import { getAgentApiUrl } from './api.ts'
import { getSettings } from './api.js'

/**
 * Client for the Vibe Coding workspace endpoints (agent-server/src/routes/workspace.ts).
 * Everything here talks to the agent-server, never to Ollama directly - the
 * server owns the file index, the ignore rules, and the write guards.
 */

export interface WorkspaceStatus {
  ok: boolean
  workspaceRoot: string | null
  isOpen: boolean
  state: 'empty' | 'indexing' | 'ready' | 'error'
  totalFiles: number
  indexedFiles: number
  chunkCount: number
  currentFile: string | null
  watching: boolean
  lastIndexedAt: string | null
  error: string | null
}

export interface WorkspaceTreeEntry {
  name: string
  relPath: string
  type: 'file' | 'directory'
  size: number
  indexable: boolean
}

export interface WorkspaceFile {
  ok: boolean
  relPath: string
  content: string
  size: number
  lines: number
  indexable: boolean
  truncated: boolean
}

export interface WorkspaceContextBlock {
  relPath: string
  reason: 'explicit' | 'target' | 'search'
  startLine: number | null
  endLine: number | null
  symbol: string | null
  score: number | null
  characters: number
  truncated: boolean
}

export interface ApplyChangesResult {
  ok: boolean
  filePath: string
  created: boolean
  bytesWritten: number
  backupPath: string | null
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getAgentApiUrl()}/workspace${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const payload = await response.json().catch(() => ({})) as T & { error?: string; conflict?: boolean }
  if (!response.ok) {
    const error = new Error(payload.error || `Workspace error ${response.status}`) as Error & { conflict?: boolean }
    error.conflict = payload.conflict === true
    throw error
  }
  return payload
}

export async function getWorkspaceStatus(): Promise<WorkspaceStatus> {
  return requestJson('/status')
}

export async function openWorkspace(path: string): Promise<WorkspaceStatus> {
  return requestJson('/open', { method: 'POST', body: JSON.stringify({ path }) })
}

export async function closeWorkspace(): Promise<WorkspaceStatus> {
  return requestJson('/close', { method: 'POST' })
}

export async function reindexWorkspace(): Promise<WorkspaceStatus> {
  return requestJson('/reindex', { method: 'POST' })
}

export async function listWorkspaceTree(path = ''): Promise<{ entries: WorkspaceTreeEntry[] }> {
  return requestJson(`/tree?path=${encodeURIComponent(path)}`)
}

/** Flat path list powering the "@" autocomplete. */
export async function listWorkspaceFiles(): Promise<{ files: string[] }> {
  return requestJson('/files')
}

export async function readWorkspaceFile(path: string): Promise<WorkspaceFile> {
  return requestJson(`/file?path=${encodeURIComponent(path)}`)
}

/**
 * Writes model-authored content to a real file.
 *
 * `expectedContent` is what the client believed the file held when the change
 * was proposed. The server refuses the write (409) when it no longer matches,
 * so an edit made in the meantime is never silently clobbered.
 */
export async function applyWorkspaceChanges(
  filePath: string,
  newContent: string,
  expectedContent?: string,
): Promise<ApplyChangesResult> {
  return requestJson('/apply-changes', {
    method: 'POST',
    body: JSON.stringify({ filePath, newContent, expectedContent }),
  })
}

function resolveOllamaBaseUrl(): string | undefined {
  const settings = getSettings()
  const url = settings.activeEngine === 'pc' ? settings.pcUrl : settings.laptopUrl
  return url && url.trim() ? url.trim().replace(/\/+$/, '') : undefined
}

function resolveChatOptions() {
  const settings = getSettings()
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

export interface WorkspaceChatHandlers {
  onContextStart?: () => void
  onContext?: (payload: {
    blocks: WorkspaceContextBlock[]
    usedCharacters: number
    budgetCharacters: number
    budgetExceeded: boolean
  }) => void
  onToken: (content: string) => void
}

/** 'code' (default): AI may propose file rewrites. 'ask': read-only Q&A, never proposes edits. */
export type WorkspaceChatMode = 'code' | 'ask'

/** A file (or a specific line range within one) the user explicitly attached as context. */
export interface WorkspaceContextAttachment {
  relPath: string
  startLine?: number
  endLine?: number
}

/**
 * Streams one Vibe Coding answer. Same ndjson wire format as the conversation
 * endpoint, plus `context` events describing which files were fed to the model.
 */
export async function sendWorkspaceChat(
  prompt: string,
  {
    model,
    targetPath,
    history,
    mode,
    attachments,
    signal,
    handlers,
  }: {
    model?: string
    targetPath?: string
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    mode?: WorkspaceChatMode
    attachments?: WorkspaceContextAttachment[]
    signal: AbortSignal
    handlers: WorkspaceChatHandlers
  },
): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${getAgentApiUrl()}/workspace/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        prompt,
        model,
        targetPath,
        history,
        mode,
        attachments,
        ollamaBaseUrl: resolveOllamaBaseUrl(),
        options: resolveChatOptions(),
      }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(`Agent server tidak dapat dihubungi di ${getAgentApiUrl()}. Jalankan agent-server terlebih dahulu.`)
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `Workspace chat error ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handleEvent = (event: Record<string, unknown>) => {
    const type = event.type as string
    if (type === 'context-start') handlers.onContextStart?.()
    if (type === 'context') {
      handlers.onContext?.({
        blocks: (event.blocks as WorkspaceContextBlock[]) || [],
        usedCharacters: Number(event.usedCharacters || 0),
        budgetCharacters: Number(event.budgetCharacters || 0),
        budgetExceeded: event.budgetExceeded === true,
      })
    }
    if (type === 'token' && typeof event.content === 'string') handlers.onToken(event.content)
    if (type === 'error') throw new Error((event.content as string) || 'Workspace chat gagal')
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      handleEvent(JSON.parse(line) as Record<string, unknown>)
    }
  }
  if (buffer.trim()) handleEvent(JSON.parse(buffer) as Record<string, unknown>)
}

// ===== AI Coding Assistant chat sessions (saved per project) =====

export interface WorkspaceChatSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface WorkspaceChatSession extends WorkspaceChatSummary {
  messages: Array<Record<string, unknown>>
}

export async function listWorkspaceChats(): Promise<{ chats: WorkspaceChatSummary[] }> {
  return requestJson('/chats')
}

export async function getWorkspaceChat(id: string): Promise<{ chat: WorkspaceChatSession }> {
  return requestJson(`/chats/${encodeURIComponent(id)}`)
}

export async function saveWorkspaceChat(
  id: string,
  title: string,
  messages: Array<Record<string, unknown>>,
): Promise<{ chat: WorkspaceChatSummary }> {
  return requestJson(`/chats/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ title, messages }),
  })
}

export async function deleteWorkspaceChat(id: string): Promise<{ deleted: boolean }> {
  return requestJson(`/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
