import type { WebContents } from 'electron'

/**
 * Injects and controls a visible, animated virtual mouse pointer inside the page.
 * Uses a Shadow Root attached to document.documentElement so page styles cannot
 * affect it, and page scripts (like querySelectorAll) cannot see it.
 */

const CURSOR_SCRIPT = `
(() => {
  if (window.__strawberryCursor) return window.__strawberryCursor;

  let host = document.getElementById('__strawberry_cursor_host');
  if (!host) {
    host = document.createElement('div');
    host.id = '__strawberry_cursor_host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;overflow:hidden;';
    (document.body || document.documentElement).appendChild(host);
  }

  const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
  shadow.innerHTML = \`
    <style>
      :host {
        pointer-events: none !important;
      }
      .cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 28px;
        height: 28px;
        pointer-events: none;
        z-index: 2147483647;
        transform: translate3d(100px, 100px, 0);
        transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
        will-change: transform;
        filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
      }
      .cursor-pointer {
        width: 24px;
        height: 24px;
        transform-origin: 2px 2px;
        transition: transform 0.12s ease;
      }
      .cursor.pressing .cursor-pointer {
        transform: scale(0.82);
      }
      .ripple {
        position: fixed;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid #ff3366;
        background: rgba(255, 51, 102, 0.35);
        pointer-events: none;
        transform: translate(-50%, -50%) scale(0.2);
        animation: ripple-anim 0.5s cubic-bezier(0, 0.7, 0.1, 1) forwards;
      }
      @keyframes ripple-anim {
        0% {
          transform: translate(-50%, -50%) scale(0.2);
          opacity: 1;
        }
        70% {
          transform: translate(-50%, -50%) scale(2.6);
          opacity: 0.7;
        }
        100% {
          transform: translate(-50%, -50%) scale(3.5);
          opacity: 0;
        }
      }
      .badge {
        position: absolute;
        left: 20px;
        top: 18px;
        padding: 3px 8px;
        background: rgba(18, 18, 20, 0.9);
        color: #fff;
        border: 1px solid #ff3366;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.2px;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .badge.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .scroll-cue {
        position: fixed;
        pointer-events: none;
        left: 50%;
        padding: 6px 14px;
        background: rgba(18, 18, 20, 0.9);
        color: #ff3366;
        border: 1px solid #ff3366;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        transform: translate(-50%, 0);
        opacity: 0;
        transition: opacity 0.25s ease, transform 0.25s ease;
        z-index: 2147483646;
      }
      .scroll-cue.visible {
        opacity: 1;
      }
      .scroll-cue.down {
        bottom: 40px;
        transform: translate(-50%, -10px);
      }
      .scroll-cue.up {
        top: 40px;
        transform: translate(-50%, 10px);
      }
    </style>

    <div class="cursor" id="strawberry-cursor">
      <svg class="cursor-pointer" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L5.85 2.86a.5.5 0 0 0-.35.35z"
              fill="#ff3366" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
      <div class="badge" id="strawberry-badge"></div>
    </div>
    <div class="scroll-cue" id="strawberry-scroll-cue"></div>
  \`;

  const cursorEl = shadow.getElementById('strawberry-cursor');
  const badgeEl = shadow.getElementById('strawberry-badge');
  const scrollCueEl = shadow.getElementById('strawberry-scroll-cue');

  let currentX = 100;
  let currentY = 100;
  let badgeTimer = null;

  window.__strawberryCursor = {
    moveTo(x, y) {
      currentX = x;
      currentY = y;
      if (cursorEl) {
        cursorEl.style.transform = \`translate3d(\${x}px, \${y}px, 0)\`;
      }
    },
    click(x, y) {
      this.moveTo(x, y);
      if (cursorEl) {
        cursorEl.classList.add('pressing');
        setTimeout(() => cursorEl.classList.remove('pressing'), 200);
      }
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = \`\${x}px\`;
      ripple.style.top = \`\${y}px\`;
      shadow.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    },
    showBadge(text, duration = 1200) {
      if (!badgeEl) return;
      badgeEl.textContent = text;
      badgeEl.classList.add('visible');
      if (badgeTimer) clearTimeout(badgeTimer);
      badgeTimer = setTimeout(() => {
        badgeEl.classList.remove('visible');
      }, duration);
    },
    showScroll(direction) {
      if (!scrollCueEl) return;
      scrollCueEl.textContent = direction === 'down' ? '↓ Scrolling Down' : '↑ Scrolling Up';
      scrollCueEl.className = \`scroll-cue visible \${direction}\`;
      setTimeout(() => {
        scrollCueEl.classList.remove('visible');
      }, 700);
    }
  };

  return window.__strawberryCursor;
})()
`

export async function ensureCursor(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await wc.executeJavaScript(CURSOR_SCRIPT, true)
  } catch (err) {
    // If page is navigating or frame is detached, ignore
  }
}

export async function animateMouseMove(wc: WebContents, x: number, y: number): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await ensureCursor(wc)
    await wc.executeJavaScript(`window.__strawberryCursor?.moveTo(${x}, ${y})`, true)
  } catch {
    /* ignore */
  }
}

export async function animateMouseClick(wc: WebContents, x: number, y: number): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await ensureCursor(wc)
    await wc.executeJavaScript(`window.__strawberryCursor?.click(${x}, ${y})`, true)
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

export async function animateScrollCue(wc: WebContents, direction: 'up' | 'down'): Promise<void> {
  if (wc.isDestroyed()) return
  try {
    await ensureCursor(wc)
    await wc.executeJavaScript(`window.__strawberryCursor?.showScroll('${direction}')`, true)
  } catch {
    /* ignore */
  }
}

