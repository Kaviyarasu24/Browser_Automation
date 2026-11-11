import type { WebContents } from 'electron'

/**
 * High-visibility persistent virtual mouse cursor system for Strawberry.
 * Maintains cursor state across page navigations, SPAs, and full page reloads,
 * ensuring the cursor remains visible at all times once an agent task begins.
 */

let lastX = 350
let lastY = 220
let heartbeatTimer: NodeJS.Timeout | null = null
let activeWebContents: WebContents | null = null

function getCursorScript(initialX: number, initialY: number): string {
  return `
(() => {
  let host = document.getElementById('__strawberry_cursor_host');
  if (host && window.__strawberryCursor) {
    // Already active, just make sure visible
    host.style.display = 'block';
    return window.__strawberryCursor;
  }

  if (host) host.remove();

  host = document.createElement('div');
  host.id = '__strawberry_cursor_host';
  host.setAttribute('style', 'position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:2147483647!important;overflow:hidden!important;display:block!important;opacity:1!important;visibility:visible!important;');
  (document.body || document.documentElement).appendChild(host);

  const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  // Safe style injection without innerHTML (CSP immune)
  const style = document.createElement('style');
  style.textContent = \`
    * { pointer-events: none !important; }
    .cursor-wrapper {
      position: fixed;
      top: 0;
      left: 0;
      width: 32px;
      height: 32px;
      z-index: 2147483647;
      transform: translate3d(\${${Math.round(initialX)}}px, \${${Math.round(initialY)}}px, 0);
      transition: transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
      will-change: transform;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.65));
      display: block !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    .cursor-svg {
      width: 28px;
      height: 28px;
      transform-origin: 3px 3px;
      transition: transform 0.1s ease;
    }
    .cursor-wrapper.pressing .cursor-svg {
      transform: scale(0.78);
    }
    .cursor-tip-glow {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ff3366;
      box-shadow: 0 0 14px 4px #ff3366;
      animation: tip-pulse 1.2s infinite ease-in-out;
    }
    @keyframes tip-pulse {
      0%, 100% { transform: scale(0.85); opacity: 0.85; }
      50% { transform: scale(1.35); opacity: 1; }
    }
    .ripple {
      position: fixed;
      border-radius: 50%;
      border: 3px solid #ff3366;
      background: rgba(255, 51, 102, 0.45);
      transform: translate(-50%, -50%) scale(0.1);
      animation: ripple-fx 0.5s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
      z-index: 2147483646;
    }
    @keyframes ripple-fx {
      0% {
        width: 14px;
        height: 14px;
        transform: translate(-50%, -50%) scale(0.2);
        opacity: 1;
      }
      100% {
        width: 65px;
        height: 65px;
        transform: translate(-50%, -50%) scale(1);
        opacity: 0;
      }
    }
    .highlight-box {
      position: fixed;
      border: 2px solid #ff3366;
      background: rgba(255, 51, 102, 0.18);
      border-radius: 6px;
      z-index: 2147483645;
      box-shadow: 0 0 16px rgba(255, 51, 102, 0.5);
      transition: all 0.18s ease;
      animation: highlight-pulse 0.35s ease-out;
    }
    @keyframes highlight-pulse {
      0% { opacity: 0; transform: scale(0.95); }
      100% { opacity: 1; transform: scale(1); }
    }
    .badge {
      position: absolute;
      left: 24px;
      top: 18px;
      padding: 4px 10px;
      background: #18181c;
      color: #ffffff;
      border: 1px solid #ff3366;
      border-radius: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.3px;
      white-space: nowrap;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      z-index: 2147483647;
    }
    .badge.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .scroll-cue {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      padding: 10px 22px;
      background: rgba(18, 18, 22, 0.92);
      color: #ff3366;
      border: 2px solid #ff3366;
      border-radius: 30px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.7);
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.2s ease;
      z-index: 2147483647;
    }
    .scroll-cue.visible {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.05);
    }
  \`;
  shadow.appendChild(style);

  // Build Cursor DOM safely without innerHTML
  const wrapper = document.createElement('div');
  wrapper.className = 'cursor-wrapper';
  wrapper.id = 'strawberry-cursor';

  const tipGlow = document.createElement('div');
  tipGlow.className = 'cursor-tip-glow';
  wrapper.appendChild(tipGlow);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'cursor-svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4.5 2.5V20.2c0 .48.58.72.92.38l4.75-4.75a.6.6 0 0 1 .42-.17h6.61c.48 0 .72-.58.38-.92L5.42 2.12a.6.6 0 0 0-.92.38z');
  path.setAttribute('fill', '#ff3366');
  path.setAttribute('stroke', '#ffffff');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  wrapper.appendChild(svg);

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.id = 'strawberry-badge';
  wrapper.appendChild(badge);

  shadow.appendChild(wrapper);

  const scrollCue = document.createElement('div');
  scrollCue.className = 'scroll-cue';
  scrollCue.id = 'strawberry-scroll-cue';
  shadow.appendChild(scrollCue);

  let badgeTimer = null;
  let activeHighlight = null;

  window.__strawberryCursor = {
    moveTo(x, y) {
      if (wrapper) {
        wrapper.style.transform = \`translate3d(\${Math.round(x)}px, \${Math.round(y)}px, 0)\`;
      }
    },
    click(x, y) {
      this.moveTo(x, y);
      if (wrapper) {
        wrapper.classList.add('pressing');
        setTimeout(() => wrapper.classList.remove('pressing'), 160);
      }
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = \`\${Math.round(x)}px\`;
      ripple.style.top = \`\${Math.round(y)}px\`;
      shadow.appendChild(ripple);
      setTimeout(() => ripple.remove(), 550);
    },
    highlight(x, y, w, h) {
      if (activeHighlight) activeHighlight.remove();
      const box = document.createElement('div');
      box.className = 'highlight-box';
      box.style.left = \`\${Math.round(x - w / 2)}px\`;
      box.style.top = \`\${Math.round(y - h / 2)}px\`;
      box.style.width = \`\${Math.max(w, 24)}px\`;
      box.style.height = \`\${Math.max(h, 24)}px\`;
      shadow.appendChild(box);
      activeHighlight = box;
      setTimeout(() => {
        if (activeHighlight === box) {
          box.remove();
          activeHighlight = null;
        }
      }, 700);
    },
    showBadge(text, duration = 1400) {
      if (!badge) return;
      badge.textContent = text;
      badge.classList.add('visible');
      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        badge.classList.remove('visible');
      }, duration);
    },
    showScroll(text = '↓ Scrolling...') {
      if (!scrollCue) return;
      scrollCue.textContent = text;
      scrollCue.classList.add('visible');
      setTimeout(() => {
        scrollCue.classList.remove('visible');
      }, 600);
    }
  };

  return window.__strawberryCursor;
})()
`
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function ensureCursor(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await wc.executeJavaScript(getCursorScript(lastX, lastY), true)
  } catch {
    /* ignore if frame is not ready */
  }
}

export function startCursorHeartbeat(wc: WebContents): void {
  activeWebContents = wc
  if (heartbeatTimer) clearInterval(heartbeatTimer)

  void ensureCursor(wc)
  void animateMouseMove(wc, lastX, lastY)

  // Every 600ms, ensure cursor host is attached and visible
  heartbeatTimer = setInterval(() => {
    if (!activeWebContents || activeWebContents.isDestroyed()) {
      stopCursorHeartbeat()
      return
    }
    void ensureCursor(activeWebContents)
  }, 600)
}

export function stopCursorHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  activeWebContents = null
}

export async function animateMouseMove(wc: WebContents, x: number, y: number): Promise<void> {
  if (wc.isDestroyed()) return
  lastX = x
  lastY = y
  try {
    await ensureCursor(wc)
    await wc.executeJavaScript(`window.__strawberryCursor?.moveTo(${x}, ${y})`, true)
  } catch {
    /* ignore */
  }
}

export async function animateMouseClick(wc: WebContents, x: number, y: number): Promise<void> {
  if (wc.isDestroyed()) return
  lastX = x
  lastY = y
  try {
    await ensureCursor(wc)
    await wc.executeJavaScript(`window.__strawberryCursor?.click(${x}, ${y})`, true)
  } catch {
    /* ignore */
  }
}

export async function animateHighlightTarget(
  wc: WebContents,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await ensureCursor(wc)
    await wc.executeJavaScript(`window.__strawberryCursor?.highlight(${x}, ${y}, ${w}, ${h})`, true)
  } catch {
    /* ignore */
  }
}

export async function animateActionBadge(
  wc: WebContents,
  text: string,
  duration = 1400
): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await ensureCursor(wc)
    const escaped = JSON.stringify(text)
    await wc.executeJavaScript(
      `window.__strawberryCursor?.showBadge(${escaped}, ${duration})`,
      true
    )
  } catch {
    /* ignore */
  }
}

export async function animateScrollCue(
  wc: WebContents,
  text = '↓ Scrolling Page...'
): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await ensureCursor(wc)
    const escaped = JSON.stringify(text)
    await wc.executeJavaScript(`window.__strawberryCursor?.showScroll(${escaped})`, true)
  } catch {
    /* ignore */
  }
}

/**
 * Animate the virtual cursor gliding to the address bar, clicking it,
 * typing the destination URL at 2x speed, and pressing Enter.
 */
export async function animateNavigateUrl(wc: WebContents, url: string): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    // 1. Move to top URL address area
    await animateMouseMove(wc, 320, 25)
    await delay(180)

    // 2. Click URL bar
    await animateMouseClick(wc, 320, 25)
    await delay(100)

    // 3. Type out URL at brisk 2x speed (~25ms per chunk)
    const cleanUrl = url.replace(/^https?:\/\//i, '')
    let typed = ''
    const chunkSize = 3
    for (let i = 0; i < cleanUrl.length; i += chunkSize) {
      if (wc.isDestroyed()) break
      typed += cleanUrl.slice(i, i + chunkSize)
      void animateActionBadge(wc, `URL: ${typed}▎`, 500)
      await delay(25)
    }

    await delay(120)
    await animateActionBadge(wc, '⏎ Enter', 600)
    await delay(180)
  } catch {
    /* ignore */
  }
}

/**
 * Quick scanning radar sweep for read_page action.
 */
export async function animateScanning(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await animateActionBadge(wc, '🔍 Scanning Page Elements...', 1200)
    await animateMouseMove(wc, lastX + 60, lastY + 30)
    await delay(150)
    await animateMouseMove(wc, lastX - 30, lastY + 10)
    await delay(150)
  } catch {
    /* ignore */
  }
}
