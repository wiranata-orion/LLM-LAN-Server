import { Agent, setGlobalDispatcher } from 'undici'
import { config } from './config.js'
import type { ChatMessage, ChatOptions, OllamaChatResponse, OllamaPullProgress, OllamaRunningModel, ToolDefinition } from './types.js'

// Node's global fetch() is backed by undici, whose default Agent gives up on
// a request that goes quiet for more than 300s (headersTimeout: no response
// headers yet; bodyTimeout: no further body bytes) - independently of any
// AbortSignal a caller passes in. A heavy vision model's prompt eval on a
// VRAM-constrained GPU can easily exceed that before the first token is
// even generated, which is exactly the "socket timeout" this exists to fix.
// Both timeouts reset on activity, so a slow-but-still-streaming reply is
// never killed - only a genuinely stalled connection (engine hung, VRAM
// stuck) trips this. This is the only file in agent-server that calls
// fetch(), so a global dispatcher here can't affect anything else.
setGlobalDispatcher(new Agent({
  headersTimeout: config.ollamaRequestTimeoutMs,
  bodyTimeout: config.ollamaRequestTimeoutMs,
}))

interface OllamaGenerateEmbeddingResponse {
  embedding?: number[]
  embeddings?: number[][]
}

interface OllamaShowResponse {
  capabilities?: string[]
}

const toolSupportCache = new Map<string, boolean>()
const visionSupportCache = new Map<string, boolean>()

export class OllamaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OllamaError'
  }
}

async function parseError(response: Response): Promise<never> {
  const body = await response.text().catch(() => '')
  // llama.cpp-backed engines (and Ollama itself, for a model pulled without
  // its projector) return this when a message carries images but the loaded
  // model has no mmproj attached - a plain-text model was never going to
  // handle vision input, so this is a model/config mismatch, not a bug.
  if (/image input is not supported|mmproj/i.test(body)) {
    throw new OllamaError(
      'Model yang sedang dipakai tidak mendukung input gambar (bukan model vision, atau mmproj-nya belum dimuat). Pilih model vision (misalnya Qwen2.5-VL, LLaVA, atau llama3.2-vision) sebelum mengirim gambar.',
      response.status,
    )
  }
  throw new OllamaError(`Ollama request failed (${response.status}): ${body || response.statusText}`, response.status)
}

/**
 * Turns the low-level errors fetch() throws for a dead connection into a
 * message that actually says what happened, instead of a bare "fetch
 * failed". Returns null for anything else so the original error passes
 * through unchanged (in particular a genuine caller-initiated abort, which
 * callers like routes.ts distinguish from a real failure via signal.aborted).
 */
function describeNetworkError(error: unknown, url: string): string | null {
  if (!(error instanceof Error)) return null
  const cause = (error as { cause?: { code?: string } }).cause
  if (cause?.code === 'UND_ERR_HEADERS_TIMEOUT' || cause?.code === 'UND_ERR_BODY_TIMEOUT') {
    const seconds = Math.round(config.ollamaRequestTimeoutMs / 1000)
    return `Ollama tidak merespons dalam ${seconds} detik. Server mungkin sedang sibuk (VRAM penuh / prompt eval model vision) atau macet - coba lagi, atau naikkan OLLAMA_REQUEST_TIMEOUT_MS jika model ini memang butuh waktu lebih lama.`
  }
  if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ENETUNREACH' || cause?.code === 'EHOSTUNREACH' || cause?.code === 'ETIMEDOUT') {
    // Reports the URL this specific request actually targeted, not the
    // shared config default - the two can differ (e.g. a chat request's own
    // ollamaBaseUrl override vs. an embedding call still on the stale
    // server-wide default), and pointing at the wrong one sends whoever's
    // debugging this to check the wrong engine.
    const origin = (() => { try { return new URL(url).origin } catch { return url } })()
    return `Tidak dapat terhubung ke Ollama di ${origin}. Pastikan server Ollama menyala dan dapat dijangkau di jaringan.`
  }
  return null
}

/**
 * Every fetch() to Ollama goes through this so a dead connection (see
 * describeNetworkError) always surfaces a clear message. `signal` here is
 * only ever a caller-initiated abort (client disconnect, or a call site's
 * own tighter timeout like the query-embedding one) - the blanket
 * stalled-connection timeout is handled by the undici Agent above, not by an
 * AbortSignal, so there is nothing to combine here.
 */
async function fetchOllama(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    const description = describeNetworkError(error, url)
    if (description) throw new OllamaError(description)
    throw error
  }
}

/**
 * Ollama's keep_alive field is a Go time.Duration under the hood: a bare
 * integer must be sent as a JSON *number* (seconds; negative = keep loaded
 * forever), while a JSON *string* is run through Go's duration parser, which
 * requires a unit suffix ("1h", "30m") and rejects a plain "-1" with
 * `time: missing unit in duration "-1"`. config.ollamaKeepAlive is a string
 * (it comes from an env var), so plain-integer values are converted to a
 * real number here; anything else (e.g. "1h") is passed through as-is.
 */
function resolveKeepAlive(value: string): number | string {
  const trimmed = value.trim()
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

/**
 * Whether this model declares Ollama's "tools" capability (GET /api/show).
 * Cached per model+engine since it never changes for a given install.
 * requestChat() below uses this itself to decide whether to attach tool
 * definitions at all; exported separately too so the web-ui can show the
 * user which of their installed models actually support tool-calling,
 * instead of it only ever surfacing as a silent fallback.
 */
export async function supportsTools(model: string, baseUrl: string): Promise<boolean> {
  const cacheKey = `${baseUrl}::${model}`
  const cached = toolSupportCache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const response = await fetchOllama(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    if (!response.ok) return false
    const payload = await response.json() as OllamaShowResponse
    const supported = payload.capabilities?.includes('tools') ?? false
    toolSupportCache.set(cacheKey, supported)
    return supported
  } catch {
    return false
  }
}

/**
 * Whether this model declares Ollama's "vision" capability (GET /api/show) -
 * lets the web-ui hide the image-attach button entirely for a model that
 * can't use it, instead of the user only finding out after sending an image
 * and getting back the "image input is not supported / mmproj" error (see
 * parseError above). Cached per model+engine, same as supportsTools.
 */
export async function supportsVision(model: string, baseUrl: string): Promise<boolean> {
  const cacheKey = `${baseUrl}::${model}`
  const cached = visionSupportCache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const response = await fetchOllama(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    })
    if (!response.ok) return false
    const payload = await response.json() as OllamaShowResponse
    const supported = payload.capabilities?.includes('vision') ?? false
    visionSupportCache.set(cacheKey, supported)
    return supported
  } catch {
    return false
  }
}

async function requestChat(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  options?: ChatOptions,
  baseUrl: string = config.ollamaBaseUrl,
  signal?: AbortSignal,
): Promise<Response> {
  const canUseTools = tools.length > 0 && await supportsTools(model, baseUrl)
  const hasOptions = options && Object.values(options).some((value) => value !== undefined && value !== null && value !== '')
  const createRequest = (includeTools: boolean) => fetchOllama(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      ...(includeTools ? { tools } : {}),
      ...(hasOptions ? { options } : {}),
      // Always stream from Ollama - even chat()'s single-shot response is
      // built by consuming this same stream (see below) - so the connection
      // keeps moving bytes (keep-alive) instead of leaving Ollama to build
      // one huge buffered response, which looks identical to a stalled
      // connection until it's entirely done.
      stream: true,
      // Without this, Ollama's default 5m idle timeout (or sooner, if VRAM
      // pressure from another model forces an early evict) unloads the model
      // between turns - the reload from disk before the next reply can take
      // far longer than the actual generation itself. See config.ts.
      keep_alive: resolveKeepAlive(config.ollamaKeepAlive),
    }),
  }, signal)

  let response = await createRequest(canUseTools)
  if (!response.ok && canUseTools && response.status === 400) {
    const body = await response.clone().text().catch(() => '')
    if (/tools?|function calling|does not support/i.test(body)) {
      toolSupportCache.set(`${baseUrl}::${model}`, false)
      response = await createRequest(false)
    }
  }
  return response
}

/**
 * @param baseUrl Defaults to the shared config.ollamaBaseUrl (only updated by
 * the web-ui's out-of-band /engine/active sync). Callers acting within a
 * single chat request should instead pass that request's own ollamaBaseUrl
 * override through here - otherwise retrieval/memory embedding silently
 * targets a different (possibly stale or unreachable) engine than the one
 * actually generating the reply.
 */
export async function embed(text: string, signal?: AbortSignal, baseUrl: string = config.ollamaBaseUrl): Promise<number[]> {
  const response = await fetchOllama(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.embedModel, prompt: text, keep_alive: resolveKeepAlive(config.ollamaEmbedKeepAlive) }),
  }, signal)
  if (!response.ok) await parseError(response)
  const payload = await response.json() as OllamaGenerateEmbeddingResponse
  const vector = payload.embedding ?? payload.embeddings?.[0]
  if (!vector?.length) throw new OllamaError('Ollama returned an empty embedding')
  return vector
}

/** Same request as chatStream(), just without forwarding individual tokens - see requestChat for why this still streams from Ollama under the hood. */
export async function chat(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model = config.chatModel,
  options?: ChatOptions,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<OllamaChatResponse> {
  return chatStream(messages, tools, model, () => {}, options, baseUrl, signal)
}

/**
 * @param signal Aborting this also cancels the underlying request to Ollama
 * itself (not just this function's own bookkeeping), so the model actually
 * stops generating - e.g. when routes.ts detects the client disconnected
 * (the Stop button) - instead of continuing to burn GPU/CPU in the background
 * for a response nobody is listening for anymore.
 */
export async function chatStream(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  model: string,
  onToken: (content: string) => void,
  options?: ChatOptions,
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<OllamaChatResponse> {
  const response = await requestChat(messages, tools, model, options, baseUrl, signal)
  if (!response.ok) await parseError(response)
  if (!response.body) throw new OllamaError('Ollama returned no stream body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let done = false
  const toolCalls: NonNullable<ChatMessage['tool_calls']> = []
  // Only the final chunk (done: true) carries these - see OllamaChatResponse.
  let stats: Pick<OllamaChatResponse, 'total_duration' | 'load_duration' | 'prompt_eval_count' | 'prompt_eval_duration' | 'eval_count' | 'eval_duration'> = {}

  const consume = (line: string) => {
    if (!line.trim()) return
    const payload = JSON.parse(line) as OllamaChatResponse
    const chunk = payload.message
    if (chunk?.content) {
      content += chunk.content
      onToken(chunk.content)
    }
    if (chunk?.tool_calls?.length) toolCalls.push(...chunk.tool_calls)
    if (payload.done) {
      // Picked field-by-field rather than storing the whole payload - it
      // still carries its own (often empty) `message`, which would otherwise
      // clobber the content accumulated above once spread into the return
      // value below.
      stats = {
        total_duration: payload.total_duration,
        load_duration: payload.load_duration,
        prompt_eval_count: payload.prompt_eval_count,
        prompt_eval_duration: payload.prompt_eval_duration,
        eval_count: payload.eval_count,
        eval_duration: payload.eval_duration,
      }
    }
    done = payload.done || done
  }

  try {
    while (!done) {
      const result = await reader.read()
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) consume(line)
    }
    if (buffer.trim()) consume(buffer)
  } catch (error) {
    // A stalled connection can go quiet mid-stream (after headers already
    // arrived), not just before the first byte - the undici bodyTimeout
    // above catches that, but it surfaces here, not from the initial
    // fetchOllama() call, so it needs the same message normalization.
    if (signal?.aborted) throw error
    const description = describeNetworkError(error, `${baseUrl ?? config.ollamaBaseUrl}/api/chat`)
    if (description) throw new OllamaError(description)
    throw error
  }
  return {
    done: true,
    message: {
      role: 'assistant',
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    ...stats,
  }
}

/**
 * Breaks a chatStream()/chat() response's total wall time down into what
 * Ollama itself reports: model load, prompt eval, and actual token
 * generation. Without this, a slow turn only ever shows up as one opaque
 * "generation took Ns" number, which can't distinguish "the model had to be
 * reloaded into VRAM" (a keep_alive/model-switching problem) from "the GPU
 * is genuinely slow at this model" (a hardware/model-choice problem) - two
 * very different things to fix. Returns '' when Ollama didn't report stats
 * (e.g. an error response never reached the final done:true chunk).
 */
export function formatOllamaStats(response: OllamaChatResponse): string {
  const seconds = (ns?: number) => (ns !== undefined ? ns / 1e9 : undefined)
  const parts: string[] = []

  const load = seconds(response.load_duration)
  if (load !== undefined && load >= 0.05) parts.push(`model load: ${load.toFixed(1)}s`)

  const promptEval = seconds(response.prompt_eval_duration)
  if (promptEval !== undefined) {
    parts.push(`prompt eval: ${promptEval.toFixed(1)}s (${response.prompt_eval_count ?? '?'} tok)`)
  }

  const eval_ = seconds(response.eval_duration)
  if (eval_ !== undefined) {
    const tokPerSec = response.eval_count && eval_ > 0 ? (response.eval_count / eval_).toFixed(1) : '?'
    parts.push(`generation: ${eval_.toFixed(1)}s (${response.eval_count ?? '?'} tok, ~${tokPerSec} tok/s)`)
  }

  return parts.length ? ` [${parts.join(', ')}]` : ''
}

export async function ping(baseUrl: string = config.ollamaBaseUrl, signal?: AbortSignal): Promise<{ version: string }> {
  const response = await fetchOllama(`${baseUrl}/api/version`, {}, signal)
  if (!response.ok) await parseError(response)
  return await response.json() as { version: string }
}

/**
 * Models currently resident in VRAM on this engine (Ollama's GET /api/ps),
 * with their size and when they'll be auto-unloaded. This is what actually
 * shows whether the chat model and embedding model are coexisting or
 * fighting each other for the same VRAM - see the Performance Dashboard.
 */
export async function listRunningModels(baseUrl: string = config.ollamaBaseUrl, signal?: AbortSignal): Promise<OllamaRunningModel[]> {
  const response = await fetchOllama(`${baseUrl}/api/ps`, {}, signal)
  if (!response.ok) await parseError(response)
  const payload = await response.json() as { models?: OllamaRunningModel[] }
  return payload.models ?? []
}

/**
 * Downloads a model, streaming Ollama's own progress lines (status, and for
 * the actual layer downloads: digest/total/completed bytes) so the caller can
 * show a real progress bar instead of an indeterminate spinner for what can
 * be a multi-gigabyte, many-minutes download. The undici bodyTimeout (see the
 * Agent above) resets on every progress line Ollama sends, so a long-but-
 * actively-progressing pull is never killed - only a genuinely stalled one is.
 */
export async function pullModel(
  model: string,
  onProgress: (progress: OllamaPullProgress) => void,
  baseUrl: string = config.ollamaBaseUrl,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchOllama(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  }, signal)
  if (!response.ok) await parseError(response)
  if (!response.body) throw new OllamaError('Ollama returned no stream body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const consume = (line: string) => {
    if (!line.trim()) return
    const payload = JSON.parse(line) as OllamaPullProgress
    onProgress(payload)
    if (payload.error) throw new OllamaError(payload.error)
  }

  try {
    let done = false
    while (!done) {
      const result = await reader.read()
      if (result.done) break
      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) consume(line)
    }
    if (buffer.trim()) consume(buffer)
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof OllamaError) throw error
    const description = describeNetworkError(error, `${baseUrl}/api/pull`)
    if (description) throw new OllamaError(description)
    throw error
  }
}

/** Removes a model from disk. `model` is the full name as shown by /api/tags (e.g. "llama3.2:latest"). */
export async function deleteModel(model: string, baseUrl: string = config.ollamaBaseUrl, signal?: AbortSignal): Promise<void> {
  const response = await fetchOllama(`${baseUrl}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
  }, signal)
  if (!response.ok) await parseError(response)
}
