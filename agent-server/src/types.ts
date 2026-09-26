export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: Role
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
  // Base64-encoded images (no data: URI prefix), passed straight through to
  // Ollama's /api/chat for vision models (e.g. Qwen2.5-VL) - see ollama.ts's
  // requestChat, which JSON.stringifies the message object as-is. Only
  // meaningful on a 'user' message; the web-ui resizes to a 1024px max
  // dimension before sending (see ChatInput.vue) so a full-resolution photo
  // doesn't get fed whole into an already VRAM-constrained prompt eval.
  images?: string[]
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
  // 'base64' means `content` is a base64-encoded binary file (PDF/DOCX/XLSX)
  // that ingestion.ts must run through file-extract.ts before chunking -
  // see IngestionService.ingest. Defaults to 'utf8'.
  encoding?: 'utf8' | 'base64'
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

/**
 * One chat turn's full performance breakdown - persisted (see
 * performance-store.ts) and returned to the client alongside the reply, so
 * "why was this slow" never has to fall back to guessing from a total
 * wall-time number alone. The optional fields are Ollama's own stats and are
 * only absent if a turn never reached a done:true response (e.g. it errored
 * before generation finished).
 */
export interface TurnPerformanceStats {
  id: string
  timestamp: string
  conversationId: string
  model: string
  ollamaBaseUrl: string
  ragEnabled: boolean
  /** Wall-clock ms spent in prepareContext() (RAG/memory retrieval), before generation started. */
  contextMs: number
  /** Wall-clock ms spent in the chat()/chatStream() call itself. */
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

export interface AgentResponse {
  message: ChatMessage
  toolRounds: number
  retrievedChunks: number
  // The memory-core record id for the assistant's own reply, so the client can
  // later rate this specific exchange (see MemoryCore.rateMessage).
  memoryId?: string
  performance?: TurnPerformanceStats
}

/** One progress line from Ollama's streaming POST /api/pull. */
export interface OllamaPullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
  error?: string
}

/** Shape of one entry in Ollama's GET /api/ps response - models currently resident in VRAM. */
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
