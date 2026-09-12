import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_CHAT_MODEL: z.string().min(1).default('llama3.2:latest'),
  OLLAMA_EMBED_MODEL: z.string().min(1).default('nomic-embed-text:latest'),
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

// Mutated in place by setMemoryRoot()/resetMemoryRootToDefault()/setChatHistoryRoot()/
// clearChatHistoryRoot() below, so every module that destructures fields off this
// same object reference sees updates immediately without needing a process restart.
export const config: {
  port: number
  ollamaBaseUrl: string
  chatModel: string
  embedModel: string
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
} = {
  port: parsed.PORT,
  ollamaBaseUrl: parsed.OLLAMA_BASE_URL.replace(/\/$/, ''),
  chatModel: parsed.OLLAMA_CHAT_MODEL,
  embedModel: parsed.OLLAMA_EMBED_MODEL,
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
