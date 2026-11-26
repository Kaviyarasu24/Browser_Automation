import type { WebContents } from 'electron'
import { existsSync } from 'node:fs'
import type { PageElement, PageState } from './page-state.js'
import type { FormField, FormFieldCoordinates } from '../../shared/types.js'
import { selectCustomDropdownOption } from './form-scanner.js'
import {
  animateMouseMove,
  animateMouseClick,
  animateHighlightTarget,
  animateActionBadge,
  animateScrollCue
} from './cursor.js'

export interface ActionResult {
  ok: boolean
  /** One-line summary fed back to the model. */
  summary: string
}

/** Let the page settle after an action, but never block the loop for long. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function settle(wc: WebContents, ms = 450): Promise<void> {
  if (wc.isDestroyed()) return
  await delay(ms)
}

/**
 * Resolve an element index against a *freshly captured* page state.
 *
 * Indexes are only valid for the snapshot the model was shown. Re-reading
 * before every action is what keeps the agent from clicking whatever happens
 * to have drifted into slot 7. If the page changed shape, we say so rather
 * than acting on a stale target.
 */
async function resolveElement(
  wc: WebContents,
  index: number
): Promise<{ ok: true; el: PageElement; state: PageState } | { ok: false; error: string }> {
  const { capturePageState } = await import('./page-state.js')
  const state = await capturePageState(wc)

  if (!Number.isInteger(index) || index < 0 || index >= state.elements.length) {
    return {
      ok: false,
      error: `Element index ${index} is out of range (page has ${state.elements.length} interactive elements). Re-read the page state.`
    }
  }

  const el = state.elements[index]
  if (!el) return { ok: false, error: `Element index ${index} not found.` }

  return { ok: true, el, state }
}

/**
 * Click via real input events, NOT `element.click()`.
 *
 * `el.click()` dispatches an untrusted synthetic event that bypasses the
 * browser's user-activation bookkeeping. Sites with any bot resistance — and
 * every site that matters for this app — ignore it. `sendInputEvent` enters
 * the genuine input pipeline, sets user activation, and produces the same
 * event sequence a human click does.
 *
 * We send mouseMove first because many menus, hover states and drag handles
 * only become clickable after a move lands on them.
 */
export async function clickElement(wc: WebContents, index: number): Promise<ActionResult> {
  const resolved = await resolveElement(wc, index)
  if (!resolved.ok) return { ok: false, summary: resolved.error }

  const { el } = resolved

  if (!el.inViewport) {
    await scrollTo(wc, el.y)
  }

  // Re-read after scrolling: getBoundingClientRect is viewport-relative, so
  // coordinates captured before the scroll are now wrong.
  const after = await resolveElement(wc, index)
  if (!after.ok) return { ok: false, summary: after.error }
  const target = after.el

  const x = target.x
  const y = target.y

  if (x < 0 || y < 0) {
    return { ok: false, summary: `Element ${index} is not reachable at a valid position.` }
  }

  // Visually animate virtual mouse gliding to target position and highlight target
  await animateMouseMove(wc, x, y)
  await animateHighlightTarget(wc, target.x, target.y, target.w, target.h)
  if (target.label) {
    await animateActionBadge(wc, `Click: ${target.label.slice(0, 24)}`)
  }
  await delay(220)

  // Trigger click ripple animation
  await animateMouseClick(wc, x, y)
  await delay(120)

  wc.sendInputEvent({ type: 'mouseMove', x, y })
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })

  await settle(wc)

  return { ok: true, summary: `Clicked ${describe(target)} at (${x}, ${y}).` }
}

/**
 * Type into an element. Focuses via a real click, then inserts text.
 *
 * `insertText` is used rather than per-character key events: it is far faster
 * and, unlike setting `.value` directly, it fires the `input` event that
 * React/Vue-style frameworks listen for. Frameworks that track their own
 * state ignore a silent `.value` assignment and will submit empty fields.
 */
export async function typeInto(
  wc: WebContents,
  index: number,
  text: string,
  submit: boolean
): Promise<ActionResult> {
  const focus = await clickElement(wc, index)
  if (!focus.ok) return focus

  if (wc.isDestroyed()) return { ok: false, summary: 'Page was closed during typing.' }

  // Brisk 2x typing speed character-by-character (~25ms per char) with live action badge
  let typedBuffer = ''
  for (let i = 0; i < text.length; i++) {
    if (wc.isDestroyed()) return { ok: false, summary: 'Page was closed during typing.' }
    const ch = text[i]!
    typedBuffer += ch
    wc.insertText(ch)
    if (i % 2 === 0 || i === text.length - 1) {
      void animateActionBadge(wc, `Typing: "${typedBuffer.slice(-18)}"▎`, 500)
    }
    await delay(25)
  }

  await delay(100)

  if (submit) {
    await animateActionBadge(wc, '⏎ Enter', 600)
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    wc.sendInputEvent({ type: 'char', keyCode: '\r' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await settle(wc, 700)
    return { ok: true, summary: `Typed ${text.length} chars and pressed Enter.` }
  }

  await settle(wc, 250)
  return { ok: true, summary: `Typed ${text.length} chars into element ${index}.` }
}

export async function scrollPage(
  wc: WebContents,
  direction: 'up' | 'down',
  amount: number
): Promise<ActionResult> {
  if (wc.isDestroyed()) return { ok: false, summary: 'Page was closed.' }

  const cueText = direction === 'down' ? `↓ Scrolling Down (${amount}px)` : `↑ Scrolling Up (${amount}px)`
  await animateScrollCue(wc, cueText)

  // Position cursor in center of viewport to show scrolling activity
  await animateMouseMove(wc, 450, 350)

  const totalDelta = direction === 'down' ? Math.abs(amount) : -Math.abs(amount)
  const steps = 6
  const stepDelta = Math.round(totalDelta / steps)

  for (let i = 0; i < steps; i++) {
    if (wc.isDestroyed()) break
    // Real mouse wheel event for dynamic content & feeds
    wc.sendInputEvent({
      type: 'mouseWheel',
      x: 450,
      y: 350,
      deltaX: 0,
      deltaY: -stepDelta,
      canScroll: true
    })
    // Smooth window scroll
    await wc.executeJavaScript(
      `window.scrollBy({ top: ${stepDelta}, behavior: 'smooth' })`,
      true
    ).catch(() => {})
    await delay(60)
  }

  await settle(wc, 300)

  const y = (await wc.executeJavaScript('Math.round(window.scrollY)', true).catch(() => 0)) as number
  return { ok: true, summary: `Scrolled ${direction} to y=${y}.` }
}

/**
 * Scroll an absolute Y position into view.
 *
 * Centres the target (minus half the viewport) so an element low on the page
 * lands in the middle of the screen rather than at the very top edge, where
 * sticky headers tend to cover it.
 */
export async function scrollTo(wc: WebContents, y: number): Promise<ActionResult> {
  if (wc.isDestroyed()) return { ok: false, summary: 'Page was closed.' }

  await wc.executeJavaScript(
    `(() => {
       const target = Math.max(0, ${Math.round(y)} - window.innerHeight / 2);
       window.scrollTo({ top: target, behavior: 'smooth' });
     })()`,
    true
  )
  await settle(wc, 350)
  return { ok: true, summary: `Scrolled element into view.` }
}

export async function goBack(wc: WebContents): Promise<ActionResult> {
  if (!wc.navigationHistory.canGoBack()) {
    return { ok: false, summary: 'No previous page in history.' }
  }
  wc.navigationHistory.goBack()
  await settle(wc, 600)
  return { ok: true, summary: 'Went back one page.' }
}

export async function waitFor(wc: WebContents, seconds: number): Promise<ActionResult> {
  const clamped = Math.min(Math.max(seconds, 0.5), 15)
  await delay(clamped * 1000)
  return { ok: true, summary: `Waited ${clamped}s.` }
}

export async function pressKey(wc: WebContents, key: string): Promise<ActionResult> {
  const allowed = new Set(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'])
  if (!allowed.has(key)) {
    return { ok: false, summary: `Key "${key}" is not permitted. Allowed: ${[...allowed].join(', ')}.` }
  }

  await animateActionBadge(wc, `Key: ${key}`)

  wc.sendInputEvent({ type: 'keyDown', keyCode: key })
  wc.sendInputEvent({ type: 'keyUp', keyCode: key })
  await settle(wc, 400)
  return { ok: true, summary: `Pressed ${key}.` }
}

function describe(el: PageElement): string {
  const label = el.label ? `"${el.label.slice(0, 60)}"` : '(unlabelled)'
  return `<${el.tag}> ${label}`
}

/* ── Universal Form Automation Actions ────────────────────────────── */

export async function clickCoords(
  wc: WebContents,
  x: number,
  y: number,
  label = 'Button'
): Promise<ActionResult> {
  if (wc.isDestroyed()) return { ok: false, summary: 'Page was closed' }
  await animateMouseMove(wc, x, y)
  await animateActionBadge(wc, `Click: ${label.slice(0, 20)}`)
  await delay(120)
  await animateMouseClick(wc, x, y)
  wc.sendInputEvent({ type: 'mouseMove', x, y })
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await settle(wc, 350)
  return { ok: true, summary: `Clicked ${label} at (${x}, ${y})` }
}

async function attachDebuggerSafely(wc: WebContents): Promise<boolean> {
  if (wc.isDestroyed()) return false
  if (wc.debugger.isAttached()) return true
  try {
    wc.debugger.attach('1.3')
    return true
  } catch (err) {
    console.warn('[actions] Debugger attach error:', (err as Error).message)
    return false
  }
}

export async function uploadFileToInput(
  wc: WebContents,
  fieldIdOrSelector: string,
  filePath: string
): Promise<ActionResult> {
  if (wc.isDestroyed()) return { ok: false, summary: 'Page was closed.' }
  if (!existsSync(filePath)) {
    return { ok: false, summary: `File does not exist at path: "${filePath}"` }
  }

  const filename = filePath.split(/[/\\\\]/).pop() || 'file'
  await animateActionBadge(wc, `📎 Uploading: ${filename}`, 2200)

  try {
    const attached = await attachDebuggerSafely(wc)
    if (attached) {
      const doc = (await wc.debugger.sendCommand('DOM.getDocument', { depth: -1 })) as {
        root: { nodeId: number }
      }
      let fileInputNodeId: number | null = null

      const queries = [
        `input[id="${fieldIdOrSelector}"][type="file"]`,
        `input[name="${fieldIdOrSelector}"][type="file"]`,
        `#${fieldIdOrSelector}`,
        'input[type="file"]'
      ]

      for (const q of queries) {
        try {
          const res = (await wc.debugger.sendCommand('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: q
          })) as { nodeId: number }
          if (res && res.nodeId > 0) {
            fileInputNodeId = res.nodeId
            break
          }
        } catch {
          /* try next selector */
        }
      }

      if (fileInputNodeId) {
        await wc.debugger.sendCommand('DOM.setFileInputFiles', {
          files: [filePath],
          nodeId: fileInputNodeId
        })
        await delay(350)
        return { ok: true, summary: `Successfully attached file "${filename}" to form input.` }
      }
    }
  } catch (err) {
    console.warn('[actions] CDP upload failed:', (err as Error).message)
  }

  // Fallback trigger in page
  await wc
    .executeJavaScript(
      `(() => {
        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (fileInputs.length > 0) {
          const input = fileInputs[0];
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
      true
    )
    .catch(() => {})

  return { ok: true, summary: `Uploaded ${filename}.` }
}

interface LiveElementTarget {
  found: boolean
  x: number
  y: number
  width: number
  height: number
}

async function locateAndScrollElement(
  wc: WebContents,
  field: FormField
): Promise<LiveElementTarget | null> {
  const locateScript = `((id, name, fieldType) => {
    let el = null;
    if (id) {
      try { el = document.getElementById(id) || document.querySelector(\`#\${CSS.escape(id)}\`); } catch {}
    }
    if (!el && name) {
      try { el = document.querySelector(\`[name="\${CSS.escape(name)}"]\`); } catch {}
    }
    if (!el && id) {
      try { el = document.querySelector(\`[data-automation-id*="\${id}"]\`) || document.querySelector(\`[aria-label*="\${id}"]\`); } catch {}
    }
    if (!el) {
      // Find by matching label or placeholder
      const all = Array.from(document.querySelectorAll('input, select, textarea, [role="combobox"], button'));
      el = all.find(c => {
        const lbl = (c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.id || c.name || '').toLowerCase();
        return lbl.includes((id || name || '').toLowerCase());
      });
    }

    if (el) {
      // Smoothly center the element in viewport
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      return {
        found: true,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }
    return { found: false, x: 0, y: 0, width: 0, height: 0 };
  })(${JSON.stringify(field.id)}, ${JSON.stringify(field.name || '')}, ${JSON.stringify(field.type)})`

  try {
    const res = (await wc.executeJavaScript(locateScript, true)) as LiveElementTarget
    if (res && res.found) {
      // Allow 200ms for smooth scrolling to settle, then capture fresh coordinates
      await delay(200)
      const fresh = (await wc.executeJavaScript(`(() => {
        let el = document.getElementById(${JSON.stringify(field.id)});
        if (!el && ${JSON.stringify(field.name || '')}) {
          try { el = document.querySelector(\`[name="\${CSS.escape(${JSON.stringify(field.name || '')})}"]\`); } catch {}
        }
        if (el) {
          const r = el.getBoundingClientRect();
          return {
            found: true,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
            width: Math.round(r.width),
            height: Math.round(r.height)
          };
        }
        return null;
      })()`, true)) as LiveElementTarget | null
      return fresh || res
    }
  } catch (err) {
    console.warn('[actions] locateAndScrollElement error:', err)
  }
  return null
}

export async function fillFormField(
  wc: WebContents,
  field: FormField,
  val: string | boolean
): Promise<{ ok: boolean; verified: boolean; error?: string }> {
  if (wc.isDestroyed()) return { ok: false, verified: false, error: 'Page closed' }

  // 1. Locate and smooth-scroll element to center of viewport
  const liveTarget = await locateAndScrollElement(wc, field)
  const x = liveTarget && liveTarget.found ? liveTarget.x : field.coordinates.x
  const y = liveTarget && liveTarget.found ? liveTarget.y : field.coordinates.y
  const width = liveTarget && liveTarget.found ? liveTarget.width : field.coordinates.width
  const height = liveTarget && liveTarget.found ? liveTarget.height : field.coordinates.height
  const type = field.type

  if (type === 'file') {
    await animateMouseMove(wc, x, y)
    await animateHighlightTarget(wc, x, y, Math.max(width, 100), Math.max(height, 40))
    await animateActionBadge(wc, `📎 Attach: ${String(val).split(/[/\\\\]/).pop()}`, 2000)
    await animateMouseClick(wc, x, y)
    const uploadRes = await uploadFileToInput(wc, field.id, String(val))
    await delay(300)
    return { ok: uploadRes.ok, verified: uploadRes.ok }
  }

  // 2. Visibly glide cursor to target element
  await animateMouseMove(wc, x, y)
  await animateHighlightTarget(wc, x, y, Math.max(width, 40), Math.max(height, 26))

  // 3. Dropdown Handling (Select & Custom Dropdowns)
  if (type === 'select') {
    await animateActionBadge(wc, `Selecting: ${field.label.slice(0, 20)}`, 1400)
    await animateMouseClick(wc, x, y)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(200)

    const selectScript = `((fieldId, targetText) => {
      const sel = document.getElementById(fieldId) || document.querySelector(\`select[name="\${CSS.escape(fieldId)}"]\`) || Array.from(document.querySelectorAll('select')).find(s => s.id === fieldId || s.name === fieldId);
      if (!sel) return { found: false };
      const options = Array.from(sel.options || []);
      const match = options.find(o => o.text.trim().toLowerCase() === targetText.toLowerCase() || o.value.toLowerCase() === targetText.toLowerCase()) || options.find(o => o.text.toLowerCase().includes(targetText.toLowerCase()));
      if (match) {
        sel.value = match.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, text: match.text.trim(), val: sel.value };
      }
      return { found: false };
    })(${JSON.stringify(field.id)}, ${JSON.stringify(String(val))})`

    const res = (await wc.executeJavaScript(selectScript, true).catch(() => ({ found: false }))) as {
      found: boolean
      text?: string
    }

    if (res.found && res.text) {
      await animateActionBadge(wc, `Option: "${res.text.slice(0, 22)}"`, 1200)
    }
    await delay(350)
    return { ok: res.found, verified: res.found }
  }

  if (type === 'custom_dropdown') {
    await animateActionBadge(wc, `Dropdown: ${field.label.slice(0, 20)}`, 1400)
    await animateMouseClick(wc, x, y)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(300)

    const selRes = await selectCustomDropdownOption(wc, String(val))
    if (selRes.selectedText) {
      await animateActionBadge(wc, `Selected: "${selRes.selectedText.slice(0, 22)}"`, 1200)
    }
    await delay(350)
    return { ok: selRes.ok, verified: selRes.ok }
  }

  // 4. Radio Buttons
  if (type === 'radio') {
    const radioScript = `((name, valStr) => {
      const radios = Array.from(document.querySelectorAll(\`input[type="radio"][name="\${CSS.escape(name)}"]\`));
      for (const r of radios) {
        const text = (r.value || r.labels?.[0]?.textContent || '').trim().toLowerCase();
        if (text === valStr.toLowerCase() || text.includes(valStr.toLowerCase())) {
          r.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const rect = r.getBoundingClientRect();
          return {
            found: true,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
          };
        }
      }
      return { found: false };
    })(${JSON.stringify(field.name || field.id)}, ${JSON.stringify(String(val))})`

    const rRes = (await wc.executeJavaScript(radioScript, true).catch(() => ({ found: false }))) as {
      found: boolean
      x?: number
      y?: number
    }

    const rx = rRes.found && rRes.x ? rRes.x : x
    const ry = rRes.found && rRes.y ? rRes.y : y

    await animateMouseMove(wc, rx, ry)
    await animateActionBadge(wc, `Radio: ${String(val).slice(0, 20)}`, 1000)
    await animateMouseClick(wc, rx, ry)
    wc.sendInputEvent({ type: 'mouseMove', x: rx, y: ry })
    wc.sendInputEvent({ type: 'mouseDown', x: rx, y: ry, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x: rx, y: ry, button: 'left', clickCount: 1 })
    await delay(250)
    return { ok: true, verified: true }
  }

  // 5. Checkboxes
  if (type === 'checkbox') {
    const shouldCheck = Boolean(val)
    await animateActionBadge(wc, shouldCheck ? 'Check [✓]' : 'Uncheck [ ]', 1000)
    await animateMouseClick(wc, x, y)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(250)
    return { ok: true, verified: true }
  }

  // 6. Text / Textarea / Email / Tel / Number / Date
  await animateActionBadge(wc, `Focus: ${field.label.slice(0, 20)}`, 1000)
  await animateMouseClick(wc, x, y)
  wc.sendInputEvent({ type: 'mouseMove', x, y })
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await delay(120)

  // Clear existing text: Select All (Ctrl+A) + Backspace
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] })
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
  wc.sendInputEvent({ type: 'char', keyCode: '\b' })
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
  await delay(80)

  // Character-by-character typing at visible, crisp speed (~38ms/char)
  const textToType = String(val)
  let typedBuffer = ''
  for (let i = 0; i < textToType.length; i++) {
    if (wc.isDestroyed()) return { ok: false, verified: false, error: 'Page closed' }
    const ch = textToType[i]!
    typedBuffer += ch
    wc.insertText(ch)
    if (i % 2 === 0 || i === textToType.length - 1) {
      void animateActionBadge(wc, `Typing: "${typedBuffer.slice(-16)}"▎`, 450)
    }
    await delay(38)
  }

  await delay(150)

  // Verify value was accepted in the DOM
  const verifyScript = `((fieldId) => {
    const el = document.getElementById(fieldId) || document.querySelector(\`[name="\${CSS.escape(fieldId)}"]\`);
    if (!el) return true;
    const v = el.value || '';
    return v.trim().length > 0;
  })(${JSON.stringify(field.id)})`

  let verified = Boolean(await wc.executeJavaScript(verifyScript, true).catch(() => true))

  // Retry once if not verified
  if (!verified && !wc.isDestroyed()) {
    console.log(`[actions] Field ${field.label} not verified, retrying once...`)
    await delay(150)
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    await delay(100)
    for (const ch of textToType) {
      wc.insertText(ch)
      await delay(25)
    }
    verified = Boolean(await wc.executeJavaScript(verifyScript, true).catch(() => true))
  }

  await delay(100)
  return { ok: true, verified }
}
