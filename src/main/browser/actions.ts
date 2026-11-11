import type { WebContents } from 'electron'
import type { PageElement, PageState } from './page-state.js'
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

  await animateActionBadge(wc, `Typing: ${text.slice(0, 16)}${text.length > 16 ? '…' : ''}`)
  wc.insertText(text)
  await delay(120)

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
