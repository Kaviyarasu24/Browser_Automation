import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface RuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  siteUrl: string
  siteName: string
}

/**
 * Minimal .env parser — deliberately dependency-free.
 *
 * Handles: `KEY=value`, optional surrounding quotes, `#` comments,
 * blank lines, and a leading `export`. Does NOT do variable interpolation;
 * that is not needed here and keeping it out avoids a class of surprises.
 *
 * Real environment variables always win over file values.
 */
function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = withoutExport.indexOf('=')
    if (eq === -1) continue

    const key = withoutExport.slice(0, eq).trim()
    if (!key) continue

    let value = withoutExport.slice(eq + 1).trim()

    // Strip one layer of matching quotes.
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted && value.length >= 2) {
      value = value.slice(1, -1)
    } else {
      // Unquoted: drop a trailing inline comment preceded by whitespace.
      const hash = value.indexOf(' #')
      if (hash !== -1) value = value.slice(0, hash).trim()
    }

    out[key] = value
  }

  return out
}

function loadEnvFiles(): void {
  const candidates = [
    join(app.getAppPath(), '.env'),
    join(process.cwd(), '.env'),
    join(app.getPath('userData'), '.env')
  ]

  const seen = new Set<string>()

  for (const file of candidates) {
    if (seen.has(file) || !existsSync(file)) continue
    seen.add(file)

    let parsed: Record<string, string>
    try {
      parsed = parseEnvFile(readFileSync(file, 'utf8'))
    } catch (err) {
      console.warn(`[config] could not read ${file}:`, (err as Error).message)
      continue
    }

    for (const [key, value] of Object.entries(parsed)) {
      // Real env vars take precedence over any file.
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

let cached: RuntimeConfig | null = null

export function getConfig(): RuntimeConfig {
  if (cached) return cached

  loadEnvFiles()

  cached = {
    baseUrl: (process.env.BASE_URL ?? '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.API_KEY ?? '').trim(),
    model: (process.env.MODEL ?? '').trim(),
    siteUrl: (process.env.OPENROUTER_SITE_URL ?? '').trim(),
    siteName: (process.env.OPENROUTER_SITE_NAME ?? 'Strawberry').trim()
  }

  return cached
}

/**
 * Validate the config and return a list of human-readable problems.
 * Empty array means the config is usable for agent runs.
 *
 * Called before an agent run rather than at startup, so the browser itself
 * still works when the LLM config is missing or wrong.
 */
export function validateConfig(cfg: RuntimeConfig): string[] {
  const problems: string[] = []

  if (!cfg.baseUrl) {
    problems.push('BASE_URL is not set (e.g. https://openrouter.ai/api/v1)')
  } else if (!/^https?:\/\//i.test(cfg.baseUrl)) {
    problems.push(`BASE_URL must start with http:// or https:// (got "${cfg.baseUrl}")`)
  }

  if (!cfg.apiKey) problems.push('API_KEY is not set')
  if (!cfg.model) problems.push('MODEL is not set (e.g. anthropic/claude-sonnet-5-5)')

  return problems
}
