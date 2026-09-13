import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { WorkspaceChunk, WorkspaceChunkMatch } from '../types.js'

/**
 * Code chunks live in their own SQLite file rather than in the shared
 * VectorStore, for three reasons:
 *
 *  1. `Retriever` pulls anything in the shared store into "Retrieved local
 *     context" on every ordinary chat turn - a whole indexed codebase in
 *     there would hijack normal conversations.
 *  2. `listDocumentSources()` (Settings > Documents) would list thousands of
 *     source files as if the user had uploaded them.
 *  3. The shared store keeps every record cached in memory and rescans it per
 *     query; adding a codebase to that pool slows conversation memory down.
 *
 * Embeddings are stored as float32 BLOBs, not the JSON text the shared store
 * uses: a real project reaches tens of thousands of chunks, where JSON costs
 * roughly five times the bytes and has to be parsed back on every load.
 */

interface FileRow {
  rel_path: string
  size: number
  mtime_ms: number
  content_hash: string
  chunk_count: number
  indexed_at: string
}

interface ChunkRow {
  id: string
  rel_path: string
  chunk_index: number
  start_line: number
  end_line: number
  symbol: string | null
  content: string
  embedding: Buffer
  norm: number
}

export interface IndexedFileState {
  relPath: string
  size: number
  mtimeMs: number
  contentHash: string
  chunkCount: number
}

export interface WorkspaceChunkInput extends WorkspaceChunk {
  embedding: number[]
}

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant'
  content: string
  contextBlocks?: unknown[]
  [key: string]: unknown
}

export interface WorkspaceChatSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface WorkspaceChatSession extends WorkspaceChatSummary {
  messages: WorkspaceChatMessage[]
}

interface ChatSummaryRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

interface ChatRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  messages: string
}

/** Cached per-workspace so search doesn't re-read and re-decode every row per query. */
interface SearchCacheEntry {
  id: string
  relPath: string
  chunkIndex: number
  startLine: number
  endLine: number
  symbol: string | null
  content: string
  embedding: Float32Array
  norm: number
}

function encodeEmbedding(values: number[]): Buffer {
  const floats = Float32Array.from(values)
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}

function decodeEmbedding(buffer: Buffer): Float32Array {
  // better-sqlite3 hands back a Buffer that is a view into a pooled
  // ArrayBuffer, whose byteOffset is rarely a multiple of 4 - constructing a
  // Float32Array directly over it throws. Copying into a fresh, aligned
  // buffer is the only safe read.
  const aligned = new Uint8Array(buffer.byteLength)
  aligned.set(buffer)
  return new Float32Array(aligned.buffer)
}

function vectorNorm(values: ArrayLike<number>): number {
  let total = 0
  for (let index = 0; index < values.length; index += 1) total += values[index] ** 2
  return Math.sqrt(total)
}

/**
 * Splits a query into comparable terms. camelCase and snake_case are broken
 * apart so "calculate cart total" matches `calculateCartTotal`, and one- and
 * two-letter fragments are dropped as noise.
 */
function tokenize(text: string): string[] {
  if (!text.trim()) return []
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
  const terms = spaced.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || []
  return [...new Set(terms.filter((term) => term.length >= 3))]
}

/** Fraction of the query's terms that appear anywhere in the chunk. */
function keywordOverlap(queryTerms: string[], haystack: string): number {
  if (!queryTerms.length) return 0
  const chunkTerms = new Set(tokenize(haystack))
  if (!chunkTerms.size) return 0
  let matches = 0
  for (const term of queryTerms) if (chunkTerms.has(term)) matches += 1
  return matches / queryTerms.length
}

export class WorkspaceStore {
  private readonly database: Database.Database
  private readonly upsertChunkStatement: Database.Statement
  private readonly upsertFileStatement: Database.Statement
  private readonly deleteChunksForFileStatement: Database.Statement
  private readonly deleteFileStatement: Database.Statement
  private readonly selectChunksStatement: Database.Statement
  private readonly selectFilesStatement: Database.Statement
  private readonly countChunksStatement: Database.Statement
  private readonly upsertChatStatement: Database.Statement
  private readonly selectChatSummariesStatement: Database.Statement
  private readonly selectChatStatement: Database.Statement
  private readonly deleteChatStatement: Database.Statement
  /** Keyed by workspace root; dropped whenever that workspace's rows change. */
  private searchCache = new Map<string, SearchCacheEntry[]>()

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.database = new Database(databasePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_files (
        workspace_root TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (workspace_root, rel_path)
      );

      CREATE TABLE IF NOT EXISTS workspace_chunks (
        id TEXT PRIMARY KEY,
        workspace_root TEXT NOT NULL,
        rel_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        symbol TEXT,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        norm REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_chunks_root ON workspace_chunks(workspace_root);
      CREATE INDEX IF NOT EXISTS idx_workspace_chunks_file ON workspace_chunks(workspace_root, rel_path);

      -- AI Coding Assistant chat sessions, scoped per project so reopening a
      -- workspace brings back the same list of past conversations about it.
      -- Deliberately separate from memory-core's conversation table: workspace
      -- chats are never fed into cross-conversation "ingatan" recall (code
      -- snippets go stale the moment the file changes), this is purely so the
      -- user can save and revisit them, the same way Conversation mode does.
      CREATE TABLE IF NOT EXISTS workspace_chats (
        id TEXT PRIMARY KEY,
        workspace_root TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        messages TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_workspace_chats_root ON workspace_chats(workspace_root, updated_at DESC);
    `)

    this.upsertChunkStatement = this.database.prepare(`
      INSERT INTO workspace_chunks (
        id, workspace_root, rel_path, chunk_index, start_line, end_line, symbol, content, embedding, norm, created_at
      ) VALUES (
        @id, @workspaceRoot, @relPath, @chunkIndex, @startLine, @endLine, @symbol, @content, @embedding, @norm, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        rel_path = excluded.rel_path,
        chunk_index = excluded.chunk_index,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        symbol = excluded.symbol,
        content = excluded.content,
        embedding = excluded.embedding,
        norm = excluded.norm,
        created_at = excluded.created_at
    `)
    this.upsertFileStatement = this.database.prepare(`
      INSERT INTO workspace_files (workspace_root, rel_path, size, mtime_ms, content_hash, chunk_count, indexed_at)
      VALUES (@workspaceRoot, @relPath, @size, @mtimeMs, @contentHash, @chunkCount, @indexedAt)
      ON CONFLICT(workspace_root, rel_path) DO UPDATE SET
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        content_hash = excluded.content_hash,
        chunk_count = excluded.chunk_count,
        indexed_at = excluded.indexed_at
    `)
    this.deleteChunksForFileStatement = this.database.prepare(
      'DELETE FROM workspace_chunks WHERE workspace_root = ? AND rel_path = ?',
    )
    this.deleteFileStatement = this.database.prepare(
      'DELETE FROM workspace_files WHERE workspace_root = ? AND rel_path = ?',
    )
    this.selectChunksStatement = this.database.prepare(
      `SELECT id, rel_path, chunk_index, start_line, end_line, symbol, content, embedding, norm
       FROM workspace_chunks WHERE workspace_root = ?`,
    )
    this.selectFilesStatement = this.database.prepare(
      'SELECT rel_path, size, mtime_ms, content_hash, chunk_count, indexed_at FROM workspace_files WHERE workspace_root = ?',
    )
    this.countChunksStatement = this.database.prepare(
      'SELECT COUNT(*) AS count FROM workspace_chunks WHERE workspace_root = ?',
    )

    this.upsertChatStatement = this.database.prepare(`
      INSERT INTO workspace_chats (id, workspace_root, title, created_at, updated_at, messages)
      VALUES (@id, @workspaceRoot, @title, @createdAt, @updatedAt, @messages)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        updated_at = excluded.updated_at,
        messages = excluded.messages
    `)
    this.selectChatSummariesStatement = this.database.prepare(
      `SELECT id, title, created_at, updated_at, json_array_length(messages) AS message_count
       FROM workspace_chats WHERE workspace_root = ? ORDER BY updated_at DESC`,
    )
    this.selectChatStatement = this.database.prepare(
      'SELECT id, title, created_at, updated_at, messages FROM workspace_chats WHERE workspace_root = ? AND id = ?',
    )
    this.deleteChatStatement = this.database.prepare(
      'DELETE FROM workspace_chats WHERE workspace_root = ? AND id = ?',
    )
  }

  /** What the index already knows about each file, so unchanged files are skipped on rescan. */
  getIndexedFiles(workspaceRoot: string): Map<string, IndexedFileState> {
    const rows = this.selectFilesStatement.all(workspaceRoot) as FileRow[]
    return new Map(rows.map((row) => [row.rel_path, {
      relPath: row.rel_path,
      size: row.size,
      mtimeMs: row.mtime_ms,
      contentHash: row.content_hash,
      chunkCount: row.chunk_count,
    }]))
  }

  countChunks(workspaceRoot: string): number {
    return (this.countChunksStatement.get(workspaceRoot) as { count: number }).count
  }

  /** Replaces every chunk of one file in a single transaction (delete-then-insert). */
  replaceFileChunks(
    workspaceRoot: string,
    file: IndexedFileState,
    chunks: WorkspaceChunkInput[],
  ): void {
    const createdAt = new Date().toISOString()
    const transaction = this.database.transaction(() => {
      this.deleteChunksForFileStatement.run(workspaceRoot, file.relPath)
      for (const chunk of chunks) {
        this.upsertChunkStatement.run({
          id: chunk.id,
          workspaceRoot,
          relPath: chunk.relPath,
          chunkIndex: chunk.chunkIndex,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          symbol: chunk.symbol,
          content: chunk.content,
          embedding: encodeEmbedding(chunk.embedding),
          norm: vectorNorm(chunk.embedding),
          createdAt,
        })
      }
      this.upsertFileStatement.run({
        workspaceRoot,
        relPath: file.relPath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        contentHash: file.contentHash,
        chunkCount: chunks.length,
        indexedAt: createdAt,
      })
    })
    transaction()
    this.searchCache.delete(workspaceRoot)
  }

  /**
   * Refreshes only a file's stat fingerprint, for when it was rewritten with
   * byte-identical content (a formatter run, a git checkout). Keeps the cheap
   * size+mtime skip working next time without paying to re-embed.
   */
  touchFile(workspaceRoot: string, relPath: string, size: number, mtimeMs: number, contentHash: string): void {
    const existing = this.getIndexedFiles(workspaceRoot).get(relPath)
    if (!existing) return
    this.upsertFileStatement.run({
      workspaceRoot,
      relPath,
      size,
      mtimeMs,
      contentHash,
      chunkCount: existing.chunkCount,
      indexedAt: new Date().toISOString(),
    })
  }

  removeFile(workspaceRoot: string, relPath: string): void {
    const transaction = this.database.transaction(() => {
      this.deleteChunksForFileStatement.run(workspaceRoot, relPath)
      this.deleteFileStatement.run(workspaceRoot, relPath)
    })
    transaction()
    this.searchCache.delete(workspaceRoot)
  }

  /** Drops a whole directory subtree - chokidar reports one unlinkDir, not a delete per file. */
  removeDirectory(workspaceRoot: string, relDirPath: string): void {
    const prefix = `${relDirPath.replace(/[\\/]+$/, '')}/`
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM workspace_chunks WHERE workspace_root = ? AND rel_path LIKE ?')
        .run(workspaceRoot, `${prefix}%`)
      this.database.prepare('DELETE FROM workspace_files WHERE workspace_root = ? AND rel_path LIKE ?')
        .run(workspaceRoot, `${prefix}%`)
    })
    transaction()
    this.searchCache.delete(workspaceRoot)
  }

  /** Forgets everything indexed for one workspace (used by "Index Ulang"). */
  clearWorkspace(workspaceRoot: string): void {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM workspace_chunks WHERE workspace_root = ?').run(workspaceRoot)
      this.database.prepare('DELETE FROM workspace_files WHERE workspace_root = ?').run(workspaceRoot)
    })
    transaction()
    this.searchCache.delete(workspaceRoot)
  }

  /** Removes index rows for files that no longer exist on disk (deleted while the server was down). */
  pruneMissingFiles(workspaceRoot: string, existingRelPaths: Set<string>): number {
    const known = this.getIndexedFiles(workspaceRoot)
    let removed = 0
    for (const relPath of known.keys()) {
      if (existingRelPaths.has(relPath)) continue
      this.removeFile(workspaceRoot, relPath)
      removed += 1
    }
    return removed
  }

  private ensureSearchCache(workspaceRoot: string): SearchCacheEntry[] {
    const cached = this.searchCache.get(workspaceRoot)
    if (cached) return cached
    const rows = this.selectChunksStatement.all(workspaceRoot) as ChunkRow[]
    const entries = rows.map((row) => ({
      id: row.id,
      relPath: row.rel_path,
      chunkIndex: row.chunk_index,
      startLine: row.start_line,
      endLine: row.end_line,
      symbol: row.symbol,
      content: row.content,
      embedding: decodeEmbedding(row.embedding),
      norm: row.norm,
    }))
    this.searchCache.set(workspaceRoot, entries)
    return entries
  }

  /**
   * Finds the chunks most relevant to a query.
   *
   * Scoring is a blend, not pure cosine similarity, for a reason measured
   * against this project's actual usage: prompts are written in Indonesian
   * while the code and its identifiers are English. nomic-embed-text handles
   * that cross-lingual gap poorly - a *relevant* Indonesian question about tax
   * scored 0.347 against the tax function, while an entirely unrelated
   * Indonesian sentence scored 0.393 against the same chunk. Absolute cosine
   * thresholds are therefore meaningless for half of the queries this app
   * receives, so two corrections are applied:
   *
   *   1. Keyword overlap is blended in (the same trick memory-core.ts uses for
   *      conversation recall). Identifiers survive translation - someone asking
   *      about "diskon" still types "discount" when they name the function.
   *   2. Results are gated *relative to the best hit* instead of against a
   *      fixed number, so the top match always survives and only comparably
   *      good chunks come with it. `minScore` stays on as a pure noise floor.
   */
  search(
    workspaceRoot: string,
    queryEmbedding: number[],
    limit: number,
    minScore: number,
    excludeRelPaths?: Set<string>,
    options: { queryText?: string; relativeRatio?: number } = {},
  ): WorkspaceChunkMatch[] {
    const entries = this.ensureSearchCache(workspaceRoot)
    if (!entries.length) return []

    const query = Float32Array.from(queryEmbedding)
    const queryNorm = vectorNorm(query)
    if (!queryNorm) return []

    const queryTerms = tokenize(options.queryText || '')

    const scored: WorkspaceChunkMatch[] = []
    for (const entry of entries) {
      if (excludeRelPaths?.has(entry.relPath)) continue
      if (!entry.norm || entry.embedding.length !== query.length) continue

      let dot = 0
      for (let index = 0; index < query.length; index += 1) dot += query[index] * entry.embedding[index]
      const semanticScore = dot / (queryNorm * entry.norm)

      // Path and symbol are matched alongside the body: a query naming a file
      // or a function should find it even when the body wording differs.
      const keyword = queryTerms.length
        ? keywordOverlap(queryTerms, `${entry.relPath} ${entry.symbol || ''} ${entry.content}`)
        : 0
      const score = queryTerms.length ? semanticScore * 0.75 + keyword * 0.25 : semanticScore

      if (score < minScore) continue
      scored.push({
        id: entry.id,
        relPath: entry.relPath,
        chunkIndex: entry.chunkIndex,
        startLine: entry.startLine,
        endLine: entry.endLine,
        symbol: entry.symbol,
        content: entry.content,
        score,
      })
    }

    scored.sort((left, right) => right.score - left.score)
    if (!scored.length) return []

    const ratio = options.relativeRatio ?? 1
    if (ratio >= 1) return scored.slice(0, limit)

    const cutoff = scored[0].score * ratio
    return scored.filter((match) => match.score >= cutoff).slice(0, limit)
  }

  // ===== AI Coding Assistant chat sessions (per workspace_root) =====

  listChats(workspaceRoot: string): WorkspaceChatSummary[] {
    const rows = this.selectChatSummariesStatement.all(workspaceRoot) as ChatSummaryRow[]
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
    }))
  }

  getChat(workspaceRoot: string, id: string): WorkspaceChatSession | null {
    const row = this.selectChatStatement.get(workspaceRoot, id) as ChatRow | undefined
    if (!row) return null
    let messages: WorkspaceChatMessage[] = []
    try {
      messages = JSON.parse(row.messages) as WorkspaceChatMessage[]
    } catch {
      messages = []
    }
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: messages.length,
      messages,
    }
  }

  /** Upserts a chat session. Reuses `createdAt` when the session already exists. */
  saveChat(
    workspaceRoot: string,
    input: { id: string; title: string; messages: WorkspaceChatMessage[] },
  ): WorkspaceChatSummary {
    const existing = this.selectChatStatement.get(workspaceRoot, input.id) as ChatRow | undefined
    const now = new Date().toISOString()
    const createdAt = existing?.created_at ?? now
    this.upsertChatStatement.run({
      id: input.id,
      workspaceRoot,
      title: input.title,
      createdAt,
      updatedAt: now,
      messages: JSON.stringify(input.messages),
    })
    return { id: input.id, title: input.title, createdAt, updatedAt: now, messageCount: input.messages.length }
  }

  deleteChat(workspaceRoot: string, id: string): boolean {
    return this.deleteChatStatement.run(workspaceRoot, id).changes > 0
  }

  close(): void {
    this.searchCache.clear()
    this.database.close()
  }
}
