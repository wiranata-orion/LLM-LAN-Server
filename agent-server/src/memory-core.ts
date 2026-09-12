import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { embed } from './ollama.js'
import { VectorStore } from './vector-store.js'
import type { ChatMessage, VectorRecord } from './types.js'

export interface MemoryRecord {
  id: string
  sessionId: string
  timestamp: string
  sender: string
  message: string
  metadata: Record<string, unknown>
}

export interface MemoryFact {
  key: string
  value: string
  confidence: number
  updatedAt: string
}

export interface MemoryLayerSnapshot {
  sessionId: string
  workingBuffer: MemoryRecord[]
  rollingSummary: string
  facts: MemoryFact[]
  semanticMemoryCount: number
}

export interface MemorySearchResult extends MemoryRecord {
  score: number
  semanticScore: number
  keywordScore: number
}

export interface MemoryCore {
  appendMessage(sender: string, message: string, metadata?: Record<string, unknown>): Promise<MemoryRecord>
  /**
   * @param queryEmbedding Pass a precomputed embedding to skip a redundant embedding call when the caller already has one.
   * @param excludeId Exclude a specific record (typically the message just appended for this same turn) from results,
   * so the question being asked right now doesn't show up as "relevant memory" of itself.
   */
  search(query: string, queryEmbedding?: number[] | null, excludeId?: string): Promise<MemorySearchResult[]>
  getCoreProfile(): Promise<string>
  getLayerSnapshot(sessionId: string): Promise<MemoryLayerSnapshot>
  exportJsonl(outputPath: string): Promise<void>
  importJsonl(inputPath: string): Promise<number>
  close(): void
}

interface MemoryFactCandidate {
  key: string
  value: string
  confidence: number
}

function keywordScore(query: string, message: string): number {
  const queryWords = new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  const messageWords = new Set(message.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  if (!queryWords.size || !messageWords.size) return 0
  let matches = 0
  for (const word of queryWords) if (messageWords.has(word)) matches += 1
  return matches / queryWords.size
}

function toRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id || row.sessionId || 'default'),
    timestamp: String(row.timestamp),
    sender: String(row.sender),
    message: String(row.message),
    metadata: parseMetadata(row.metadata),
  }
}

function parseMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata) return {}
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return metadata as Record<string, unknown>
}

function normalizeSessionId(metadata: Record<string, unknown> = {}, fallback = 'default'): string {
  const raw = metadata.conversationId ?? metadata.sessionId ?? fallback
  return String(raw || fallback)
}

export function extractFactsFromMessage(_message: string): MemoryFactCandidate[] {
  return []
}

export class SqliteMemoryCore implements MemoryCore {
  private readonly database: Database.Database
  private readonly insertStatement: Database.Statement
  private readonly selectAllStatement: Database.Statement
  private readonly selectRecentForSearchStatement: Database.Statement
  private readonly selectSessionMessagesStatement: Database.Statement
  private readonly countSessionMessagesStatement: Database.Statement
  private readonly selectSessionSummaryStatement: Database.Statement
  private readonly upsertSummaryStatement: Database.Statement
  private readonly selectSessionFactsStatement: Database.Statement
  private readonly upsertFactStatement: Database.Statement

  constructor(private readonly vectorStore: VectorStore) {
    mkdirSync(path.dirname(config.memoryDbPath), { recursive: true })
    this.database = new Database(config.memoryDbPath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_timestamp ON conversations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_conversations_sender ON conversations(sender);

      CREATE TABLE IF NOT EXISTS session_summaries (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        summary_upto INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        scope TEXT NOT NULL DEFAULT 'user',
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        updated_at TEXT NOT NULL,
        UNIQUE(session_id, scope, key)
      );
    `)

    const columns = this.database.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'session_id')) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN session_id TEXT NOT NULL DEFAULT 'default'")
    }

    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_session_timestamp ON conversations(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_facts_session_updated ON facts(session_id, updated_at DESC);
    `)

    this.insertStatement = this.database.prepare(`
      INSERT OR IGNORE INTO conversations (id, session_id, timestamp, sender, message, metadata)
      VALUES (@id, @sessionId, @timestamp, @sender, @message, @metadata)
    `)
    this.selectAllStatement = this.database.prepare(
      'SELECT id, session_id, timestamp, sender, message, metadata FROM conversations ORDER BY timestamp ASC',
    )
    // Cross-conversation recall (see docs/universal-central-memory.md) intentionally
    // searches beyond the current session, but scanning every message ever stored on
    // every single request does not scale as history grows. Bound it to the most
    // recent window instead - relevant memories are overwhelmingly recent in practice.
    this.selectRecentForSearchStatement = this.database.prepare(
      'SELECT id, session_id, timestamp, sender, message, metadata FROM conversations ORDER BY timestamp DESC LIMIT ?',
    )
    this.selectSessionMessagesStatement = this.database.prepare(
      'SELECT id, session_id, timestamp, sender, message, metadata FROM conversations WHERE session_id = ? ORDER BY timestamp ASC',
    )
    this.countSessionMessagesStatement = this.database.prepare(
      'SELECT COUNT(*) AS count FROM conversations WHERE session_id = ?',
    )
    this.selectSessionSummaryStatement = this.database.prepare(
      'SELECT summary FROM session_summaries WHERE session_id = ?',
    )
    this.upsertSummaryStatement = this.database.prepare(`
      INSERT INTO session_summaries (session_id, summary, summary_upto, updated_at)
      VALUES (@sessionId, @summary, @summaryUpto, @updatedAt)
      ON CONFLICT(session_id)
      DO UPDATE SET summary = excluded.summary, summary_upto = excluded.summary_upto, updated_at = excluded.updated_at
    `)
    this.selectSessionFactsStatement = this.database.prepare(
      'SELECT key, value, confidence, updated_at FROM facts WHERE session_id = ? ORDER BY updated_at DESC, id DESC',
    )
    this.upsertFactStatement = this.database.prepare(`
      INSERT INTO facts (session_id, scope, key, value, confidence, updated_at)
      VALUES (@sessionId, @scope, @key, @value, @confidence, @updatedAt)
      ON CONFLICT(session_id, scope, key)
      DO UPDATE SET value = excluded.value, confidence = excluded.confidence, updated_at = excluded.updated_at
    `)
  }

  async appendMessage(sender: string, message: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    if (!message.trim()) throw new Error('Cannot store an empty memory message')
    const sessionId = normalizeSessionId(metadata)
    const record: MemoryRecord = {
      id: randomUUID(),
      sessionId,
      timestamp: new Date().toISOString(),
      sender,
      message,
      metadata,
    }

    this.insertStatement.run({
      ...record,
      sessionId,
      metadata: JSON.stringify(metadata),
    })

    this.storeFactsForSession(sessionId, extractFactsFromMessage(message))
    this.refreshRollingSummary(sessionId)

    try {
      const embedding = await embed(message)
      const vector: VectorRecord = {
        id: record.id,
        source: `sqlite:conversations:${record.id}`,
        content: `${record.sender}: ${record.message}`,
        embedding,
        metadata: { sender: record.sender, timestamp: record.timestamp, sessionId, ...metadata },
        createdAt: record.timestamp,
      }
      await this.vectorStore.upsert([vector])
    } catch (error) {
      console.warn(`Memory embedding skipped for ${record.id}:`, error)
    }
    return record
  }

  async search(query: string, precomputedEmbedding?: number[] | null, excludeId?: string): Promise<MemorySearchResult[]> {
    if (!query.trim()) return []
    const rows = (this.selectRecentForSearchStatement.all(config.memorySearchScanLimit) as Record<string, unknown>[])
      .filter((row) => !excludeId || String(row.id) !== excludeId)

    let queryEmbedding: number[] | null | undefined = precomputedEmbedding
    if (queryEmbedding === undefined) {
      try {
        queryEmbedding = await embed(query)
      } catch (error) {
        console.warn('Memory semantic search unavailable; using exact keyword search:', error)
        queryEmbedding = null
      }
    }

    // Only the conversation vectors we might actually use are relevant here; asking
    // the vector store for literally every record (including ingested documents) and
    // an unbounded limit wastes work on a growing store.
    const vectorResults = queryEmbedding
      ? await this.vectorStore.search(queryEmbedding, Math.max(config.maxRetrievedChunks * 8, 50), 0)
      : []
    const semanticById = new Map(vectorResults.map((item) => [item.id, item.score]))
    return rows
      .map((row) => {
        const record = toRecord(row)
        const semanticScore = semanticById.get(record.id) || 0
        const keyword = keywordScore(query, `${record.sender} ${record.message}`)
        return { ...record, semanticScore, keywordScore: keyword, score: semanticScore * 0.7 + keyword * 0.3 }
      })
      .filter((record) => record.semanticScore > 0 || record.keywordScore > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, config.maxRetrievedChunks)
  }

  async getCoreProfile(): Promise<string> {
    try {
      const rows = this.database.prepare(
        'SELECT key, value FROM facts ORDER BY updated_at DESC, id DESC LIMIT ?',
      ).all(config.memoryFactLimit) as Array<{ key: string; value: string }>
      if (!rows.length) return ''
      return rows.map((row) => `${row.key}: ${row.value}`).join('\n')
    } catch (error) {
      console.warn('Failed to retrieve core profile from SQLite:', error)
      return ''
    }
  }

  async getLayerSnapshot(sessionId: string): Promise<MemoryLayerSnapshot> {
    const workingBuffer = (this.selectSessionMessagesStatement.all(sessionId) as Record<string, unknown>[]).map(toRecord)
    const facts = (this.selectSessionFactsStatement.all(sessionId) as Array<{
      key: string
      value: string
      confidence: number
      updated_at: string
    }>).map((fact) => ({
      key: fact.key,
      value: fact.value,
      confidence: Number(fact.confidence),
      updatedAt: String(fact.updated_at),
    }))
    const rollingSummary = (this.selectSessionSummaryStatement.get(sessionId) as { summary?: string } | undefined)?.summary || ''
    return {
      sessionId,
      workingBuffer,
      rollingSummary,
      facts,
      semanticMemoryCount: await this.vectorStore.count(),
    }
  }

  async exportJsonl(outputPath: string): Promise<void> {
    await mkdir(path.dirname(outputPath), { recursive: true })
    const temporaryPath = `${outputPath}.tmp`
    const lines = this.selectAllStatement.iterate() as Iterable<Record<string, unknown>>
    const stream = createWriteStream(temporaryPath, { encoding: 'utf8' })
    for (const row of lines) stream.write(`${JSON.stringify(toRecord(row))}\n`)
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(() => resolve())
    })
    await rename(temporaryPath, outputPath)
  }

  async importJsonl(inputPath: string): Promise<number> {
    const content = await readFile(inputPath, 'utf8')
    const rows = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as MemoryRecord)
    const transaction = this.database.transaction((records: MemoryRecord[]) => {
      for (const record of records) {
        this.insertStatement.run({
          ...record,
          sessionId: record.sessionId || 'default',
          metadata: JSON.stringify(record.metadata || {}),
        })
      }
    })
    transaction(rows)
    for (const record of rows) {
      try {
        const embedding = await embed(record.message)
        await this.vectorStore.upsert([{
          id: record.id,
          source: `sqlite:conversations:${record.id}`,
          content: `${record.sender}: ${record.message}`,
          embedding,
          metadata: { sender: record.sender, timestamp: record.timestamp, sessionId: record.sessionId, ...record.metadata },
          createdAt: record.timestamp,
        }])
      } catch (error) {
        console.warn(`Imported record ${record.id} without embedding:`, error)
      }
    }
    return rows.length
  }

  close(): void {
    this.database.close()
  }

  private storeFactsForSession(sessionId: string, facts: MemoryFactCandidate[]): void {
    if (!facts.length) return
    const transaction = this.database.transaction((items: MemoryFactCandidate[]) => {
      const updatedAt = new Date().toISOString()
      for (const item of items) {
        this.upsertFactStatement.run({
          sessionId,
          scope: 'user',
          key: item.key,
          value: item.value,
          confidence: item.confidence,
          updatedAt,
        })
      }
    })
    transaction(facts)
  }

  private refreshRollingSummary(sessionId: string): void {
    const count = Number((this.countSessionMessagesStatement.get(sessionId) as { count: number } | undefined)?.count || 0)
    if (count < config.memorySummaryThreshold) return

    const rows = (this.selectSessionMessagesStatement.all(sessionId) as Record<string, unknown>[]).map(toRecord)
    const recentWindow = rows.slice(-Math.min(rows.length, 12))
    const summary = recentWindow
      .map((row) => `${row.sender}: ${row.message}`)
      .join(' | ')
      .trim()

    this.upsertSummaryStatement.run({
      sessionId,
      summary,
      summaryUpto: rows.length,
      updatedAt: new Date().toISOString(),
    })
  }
}

export function chatMessagesToMemory(messages: ChatMessage[]): Array<{ sender: string; message: string }> {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim())
    .map((message) => ({ sender: message.role, message: message.content }))
}
