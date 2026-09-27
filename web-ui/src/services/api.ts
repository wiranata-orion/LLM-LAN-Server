import { getSettings, saveSettingsToStorage } from './api.js'

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  // Base64-encoded images (no data: URI prefix), already resized client-side
  // (see image.js) - passed straight through to Ollama's /api/chat.
  images?: string[]
}

/**
 * One chat turn's full performance breakdown, as computed by the
 * agent-server (see TurnPerformanceStats in agent-server/src/types.ts) -
 * powers the per-message stats line (ChatView.vue) and the Performance
 * Dashboard's history/chart. The Ollama-reported fields are nanoseconds and
 * only present once a turn actually reached a done:true response.
 */
export interface TurnPerformanceStats {
  id: string
  timestamp: string
  conversationId: string
  model: string
  ollamaBaseUrl: string
  ragEnabled: boolean
  contextMs: number
  generationMs: number
  toolRounds: number
  retrievedChunks: number
  totalDuration?: number
  loadDuration?: number
  promptEvalCount?: number
  promptEvalDuration?: number
  evalCount?: number
  evalDuration?: number
}

export interface AgentChatResult {
  ok: boolean
  message?: AgentMessage
  toolRounds?: number
  retrievedChunks?: number
  memoryId?: string
  performance?: TurnPerformanceStats
  error?: string
}

export interface AgentStreamEvent {
  type: 'meta' | 'token' | 'done' | 'error' | 'memory'
  content?: string
  toolRounds?: number
  retrievedChunks?: number
  memoryId?: string
  performance?: TurnPerformanceStats
  // Present only when type === 'memory' - see MemoryEvent in agent-server/src/types.ts.
  phase?: 'read' | 'write'
  status?: 'start' | 'end' | 'error'
  detail?: string
}

/** Live "reading memory" / "writing memory" activity for one chat turn - see MemoryIndicator.vue. */
export interface MemoryActivityEvent {
  phase: 'read' | 'write'
  status: 'start' | 'end' | 'error'
  detail?: string
}

const DEFAULT_AGENT_URL = 'http://127.0.0.1:8787/api'

export function getAgentApiUrl(): string {
  const configured = import.meta.env.VITE_AGENT_SERVER_URL
  return (configured || DEFAULT_AGENT_URL).replace(/\/$/, '')
}

/**
 * The Ollama endpoint the agent-server should target for this request:
 * whichever engine (Laptop / PC Server) is currently active in Settings.
 * This is what actually makes the "Mesin & Koneksi" switch affect real
 * chat inference, not just the model list / ping display.
 */
function resolveOllamaBaseUrl(settings: ReturnType<typeof getSettings>): string | undefined {
  const url = settings.activeEngine === 'pc' ? settings.pcUrl : settings.laptopUrl
  return url && url.trim() ? url.trim().replace(/\/+$/, '') : undefined
}

/**
 * Chat options (temperature / context window / max tokens) as configured in
 * Settings > Parameter AI, resolved for whichever engine is currently active.
 */
function resolveChatOptions(settings: ReturnType<typeof getSettings>) {
  const options: { temperature?: number; num_ctx?: number; num_predict?: number } = {}
  if (settings.temperature !== undefined && settings.temperature !== '' && !Number.isNaN(Number(settings.temperature))) {
    options.temperature = Number(settings.temperature)
  }
  const activeNumCtx = settings.activeEngine === 'pc'
    ? (settings.numCtxPc || settings.numCtx)
    : (settings.numCtxLaptop || settings.numCtx)
  if (activeNumCtx) options.num_ctx = parseInt(String(activeNumCtx), 10)
  if (settings.maxTokens !== undefined && settings.maxTokens !== '') {
    options.num_predict = parseInt(String(settings.maxTokens), 10)
  }
  return options
}

function isConnectivityError(message: string): boolean {
  return /tidak dapat dihubungi|ECONNREFUSED|fetch failed|unreachable|timeout|network|Ollama request failed|Ollama unavailable/i.test(message)
}

function dispatchEngineFallback(message: string) {
  window.dispatchEvent(
    new CustomEvent('engine-fallback', {
      detail: { from: 'PC Server', to: 'Laptop', message },
    })
  )
}

/**
 * Switches settings to Laptop and waits for the agent-server to actually
 * stop targeting the broken PC Server (via syncActiveEngine) before this
 * resolves. Awaiting this - instead of firing the retry immediately after
 * saveSettingsToStorage - matters because memory/embedding calls on the
 * agent-server follow that synced default, not a per-request override (see
 * config.ts): retrying too early could have the "fallback" request still
 * silently hit the broken PC for its memory step even though chat itself had
 * already moved to Laptop.
 */
async function switchToLaptopAfterFailure(message: string): Promise<void> {
  saveSettingsToStorage({ activeEngine: 'laptop' })
  await syncActiveEngine()
  dispatchEngineFallback(message)
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getAgentApiUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error || `Agent server error ${response.status}`)
  }
  return payload
}

export async function sendMessage(
  message: string,
  history: AgentMessage[],
  model?: string,
  signal?: AbortSignal,
  conversationId?: string,
  images?: string[],
  isFallbackRetry = false,
): Promise<AgentChatResult> {
  const settings = getSettings()
  try {
    return await requestJson<AgentChatResult>('/chat', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        model: model || settings.agentModel || undefined,
        conversationId,
        ollamaBaseUrl: resolveOllamaBaseUrl(settings),
        options: resolveChatOptions(settings),
        useContextRetrieval: settings.useContextRetrieval !== false,
        customInstructions: settings.customInstructions || undefined,
        messages: [...history, { role: 'user', content: message, ...(images?.length ? { images } : {}) }],
      }),
    })
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Agent request failed'
    if (settings.activeEngine === 'pc' && settings.autoFallback !== false && !isFallbackRetry && isConnectivityError(messageText)) {
      await switchToLaptopAfterFailure('Koneksi PC Server terputus. Mengalihkan ke Laptop.')
      return sendMessage(message, history, model, signal, conversationId, images, true)
    }
    throw error
  }
}

export async function sendMessageStream(
  message: string,
  history: AgentMessage[],
  model: string | undefined,
  signal: AbortSignal,
  conversationId: string,
  onToken: (content: string) => void,
  onMeta?: (meta: { retrievedChunks?: number; memoryId?: string; performance?: TurnPerformanceStats }) => void,
  onMemory?: (event: MemoryActivityEvent) => void,
  images?: string[],
  isFallbackRetry = false,
): Promise<void> {
  const settings = getSettings()
  // Set once the stream reader below actually exists, so a fallback
  // triggered mid-stream (see handleEvent's 'error' branch) can explicitly
  // close it out - "disconnect the old engine first" - before a retry to the
  // new engine starts, instead of just abandoning it.
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined

  const fallbackIfEligible = async (messageText: string): Promise<boolean> => {
    if (settings.activeEngine === 'pc' && settings.autoFallback !== false && !isFallbackRetry && isConnectivityError(messageText)) {
      if (activeReader) await activeReader.cancel().catch(() => {})
      await switchToLaptopAfterFailure('Koneksi PC Server terputus. Mengalihkan ke Laptop.')
      await sendMessageStream(message, history, model, signal, conversationId, onToken, onMeta, onMemory, images, true)
      return true
    }
    return false
  }

  let response: Response
  try {
    response = await fetch(`${getAgentApiUrl()}/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        model,
        conversationId,
        stream: true,
        ollamaBaseUrl: resolveOllamaBaseUrl(settings),
        options: resolveChatOptions(settings),
        useContextRetrieval: settings.useContextRetrieval !== false,
        customInstructions: settings.customInstructions || undefined,
        messages: [...history, { role: 'user', content: message, ...(images?.length ? { images } : {}) }],
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const messageText = `Agent server tidak dapat dihubungi di ${getAgentApiUrl()}. Jalankan agent-server terlebih dahulu.`
    if (await fallbackIfEligible(messageText)) return
    throw new Error(messageText)
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    const messageText = payload.error || `Agent server error ${response.status}`
    if (await fallbackIfEligible(messageText)) return
    throw new Error(messageText)
  }

  const reader = response.body.getReader()
  activeReader = reader
  const decoder = new TextDecoder()
  let buffer = ''

  const handleEvent = async (event: AgentStreamEvent): Promise<boolean> => {
    if (event.type === 'token' && event.content) onToken(event.content)
    if (event.type === 'meta') onMeta?.({ retrievedChunks: event.retrievedChunks, memoryId: event.memoryId, performance: event.performance })
    if (event.type === 'memory' && event.phase && event.status) {
      onMemory?.({ phase: event.phase, status: event.status, detail: event.detail })
    }
    if (event.type === 'error') {
      const messageText = event.content || 'Agent request failed'
      if (await fallbackIfEligible(messageText)) return true
      throw new Error(messageText)
    }
    return false
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as AgentStreamEvent
      if (await handleEvent(event)) return
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as AgentStreamEvent
    await handleEvent(event)
  }
}

// PDF/DOCX/XLSX decode to garbage as text (see agent-server's ingestion.ts
// looksBinary guard) - they need to reach the server as base64 so
// file-extract.ts can run the right parser on the real bytes.
const BINARY_DOCUMENT_PATTERN = /\.(pdf|docx|xlsx|xls)$/i

/** Reads a File as base64 (no data: URI prefix) via the browser's own decoder, instead of a manual byte-to-base64 loop that chokes on multi-MB files. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '')
    reader.onerror = () => reject(new Error(`Gagal membaca file: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export async function uploadDocument(file: File): Promise<{ ok: boolean; documents: number; chunks: number }> {
  const isBinaryDocument = BINARY_DOCUMENT_PATTERN.test(file.name)
  const content = isBinaryDocument ? await readFileAsBase64(file) : await file.text()
  return requestJson('/ingest', {
    method: 'POST',
    body: JSON.stringify({
      documents: [{ source: file.name, content, ...(isBinaryDocument ? { encoding: 'base64' } : {}) }],
    }),
  })
}

// ===== RAG document management =====

export interface RagDocumentSource {
  source: string
  chunks: number
  characters: number
}

export async function listDocuments(): Promise<{ ok: boolean; documents: RagDocumentSource[] }> {
  return requestJson('/documents', { method: 'GET' })
}

export async function deleteDocument(source: string): Promise<{ ok: boolean; removed: number }> {
  return requestJson(`/documents/${encodeURIComponent(source)}`, { method: 'DELETE' })
}

// ===== Tool-calling support check =====

export async function checkModelSupportsTools(model: string, ollamaBaseUrl?: string): Promise<{ ok: boolean; supported: boolean; error?: string }> {
  const params = new URLSearchParams({ model })
  if (ollamaBaseUrl) params.set('ollamaBaseUrl', ollamaBaseUrl)
  return requestJson(`/models/supports-tools?${params.toString()}`, { method: 'GET' })
}

// ===== Vision (image input) support check =====

export async function checkModelSupportsVision(model: string, ollamaBaseUrl?: string): Promise<{ ok: boolean; supported: boolean; error?: string }> {
  const params = new URLSearchParams({ model })
  if (ollamaBaseUrl) params.set('ollamaBaseUrl', ollamaBaseUrl)
  return requestJson(`/models/supports-vision?${params.toString()}`, { method: 'GET' })
}

/**
 * Checks that the agent-server itself (and its SQLite-backed long-term
 * memory) is reachable - this is what drives the "Ingatan" badge, and it
 * deliberately does NOT depend on Ollama/the active engine being reachable:
 * that storage works with zero Ollama dependency, and tying the badge to a
 * LAN ping of a possibly-busy PC Server engine made it flicker "disconnected"
 * mid-reply. The active engine's own reachability already has its own
 * indicator (see the engine-status-pill in App.vue / getModels()).
 * The active engine's URL is still sent so the response's `ollama` field
 * carries it as non-blocking diagnostic info, but it never affects `ok`.
 */
export async function checkAgentHealth(): Promise<{
  ok: boolean
  error?: string
  // Reachability/version of the active engine specifically - non-blocking
  // diagnostic info, never a reason `ok` itself is false (see routes.ts).
  ollama?: { ok: boolean; version?: string; error?: string }
}> {
  const ollamaBaseUrl = resolveOllamaBaseUrl(getSettings())
  const query = ollamaBaseUrl ? `?ollamaBaseUrl=${encodeURIComponent(ollamaBaseUrl)}` : ''
  return requestJson(`/health${query}`, { method: 'GET' })
}

/**
 * Pushes the currently active engine (Laptop / PC Server) to the agent-server
 * as its own default Ollama target, so work that doesn't flow through a
 * per-request ollamaBaseUrl - Vibe Coding's background file-watcher
 * re-indexing, document ingestion, memory embeddings - also fully follows
 * whichever engine is selected instead of silently defaulting to whatever
 * OLLAMA_BASE_URL the agent-server booted with. Call this on load and on
 * every engine switch (see App.vue). Best-effort: if the agent-server isn't
 * up yet, this just fails quietly like any other health-adjacent check.
 */
export async function syncActiveEngine(): Promise<void> {
  const ollamaBaseUrl = resolveOllamaBaseUrl(getSettings())
  if (!ollamaBaseUrl) return
  try {
    await requestJson('/engine/active', {
      method: 'POST',
      body: JSON.stringify({ ollamaBaseUrl }),
    })
  } catch (error) {
    console.warn('Could not sync active engine with agent-server:', error)
  }
}

/**
 * Records Yes/No feedback on a specific past reply (identified by the
 * `memoryId` returned alongside the chat response). The agent-server surfaces
 * this feedback the next time that exchange is retrieved as relevant memory,
 * so a reply marked "No" isn't quietly repeated for a similar question later.
 */
export async function rateMemoryMessage(memoryId: string, rating: 'good' | 'bad' | null): Promise<{ ok: boolean; error?: string }> {
  return requestJson(`/memory/messages/${encodeURIComponent(memoryId)}/rating`, {
    method: 'POST',
    body: JSON.stringify({ rating }),
  })
}

export interface MemoryStorageInfo {
  ok: boolean
  memoryRoot: string
  isCustom: boolean
  defaultMemoryRoot: string
  error?: string
}

/** Where the agent-server's real memory (conversation SQLite + vector store) lives right now. */
export async function getMemoryStoragePath(): Promise<MemoryStorageInfo> {
  return requestJson('/memory/storage', { method: 'GET' })
}

/**
 * Point the agent-server's memory at a different absolute folder path (e.g. a
 * flashdisk). Pointing at the same folder again later - from either device -
 * picks the same memory back up, since the server persists this choice.
 */
export async function setMemoryStoragePath(path: string): Promise<MemoryStorageInfo> {
  return requestJson('/memory/storage', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export async function resetMemoryStoragePath(): Promise<MemoryStorageInfo> {
  return requestJson('/memory/storage/reset', { method: 'POST' })
}

export interface BrowseEntry {
  name: string
  path: string
}

export interface BrowseResult {
  ok: boolean
  currentPath: string | null
  parentPath: string | null
  directories: BrowseEntry[]
  shortcuts: BrowseEntry[]
  error?: string
}

/**
 * Lists subfolders of a path on the machine running the agent-server, so the
 * UI can offer a "Pilih Folder" button for the memory location. Omit `path`
 * to list top-level roots (drives on Windows, "/" elsewhere).
 */
export async function browseServerFolder(path?: string): Promise<BrowseResult> {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  return requestJson(`/memory/browse${query}`, { method: 'GET' })
}

// ===== Chat history storage (Settings > Memory > "Folder Penyimpanan Fisik") =====
// This is raw conversation/folder storage, mediated by the agent-server so the
// same server-side folder browser above can be reused for it - the browser's
// own File System Access API never exposes a real path a server could use.

export interface ChatHistoryStorageInfo {
  ok: boolean
  chatHistoryRoot: string | null
  isConfigured: boolean
  error?: string
}

export async function getChatHistoryStoragePath(): Promise<ChatHistoryStorageInfo> {
  return requestJson('/chat-history/storage', { method: 'GET' })
}

export async function setChatHistoryStoragePath(path: string): Promise<ChatHistoryStorageInfo> {
  return requestJson('/chat-history/storage', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export async function clearChatHistoryStoragePath(): Promise<ChatHistoryStorageInfo> {
  return requestJson('/chat-history/storage/reset', { method: 'POST' })
}

export interface ServerConversation {
  version: 1
  conversationId: string
  title: string
  folderId: string | null
  createdAt: string
  updatedAt: string
  messages: Array<Record<string, unknown>>
  embedding?: number[] | null
}

export async function listServerConversations(): Promise<{ ok: boolean; conversations: ServerConversation[] }> {
  return requestJson('/chat-history/conversations', { method: 'GET' })
}

export async function saveServerConversation(conversation: {
  conversationId: string
  title?: string
  folderId?: string | null
  createdAt?: string
  messages: Array<Record<string, unknown>>
  embedding?: number[] | null
}): Promise<{ ok: boolean }> {
  const { conversationId, ...body } = conversation
  return requestJson(`/chat-history/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deleteServerConversation(conversationId: string): Promise<{ ok: boolean; deleted: boolean }> {
  return requestJson(`/chat-history/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
}

export interface ServerFolder {
  id: string
  name: string
  parentId: string | null
  isExpanded: boolean
  createdAt: string
}

export async function listServerFolders(): Promise<{ ok: boolean; folders: ServerFolder[] }> {
  return requestJson('/chat-history/folders', { method: 'GET' })
}

export async function saveServerFolders(folders: ServerFolder[]): Promise<{ ok: boolean }> {
  return requestJson('/chat-history/folders', {
    method: 'PUT',
    body: JSON.stringify({ folders }),
  })
}

export interface ServerGlobalMemory {
  permanent_instructions: string[]
  interactions: Array<Record<string, unknown>>
  updatedAt: string
}

export async function getServerGlobalMemory(): Promise<{ ok: boolean; memory: ServerGlobalMemory }> {
  return requestJson('/chat-history/global-memory', { method: 'GET' })
}

export async function saveServerGlobalMemory(memory: {
  permanent_instructions?: string[]
  interactions?: Array<Record<string, unknown>>
}): Promise<{ ok: boolean }> {
  return requestJson('/chat-history/global-memory', {
    method: 'PUT',
    body: JSON.stringify(memory),
  })
}

// ===== Performance Dashboard =====

/** One model Ollama's GET /api/ps reports as currently resident in VRAM. */
export interface OllamaRunningModel {
  name: string
  model: string
  size: number
  size_vram: number
  digest: string
  expires_at: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
    [key: string]: unknown
  }
}

/** History of past turns' timing breakdown, for the dashboard's trend chart. */
export async function getPerformanceHistory(limit = 50): Promise<{ ok: boolean; history: TurnPerformanceStats[] }> {
  return requestJson(`/performance/history?limit=${encodeURIComponent(String(limit))}`, { method: 'GET' })
}

/**
 * Models currently loaded in VRAM on the given engine. Never throws on an
 * unreachable engine - see the endpoint's own comment in routes.ts - so the
 * dashboard can show "engine tidak terjangkau" instead of an error boundary.
 */
export async function getRunningModels(ollamaBaseUrl?: string): Promise<{ ok: boolean; models: OllamaRunningModel[]; error?: string }> {
  const query = ollamaBaseUrl ? `?ollamaBaseUrl=${encodeURIComponent(ollamaBaseUrl)}` : ''
  return requestJson(`/performance/running-models${query}`, { method: 'GET' })
}

// ===== Disk usage (Settings > Penyimpanan) =====

export interface StorageUsageEntry {
  key: string
  label: string
  path: string
  bytes: number
  exists: boolean
}

export async function getStorageUsage(): Promise<{ ok: boolean; usage: StorageUsageEntry[]; memoryRoot: string }> {
  return requestJson('/storage/usage', { method: 'GET' })
}

/** Runs SQLite VACUUM on the memory/vector/performance databases to reclaim disk space. */
export async function vacuumStorage(): Promise<{ ok: boolean; error?: string }> {
  return requestJson('/storage/vacuum', { method: 'POST' })
}

// ===== Model Management (pull / delete) =====
// Installed models with sizes come from getModels() in api.js (Ollama's own
// GET /api/tags, called directly, not through the agent-server) - these two
// only cover the mutating operations, routed through the agent-server to
// reuse its timeout/error-handling for what can be a very long download.

export interface OllamaPullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

/**
 * Streams Ollama's own pull progress (status text, and byte counts once a
 * layer download starts) via onProgress. Resolves once the pull finishes;
 * rejects with a clear message on failure (bad model name, disk full, engine
 * unreachable, etc.) - see ollama.ts's pullModel for what can throw.
 */
export async function pullModel(
  model: string,
  ollamaBaseUrl: string | undefined,
  onProgress: (progress: OllamaPullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${getAgentApiUrl()}/models/pull`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ model, ollamaBaseUrl }),
  })
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Agent server error ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleLine = (line: string) => {
    const progress = JSON.parse(line) as OllamaPullProgress
    if (progress.status === 'error' || progress.error) throw new Error(progress.error || 'Gagal mengunduh model')
    if (progress.status !== 'done') onProgress(progress)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) handleLine(line)
    }
  }
  if (buffer.trim()) handleLine(buffer)
}

export async function deleteModel(model: string, ollamaBaseUrl?: string): Promise<{ ok: boolean; error?: string }> {
  const query = ollamaBaseUrl
    ? `?model=${encodeURIComponent(model)}&ollamaBaseUrl=${encodeURIComponent(ollamaBaseUrl)}`
    : `?model=${encodeURIComponent(model)}`
  return requestJson(`/models${query}`, { method: 'DELETE' })
}
