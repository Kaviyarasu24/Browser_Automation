import { app, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import type { ApplicationTrackerRecord } from '../../shared/types.js'

function getTrackerFilePath(): string {
  const dir = join(app.getPath('downloads'), 'Strawberry')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'applications.csv')
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export function recordApplication(rec: ApplicationTrackerRecord): { ok: boolean; path: string } {
  try {
    const filePath = getTrackerFilePath()
    const header = 'date,company,role,url,status,notes\n'

    if (!existsSync(filePath)) {
      writeFileSync(filePath, header, 'utf8')
    }

    const row = [
      escapeCsv(rec.date),
      escapeCsv(rec.company),
      escapeCsv(rec.role),
      escapeCsv(rec.url),
      escapeCsv(rec.status),
      escapeCsv(rec.notes)
    ].join(',') + '\n'

    appendFileSync(filePath, row, 'utf8')
    return { ok: true, path: filePath }
  } catch (err) {
    console.warn('[tracker] Failed to record application:', (err as Error).message)
    return { ok: false, path: '' }
  }
}

export function listApplications(): ApplicationTrackerRecord[] {
  const filePath = getTrackerFilePath()
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/).filter(Boolean)
    if (lines.length <= 1) return []

    const records: ApplicationTrackerRecord[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!
      // Simple CSV split (handling quoted commas)
      const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || []
      const cleanParts = parts.map((p) => p.replace(/^"|"$/g, '').replace(/""/g, '"'))
      if (cleanParts.length >= 4) {
        records.push({
          date: cleanParts[0] || '',
          company: cleanParts[1] || '',
          role: cleanParts[2] || '',
          url: cleanParts[3] || '',
          status: cleanParts[4] || '',
          notes: cleanParts[5] || ''
        })
      }
    }
    return records
  } catch {
    return []
  }
}

export function openApplicationsTracker(): void {
  const filePath = getTrackerFilePath()
  if (existsSync(filePath)) {
    shell.openPath(filePath).catch(() => {})
  }
}
