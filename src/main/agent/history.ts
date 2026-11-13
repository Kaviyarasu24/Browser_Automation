import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { TaskHistoryItem } from '../../shared/types.js'

const MAX_HISTORY = 50

function getHistoryPath(): string {
  return join(app.getPath('userData'), 'strawberry-history.json')
}

export function listHistory(): TaskHistoryItem[] {
  const filePath = getHistoryPath()
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
    }
  } catch (err) {
    console.warn('[history] failed to read history file:', (err as Error).message)
  }

  return []
}

export function saveHistoryItem(item: TaskHistoryItem): void {
  try {
    const items = listHistory()
    // Prepend new item and filter duplicates by id
    const updated = [item, ...items.filter((h) => h.id !== item.id)].slice(0, MAX_HISTORY)
    writeFileSync(getHistoryPath(), JSON.stringify(updated, null, 2), 'utf8')
  } catch (err) {
    console.warn('[history] failed to save history item:', (err as Error).message)
  }
}

export function deleteHistoryItem(id: string): void {
  try {
    const items = listHistory()
    const updated = items.filter((h) => h.id !== id)
    writeFileSync(getHistoryPath(), JSON.stringify(updated, null, 2), 'utf8')
  } catch (err) {
    console.warn('[history] failed to delete history item:', (err as Error).message)
  }
}

export function clearHistory(): void {
  try {
    writeFileSync(getHistoryPath(), JSON.stringify([], null, 2), 'utf8')
  } catch (err) {
    console.warn('[history] failed to clear history:', (err as Error).message)
  }
}

