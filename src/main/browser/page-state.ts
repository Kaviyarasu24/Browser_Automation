import type { WebContents } from 'electron'

export interface PageElement {
  /** Stable index within THIS snapshot. Stale after any navigation. */
  index: number
  tag: string
  role: string
  /** Visible label: text content, aria-label, placeholder, name, alt. */
  label: string
  type: string | null
  href: string | null
  /** Viewport coordinates of the element's centre. */
  x: number
  y: number
  w: number
  h: number
  inViewport: boolean
}

export interface PageState {
  url: string
  title: string
  /** Visible text, truncated. */
  text: string
  elements: PageElement[]
  scrollY: number
  scrollHeight: number
  viewportHeight: number
  truncatedText: boolean
  truncatedElements: boolean
}

const MAX_TEXT_CHARS = 2800
const MAX_ELEMENTS = 75

/**
 * Runs in the page. Must be a self-contained expression — no closures over
 * Node scope, since it is serialised and evaluated in the renderer.
 *
 * Kept as a string (not a function reference) so the bundler cannot rewrite
 * it or inject helper imports the page knows nothing about.
 */
const EXTRACT_SCRIPT = `(() => {
  const MAX_TEXT = ${MAX_TEXT_CHARS};
  const MAX_ELS = ${MAX_ELEMENTS};

  const isVisible = (el) => {
    if (el.id === '__strawberry_cursor_host' || el.closest('#__strawberry_cursor_host')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity || '1') === 0) return false;
    return true;
  };

  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const target = document.getElementById(labelled);
      if (target && target.textContent) return target.textContent.trim().slice(0, 140);
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const value = el.value;
    if (typeof value === 'string' && value.trim() && el.tagName === 'INPUT') {
      return value.trim().slice(0, 140);
    }
    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return text.slice(0, 140);
  };

  const selector = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
    '[contenteditable="true"]', '[onclick]', 'summary'
  ].join(',');

  const all = Array.from(document.querySelectorAll(selector));
  const visible = all.filter(isVisible).filter((el) => !el.disabled);

  // Prioritize in-viewport and clearly labelled elements to keep token footprint high-value
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
  };

  visible.sort((a, b) => {
    const aV = inView(a) ? 1 : 0;
    const bV = inView(b) ? 1 : 0;
    if (aV !== bV) return bV - aV;
    const aL = (labelFor(a) || '').length > 0 ? 1 : 0;
    const bL = (labelFor(b) || '').length > 0 ? 1 : 0;
    return bL - aL;
  });

  const elements = visible.slice(0, MAX_ELS).map((el, index) => {
    const rect = el.getBoundingClientRect();
    return {
      index,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      label: labelFor(el),
      type: el.getAttribute('type'),
      href: el.getAttribute('href'),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      inViewport: rect.top < window.innerHeight && rect.bottom > 0
    };
  });

  const bodyText = (document.body ? document.body.innerText : '') || '';
  const normalised = bodyText.replace(/\\n{3,}/g, '\\n\\n').trim();

  return {
    url: location.href,
    title: document.title,
    text: normalised.slice(0, MAX_TEXT),
    truncatedText: normalised.length > MAX_TEXT,
    elements,
    truncatedElements: visible.length > MAX_ELS,
    scrollY: Math.round(window.scrollY),
    scrollHeight: Math.round(document.documentElement.scrollHeight),
    viewportHeight: window.innerHeight
  };
})()`

export async function capturePageState(wc: WebContents): Promise<PageState> {
  const currentUrl = wc.getURL()
  if (!currentUrl || currentUrl === 'about:blank') {
    return {
      url: currentUrl || 'about:blank',
      title: wc.getTitle() || 'New Tab',
      text: '(empty page)',
      elements: [],
      truncatedText: false,
      truncatedElements: false,
      scrollY: 0,
      scrollHeight: 0,
      viewportHeight: 800
    }
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('capturePageState timed out')), 4000)
  })

  let raw: PageState
  try {
    raw = (await Promise.race([
      wc.executeJavaScript(EXTRACT_SCRIPT, true),
      timeoutPromise
    ])) as PageState
  } catch {
    return {
      url: wc.getURL() || 'about:blank',
      title: wc.getTitle() || '',
      text: '',
      elements: [],
      truncatedText: false,
      truncatedElements: false,
      scrollY: 0,
      scrollHeight: 0,
      viewportHeight: 800
    }
  }

  // Defensive: a page can race teardown and return something unexpected.
  return {
    url: typeof raw.url === 'string' ? raw.url : wc.getURL(),
    title: typeof raw.title === 'string' ? raw.title : wc.getTitle(),
    text: typeof raw.text === 'string' ? raw.text : '',
    elements: Array.isArray(raw.elements) ? raw.elements : [],
    truncatedText: Boolean(raw.truncatedText),
    truncatedElements: Boolean(raw.truncatedElements),
    scrollY: Number(raw.scrollY) || 0,
    scrollHeight: Number(raw.scrollHeight) || 0,
    viewportHeight: Number(raw.viewportHeight) || 0
  }
}

/**
 * Compact, LLM-facing rendering of page state.
 *
 * Numbered `[index]` markers are how the model refers to elements when
 * calling click/type — so the numbering here and in `elements` must match.
 */
export function formatPageState(state: PageState): string {
  const lines: string[] = [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    `Scroll: ${state.scrollY}px of ${state.scrollHeight}px (viewport ${state.viewportHeight}px)`,
    ''
  ]

  if (state.elements.length === 0) {
    lines.push('INTERACTIVE ELEMENTS: none found.')
  } else {
    lines.push(`INTERACTIVE ELEMENTS (${state.elements.length}):`)
    for (const el of state.elements) {
      const bits = [`[${el.index}]`, `<${el.tag}>`]
      if (el.type) bits.push(`type=${el.type}`)
      if (el.role) bits.push(`role=${el.role}`)
      bits.push(JSON.stringify(el.label))
      if (el.href && el.href !== '#') bits.push(`href=${JSON.stringify(el.href.slice(0, 80))}`)
      if (!el.inViewport) bits.push('(off-screen)')
      lines.push('  ' + bits.join(' '))
    }
    if (state.truncatedElements) {
      lines.push(`  … more elements not shown; scroll or narrow the page to see them.`)
    }
  }

  lines.push('', 'PAGE TEXT:')
  lines.push(state.text || '(empty)')
  if (state.truncatedText) lines.push('… (text truncated)')

  return lines.join('\n')
}
