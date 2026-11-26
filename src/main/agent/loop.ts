import { existsSync } from 'node:fs'
import type { TabManager } from '../browser/tabs.js'
import { validateConfig, type RuntimeConfig } from '../config.js'
import { capturePageState, formatPageState } from '../browser/page-state.js'
import {
  clickElement,
  goBack,
  pressKey,
  scrollPage,
  typeInto,
  waitFor,
  clickCoords,
  fillFormField,
  uploadFileToInput,
  type ActionResult
} from '../browser/actions.js'
import {
  checkSensitiveClick,
  checkSensitiveType,
  checkSensitiveNavigation,
  detectUserInterventionRequired
} from '../browser/safeguards.js'
import {
  animateMouseMove,
  animateActionBadge,
  animateNavigateUrl,
  animateScanning,
  startCursorHeartbeat,
  stopCursorHeartbeat
} from '../browser/cursor.js'
import { exportDataToFile, setOnDownloadComplete } from '../browser/downloads.js'
import { scanForm, type ScanResult } from '../browser/form-scanner.js'
import { loadProfile } from '../profile/profile.js'
import { mapFormFields, saveAnswerToCache, type MappedField } from './field-mapper.js'
import { getAdapter } from '../browser/adapters/index.js'
import { recordApplication } from '../tracker/applications.js'
import { BROWSER_TOOLS } from './tools.js'
import { LlmError, complete, type ChatMessage, type ToolCall } from './llm.js'
import type { AgentEvent, FormFieldReviewItem, JobStatus } from '../../shared/types.js'

const MAX_STEPS = 60

const SYSTEM_PROMPT = `You are EDITH (Even Dead, I'm The Hero), an ultra-fast, intelligent browser automation and job application AI agent operating EDITH Browser on the user's behalf. The browser has the user's authentic, logged-in sessions.

Universal Form Filling & Job Application Strategy:
1. When navigating to an application page or job link, first call scan_form to detect all form fields, input types, dropdowns, and file upload zones.
2. Call fill_form to map and populate fields using the candidate's profile and cached answers.
3. For file inputs (resume, CV, cover letter), use upload_file to attach candidate documents.
4. On multi-step applications, verify the current step, then call next_step to advance to subsequent sections.
5. If fields have low confidence or require verification, call review_form to present a structured summary to the user before proceeding.
6. When the application is completely filled and reviewed, call submit_form to finalize. Remember: final submission requires explicit user authorization. In dry-run mode, never submit.
7. NEVER auto-answer demographic, veteran, disability, or EEO survey questions with candidate identity — select 'Prefer not to say' / 'Decline' or flag for review.
8. NEVER type passwords. If a sign-in wall, CAPTCHA, or verification code appears, pause and ask the user to complete it in the browser.
9. Aim to finish forms accurately in the fewest steps. If validation errors appear, re-scan and fix the flagged fields.`

export interface RunOptions {
  task: string
  cfg: RuntimeConfig
  tabs: TabManager
  emit: (event: AgentEvent) => void
  confirm: (info: {
    title: string
    description: string
    action: string
    target?: string
  }) => Promise<boolean>
  reviewForm?: (
    fields: FormFieldReviewItem[]
  ) => Promise<{ approved: boolean; editedFields?: Record<string, string | boolean> }>
  waitForIntervention?: (info: {
    reason: 'captcha' | 'login' | 'otp' | 'verification' | 'other'
    title: string
    message: string
  }) => Promise<boolean>
  dryRun?: boolean
  signal: AbortSignal
  onJobStatusChange?: (status: JobStatus, notes?: string) => void
}

interface DoneResult {
  summary: string
  success: boolean
}

/**
 * The agent loop.
 *
 * Shape is deliberately the classic one: read state → ask model → run tool →
 * feed result back → repeat. Each iteration re-reads nothing automatically;
 * the model decides via `read_page` when it needs fresh state. That keeps the
 * context smaller and makes the loop's behaviour legible in the action log.
 */
export async function runAgent(opts: RunOptions): Promise<void> {
  const { task, cfg, tabs, emit, confirm, signal } = opts
  const started = Date.now()

  const problems = validateConfig(cfg)
  if (problems.length > 0) {
    emit({
      type: 'error',
      message: 'The LLM is not configured.',
      hint: `${problems.join('; ')}. Edit .env in the project root and restart.`
    })
    return
  }

  const wc = tabs.getActiveWebContents()
  if (!wc) {
    emit({
      type: 'error',
      message: 'No active tab.',
      hint: 'Open a tab and navigate to a page before running a task.'
    })
    return
  }

  emit({ type: 'start', task, model: cfg.model })
  startCursorHeartbeat(wc)
  void animateMouseMove(wc, 350, 250)
  void animateActionBadge(wc, '🕶️ EDITH Active', 2500)

  setOnDownloadComplete((rec) => {
    emit({
      type: 'download',
      filename: rec.filename,
      path: rec.savePath,
      size: rec.totalBytes,
      state: 'completed'
    })
    void animateActionBadge(wc, `📥 Downloaded: ${rec.filename}`, 2500)
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildTaskMessage(task, wc.getURL()) }
  ]

  let step = 0
  let cumulativePrompt = 0
  let cumulativeCompletion = 0
  let cumulativeTotal = 0

  try {
    for (step = 1; step <= MAX_STEPS; step++) {
      if (signal.aborted) {
        emit({ type: 'cancelled' })
        return
      }

      // Check for human intervention triggers (CAPTCHAs, OTPs, Workday login wall)
      const intervention = await detectUserInterventionRequired(wc)
      if (intervention && intervention.required && opts.waitForIntervention) {
        emit({
          type: 'user_intervention_required',
          id: String(Date.now()),
          reason: intervention.reason,
          title: intervention.title,
          message: intervention.message
        })
        await opts.waitForIntervention(intervention)
        await new Promise((r) => setTimeout(r, 600))
      }

      const result = await complete(cfg, messages, BROWSER_TOOLS, signal)

      if (result.usage) {
        cumulativePrompt += result.usage.prompt
        cumulativeCompletion += result.usage.completion
        cumulativeTotal += result.usage.total
        emit({
          type: 'usage',
          prompt: cumulativePrompt,
          completion: cumulativeCompletion,
          total: cumulativeTotal,
          step
        })
      }

      if (result.content.trim()) {
        emit({ type: 'thinking', step, text: result.content.trim() })
      }

      // No tool calls means the model answered in prose. Treat that as the
      // answer and stop — otherwise the loop spins forever waiting for a
      // tool call that never comes.
      if (result.toolCalls.length === 0) {
        const prose = result.content.trim() || '(the model returned no text)'
        emit({ type: 'done', summary: prose, steps: step, totalTokens: cumulativeTotal })
        return
      }

      messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls
      })

      for (const call of result.toolCalls) {
        if (signal.aborted) {
          emit({ type: 'cancelled' })
          return
        }

        const args = parseArgs(call, emit, step)
        emit({ type: 'tool', step, name: call.function.name, args })

        const outcome = await executeTool(
          call.function.name,
          args,
          opts,
          step
        )

        messages.push(toolMessage(call, JSON.stringify(outcome.result)))
        pruneHistorySnapshots(messages)

        // `done` ends the run immediately.
        if (outcome.done) {
          emit({
            type: 'done',
            summary: outcome.done.summary,
            steps: step,
            totalTokens: cumulativeTotal
          })
          return
        }
      }
    }

    emit({
      type: 'done',
      summary: `Stopped after the ${MAX_STEPS}-step limit without finishing. Last known state: the agent was still working on: ${task}`,
      steps: MAX_STEPS,
      totalTokens: cumulativeTotal
    })
  } catch (err) {
    if (signal.aborted || (err as Error).name === 'AbortError') {
      emit({ type: 'cancelled' })
      return
    }

    if (err instanceof LlmError) {
      emit({ type: 'error', message: err.message, hint: err.hint })
      return
    }

    console.error('[agent] unexpected failure:', err)
    emit({
      type: 'error',
      message: `The agent stopped unexpectedly: ${(err as Error).message}`,
      hint: `Ran for ${Math.round((Date.now() - started) / 1000)}s over ${step} step(s).`
    })
  } finally {
    setOnDownloadComplete(null)
    stopCursorHeartbeat()
  }
}

function buildTaskMessage(task: string, currentUrl: string): string {
  return `TASK: ${task}\n\nYou are currently on: ${currentUrl}\n\nBegin by calling read_page to see the current page.`
}

/** Malformed JSON from the model is common enough to handle explicitly. */
function parseArgs(
  call: ToolCall,
  emit: (e: AgentEvent) => void,
  step: number
): Record<string, unknown> {
  const raw = call.function.arguments
  if (!raw || raw.trim() === '') return {}

  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    console.warn(`[agent] unparseable tool arguments for ${call.function.name}: ${raw.slice(0, 200)}`)
    emit({
      type: 'result',
      step,
      name: call.function.name,
      ok: false,
      summary: 'Arguments were not valid JSON; nothing was executed.'
    })
    return { __malformed: true }
  }
}

function toolMessage(call: ToolCall, content: string): ChatMessage {
  return { role: 'tool', tool_call_id: call.id, name: call.function.name, content }
}

/**
 * Keeps only the single most recent page snapshot in conversation history.
 * Collapses all prior snapshots into a compact placeholder, saving ~70% of tokens.
 */
function pruneHistorySnapshots(messages: ChatMessage[]): void {
  let lastSnapshotIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('"page":')) {
      lastSnapshotIndex = i
      break
    }
  }

  if (lastSnapshotIndex <= 0) return

  for (let i = 0; i < lastSnapshotIndex; i++) {
    const msg = messages[i]
    if (msg?.role === 'tool' && typeof msg.content === 'string' && msg.content.includes('"page":')) {
      try {
        const parsed = JSON.parse(msg.content)
        if (parsed && parsed.page) {
          parsed.page = '[Previous page snapshot collapsed to save tokens; current active page is in the latest step]'
          msg.content = JSON.stringify(parsed)
        }
      } catch {
        /* ignore */
      }
    }
  }
}

interface ToolOutcome {
  result: unknown
  done?: DoneResult
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  opts: RunOptions,
  step: number
): Promise<ToolOutcome> {
  const { tabs, signal, emit, confirm } = opts
  if (args.__malformed) {
    return {
      result: {
        ok: false,
        error: 'Your tool arguments were not valid JSON. Re-issue the call with valid JSON.'
      }
    }
  }

  const wc = tabs.getActiveWebContents()
  if (!wc || wc.isDestroyed()) {
    return { result: { ok: false, error: 'No active page. It may have been closed.' } }
  }

  // Helper so every branch reports the same way and cannot forget to emit.
  const report = (r: ActionResult, extra?: Record<string, unknown>): ToolOutcome => {
    emit({
      type: 'result',
      step,
      name,
      ok: r.ok,
      summary: r.summary
    })
    return { result: { ok: r.ok, summary: r.summary, ...extra } }
  }

  try {
    switch (name) {
      case 'read_page': {
        await animateScanning(wc)
        const state = await capturePageState(wc)
        emit({
          type: 'result',
          step,
          name,
          ok: true,
          summary: `Read ${state.elements.length} elements from ${state.title || state.url}`
        })
        // Return the formatted text the model consumes.
        return { result: { ok: true, page: formatPageState(state) } }
      }

      case 'navigate': {
        const url = requireString(args, 'url')
        if (!url) return report({ ok: false, summary: 'navigate needs a "url" string.' })

        const target = normaliseUrl(url)
        if (!target) return report({ ok: false, summary: `"${url}" is not a usable URL.` })

        const check = checkSensitiveNavigation(target, wc.getURL())
        if (check.sensitive) {
          const approved = await confirm({
            title: check.title,
            description: check.description,
            action: 'navigate',
            target
          })
          if (!approved) {
            return report({
              ok: false,
              summary: `Navigation blocked: User declined confirmation to navigate to external domain ${target}.`
            })
          }
        }

        // Emit navigating event to UI so address bar animates at 2x speed
        emit({ type: 'navigating', url: target })

        // Animate virtual cursor gliding to URL bar, clicking, and typing URL at 2x speed
        await animateNavigateUrl(wc, target)

        await wc.loadURL(target).catch((err: Error) => {
          throw new Error(`navigation failed: ${err.message}`)
        })
        await new Promise((r) => setTimeout(r, 450))
        const stateAfterNav = await capturePageState(wc)
        const pageAfterNav = formatPageState(stateAfterNav)
        return report(
          { ok: true, summary: `Navigated to ${target}. Automatically loaded ${stateAfterNav.elements.length} interactive elements.` },
          { url: target, page: pageAfterNav }
        )
      }

      case 'click': {
        const index = requireInt(args, 'index')
        if (index === null) return report({ ok: false, summary: 'click needs an integer "index".' })

        const state = await capturePageState(wc)
        const el = state.elements[index]
        if (el) {
          const check = checkSensitiveClick(el)
          if (check.sensitive) {
            const approved = await confirm({
              title: check.title,
              description: check.description,
              action: 'click',
              target: `<${el.tag}> ${el.label || '(unlabelled)'}`
            })
            if (!approved) {
              return report({
                ok: false,
                summary: 'Action blocked: User declined confirmation to click this sensitive element.'
              })
            }
          }
        }

        const clickRes = await clickElement(wc, index)
        if (!clickRes.ok) return report(clickRes)

        await new Promise((r) => setTimeout(r, 350))
        const stateAfterClick = await capturePageState(wc)
        const pageAfterClick = formatPageState(stateAfterClick)
        return report(
          { ok: true, summary: `${clickRes.summary} Updated page has ${stateAfterClick.elements.length} interactive elements.` },
          { page: pageAfterClick }
        )
      }

      case 'type': {
        const index = requireInt(args, 'index')
        const text = requireString(args, 'text')
        if (index === null) return report({ ok: false, summary: 'type needs an integer "index".' })
        if (text === null) return report({ ok: false, summary: 'type needs a "text" string.' })

        const state = await capturePageState(wc)
        const el = state.elements[index]
        if (el) {
          const check = checkSensitiveType(el, text)
          if (check.sensitive) {
            const approved = await confirm({
              title: check.title,
              description: check.description,
              action: 'type',
              target: `<${el.tag}> ${el.label || ''}`
            })
            if (!approved) {
              return report({
                ok: false,
                summary: 'Action blocked: User declined confirmation to type into this sensitive field.'
              })
            }
          }
        }

        const submit = args.submit === true
        const typeRes = await typeInto(wc, index, text, submit)
        if (!typeRes.ok) return report(typeRes)

        if (submit) {
          await new Promise((r) => setTimeout(r, 450))
          const stateAfterSubmit = await capturePageState(wc)
          const pageAfterSubmit = formatPageState(stateAfterSubmit)
          return report(
            { ok: true, summary: `${typeRes.summary} Submitted. Loaded ${stateAfterSubmit.elements.length} elements.` },
            { page: pageAfterSubmit }
          )
        }
        return report(typeRes)
      }

      case 'scroll': {
        const direction = args.direction === 'up' ? 'up' : 'down'
        const amount = requireInt(args, 'amount') ?? 800
        return report(await scrollPage(wc, direction, amount))
      }

      case 'go_back': {
        await animateActionBadge(wc, '← Going Back', 1200)
        return report(await goBack(wc))
      }

      case 'press_key': {
        const key = requireString(args, 'key')
        if (!key) return report({ ok: false, summary: 'press_key needs a "key" string.' })
        return report(await pressKey(wc, key))
      }

      case 'wait': {
        const seconds = typeof args.seconds === 'number' ? args.seconds : 2
        await animateActionBadge(wc, `⏳ Waiting (${seconds}s)...`, seconds * 1000)
        return report(await waitFor(wc, seconds))
      }

      case 'open_tab': {
        const url = requireString(args, 'url')
        if (!url) return report({ ok: false, summary: 'open_tab needs a "url" string.' })
        const target = normaliseUrl(url)
        if (!target) return report({ ok: false, summary: `"${url}" is not a usable URL.` })

        tabs.create(target, false)
        return report(
          { ok: true, summary: `Opened ${target} in a background tab.` },
          { url: target }
        )
      }

      case 'export_data': {
        const content = requireString(args, 'content')
        if (!content) return report({ ok: false, summary: 'export_data requires a "content" string.' })
        const filename = typeof args.filename === 'string' ? args.filename : undefined
        const format = typeof args.format === 'string' ? args.format : 'txt'

        const res = exportDataToFile(content, filename, format)
        if (!res.ok) {
          return report({ ok: false, summary: `Export failed: ${res.error}` })
        }

        emit({
          type: 'download',
          filename: res.filename!,
          path: res.path!,
          size: res.size!,
          state: 'completed'
        })
        void animateActionBadge(wc, `💾 Exported ${res.filename}`, 2500)

        return report(
          {
            ok: true,
            summary: `Successfully saved ${res.filename} (${res.size} bytes) to ${res.path}.`
          },
          { path: res.path, filename: res.filename }
        )
      }

      case 'scan_form': {
        const scan = await scanForm(wc)
        emit({
          type: 'form_scan_completed',
          step,
          fieldsCount: scan.fields.length,
          fields: scan.fields.map((f) => ({
            id: f.id,
            label: f.label,
            type: f.type,
            required: f.required,
            hasValue: Boolean(f.currentValue)
          }))
        })
        const summary = `Scanned form on "${scan.title}". Found ${scan.fields.length} inputs (${scan.fields.filter((f) => f.required).length} required).`
        return report(
          {
            ok: true,
            summary:
              summary +
              (scan.validationErrors.length
                ? ` Validation errors: ${scan.validationErrors.join(', ')}`
                : '')
          },
          {
            fields: scan.fields.map((f) => ({
              id: f.id,
              label: f.label,
              type: f.type,
              required: f.required,
              currentValue: f.currentValue,
              options: f.options?.map((o) => o.label)
            })),
            hasSubmitButton: scan.hasSubmitButton,
            hasNextButton: scan.hasNextButton,
            validationErrors: scan.validationErrors
          }
        )
      }

      case 'fill_form': {
        const profile = loadProfile()
        if (!profile) {
          return report({
            ok: false,
            summary: 'No user profile found. Please create profile.json in userData or app root.'
          })
        }

        const dryRun = args.dryRun === true || opts.dryRun === true
        const reviewFirst = args.reviewFirst === true

        opts.onJobStatusChange?.('filling', 'Mapping and filling fields')
        await animateActionBadge(wc, '📋 Scanning & Mapping Form...', 1800)

        const scan = await scanForm(wc)
        if (scan.fields.length === 0) {
          return report({ ok: false, summary: 'No form fields detected on active page.' })
        }

        // Check adapter hooks
        const adapter = getAdapter(wc.getURL(), scan.title)
        if (adapter?.quirks.beforeFill) {
          await adapter.quirks.beforeFill(wc)
        }

        const mapped = await mapFormFields(scan.fields, profile, opts.cfg, {
          title: scan.title,
          company: scan.title.split('-')[0]?.trim()
        })

        // Review step if requested or if low confidence/EEO fields exist
        const fieldsNeedingReview = mapped.filter((m) => m.needsReview || m.confidence < 0.7)
        if ((reviewFirst || fieldsNeedingReview.length > 0) && opts.reviewForm) {
          opts.onJobStatusChange?.('needs_review', 'Waiting for user review')
          const reviewItems: FormFieldReviewItem[] = mapped.map((m) => ({
            id: m.fieldId,
            fieldId: m.fieldId,
            label: m.label,
            type: m.type as any,
            currentValue: scan.fields.find((f) => f.id === m.fieldId)?.currentValue || null,
            proposedValue: m.value,
            source: m.source,
            confidence: m.confidence,
            required: scan.fields.find((f) => f.id === m.fieldId)?.required || false,
            approved: !m.needsReview,
            options: m.options
          }))

          const reviewRes = await opts.reviewForm(reviewItems)
          if (!reviewRes.approved) {
            opts.onJobStatusChange?.('needs_manual', 'Review rejected by user')
            return report({ ok: false, summary: 'Form filling cancelled by user during review.' })
          }

          // Apply any edited field values from user
          if (reviewRes.editedFields) {
            for (const [fId, val] of Object.entries(reviewRes.editedFields)) {
              const item = mapped.find((m) => m.fieldId === fId)
              if (item) {
                item.value = val
                item.source = 'manual'
                item.confidence = 1.0
                saveAnswerToCache(item.label, String(val))
              }
            }
          }
        }

        // Fill fields sequentially
        let filledCount = 0
        let retryCount = 0
        for (const m of mapped) {
          if (signal.aborted) throw new Error('Aborted')
          if (m.value === null || m.value === undefined || m.value === '') continue

          const field = scan.fields.find((f) => f.id === m.fieldId)
          if (!field) continue

          emit({
            type: 'form_fill_progress',
            step,
            fieldId: field.id,
            label: field.label,
            value: String(m.value),
            status: 'filling'
          })

          const fillRes = await fillFormField(wc, field, m.value)
          if (fillRes.ok) {
            filledCount++
            if (typeof m.value === 'string' && m.source !== 'rule') {
              saveAnswerToCache(field.label, m.value)
            }
            emit({
              type: 'form_fill_progress',
              step,
              fieldId: field.id,
              label: field.label,
              value: String(m.value),
              status: fillRes.verified ? 'verified' : 'filled'
            })
          } else {
            emit({
              type: 'form_fill_progress',
              step,
              fieldId: field.id,
              label: field.label,
              value: String(m.value),
              status: 'failed'
            })
          }
        }

        // Re-scan to check for validation errors
        await new Promise((r) => setTimeout(r, 350))
        let postScan = await scanForm(wc)

        // Validation error recovery (up to 2 retries)
        while (postScan.validationErrors.length > 0 && retryCount < 2) {
          retryCount++
          console.log(
            `[loop] Validation errors detected (attempt ${retryCount}/2):`,
            postScan.validationErrors
          )
          await animateActionBadge(wc, `Fixing validation errors (${retryCount}/2)...`, 1500)

          for (const err of postScan.validationErrors) {
            const fieldNameOrLabel = err.split(':')[0]?.trim().toLowerCase()
            const fieldToFix = postScan.fields.find(
              (f) =>
                f.label.toLowerCase().includes(fieldNameOrLabel || '') ||
                f.id.toLowerCase().includes(fieldNameOrLabel || '')
            )
            if (fieldToFix) {
              const remapped = await mapFormFields([fieldToFix], profile, opts.cfg)
              const reVal = remapped[0]?.value
              if (reVal) {
                await fillFormField(wc, fieldToFix, reVal)
              }
            }
          }
          await new Promise((r) => setTimeout(r, 400))
          postScan = await scanForm(wc)
        }

        if (adapter?.quirks.afterFill) {
          await adapter.quirks.afterFill(wc)
        }

        const dryRunMsg = dryRun ? ' (Dry-run mode: submission disabled)' : ''
        const errorMsg =
          postScan.validationErrors.length > 0
            ? ` Warnings/Errors: ${postScan.validationErrors.join('; ')}`
            : ''

        return report(
          {
            ok: true,
            summary: `Successfully filled ${filledCount} fields.${dryRunMsg}${errorMsg}`
          },
          {
            filledCount,
            validationErrors: postScan.validationErrors,
            hasNextButton: postScan.hasNextButton,
            hasSubmitButton: postScan.hasSubmitButton
          }
        )
      }

      case 'upload_file': {
        const profile = loadProfile()
        const fileType = requireString(args, 'fileType') || 'resume'
        const customPath = requireString(args, 'customPath')
        const fieldId = requireString(args, 'fieldId') || 'resume'

        let filePath: string | null = customPath
        if (!filePath) {
          if (fileType === 'cover_letter') {
            if (profile?.coverLetterTemplate && !existsSync(profile.coverLetterTemplate)) {
              const exp = exportDataToFile(profile.coverLetterTemplate, 'cover_letter.txt', 'txt')
              filePath = exp.path || null
            } else {
              filePath = profile?.coverLetterTemplate || null
            }
          } else {
            filePath = profile?.resumePath || null
          }
        }

        if (!filePath || !existsSync(filePath)) {
          return report({
            ok: false,
            summary: `File upload failed: No valid ${fileType} file found at "${filePath || '(empty)'}". Check resumePath in profile.json.`
          })
        }

        const uploadRes = await uploadFileToInput(wc, fieldId, filePath)
        return report(uploadRes)
      }

      case 'next_step': {
        const scan = await scanForm(wc)
        if (scan.validationErrors.length > 0) {
          return report({
            ok: false,
            summary: `Cannot advance: form has validation errors: ${scan.validationErrors.join('; ')}. Fix them first.`
          })
        }

        let nextCoords = scan.nextButtonCoordinates
        const adapter = getAdapter(wc.getURL())
        if (!nextCoords && adapter?.quirks.nextSelector) {
          const sel = adapter.quirks.nextSelector
          const coords = (await wc
            .executeJavaScript(
              `(() => {
                const btn = document.querySelector(${JSON.stringify(sel)});
                if (btn) {
                  btn.scrollIntoView({ block: 'center' });
                  const r = btn.getBoundingClientRect();
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }
                return null;
              })()`,
              true
            )
            .catch(() => null)) as { x: number; y: number } | null
          if (coords) nextCoords = { x: coords.x, y: coords.y, width: 80, height: 35 }
        }

        if (!nextCoords) {
          return report({
            ok: false,
            summary:
              'Next / Continue button not found. You may be on the final page or need to click an element manually.'
          })
        }

        await clickCoords(wc, nextCoords.x, nextCoords.y, 'Next Step')
        await new Promise((r) => setTimeout(r, 650))
        const newScan = await scanForm(wc)
        return report(
          {
            ok: true,
            summary: `Advanced to next step. Found ${newScan.fields.length} fields on new page (${newScan.hasSubmitButton ? 'Submit button visible' : 'Multi-step in progress'}).`
          },
          {
            fieldsCount: newScan.fields.length,
            hasSubmitButton: newScan.hasSubmitButton,
            hasNextButton: newScan.hasNextButton
          }
        )
      }

      case 'review_form': {
        const profile = loadProfile()
        if (!profile) return report({ ok: false, summary: 'No profile found' })
        const scan = await scanForm(wc)
        const mapped = await mapFormFields(scan.fields, profile, opts.cfg)

        if (opts.reviewForm) {
          const reviewItems: FormFieldReviewItem[] = mapped.map((m) => ({
            id: m.fieldId,
            fieldId: m.fieldId,
            label: m.label,
            type: m.type as any,
            currentValue: scan.fields.find((f) => f.id === m.fieldId)?.currentValue || null,
            proposedValue: m.value,
            source: m.source,
            confidence: m.confidence,
            required: scan.fields.find((f) => f.id === m.fieldId)?.required || false,
            approved: !m.needsReview,
            options: m.options
          }))

          const res = await opts.reviewForm(reviewItems)
          return report({
            ok: res.approved,
            summary: res.approved ? 'Form review approved by user.' : 'Form review rejected by user.'
          })
        }

        return report({ ok: true, summary: `Form has ${mapped.length} fields mapped.` })
      }

      case 'submit_form': {
        const dryRun = args.dryRun === true || opts.dryRun === true
        if (dryRun) {
          opts.onJobStatusChange?.('submitted', 'Dry-run completed (submission skipped)')
          return report({
            ok: true,
            summary: 'Dry-run mode is ACTIVE: All form fields verified. Final submission was skipped.'
          })
        }

        const confirmed = args.confirmed === true
        if (!confirmed) {
          return report({
            ok: false,
            summary: 'submit_form requires confirmed=true.'
          })
        }

        // Always require user confirmation safeguard for final submit
        const approved = await opts.confirm({
          title: 'Confirm Final Application Submission',
          description: `The agent is ready to submit your job application on ${wc.getTitle() || wc.getURL()}. Do you want to submit now?`,
          action: 'submit_form',
          target: wc.getURL()
        })

        if (!approved) {
          opts.onJobStatusChange?.('needs_manual', 'Submission cancelled by user')
          return report({
            ok: false,
            summary: 'Submission blocked: User declined confirmation to submit application.'
          })
        }

        const scan = await scanForm(wc)
        let submitCoords = scan.submitButtonCoordinates
        const adapter = getAdapter(wc.getURL())
        if (!submitCoords && adapter?.quirks.submitSelector) {
          const coords = (await wc
            .executeJavaScript(
              `(() => {
                const btn = document.querySelector(${JSON.stringify(adapter.quirks.submitSelector)});
                if (btn) {
                  btn.scrollIntoView({ block: 'center' });
                  const r = btn.getBoundingClientRect();
                  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }
                return null;
              })()`,
              true
            )
            .catch(() => null)) as { x: number; y: number } | null
          if (coords) submitCoords = { x: coords.x, y: coords.y, width: 80, height: 35 }
        }

        if (!submitCoords) {
          return report({
            ok: false,
            summary: 'Submit button not located on the page.'
          })
        }

        await clickCoords(wc, submitCoords.x, submitCoords.y, 'Submit Application')
        await new Promise((r) => setTimeout(r, 1200))

        // Record application in CSV
        const dateStr = new Date().toISOString().split('T')[0] || ''
        const pageTitle = wc.getTitle() || ''
        const roleName = pageTitle.split('-')[0]?.trim() || 'Software Engineer'
        const companyName = pageTitle.split('-')[1]?.trim() || new URL(wc.getURL()).hostname

        const trackRes = recordApplication({
          date: dateStr,
          company: companyName,
          role: roleName,
          url: wc.getURL(),
          status: 'submitted',
          notes: 'Submitted via EDITH Browser universal form automation'
        })

        opts.onJobStatusChange?.('submitted', 'Application submitted')
        await animateActionBadge(wc, '🎉 Application Submitted!', 3500)

        return report({
          ok: true,
          summary: `Application submitted successfully! Recorded to ${trackRes.path}.`
        })
      }

      case 'done': {
        const summary = requireString(args, 'summary') ?? 'Task finished with no summary.'
        const success = args.success !== false

        await animateActionBadge(wc, success ? '🎉 Task Complete!' : '⏹ Finished', 3000)
        emit({ type: 'result', step, name, ok: true, summary })
        return {
          result: { ok: true, summary: 'Run complete.' },
          done: { summary, success }
        }
      }

      default:
        return report({
          ok: false,
          summary: `Unknown tool "${name}". Available: ${BROWSER_TOOLS.map((t) => t.function.name).join(', ')}.`
        })
    }
  } catch (err) {
    // A tool throwing must not kill the run — report it and let the model adapt.
    const message = (err as Error).message
    if (signal.aborted) throw err
    return report({ ok: false, summary: `Tool failed: ${message}` })
  }
}

/* ── argument coercion ──────────────────────────────────────────────
 * Models routinely send numbers as strings ("3") and occasionally send a
 * string where an object is expected. Coerce rather than reject, so a
 * harmless type slip does not burn a step.                              */

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key]
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function requireInt(args: Record<string, unknown>, key: string): number | null {
  const v = args[key]
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Accept a bare domain by assuming https.
 * `example.com` -> `https://example.com`. Anything unparseable returns null.
 */
function normaliseUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).toString()
    } catch {
      return null
    }
  }

  // Reject non-web schemes the model might hallucinate.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[\w-]+(\.[\w-]+)+/.test(trimmed)) {
    return null
  }

  try {
    return new URL(`https://${trimmed}`).toString()
  } catch {
    return null
  }
}
