import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'

export interface StoredConversation {
  version: 1
  conversationId: string
  title: string
  folderId: string | null
  createdAt: string
  updatedAt: string
  messages: unknown[]
  // Cached embedding of the full message text, used by the client's local
  // relevant-memory search so it doesn't re-embed every past conversation on
  // every message. Reset to null whenever the conversation's messages change.
  embedding: number[] | null
}

export interface StoredFolder {
  id: string
  name: string
  parentId: string | null
  isExpanded: boolean
  createdAt: string
}

export interface GlobalMemory {
  permanent_instructions: string[]
  interactions: unknown[]
  updatedAt: string
}

const CONVERSATIONS_FOLDER = 'conversations'

/**
 * Server-side counterpart to the file format the browser used to write
 * directly via the File System Access API (see web-ui/src/services/memory.js
 * history). Keeping the exact same filenames and JSON shape means pointing
 * this at a folder that already has conversations from that older flow just
 * works, and files stay interoperable either way.
 */
function requireRoot(): string {
  if (!config.chatHistoryRoot) throw new Error('Folder penyimpanan riwayat chat belum diatur')
  return config.chatHistoryRoot
}

async function conversationsDir(): Promise<string> {
  const dir = path.join(requireRoot(), CONVERSATIONS_FOLDER)
  await mkdir(dir, { recursive: true })
  return dir
}

async function listConversationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name)
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.warn(`Failed to read ${filePath}:`, error)
    return null
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

export async function listConversations(): Promise<StoredConversation[]> {
  const dir = await conversationsDir()
  const files = await listConversationFiles(dir)
  const conversations: StoredConversation[] = []
  for (const fileName of files) {
    const stored = await readJsonFile<StoredConversation>(path.join(dir, fileName))
    if (stored?.conversationId && Array.isArray(stored.messages)) conversations.push(stored)
  }
  return conversations.sort((left, right) => (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  ))
}

async function findConversationFileName(dir: string, conversationId: string): Promise<string | null> {
  for (const fileName of await listConversationFiles(dir)) {
    const stored = await readJsonFile<StoredConversation>(path.join(dir, fileName))
    if (stored?.conversationId === conversationId) return fileName
  }
  return null
}

async function nextConversationFileName(dir: string, conversationId: string): Promise<string> {
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const usedNumbers = new Set<number>()
  for (const fileName of await listConversationFiles(dir)) {
    const match = fileName.match(/^conv_(\d+)(?:_|\.json$)/)
    if (match) usedNumbers.add(Number(match[1]))
  }
  let number = 1
  while (usedNumbers.has(number)) number += 1
  return `conv_${String(number).padStart(3, '0')}_${safeId}.json`
}

export async function saveConversation(conversation: {
  conversationId: string
  title?: string
  folderId?: string | null
  createdAt?: string
  messages: unknown[]
  // Omit (or pass null) to invalidate any previously cached embedding - the normal
  // case whenever messages change. Pass an array only to persist a freshly
  // computed cache after a relevant-memory search embedded this conversation.
  embedding?: number[] | null
}): Promise<void> {
  const dir = await conversationsDir()
  const existingFileName = await findConversationFileName(dir, conversation.conversationId)
  const fileName = existingFileName ?? await nextConversationFileName(dir, conversation.conversationId)

  const record: StoredConversation = {
    version: 1,
    conversationId: conversation.conversationId,
    title: conversation.title || '',
    folderId: conversation.folderId || null,
    createdAt: conversation.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: conversation.messages || [],
    embedding: conversation.embedding ?? null,
  }
  await writeJsonFile(path.join(dir, fileName), record)
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  const dir = await conversationsDir()
  const fileName = await findConversationFileName(dir, conversationId)
  if (!fileName) return false
  await rm(path.join(dir, fileName), { force: true })
  return true
}

export async function listFolders(): Promise<StoredFolder[]> {
  const stored = await readJsonFile<StoredFolder[]>(path.join(requireRoot(), 'folders.json'))
  return Array.isArray(stored) ? stored : []
}

export async function saveFolders(folders: StoredFolder[]): Promise<void> {
  const root = requireRoot()
  await mkdir(root, { recursive: true })
  await writeJsonFile(path.join(root, 'folders.json'), folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId || null,
    isExpanded: folder.isExpanded !== false,
    createdAt: folder.createdAt,
  })))
}

const DEFAULT_GLOBAL_MEMORY: GlobalMemory = {
  permanent_instructions: [],
  interactions: [],
  updatedAt: new Date(0).toISOString(),
}

export async function readGlobalMemory(): Promise<GlobalMemory> {
  const stored = await readJsonFile<Partial<GlobalMemory>>(path.join(requireRoot(), 'global_memory.json'))
  if (!stored) return { ...DEFAULT_GLOBAL_MEMORY }
  return {
    permanent_instructions: Array.isArray(stored.permanent_instructions) ? stored.permanent_instructions : [],
    interactions: Array.isArray(stored.interactions) ? stored.interactions : [],
    updatedAt: stored.updatedAt || new Date().toISOString(),
  }
}

export async function saveGlobalMemory(memory: Partial<GlobalMemory>): Promise<void> {
  const root = requireRoot()
  await mkdir(root, { recursive: true })
  const record: GlobalMemory = {
    permanent_instructions: memory.permanent_instructions || [],
    interactions: memory.interactions || [],
    updatedAt: new Date().toISOString(),
  }
  await writeJsonFile(path.join(root, 'global_memory.json'), record)
}
