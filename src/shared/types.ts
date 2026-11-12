/**
 * Types shared across main, preload and renderer.
 * Kept dependency-free so both tsconfig projects can include it.
 */

export interface TabState {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Favicon URL, when the page provides one. */
  favicon: string | null
}

export interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PublicConfig {
  baseUrl: string
  model: string
  /** Never the key itself — only whether one is present. */
  hasApiKey: boolean
}

/* ── Downloads & Exports ────────────────────────────────────────────── */

export interface DownloadRecord {
  id: string
  filename: string
  savePath: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  totalBytes: number
  receivedBytes: number
  mimeType: string
  url: string
  startTime: number
}

/* ── Agent ─────────────────────────────────────────────────────────── */

export type AgentEvent =
  | { type: 'start'; task: string; model: string }
  | { type: 'navigating'; url: string }
  | { type: 'thinking'; step: number; text: string }
  | { type: 'tool'; step: number; name: string; args: Record<string, unknown> }
  | { type: 'result'; step: number; name: string; ok: boolean; summary: string }
  | {
      type: 'confirmation_required'
      id: string
      step: number
      title: string
      description: string
      action: string
      target?: string
    }
  | {
      type: 'download'
      filename: string
      path: string
      size: number
      state: 'started' | 'completed' | 'failed'
    }
  | { type: 'usage'; prompt: number; completion: number; total: number; step: number }
  | { type: 'done'; summary: string; steps: number; totalTokens?: number }
  | { type: 'error'; message: string; hint?: string }
  | { type: 'cancelled' }
