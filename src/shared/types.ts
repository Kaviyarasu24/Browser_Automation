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

/* ── Agent ─────────────────────────────────────────────────────────── */

export type AgentEvent =
  | { type: 'start'; task: string; model: string }
  | { type: 'thinking'; step: number; text: string }
  | { type: 'tool'; step: number; name: string; args: Record<string, unknown> }
  | { type: 'result'; step: number; name: string; ok: boolean; summary: string }
  | { type: 'done'; summary: string; steps: number }
  | { type: 'error'; message: string; hint?: string }
  | { type: 'cancelled' }
