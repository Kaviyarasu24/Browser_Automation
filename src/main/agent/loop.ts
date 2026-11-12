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
  type ActionResult
} from '../browser/actions.js'
import {
  checkSensitiveClick,
  checkSensitiveType,
  checkSensitiveNavigation
} from '../browser/safeguards.js'
import {
  animateMouseMove,
  animateActionBadge,
  animateNavigateUrl,
  animateScanning,
  startCursorHeartbeat,
  stopCursorHeartbeat
} from '../browser/cursor.js'
import { BROWSER_TOOLS } from './tools.js'
import { LlmError, complete, type ChatMessage, type ToolCall } from './llm.js'
import type { AgentEvent } from '../../shared/types.js'

const MAX_STEPS = 25

const SYSTEM_PROMPT = `You are an ultra-fast, efficient browser automation agent operating a real browser on the user's behalf. The browser has the user's own logged-in sessions. Never ask the user to log in or provide credentials.

How to work with maximum efficiency:
1. Navigate directly to relevant domains or search URLs (e.g. https://www.google.com/search?q=... or https://cricbuzz.com) instead of searching multiple intermediate portals.
2. Both navigate, click, and search typing automatically return the fresh page state and interactive elements. Do NOT waste a step calling read_page immediately after navigate or click.
3. Refer to elements by the index shown in the most recent page snapshot.
4. Only call read_page if you explicitly scrolled or need a fresh re-inspection.
5. When the goal is met, call done immediately with the real answer and findings.

Rules:
- Aim to finish tasks in the fewest possible steps.
- Do not repeat an action that just failed. Try an alternate path or report the blocker.
- Keep your non-tool text brief. The action log is what the user reads.`

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
  signal: AbortSignal
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
  void animateActionBadge(wc, '🍓 Strawberry Agent Active', 2500)

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
          tabs,
          signal,
          emit,
          confirm,
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
  tabs: TabManager,
  signal: AbortSignal,
  emit: (e: AgentEvent) => void,
  confirm: (info: {
    title: string
    description: string
    action: string
    target?: string
  }) => Promise<boolean>,
  step: number
): Promise<ToolOutcome> {
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
