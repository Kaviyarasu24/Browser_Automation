import type { RuntimeConfig } from '../config.js'

/* ── OpenAI-compatible wire types ──────────────────────────────────── */

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface CompletionResult {
  content: string
  toolCalls: ToolCall[]
  finishReason: string
  usage: { prompt: number; completion: number; total: number } | null
}

/** Raised for anything the user should see as a readable message. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly hint?: string
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

function describeStatus(status: number, body: string): LlmError {
  const snippet = body.slice(0, 300).replace(/\s+/g, ' ').trim()

  switch (status) {
    case 401:
    case 403:
      return new LlmError(
        `Provider rejected the API key (HTTP ${status}).`,
        'Check API_KEY in .env. For OpenRouter, keys start with "sk-or-".'
      )
    case 402:
      return new LlmError(
        'Provider reports insufficient credits (HTTP 402).',
        'Top up your provider account, or switch MODEL to a free variant.'
      )
    case 404:
      return new LlmError(
        `Model or endpoint not found (HTTP 404).`,
        'Check MODEL spelling and that BASE_URL includes the version path, e.g. https://openrouter.ai/api/v1'
      )
    case 429:
      return new LlmError(
        'Rate limited by the provider (HTTP 429).',
        'Wait a moment and retry, or switch to a paid model tier.'
      )
    default:
      return new LlmError(
        `Provider returned HTTP ${status}.`,
        snippet || undefined
      )
  }
}

/**
 * One non-streaming chat completion against any OpenAI-compatible endpoint.
 *
 * Non-streaming is deliberate for v1: the agent loop needs the *complete*
 * tool-call set before it can act, so incremental tokens buy nothing here and
 * add a whole class of SSE parsing bugs.
 */
export async function complete(
  cfg: RuntimeConfig,
  messages: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal
): Promise<CompletionResult> {
  const url = `${cfg.baseUrl}/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`
  }

  // OpenRouter attribution headers. Ignored by other providers.
  if (cfg.siteUrl) headers['HTTP-Referer'] = cfg.siteUrl
  if (cfg.siteName) headers['X-Title'] = cfg.siteName

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0,
    // `tool_choice: auto` lets the model decide when to stop calling tools and
    // answer directly, which is how the loop terminates naturally.
    tool_choice: 'auto'
  }
  if (tools.length > 0) payload.tools = tools

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new LlmError(
      `Could not reach the provider at ${cfg.baseUrl}.`,
      `Network error: ${(err as Error).message}. Check BASE_URL and your connection.`
    )
  }

  const raw = await res.text()

  if (!res.ok) {
    throw describeStatus(res.status, raw)
  }

  let json: {
    choices?: Array<{
      message?: { content?: string | null; tool_calls?: ToolCall[] }
      finish_reason?: string
    }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    error?: { message?: string }
  }

  try {
    json = JSON.parse(raw)
  } catch {
    // A gateway returning HTML (login page, 502 page) lands here.
    throw new LlmError(
      'Provider returned a non-JSON response.',
      `First 200 chars: ${raw.slice(0, 200).replace(/\s+/g, ' ')}`
    )
  }

  if (json.error?.message) {
    throw new LlmError(`Provider error: ${json.error.message}`)
  }

  const choice = json.choices?.[0]
  if (!choice) {
    throw new LlmError('Provider returned no choices.', `Raw: ${raw.slice(0, 200)}`)
  }

  return {
    content: choice.message?.content ?? '',
    toolCalls: choice.message?.tool_calls ?? [],
    finishReason: choice.finish_reason ?? 'stop',
    usage: json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0
        }
      : null
  }
}

/** Cheap connectivity check used by the Settings panel. */
export async function ping(cfg: RuntimeConfig): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)

  try {
    const result = await complete(
      cfg,
      [{ role: 'user', content: 'Reply with the single word: ok' }],
      [],
      controller.signal
    )
    return { ok: true, detail: `Model replied: ${result.content.trim().slice(0, 60) || '(empty)'}` }
  } catch (err) {
    if (err instanceof LlmError) return { ok: false, detail: `${err.message} ${err.hint ?? ''}`.trim() }
    return { ok: false, detail: (err as Error).message }
  } finally {
    clearTimeout(timer)
  }
}
