import { Menu, clipboard, type BrowserWindow, type WebContents, type MenuItemConstructorOptions } from 'electron'
import type { TabManager } from './tabs.js'
import { getSettings } from '../settings.js'

function buildSearchUrlFromSettings(query: string): string {
  const q = encodeURIComponent(query)
  const settings = getSettings()
  switch (settings.searchEngine) {
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${q}`
    case 'bing':
      return `https://www.bing.com/search?q=${q}`
    case 'brave':
      return `https://search.brave.com/search?q=${q}`
    case 'custom': {
      const tpl = settings.customSearchUrl || 'https://www.google.com/search?q=%s'
      return tpl.includes('%s') ? tpl.replace('%s', q) : `${tpl}${q}`
    }
    default:
      return `https://www.google.com/search?q=${q}`
  }
}

export function attachBrowserShortcuts(
  wc: WebContents,
  getTabManager: () => TabManager | null,
  getMainWindow: () => BrowserWindow | null
): void {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const tabs = getTabManager()
    const win = getMainWindow()
    if (!tabs) return

    const ctrlOrMeta = input.control || input.meta
    const key = input.key.toLowerCase()
    const active = tabs.getActive()
    const activeWc = active?.view.webContents

    // Zoom In: Ctrl+= / Ctrl++
    if (
      ctrlOrMeta &&
      !input.alt &&
      (input.key === '=' || input.key === '+' || input.code === 'NumpadAdd')
    ) {
      event.preventDefault()
      if (activeWc && !activeWc.isDestroyed()) {
        const next = Math.min(3.0, Math.round((activeWc.getZoomFactor() + 0.1) * 10) / 10)
        activeWc.setZoomFactor(next)
      }
      return
    }

    // Zoom Out: Ctrl+-
    if (
      ctrlOrMeta &&
      !input.alt &&
      (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract')
    ) {
      event.preventDefault()
      if (activeWc && !activeWc.isDestroyed()) {
        const next = Math.max(0.25, Math.round((activeWc.getZoomFactor() - 0.1) * 10) / 10)
        activeWc.setZoomFactor(next)
      }
      return
    }

    // Reset Zoom: Ctrl+0
    if (ctrlOrMeta && !input.alt && (input.key === '0' || input.code === 'Numpad0')) {
      event.preventDefault()
      if (activeWc && !activeWc.isDestroyed()) {
        activeWc.setZoomFactor(getSettings().defaultZoom || 1.0)
      }
      return
    }

    // New Tab: Ctrl+T
    if (ctrlOrMeta && !input.shift && !input.alt && key === 't') {
      event.preventDefault()
      tabs.create('about:blank', true)
      return
    }

    // Close Tab: Ctrl+W
    if (ctrlOrMeta && !input.shift && !input.alt && key === 'w') {
      event.preventDefault()
      if (active) tabs.close(active.id)
      return
    }

    // Reload: Ctrl+R / F5
    if ((ctrlOrMeta && !input.alt && key === 'r') || input.key === 'F5') {
      event.preventDefault()
      if (activeWc && !activeWc.isDestroyed()) {
        if (input.shift) activeWc.reloadIgnoringCache()
        else activeWc.reload()
      }
      return
    }

    // Focus Address Bar: Ctrl+L
    if (ctrlOrMeta && !input.alt && key === 'l') {
      event.preventDefault()
      if (win && !win.isDestroyed()) {
        win.webContents.focus()
        win.webContents.send('browser:focusOmnibox')
      }
      return
    }

    // Open Settings: Ctrl+,
    if (ctrlOrMeta && !input.alt && input.key === ',') {
      event.preventDefault()
      const existing = tabs.list().find((t) => t.url === 'edith://settings')
      if (existing) {
        tabs.activate(existing.id)
      } else {
        tabs.create('edith://settings', true)
      }
      return
    }

    // Back / Forward: Alt+Left / Alt+Right
    if (input.alt && !ctrlOrMeta && input.key === 'ArrowLeft') {
      event.preventDefault()
      if (activeWc && activeWc.navigationHistory.canGoBack()) {
        activeWc.navigationHistory.goBack()
      }
      return
    }
    if (input.alt && !ctrlOrMeta && input.key === 'ArrowRight') {
      event.preventDefault()
      if (activeWc && activeWc.navigationHistory.canGoForward()) {
        activeWc.navigationHistory.goForward()
      }
      return
    }

    // Switch Tabs: Ctrl+Tab / Ctrl+Shift+Tab
    if (ctrlOrMeta && !input.alt && input.key === 'Tab') {
      event.preventDefault()
      const list = tabs.list()
      if (list.length > 1 && active) {
        const idx = list.findIndex((t) => t.id === active.id)
        const nextIdx = input.shift
          ? (idx - 1 + list.length) % list.length
          : (idx + 1) % list.length
        const target = list[nextIdx]
        if (target) tabs.activate(target.id)
      }
      return
    }

    // Jump to Tab: Ctrl+1..9
    if (ctrlOrMeta && !input.alt && !input.shift && /^[1-9]$/.test(input.key)) {
      event.preventDefault()
      const list = tabs.list()
      const num = Number(input.key)
      const target = num === 9 ? list[list.length - 1] : list[num - 1]
      if (target) tabs.activate(target.id)
      return
    }

    // DevTools: F12 or Ctrl+Shift+I
    if (input.key === 'F12' || (ctrlOrMeta && input.shift && key === 'i')) {
      event.preventDefault()
      const targetWc = activeWc && active && !active.url.startsWith('edith://') && active.url !== 'about:blank'
        ? activeWc
        : win?.webContents
      if (targetWc && !targetWc.isDestroyed()) {
        if (targetWc.isDevToolsOpened()) targetWc.closeDevTools()
        else targetWc.openDevTools({ mode: 'detach' })
      }
    }
  })
}

export function attachContextMenu(
  wc: WebContents,
  getTabManager: () => TabManager | null,
  getMainWindow: () => BrowserWindow | null,
  isShell = false
): void {
  wc.on('context-menu', (_event, params) => {
    const tabs = getTabManager()
    const win = getMainWindow()
    const template: MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      template.push(
        {
          label: 'Open link in new tab',
          click: () => tabs?.create(params.linkURL, true)
        },
        {
          label: 'Copy link address',
          click: () => clipboard.writeText(params.linkURL)
        },
        { type: 'separator' }
      )
    }

    if (params.hasImageContents && params.srcURL) {
      template.push(
        {
          label: 'Copy image address',
          click: () => clipboard.writeText(params.srcURL)
        },
        {
          label: 'Save image as...',
          click: () => wc.downloadURL(params.srcURL)
        },
        { type: 'separator' }
      )
    }

    if (params.isEditable) {
      template.push(
        { label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo },
        { label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
        { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }
      )
    } else if (params.selectionText.trim()) {
      const selected = params.selectionText.trim()
      const preview = selected.length > 28 ? `${selected.slice(0, 28)}...` : selected
      template.push(
        { label: 'Copy', role: 'copy' },
        {
          label: `Search for "${preview}"`,
          click: () => tabs?.create(buildSearchUrlFromSettings(selected), true)
        }
      )
    }

    if (!isShell) {
      if (template.length > 0) template.push({ type: 'separator' })
      template.push(
        {
          label: 'Back',
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack()
        },
        {
          label: 'Forward',
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward()
        },
        {
          label: 'Reload',
          click: () => wc.reload()
        },
        { type: 'separator' },
        {
          label: 'Copy page URL',
          click: () => clipboard.writeText(wc.getURL())
        },
        {
          label: 'Select All',
          role: 'selectAll'
        }
      )
    } else if (template.length === 0) {
      template.push({ label: 'Select All', role: 'selectAll' })
    }

    template.push(
      { type: 'separator' },
      {
        label: 'Inspect Element',
        click: () => wc.inspectElement(params.x, params.y)
      }
    )

    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: win ?? undefined })
  })
}
