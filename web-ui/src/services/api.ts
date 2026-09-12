import { getSettings, saveSettingsToStorage } from './api.js'

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

export interface AgentChatResult {
  ok: boolean
  message?: AgentMessage
  toolRounds?: number
  retrievedChunks?: number
  error?: string
}

export interface AgentStreamEvent {
  type: 'meta' | 'token' | 'done' | 'error'
  content?: string
  toolRounds?: number
  retrievedChunks?: number
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
        messages: [...history, { role: 'user', content: message }],
      }),
    })
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Agent request failed'
    if (settings.activeEngine === 'pc' && settings.autoFallback !== false && !isFallbackRetry && isConnectivityError(messageText)) {
      saveSettingsToStorage({ activeEngine: 'laptop' })
      dispatchEngineFallback('Koneksi PC Server terputus. Mengalihkan ke Laptop.')
      return sendMessage(message, history, model, signal, conversationId, true)
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
  isFallbackRetry = false,
): Promise<void> {
  const settings = getSettings()

  const fallbackIfEligible = async (messageText: string): Promise<boolean> => {
    if (settings.activeEngine === 'pc' && settings.autoFallback !== false && !isFallbackRetry && isConnectivityError(messageText)) {
      saveSettingsToStorage({ activeEngine: 'laptop' })
      dispatchEngineFallback('Koneksi PC Server terputus. Mengalihkan ke Laptop.')
      await sendMessageStream(message, history, model, signal, conversationId, onToken, true)
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
        messages: [...history, { role: 'user', content: message }],
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
  const decoder = new TextDecoder()
  let buffer = ''

  const handleEvent = async (event: AgentStreamEvent): Promise<boolean> => {
    if (event.type === 'token' && event.content) onToken(event.content)
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

export async function uploadDocument(file: File): Promise<{ ok: boolean; documents: number; chunks: number }> {
  const content = await file.text()
  return requestJson('/ingest', {
    method: 'POST',
    body: JSON.stringify({
      documents: [{ source: file.name, content }],
    }),
  })
}

export async function checkAgentHealth(): Promise<{ ok: boolean; error?: string }> {
  return requestJson('/health', { method: 'GET' })
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
