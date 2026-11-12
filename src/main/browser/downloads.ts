import { app, session, shell, type DownloadItem, type WebContents } from 'electron'
import { join, parse, extname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { BROWSER_PARTITION } from './session.js'
import type { DownloadRecord } from '../../shared/types.js'

let downloadList: DownloadRecord[] = []
let notifyRenderer: ((records: DownloadRecord[]) => void) | null = null
let onDownloadCompleteCallback: ((record: DownloadRecord) => void) | null = null

export function getDownloadsDir(): string {
  const dir = join(app.getPath('downloads'), 'Strawberry')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getUniqueFilePath(dir: string, originalName: string): string {
  const { name, ext } = parse(originalName)
  let candidate = join(dir, originalName)
  let counter = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${name} (${counter})${ext}`)
    counter++
  }
  return candidate
}

export function initDownloadManager(onUpdate?: (records: DownloadRecord[]) => void): void {
  if (onUpdate) {
    notifyRenderer = onUpdate
  }

  const sess = session.fromPartition(BROWSER_PARTITION)

  sess.on('will-download', (_event, item: DownloadItem, _webContents: WebContents) => {
    const originalFilename = item.getFilename() || 'download'
    const targetDir = getDownloadsDir()
    const safeSavePath = getUniqueFilePath(targetDir, originalFilename)

    // Set save path so Electron downloads automatically without opening blocking file dialog
    item.setSavePath(safeSavePath)

    const record: DownloadRecord = {
      id: randomUUID(),
      filename: parse(safeSavePath).base,
      savePath: safeSavePath,
      state: 'progressing',
      totalBytes: item.getTotalBytes() || 0,
      receivedBytes: item.getReceivedBytes() || 0,
      mimeType: item.getMimeType() || '',
      url: item.getURL() || '',
      startTime: Date.now()
    }

    downloadList.unshift(record)
    // Keep list bounded to recent 30 downloads
    if (downloadList.length > 30) {
      downloadList = downloadList.slice(0, 30)
    }
    notifyRenderer?.(downloadList)

    item.on('updated', (_e, state) => {
      record.receivedBytes = item.getReceivedBytes()
      record.totalBytes = item.getTotalBytes()
      if (state === 'interrupted') {
        record.state = 'interrupted'
      } else if (state === 'progressing') {
        record.state = 'progressing'
      }
      notifyRenderer?.(downloadList)
    })

    item.once('done', (_e, state) => {
      if (state === 'completed') {
        record.state = 'completed'
        record.receivedBytes = record.totalBytes || item.getReceivedBytes()
        onDownloadCompleteCallback?.(record)
      } else if (state === 'cancelled') {
        record.state = 'cancelled'
      } else {
        record.state = 'interrupted'
      }
      notifyRenderer?.(downloadList)
    })
  })
}

export function listDownloads(): DownloadRecord[] {
  return [...downloadList]
}

export function setOnDownloadComplete(cb: ((record: DownloadRecord) => void) | null): void {
  onDownloadCompleteCallback = cb
}

export function setDownloadUpdateNotifier(notifier: (records: DownloadRecord[]) => void): void {
  notifyRenderer = notifier
}

export async function openDownloadedFile(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false
  const err = await shell.openPath(filePath)
  return !err
}

export function showInDownloadFolder(filePath: string): void {
  if (existsSync(filePath)) {
    shell.showItemInFolder(filePath)
  } else {
    shell.openPath(getDownloadsDir()).catch(() => {})
  }
}

/**
 * Save text/CSV/JSON/markdown data to the Strawberry downloads folder.
 */
export function exportDataToFile(
  content: string,
  rawFilename?: string,
  format = 'txt'
): { ok: boolean; path?: string; filename?: string; size?: number; error?: string } {
  try {
    const targetDir = getDownloadsDir()
    let ext = format.startsWith('.') ? format : `.${format}`
    let name = rawFilename?.trim() || `strawberry_export_${Date.now()}`

    if (!extname(name)) {
      name = `${name}${ext}`
    }

    const safePath = getUniqueFilePath(targetDir, name)
    writeFileSync(safePath, content, 'utf8')
    const stats = statSync(safePath)

    const finalName = parse(safePath).base
    const record: DownloadRecord = {
      id: randomUUID(),
      filename: finalName,
      savePath: safePath,
      state: 'completed',
      totalBytes: stats.size,
      receivedBytes: stats.size,
      mimeType: format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain',
      url: 'export://local',
      startTime: Date.now()
    }

    downloadList.unshift(record)
    if (downloadList.length > 30) {
      downloadList = downloadList.slice(0, 30)
    }
    notifyRenderer?.(downloadList)

    return {
      ok: true,
      path: safePath,
      filename: finalName,
      size: stats.size
    }
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message
    }
  }
}

