export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: Role
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

export interface DocumentInput {
  id?: string
  source: string
  content: string
  metadata?: Record<string, string | number | boolean>
}

export interface VectorRecord {
  id: string
  source: string
  content: string
  embedding: number[]
  metadata: Record<string, string | number | boolean>
  createdAt: string
}

export interface OllamaChatResponse {
  message: ChatMessage
  done: boolean
  // Only present on the final chunk (done: true) - Ollama's own breakdown of
  // where the time actually went, in nanoseconds. Without this, "generation
  // took 66.9s" can't be told apart from "model load took 62s, actual
  // generation took 4.5s" - see formatOllamaStats() in ollama.ts.
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

export interface ChatOptions {
  temperature?: number
  num_ctx?: number
  num_predict?: number
}

export interface AgentResponse {
  message: ChatMessage
  toolRounds: number
  retrievedChunks: number
  // The memory-core record id for the assistant's own reply, so the client can
  // later rate this specific exchange (see MemoryCore.rateMessage).
  memoryId?: string
}

// Lets callers (see routes.ts) surface live memory activity to the client -
// e.g. a "Membaca ingatan..." / "Menulis ingatan..." indicator in the UI -
// while a chat request is being handled, instead of the memory subsystem
// being an invisible black box that only ever reports its final result.
export type MemoryEventPhase = 'read' | 'write'
export type MemoryEventStatus = 'start' | 'end' | 'error'

export interface MemoryEvent {
  phase: MemoryEventPhase
  status: MemoryEventStatus
  // What triggered this event, e.g. 'append-user' | 'recall' | 'append-assistant'.
  detail: string
  error?: string
}

export type MemoryEventListener = (event: MemoryEvent) => void

// ===== Workspace (Vibe Coding) =====

/** One embedded slice of a source file, as stored in the workspace index. */
export interface WorkspaceChunk {
  id: string
  relPath: string
  chunkIndex: number
  startLine: number
  endLine: number
  /** Best-guess function/class name the chunk starts with, for prompt headers. */
  symbol: string | null
  content: string
}

export interface WorkspaceChunkMatch extends WorkspaceChunk {
  score: number
}

export type WorkspaceIndexState = 'empty' | 'indexing' | 'ready' | 'error'

export interface WorkspaceStatus {
  workspaceRoot: string | null
  isOpen: boolean
  state: WorkspaceIndexState
  /** Files eligible for indexing (after .vibeignore + built-in filters). */
  totalFiles: number
  indexedFiles: number
  chunkCount: number
  /** Relative path currently being embedded, for a live progress line in the UI. */
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
  /** False when the entry is excluded from indexing (binary, too big, ignored). */
  indexable: boolean
}

/** Why a file ended up in the prompt - drives the "context used" chips in the UI. */
export type WorkspaceContextReason = 'explicit' | 'target' | 'search'

export interface WorkspaceContextBlock {
  relPath: string
  reason: WorkspaceContextReason
  startLine: number | null
  endLine: number | null
  symbol: string | null
  score: number | null
  characters: number
  /** True when the file was cut short to stay inside the token budget. */
  truncated: boolean
}

export interface WorkspaceContextResult {
  /** Ready-to-send chat messages (system prompt carrying the code context + the user turn). */
  messages: ChatMessage[]
  /** The same thing rendered as the flat SYSTEM/CONTEXT/USER text, for preview and debugging. */
  promptPreview: string
  blocks: WorkspaceContextBlock[]
  usedCharacters: number
  budgetCharacters: number
  /** True when at least one candidate was dropped or cut for budget. */
  budgetExceeded: boolean
}
