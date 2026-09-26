import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_CHAT_MODEL: z.string().min(1).default('llama3.2:latest'),
  OLLAMA_EMBED_MODEL: z.string().min(1).default('nomic-embed-text:latest'),
  // Sent as "keep_alive" on every /api/chat request so Ollama doesn't unload
  // the (usually large) chat model back out of VRAM between turns - without
  // this field Ollama defaults to unloading after 5m idle, and a reload from
  // disk before the next reply can take far longer than actual generation.
  // Defaults to "2m" rather than holding it forever: on a VRAM-constrained
  // GPU (e.g. an 8GB card also running a vision model) never releasing the
  // model is what leaves VRAM stuck at 100% between turns. Set to "-1" to
  // keep it loaded indefinitely instead, or e.g. "30m" for a longer window.
  OLLAMA_KEEP_ALIVE: z.string().min(1).default('2m'),
  // Same idea, but for the embedding model (/api/embeddings), kept separate
  // from OLLAMA_KEEP_ALIVE on purpose: the embedding model is tiny (tens to a
  // few hundred MB) compared to a chat model, so there's little VRAM cost to
  // keeping it resident far longer - and doing so avoids the chat model and
  // embedding model repeatedly evicting each other on an 8GB-class card,
  // which is what makes a single query embedding call take 20s+ (a full
  // model swap) instead of the sub-second it should be once both are warm.
  OLLAMA_EMBED_KEEP_ALIVE: z.string().min(1).default('30m'),
  // Ceiling on how long the agent-server waits for Ollama to respond to a
  // single /api/chat, /api/embeddings, /api/show or /api/version call -
  // applied as both an undici headersTimeout/bodyTimeout (see ollama.ts) and
  // the effective request budget. Needs to be generous: a heavy vision model
  // (e.g. Qwen2.5-VL) can spend minutes on prompt eval alone on a
  // memory-constrained GPU before the first token even appears. Raise this
  // further if that still isn't enough for your hardware/model.
  OLLAMA_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  // How long orchestrator.ts's query-embedding step (used for RAG/memory
  // retrieval, before generation even starts) waits before giving up and
  // degrading to keyword-only search - see prepareContext(). Separate from
  // OLLAMA_REQUEST_TIMEOUT_MS because this one gates the whole reply on
  // something that's a nice-to-have (better retrieval), not the reply itself,
  // so it should give up well before the main generation budget does. Needs
  // to be generous enough to survive a genuine chat<->embed model VRAM swap
  // on a memory-constrained GPU, though - too short and it degrades to
  // keyword search on every single turn instead of the swap ever finishing.
  QUERY_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  MEMORY_ROOT: z.string().min(1).default('./data'),
  VECTOR_STORE_PATH: z.string().min(1).default('./data/vector-store.json'),
  MEMORY_DB_PATH: z.string().min(1).default('./data/memory_core.sqlite'),
  MAX_RETRIEVED_CHUNKS: z.coerce.number().int().positive().default(6),
  MEMORY_SUMMARY_THRESHOLD: z.coerce.number().int().positive().default(6),
  MEMORY_FACT_LIMIT: z.coerce.number().int().positive().default(20),
  // How many of the most recent conversation rows cross-conversation memory search
  // will consider. Without a bound this scan (and its vector-store lookup) grows
  // linearly with the entire lifetime message count, which gets slow.
  MEMORY_SEARCH_SCAN_LIMIT: z.coerce.number().int().positive().default(500),
  // Only inject documents that are actually relevant. At the old 0.18 almost
  // anything cleared the bar, so six chunks were pushed into every prompt
  // regardless of the question, eating most of the context window.
  RAG_MIN_SCORE: z.coerce.number().min(-1).max(1).default(0.45),
  // Assumed context window when the client doesn't send one, used only to
  // size the retrieval budget (see orchestrator.ts).
  NUM_CTX_FALLBACK: z.coerce.number().int().positive().default(4096),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(5),

  // ===== Workspace (Vibe Coding) =====
  // Code chunks are embedded with the same nomic-embed-text model as everything
  // else, whose usable window is ~2k tokens - so a literal "300-500 lines per
  // chunk" would be silently truncated by the embedder and produce vectors that
  // describe only the top of each chunk. These caps keep a whole function in one
  // chunk while staying inside what the embedder can actually read.
  WORKSPACE_CHUNK_MAX_LINES: z.coerce.number().int().positive().default(160),
  WORKSPACE_CHUNK_MAX_CHARS: z.coerce.number().int().positive().default(6000),
  // Retrieval: how many code chunks a @workspace question may pull in.
  WORKSPACE_MAX_CHUNKS: z.coerce.number().int().positive().default(5),
  // Pure noise floor, NOT a relevance threshold. Measured on this project:
  // prompts are Indonesian while the code is English, and nomic-embed-text
  // scores that pairing so low (0.35-0.47, with unrelated text scoring 0.39)
  // that any meaningful absolute cutoff also throws away the right answer.
  // Relevance is decided by WORKSPACE_RELATIVE_SCORE_RATIO instead.
  WORKSPACE_MIN_SCORE: z.coerce.number().min(-1).max(1).default(0.25),
  // Keep chunks scoring at least this fraction of the best hit. The top match
  // always survives; weaker ones only join it when they are nearly as good.
  WORKSPACE_RELATIVE_SCORE_RATIO: z.coerce.number().min(0).max(1).default(0.82),
  // Hard ceiling on injected code context, in tokens, to protect num_ctx.
  WORKSPACE_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(2500),
  // Files bigger than this are listed in the tree but never indexed or inlined.
  WORKSPACE_MAX_FILE_BYTES: z.coerce.number().int().positive().default(512 * 1024),
  // Parallel embedding requests during a full index. Higher finishes sooner but
  // competes with chat generation for the same Ollama instance.
  WORKSPACE_INDEX_CONCURRENCY: z.coerce.number().int().positive().default(3),
})

const parsed = envSchema.parse(process.env)
const projectRoot = process.cwd()

// Fixed location (independent of whatever memory root is active) that remembers
// which folder the user pointed memory storage at, so it survives restarts and
// so pointing at the same folder again - e.g. a flashdisk moved between the
// Laptop and PC Server - keeps working without having to reconfigure anything.
const storagePointerPath = path.resolve(projectRoot, 'data', '.storage-location.json')

const defaultMemoryRoot = path.resolve(projectRoot, parsed.MEMORY_ROOT)
const defaultVectorStorePath = path.resolve(projectRoot, parsed.VECTOR_STORE_PATH)
const defaultMemoryDbPath = path.resolve(projectRoot, parsed.MEMORY_DB_PATH)

function derivePathsForRoot(memoryRoot: string) {
  return {
    vectorStorePath: path.join(memoryRoot, 'vector-store.json'),
    memoryDbPath: path.join(memoryRoot, 'memory_core.sqlite'),
  }
}

function readStoragePointer(): { memoryRoot: string } | null {
  try {
    if (!existsSync(storagePointerPath)) return null
    const parsedPointer = JSON.parse(readFileSync(storagePointerPath, 'utf8')) as { memoryRoot?: string }
    if (parsedPointer.memoryRoot && path.isAbsolute(parsedPointer.memoryRoot)) {
      return { memoryRoot: parsedPointer.memoryRoot }
    }
    return null
  } catch (error) {
    console.warn(`Could not read storage location pointer at ${storagePointerPath}:`, error)
    return null
  }
}

function writeStoragePointer(memoryRoot: string): void {
  mkdirSync(path.dirname(storagePointerPath), { recursive: true })
  writeFileSync(storagePointerPath, JSON.stringify({ memoryRoot }, null, 2), 'utf8')
}

const initialPointer = readStoragePointer()
const initialMemoryRoot = initialPointer?.memoryRoot ?? defaultMemoryRoot
const initialPaths = initialPointer
  ? derivePathsForRoot(initialPointer.memoryRoot)
  : { vectorStorePath: defaultVectorStorePath, memoryDbPath: defaultMemoryDbPath }

// ===== Chat history storage (Settings > Memory > "Folder Penyimpanan Fisik") =====
// Unlike memoryRoot, this has no built-in default folder: unset means the web-ui
// falls back to browser localStorage, exactly like before this existed. It only
// becomes a real folder once the user picks one (same picker UI as the memory
// location above), so existing localStorage-based history is never silently
// switched away from underneath anyone.
const chatHistoryPointerPath = path.resolve(projectRoot, 'data', '.chat-history-location.json')

function readChatHistoryPointer(): string | null {
  try {
    if (!existsSync(chatHistoryPointerPath)) return null
    const parsedPointer = JSON.parse(readFileSync(chatHistoryPointerPath, 'utf8')) as { chatHistoryRoot?: string }
    if (parsedPointer.chatHistoryRoot && path.isAbsolute(parsedPointer.chatHistoryRoot)) {
      return parsedPointer.chatHistoryRoot
    }
    return null
  } catch (error) {
    console.warn(`Could not read chat history location pointer at ${chatHistoryPointerPath}:`, error)
    return null
  }
}

function writeChatHistoryPointer(chatHistoryRoot: string): void {
  mkdirSync(path.dirname(chatHistoryPointerPath), { recursive: true })
  writeFileSync(chatHistoryPointerPath, JSON.stringify({ chatHistoryRoot }, null, 2), 'utf8')
}

// ===== Workspace root (Vibe Coding mode) =====
// The project folder the user is currently coding against. Like chat history
// it has no default: unset simply means Workspace mode shows its folder picker
// instead of a file tree. Remembered across restarts so reopening the app
// lands back in the same project with its index already built.
const workspacePointerPath = path.resolve(projectRoot, 'data', '.workspace-location.json')

function readWorkspacePointer(): string | null {
  try {
    if (!existsSync(workspacePointerPath)) return null
    const parsedPointer = JSON.parse(readFileSync(workspacePointerPath, 'utf8')) as { workspaceRoot?: string }
    if (parsedPointer.workspaceRoot && path.isAbsolute(parsedPointer.workspaceRoot)) {
      return parsedPointer.workspaceRoot
    }
    return null
  } catch (error) {
    console.warn(`Could not read workspace location pointer at ${workspacePointerPath}:`, error)
    return null
  }
}

function writeWorkspacePointer(workspaceRoot: string): void {
  mkdirSync(path.dirname(workspacePointerPath), { recursive: true })
  writeFileSync(workspacePointerPath, JSON.stringify({ workspaceRoot }, null, 2), 'utf8')
}

// Mutated in place by setMemoryRoot()/resetMemoryRootToDefault()/setChatHistoryRoot()/
// clearChatHistoryRoot() below, so every module that destructures fields off this
// same object reference sees updates immediately without needing a process restart.
export const config: {
  port: number
  ollamaBaseUrl: string
  chatModel: string
  embedModel: string
  ollamaKeepAlive: string
  ollamaEmbedKeepAlive: string
  ollamaRequestTimeoutMs: number
  queryEmbeddingTimeoutMs: number
  memoryRoot: string
  vectorStorePath: string
  memoryDbPath: string
  maxRetrievedChunks: number
  memorySummaryThreshold: number
  memoryFactLimit: number
  memorySearchScanLimit: number
  ragMinScore: number
  numCtxFallback: number
  corsOrigin: string
  corsOrigins: string[]
  maxToolRounds: number
  chatHistoryRoot: string | null
  workspaceRoot: string | null
  workspaceChunkMaxLines: number
  workspaceChunkMaxChars: number
  workspaceMaxChunks: number
  workspaceMinScore: number
  workspaceRelativeScoreRatio: number
  workspaceContextTokenBudget: number
  workspaceMaxFileBytes: number
  workspaceIndexConcurrency: number
} = {
  port: parsed.PORT,
  ollamaBaseUrl: parsed.OLLAMA_BASE_URL.replace(/\/$/, ''),
  chatModel: parsed.OLLAMA_CHAT_MODEL,
  embedModel: parsed.OLLAMA_EMBED_MODEL,
  ollamaKeepAlive: parsed.OLLAMA_KEEP_ALIVE,
  ollamaEmbedKeepAlive: parsed.OLLAMA_EMBED_KEEP_ALIVE,
  ollamaRequestTimeoutMs: parsed.OLLAMA_REQUEST_TIMEOUT_MS,
  queryEmbeddingTimeoutMs: parsed.QUERY_EMBEDDING_TIMEOUT_MS,
  memoryRoot: initialMemoryRoot,
  vectorStorePath: initialPaths.vectorStorePath,
  memoryDbPath: initialPaths.memoryDbPath,
  maxRetrievedChunks: parsed.MAX_RETRIEVED_CHUNKS,
  memorySummaryThreshold: parsed.MEMORY_SUMMARY_THRESHOLD,
  memoryFactLimit: parsed.MEMORY_FACT_LIMIT,
  memorySearchScanLimit: parsed.MEMORY_SEARCH_SCAN_LIMIT,
  ragMinScore: parsed.RAG_MIN_SCORE,
  numCtxFallback: parsed.NUM_CTX_FALLBACK,
  corsOrigin: parsed.CORS_ORIGIN,
  corsOrigins: parsed.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean),
  maxToolRounds: parsed.MAX_TOOL_ROUNDS,
  chatHistoryRoot: readChatHistoryPointer(),
  workspaceRoot: readWorkspacePointer(),
  workspaceChunkMaxLines: parsed.WORKSPACE_CHUNK_MAX_LINES,
  workspaceChunkMaxChars: parsed.WORKSPACE_CHUNK_MAX_CHARS,
  workspaceMaxChunks: parsed.WORKSPACE_MAX_CHUNKS,
  workspaceMinScore: parsed.WORKSPACE_MIN_SCORE,
  workspaceRelativeScoreRatio: parsed.WORKSPACE_RELATIVE_SCORE_RATIO,
  workspaceContextTokenBudget: parsed.WORKSPACE_CONTEXT_TOKEN_BUDGET,
  workspaceMaxFileBytes: parsed.WORKSPACE_MAX_FILE_BYTES,
  workspaceIndexConcurrency: parsed.WORKSPACE_INDEX_CONCURRENCY,
}

/** Where the workspace code index (its own SQLite file) lives for the active memory root. */
export function getWorkspaceIndexPath(): string {
  return path.join(config.memoryRoot, 'workspace-index.sqlite')
}

/**
 * Backups of every file Vibe Coding overwrites. Deliberately kept outside the
 * user's project folder: a backup written next to the source would itself get
 * indexed, show up in the file tree, and end up committed to their repo.
 */
export function getWorkspaceBackupRoot(): string {
  return path.join(config.memoryRoot, 'workspace-backups')
}

export function getWorkspaceRootInfo(): { workspaceRoot: string | null; isConfigured: boolean } {
  return { workspaceRoot: config.workspaceRoot, isConfigured: config.workspaceRoot !== null }
}

export function setWorkspaceRoot(newRoot: string): { workspaceRoot: string } {
  if (!newRoot || !newRoot.trim()) throw new Error('Path folder tidak boleh kosong')
  if (!path.isAbsolute(newRoot)) throw new Error('Gunakan path folder absolut (contoh: D:\\projects\\app atau /home/user/app)')

  const resolved = path.normalize(newRoot.trim())
  if (!existsSync(resolved)) throw new Error(`Folder tidak ditemukan: ${resolved}`)

  config.workspaceRoot = resolved
  writeWorkspacePointer(resolved)
  return { workspaceRoot: resolved }
}

export function clearWorkspaceRoot(): { workspaceRoot: null } {
  config.workspaceRoot = null
  try {
    if (existsSync(workspacePointerPath)) unlinkSync(workspacePointerPath)
  } catch (error) {
    console.warn('Could not remove workspace location pointer:', error)
  }
  return { workspaceRoot: null }
}

export function getMemoryRootInfo(): { memoryRoot: string; isCustom: boolean; defaultMemoryRoot: string } {
  return {
    memoryRoot: config.memoryRoot,
    isCustom: config.memoryRoot !== defaultMemoryRoot,
    defaultMemoryRoot,
  }
}

function assertWritable(directory: string): void {
  const probePath = path.join(directory, `.write-test-${process.pid}`)
  writeFileSync(probePath, 'ok', 'utf8')
  unlinkSync(probePath)
}

/**
 * Point memory storage (conversation history + vector store) at a different
 * folder - e.g. a flashdisk shared between the Laptop and PC Server - and
 * remember the choice so it keeps applying on the next server start.
 */
export function setMemoryRoot(newRoot: string): { memoryRoot: string; vectorStorePath: string; memoryDbPath: string } {
  if (!newRoot || !newRoot.trim()) throw new Error('Path folder tidak boleh kosong')
  if (!path.isAbsolute(newRoot)) throw new Error('Gunakan path folder absolut (contoh: D:\\ai-memory atau /mnt/flashdisk/ai-memory)')

  const resolved = path.normalize(newRoot)
  try {
    mkdirSync(resolved, { recursive: true })
    assertWritable(resolved)
  } catch (error) {
    throw new Error(`Folder tidak bisa ditulis: ${error instanceof Error ? error.message : String(error)}`)
  }

  const derived = derivePathsForRoot(resolved)
  config.memoryRoot = resolved
  config.vectorStorePath = derived.vectorStorePath
  config.memoryDbPath = derived.memoryDbPath
  writeStoragePointer(resolved)

  return { memoryRoot: config.memoryRoot, vectorStorePath: config.vectorStorePath, memoryDbPath: config.memoryDbPath }
}

export function resetMemoryRootToDefault(): { memoryRoot: string; vectorStorePath: string; memoryDbPath: string } {
  config.memoryRoot = defaultMemoryRoot
  config.vectorStorePath = defaultVectorStorePath
  config.memoryDbPath = defaultMemoryDbPath
  try {
    if (existsSync(storagePointerPath)) unlinkSync(storagePointerPath)
  } catch (error) {
    console.warn('Could not remove storage location pointer:', error)
  }
  return { memoryRoot: config.memoryRoot, vectorStorePath: config.vectorStorePath, memoryDbPath: config.memoryDbPath }
}

/**
 * Lets the web-ui push whichever Ollama engine (Laptop / PC Server) is
 * currently active into the agent-server's own default, so every embed()
 * call - not just the ones that flow through a per-request /chat body field -
 * follows it too. This matters because several embedding call sites (Vibe
 * Coding's file-watcher re-indexing in workspace-indexer.ts, in particular)
 * run in the background with no HTTP request to carry a per-request override
 * on at all; a single shared default is the only thing that reaches them.
 * Deliberately in-memory only (unlike memoryRoot/workspaceRoot) - which
 * engine is "active" is the browser's own preference (see localStorage
 * settings), and the web-ui re-syncs this on every load, so persisting it
 * server-side would just be a second, potentially stale copy of the same
 * fact.
 */
export function setActiveOllamaBaseUrl(url: string): { ollamaBaseUrl: string } {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('ollamaBaseUrl tidak boleh kosong')
  config.ollamaBaseUrl = trimmed
  return { ollamaBaseUrl: config.ollamaBaseUrl }
}

export function getChatHistoryRootInfo(): { chatHistoryRoot: string | null; isConfigured: boolean } {
  return { chatHistoryRoot: config.chatHistoryRoot, isConfigured: config.chatHistoryRoot !== null }
}

export function setChatHistoryRoot(newRoot: string): { chatHistoryRoot: string } {
  if (!newRoot || !newRoot.trim()) throw new Error('Path folder tidak boleh kosong')
  if (!path.isAbsolute(newRoot)) throw new Error('Gunakan path folder absolut (contoh: D:\\chat-history atau /mnt/flashdisk/chat-history)')

  const resolved = path.normalize(newRoot)
  try {
    mkdirSync(resolved, { recursive: true })
    assertWritable(resolved)
  } catch (error) {
    throw new Error(`Folder tidak bisa ditulis: ${error instanceof Error ? error.message : String(error)}`)
  }

  config.chatHistoryRoot = resolved
  writeChatHistoryPointer(resolved)
  return { chatHistoryRoot: resolved }
}

export function clearChatHistoryRoot(): { chatHistoryRoot: string | null } {
  config.chatHistoryRoot = null
  try {
    if (existsSync(chatHistoryPointerPath)) unlinkSync(chatHistoryPointerPath)
  } catch (error) {
    console.warn('Could not remove chat history location pointer:', error)
  }
  return { chatHistoryRoot: null }
}
