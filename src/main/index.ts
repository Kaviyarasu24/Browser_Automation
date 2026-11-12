import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfig, validateConfig } from './config.js'
import { TabManager, tabUserAgent } from './browser/tabs.js'
import { runAgent } from './agent/loop.js'
import { ping } from './agent/llm.js'
import {
  initDownloadManager,
  listDownloads,
  openDownloadedFile,
  showInDownloadFolder,
  exportDataToFile
} from './browser/downloads.js'
import type { ContentBounds, AgentEvent, PublicConfig } from '../shared/types.js'

let mainWindow: BrowserWindow | null = null
let tabManager: TabManager | null = null
let activeAgentAbort: AbortController | null = null
const pendingConfirmations = new Map<string, (approved: boolean) => void>()

function createWindow(): void {
  const cfg = getConfig()
  const chromeMajor = process.versions.chrome.split('.')[0] ?? '130'
  const ua = tabUserAgent(chromeMajor)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Strawberry',
    backgroundColor: '#121214',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Prevent main window from navigating away from the shell
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (tabManager && /^https?:/i.test(url)) {
      tabManager.create(url, true)
    } else {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  tabManager = new TabManager(mainWindow.contentView, ua)

  // Forward tab state changes to renderer
  tabManager.on('changed', (tabs, activeId) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tabs:updated', { tabs, activeId })
    }
  })

  // Load renderer
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Create initial tab once ready
  mainWindow.webContents.once('did-finish-load', () => {
    if (tabManager && tabManager.list().length === 0) {
      tabManager.create('about:blank', true)
    }
  })

  mainWindow.on('resize', () => {
    // Re-apply current bounds to active tab on window resize
    if (tabManager) {
      tabManager.setBounds(tabManager.getBounds())
    }
  })

  mainWindow.on('closed', () => {
    if (activeAgentAbort) {
      activeAgentAbort.abort()
      activeAgentAbort = null
    }
    mainWindow = null
    tabManager = null
  })
}

/* ── IPC Handlers ──────────────────────────────────────────────────── */

function setupIpc(): void {
  // Tabs management
  ipcMain.handle('tabs:create', (_event, url?: string) => {
    if (!tabManager) return null
    const tab = tabManager.create(url || 'about:blank', true)
    return tab.id
  })

  ipcMain.handle('tabs:close', (_event, id: string) => {
    tabManager?.close(id)
  })

  ipcMain.handle('tabs:activate', (_event, id: string) => {
    tabManager?.activate(id)
  })

  ipcMain.handle('tabs:navigate', (_event, id: string, url: string) => {
    tabManager?.navigate(id, url)
  })

  ipcMain.handle('tabs:goBack', (_event, id: string) => {
    const tab = tabManager?.get(id)
    if (tab && tab.view.webContents.navigationHistory.canGoBack()) {
      tab.view.webContents.navigationHistory.goBack()
    }
  })

  ipcMain.handle('tabs:goForward', (_event, id: string) => {
    const tab = tabManager?.get(id)
    if (tab && tab.view.webContents.navigationHistory.canGoForward()) {
      tab.view.webContents.navigationHistory.goForward()
    }
  })

  ipcMain.handle('tabs:reload', (_event, id: string) => {
    const tab = tabManager?.get(id)
    tab?.view.webContents.reload()
  })

  ipcMain.handle('tabs:list', () => {
    return {
      tabs: tabManager?.list() ?? [],
      activeId: tabManager?.activeTabId ?? null
    }
  })

  ipcMain.on('tabs:setBounds', (_event, bounds: ContentBounds) => {
    tabManager?.setBounds(bounds)
  })

  // Configuration
  ipcMain.handle('config:get', (): PublicConfig => {
    const cfg = getConfig()
    return {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      hasApiKey: Boolean(cfg.apiKey)
    }
  })

  ipcMain.handle('config:ping', async () => {
    const cfg = getConfig()
    return await ping(cfg)
  })

  // Agent execution
  ipcMain.handle('agent:run', async (_event, task: string) => {
    if (!tabManager) {
      return { ok: false, error: 'Browser not initialized.' }
    }

    if (activeAgentAbort) {
      return { ok: false, error: 'An agent task is already running.' }
    }

    const cfg = getConfig()
    const problems = validateConfig(cfg)
    if (problems.length > 0) {
      return { ok: false, error: problems.join('; ') }
    }

    const abortController = new AbortController()
    activeAgentAbort = abortController

    const emit = (event: AgentEvent): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:event', event)
      }
    }

    // Run in background without blocking IPC response
    void (async () => {
      try {
        await runAgent({
          task,
          cfg,
          tabs: tabManager!,
          emit,
          confirm: (info) => {
            const id = randomUUID()
            return new Promise<boolean>((resolve) => {
              const cleanup = () => {
                pendingConfirmations.delete(id)
              }
              pendingConfirmations.set(id, (approved) => {
                cleanup()
                resolve(approved)
              })
              emit({
                type: 'confirmation_required',
                id,
                step: 0,
                title: info.title,
                description: info.description,
                action: info.action,
                target: info.target
              })
              abortController.signal.addEventListener('abort', () => {
                cleanup()
                resolve(false)
              })
            })
          },
          signal: abortController.signal
        })
      } finally {
        if (activeAgentAbort === abortController) {
          activeAgentAbort = null
        }
        for (const resolve of pendingConfirmations.values()) {
          resolve(false)
        }
        pendingConfirmations.clear()
      }
    })()

    return { ok: true }
  })

  ipcMain.handle('agent:confirm', (_event, id: string, approved: boolean) => {
    const resolve = pendingConfirmations.get(id)
    if (resolve) {
      resolve(approved)
      pendingConfirmations.delete(id)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle('agent:cancel', () => {
    if (activeAgentAbort) {
      activeAgentAbort.abort()
      activeAgentAbort = null
      for (const resolve of pendingConfirmations.values()) {
        resolve(false)
      }
      pendingConfirmations.clear()
      return { ok: true }
    }
    return { ok: false }
  })

  // Downloads & File Exports
  ipcMain.handle('downloads:list', () => listDownloads())
  ipcMain.handle('downloads:openFile', (_event, filePath: string) => openDownloadedFile(filePath))
  ipcMain.handle('downloads:showInFolder', (_event, filePath: string) => {
    showInDownloadFolder(filePath)
  })
  ipcMain.handle(
    'export:saveToFile',
    (_event, data: { content: string; filename?: string; format?: string }) => {
      return exportDataToFile(data.content, data.filename, data.format)
    }
  )
}

/* ── App Lifecycle ─────────────────────────────────────────────────── */

app.whenReady().then(() => {
  setupIpc()
  initDownloadManager((records) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('downloads:updated', records)
    }
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

