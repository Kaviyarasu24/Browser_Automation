import { WebContentsView, type WebContents, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ContentBounds, TabState } from '../../shared/types.js'
import { BROWSER_PARTITION, browserUserAgent } from './session.js'
import { ensureCursor } from './cursor.js'

export interface Tab {
  id: string
  view: WebContentsView
  title: string
  url: string
  loading: boolean
  favicon: string | null
}

/**
 * Owns one WebContentsView per tab.
 *
 * Why WebContentsView and not <webview>: the <webview> tag is deprecated in
 * Electron 28+, and it runs content in a guest webContents the host cannot
 * cleanly attach CDP to. We need CDP (for the accessibility tree) and clean
 * input dispatch, so main-process views are the right primitive.
 *
 * Layering: the chrome (React shell) view is added first and covers the whole
 * window. Tab views are added on top, positioned to exactly cover the content
 * rectangle the shell reports. Regions therefore must not overlap — the shell
 * renders the tab strip and sidebar, and leaves the middle empty for content.
 *
 * Inactive tabs are *detached* rather than destroyed: the WebContents stays
 * alive (background tabs keep running, like a real browser) but renders
 * nothing and reports itself hidden. Detaching does not reload the page.
 */
export class TabManager extends EventEmitter {
  private tabs = new Map<string, Tab>()
  private activeId: string | null = null
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 }

  constructor(
    private readonly contentView: Electron.View,
    private readonly ua: string
  ) {
    super()
  }

  /* ── lifecycle ──────────────────────────────────────────────────── */

  create(url = 'about:blank', activate = true): Tab {
    const id = randomUUID()

    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        // Untrusted web pages get the strictest settings, and NO preload.
        // The IPC bridge is for the shell renderer only.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: true
      }
    })

    const tab: Tab = { id, view, title: 'New Tab', url, loading: false, favicon: null }
    this.tabs.set(id, tab)

    const wc = view.webContents
    wc.setUserAgent(this.ua)
    this.wireEvents(tab)

    // Popups become tabs rather than separate windows.
    wc.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/i.test(target)) {
        this.create(target, true)
        return { action: 'deny' }
      }
      return { action: 'deny' }
    })

    const targetUrl = url || 'about:blank'
    void wc.loadURL(targetUrl).catch((err: Error) => {
      console.warn(`[tabs] load failed for ${targetUrl}:`, err.message)
    })

    if (activate) this.activate(id)

    this.emitState()
    return tab
  }

  close(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    this.tabs.delete(id)
    this.contentView.removeChildView(tab.view)

    // destroy() frees the renderer process. Without it the webContents leaks
    // and keeps its process alive.
    try {
      tab.view.webContents.close()
    } catch {
      /* already gone */
    }

    if (this.activeId === id) {
      this.activeId = null
      const next = [...this.tabs.keys()].at(-1)
      if (next) this.activate(next)
    }

    this.emitState()
  }

  activate(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return

    // Detach the previous tab, keeping its WebContents alive.
    if (this.activeId && this.activeId !== id) {
      const prev = this.tabs.get(this.activeId)
      if (prev) this.contentView.removeChildView(prev.view)
    }

    this.activeId = id
    this.contentView.addChildView(tab.view)
    tab.view.setBounds(this.bounds)
    this.emitState()
  }

  /* ── accessors ──────────────────────────────────────────────────── */

  get(id: string): Tab | undefined {
    return this.tabs.get(id)
  }

  getActive(): Tab | null {
    return this.activeId ? (this.tabs.get(this.activeId) ?? null) : null
  }

  getActiveWebContents(): WebContents | null {
    return this.getActive()?.view.webContents ?? null
  }

  getSession(): Session | null {
    return this.tabs.values().next().value?.view.webContents.session ?? null
  }

  list(): TabState[] {
    return [...this.tabs.values()].map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      loading: t.loading,
      canGoBack: t.view.webContents.navigationHistory.canGoBack(),
      canGoForward: t.view.webContents.navigationHistory.canGoForward(),
      favicon: t.favicon
    }))
  }

  get activeTabId(): string | null {
    return this.activeId
  }

  /* ── layout ─────────────────────────────────────────────────────── */

  /**
   * Called whenever the shell reports a new content rectangle (window resize,
   * sidebar toggle, etc). Only the active view is visible, so only it is
   * positioned; detached views keep their last bounds harmlessly.
   */
  setBounds(bounds: ContentBounds): void {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    }

    const active = this.getActive()
    if (active) active.view.setBounds(this.bounds)
  }

  getBounds(): ContentBounds {
    return this.bounds
  }

  /* ── navigation ─────────────────────────────────────────────────── */

  navigate(id: string, url: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    void tab.view.webContents.loadURL(url).catch((err: Error) => {
      console.warn(`[tabs] navigate failed:`, err.message)
    })
  }

  /* ── internals ──────────────────────────────────────────────────── */

  private wireEvents(tab: Tab): void {
    const wc = tab.view.webContents

    wc.on('did-start-loading', () => {
      tab.loading = true
      this.emitState()
    })

    wc.on('did-stop-loading', () => {
      tab.loading = false
      this.emitState()
    })

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title || 'Untitled'
      this.emitState()
    })

    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null
      this.emitState()
    })

    const syncUrl = (url: string) => {
      tab.url = url
      // A page that never fires page-title-updated still needs a label.
      if (tab.title === 'New Tab' || tab.title === 'Untitled') {
        try {
          tab.title = new URL(url).hostname || url
        } catch {
          tab.title = url
        }
      }
      this.emitState()
    }

    wc.on('did-navigate', (_e, url) => syncUrl(url))
    wc.on('did-navigate-in-page', (_e, url) => syncUrl(url))
    wc.on('dom-ready', () => {
      void ensureCursor(wc)
    })

    // A crashed renderer leaves a blank tab with no explanation.
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[tabs] renderer gone (${details.reason})`)
      tab.title = 'Page crashed'
      tab.loading = false
      this.emitState()
    })

    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 is ERR_ABORTED, which fires routinely on redirects and is not an error.
      if (!isMainFrame || code === -3) return
      console.warn(`[tabs] ${desc} (${code}) for ${url}`)
    })
  }

  private emitState(): void {
    this.emit('changed', this.list(), this.activeId)
  }
}

/** Chrome version from the UA helper, reused for the tab UA. */
export function tabUserAgent(chromeMajor: string): string {
  return browserUserAgent(chromeMajor)
}
