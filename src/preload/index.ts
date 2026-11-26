import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentEvent,
  ApplicationTrackerRecord,
  ContentBounds,
  DownloadRecord,
  JobQueueItem,
  PublicConfig,
  TabState,
  TaskHistoryItem,
  UserProfile
} from '../shared/types.js'

export interface StrawberryApi {
  tabs: {
    create: (url?: string) => Promise<string | null>
    close: (id: string) => Promise<void>
    activate: (id: string) => Promise<void>
    navigate: (id: string, url: string) => Promise<void>
    goBack: (id: string) => Promise<void>
    goForward: (id: string) => Promise<void>
    reload: (id: string) => Promise<void>
    list: () => Promise<{ tabs: TabState[]; activeId: string | null }>
    setBounds: (bounds: ContentBounds) => void
    onUpdated: (callback: (data: { tabs: TabState[]; activeId: string | null }) => void) => () => void
  }
  config: {
    get: () => Promise<PublicConfig>
    update: (updates: { baseUrl?: string; apiKey?: string; model?: string }) => Promise<{
      ok: boolean
      config: PublicConfig
      error?: string
    }>
    ping: () => Promise<{ ok: boolean; detail: string }>
  }
  history: {
    list: () => Promise<TaskHistoryItem[]>
    delete: (id: string) => Promise<boolean>
    clear: () => Promise<boolean>
  }
  agent: {
    run: (task: string) => Promise<{ ok: boolean; error?: string }>
    cancel: () => Promise<{ ok: boolean }>
    confirm: (id: string, approved: boolean) => Promise<{ ok: boolean }>
    reviewResponse: (
      id: string,
      response: { approved: boolean; editedFields?: Record<string, string | boolean> }
    ) => Promise<{ ok: boolean }>
    interventionResolved: (id: string) => Promise<{ ok: boolean }>
    onEvent: (callback: (event: AgentEvent) => void) => () => void
  }
  profile: {
    get: () => Promise<UserProfile | null>
    save: (profile: UserProfile) => Promise<{ ok: boolean; profile: UserProfile | null }>
  }
  tracker: {
    list: () => Promise<ApplicationTrackerRecord[]>
    open: () => Promise<boolean>
  }
  queue: {
    run: (data: { urls: string[]; dryRun?: boolean }) => Promise<{ ok: boolean; error?: string }>
    cancel: () => Promise<{ ok: boolean }>
    onUpdated: (callback: (items: JobQueueItem[]) => void) => () => void
  }
  downloads: {
    list: () => Promise<DownloadRecord[]>
    openFile: (path: string) => Promise<boolean>
    showInFolder: (path: string) => Promise<void>
    onUpdated: (callback: (records: DownloadRecord[]) => void) => () => void
  }
  export: {
    saveToFile: (data: { content: string; filename?: string; format?: string }) => Promise<{
      ok: boolean
      path?: string
      filename?: string
      size?: number
      error?: string
    }>
  }
}

const api: StrawberryApi = {
  tabs: {
    create: (url?: string) => ipcRenderer.invoke('tabs:create', url),
    close: (id: string) => ipcRenderer.invoke('tabs:close', id),
    activate: (id: string) => ipcRenderer.invoke('tabs:activate', id),
    navigate: (id: string, url: string) => ipcRenderer.invoke('tabs:navigate', id, url),
    goBack: (id: string) => ipcRenderer.invoke('tabs:goBack', id),
    goForward: (id: string) => ipcRenderer.invoke('tabs:goForward', id),
    reload: (id: string) => ipcRenderer.invoke('tabs:reload', id),
    list: () => ipcRenderer.invoke('tabs:list'),
    setBounds: (bounds: ContentBounds) => ipcRenderer.send('tabs:setBounds', bounds),
    onUpdated: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { tabs: TabState[]; activeId: string | null }
      ) => callback(data)
      ipcRenderer.on('tabs:updated', handler)
      return () => {
        ipcRenderer.removeListener('tabs:updated', handler)
      }
    }
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (updates) => ipcRenderer.invoke('config:update', updates),
    ping: () => ipcRenderer.invoke('config:ping')
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    delete: (id) => ipcRenderer.invoke('history:delete', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },
  agent: {
    run: (task: string) => ipcRenderer.invoke('agent:run', task),
    cancel: () => ipcRenderer.invoke('agent:cancel'),
    confirm: (id: string, approved: boolean) => ipcRenderer.invoke('agent:confirm', id, approved),
    reviewResponse: (id, response) => ipcRenderer.invoke('agent:reviewResponse', id, response),
    interventionResolved: (id) => ipcRenderer.invoke('agent:interventionResolved', id),
    onEvent: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, event: AgentEvent) => callback(event)
      ipcRenderer.on('agent:event', handler)
      return () => {
        ipcRenderer.removeListener('agent:event', handler)
      }
    }
  },
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    save: (profile) => ipcRenderer.invoke('profile:save', profile)
  },
  tracker: {
    list: () => ipcRenderer.invoke('tracker:list'),
    open: () => ipcRenderer.invoke('tracker:open')
  },
  queue: {
    run: (data) => ipcRenderer.invoke('queue:run', data),
    cancel: () => ipcRenderer.invoke('queue:cancel'),
    onUpdated: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, items: JobQueueItem[]) => callback(items)
      ipcRenderer.on('queue:updated', handler)
      return () => {
        ipcRenderer.removeListener('queue:updated', handler)
      }
    }
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    openFile: (path: string) => ipcRenderer.invoke('downloads:openFile', path),
    showInFolder: (path: string) => ipcRenderer.invoke('downloads:showInFolder', path),
    onUpdated: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, records: DownloadRecord[]) => callback(records)
      ipcRenderer.on('downloads:updated', handler)
      return () => {
        ipcRenderer.removeListener('downloads:updated', handler)
      }
    }
  },
  export: {
    saveToFile: (data) => ipcRenderer.invoke('export:saveToFile', data)
  }
}

contextBridge.exposeInMainWorld('api', api)


