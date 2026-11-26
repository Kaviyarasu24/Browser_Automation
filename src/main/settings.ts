import { app, nativeTheme } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import type { BrowserRuntimeInfo, BrowserSettings } from '../shared/types.js'

const SETTINGS_FILENAME = 'edith-settings.json'

export function getDefaultSettings(): BrowserSettings {
  return {
    theme: 'system',
    startupBehavior: 'newtab',
    startupUrl: 'https://www.google.com',
    lastOpenTabs: [],
    showHomeButton: true,
    homeUrl: 'about:blank',
    searchEngine: 'google',
    customSearchUrl: 'https://www.google.com/search?q=%s',
    downloadPath: '',
    askWhereToSave: false,
    defaultZoom: 1.0,
    showVirtualCursor: true,
    typingSpeed: 'normal',
    crossDomainConfirm: true,
    defaultDryRun: false,
    maxAgentSteps: 60,
    eeoPolicy: 'prefer_not_to_say',
    rememberSidebar: true
  }
}

let cachedSettings: BrowserSettings | null = null

function getSettingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, SETTINGS_FILENAME)
}

export function getSettings(): BrowserSettings {
  if (cachedSettings) return cachedSettings
  const defaults = getDefaultSettings()
  try {
    const file = getSettingsPath()
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BrowserSettings>
      cachedSettings = { ...defaults, ...parsed }
      return cachedSettings
    }
  } catch (err) {
    console.warn('[settings] Failed to load settings, using defaults:', (err as Error).message)
  }
  cachedSettings = defaults
  return cachedSettings
}

export function applyThemeSource(theme: BrowserSettings['theme']): void {
  nativeTheme.themeSource = theme
}

export function updateSettings(patch: Partial<BrowserSettings>): BrowserSettings {
  const next: BrowserSettings = {
    ...getSettings(),
    ...patch
  }

  // Clamp numeric fields safely
  next.defaultZoom = Math.min(2.0, Math.max(0.5, Number(next.defaultZoom) || 1.0))
  next.maxAgentSteps = Math.min(150, Math.max(10, Math.round(Number(next.maxAgentSteps) || 60)))

  cachedSettings = next
  applyThemeSource(next.theme)

  try {
    writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.warn('[settings] Failed to save settings:', (err as Error).message)
  }

  return next
}

export function resetSettings(): BrowserSettings {
  const defaults = getDefaultSettings()
  // Preserve lastOpenTabs on reset
  defaults.lastOpenTabs = getSettings().lastOpenTabs
  cachedSettings = defaults
  applyThemeSource(defaults.theme)
  try {
    writeFileSync(getSettingsPath(), JSON.stringify(defaults, null, 2), 'utf8')
  } catch (err) {
    console.warn('[settings] Failed to reset settings:', (err as Error).message)
  }
  return defaults
}

export function getBrowserRuntimeInfo(): BrowserRuntimeInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? '',
    chromeVersion: process.versions.chrome ?? '',
    nodeVersion: process.versions.node ?? '',
    userDataPath: app.getPath('userData'),
    defaultDownloadsPath: join(app.getPath('downloads'), 'EDITH')
  }
}
