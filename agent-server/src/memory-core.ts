import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { embed } from './ollama.js'
import { JsonVectorStore } from './vector-store.js'
import type { ChatMessage, VectorRecord } from './types.js'

export interface MemoryRecord {
  id: string
  timestamp: string
  sender: string
  message: string
  metadata: Record<string, unknown>
}

export interface MemorySearchResult extends MemoryRecord {
  score: number
  semanticScore: number
  keywordScore: number
}

export interface MemoryCore {
  appendMessage(sender: string, message: string, metadata?: Record<string, unknown>): Promise<MemoryRecord>
  search(query: string): Promise<MemorySearchResult[]>
  exportJsonl(outputPath: string): Promise<void>
  importJsonl(inputPath: string): Promise<number>
  close(): void
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
    timestamp: String(row.timestamp),
    sender: String(row.sender),
    message: String(row.message),
    metadata: JSON.parse(String(row.metadata || '{}')) as Record<string, unknown>,
  }
}

export class SqliteMemoryCore implements MemoryCore {
  private readonly database: Database.Database
  private readonly insertStatement: Database.Statement
  private readonly selectAllStatement: Database.Statement

  constructor(private readonly vectorStore: JsonVectorStore) {
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
    `)
    this.insertStatement = this.database.prepare(`
      INSERT OR IGNORE INTO conversations (id, timestamp, sender, message, metadata)
      VALUES (@id, @timestamp, @sender, @message, @metadata)
    `)
    this.selectAllStatement = this.database.prepare('SELECT id, timestamp, sender, message, metadata FROM conversations ORDER BY timestamp ASC')
  }

  async appendMessage(sender: string, message: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    if (!message.trim()) throw new Error('Cannot store an empty memory message')
    const record: MemoryRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sender,
      message,
      metadata,
    }
    this.insertStatement.run({ ...record, metadata: JSON.stringify(metadata) })

    try {
      const embedding = await embed(message)
      const vector: VectorRecord = {
        id: record.id,
        source: `sqlite:conversations:${record.id}`,
        content: `${record.sender}: ${record.message}`,
        embedding,
        metadata: { sender: record.sender, timestamp: record.timestamp, ...metadata },
        createdAt: record.timestamp,
      }
      await this.vectorStore.upsert([vector])
    } catch (error) {
      console.warn(`Memory embedding skipped for ${record.id}:`, error)
    }
    return record
  }

  async search(query: string): Promise<MemorySearchResult[]> {
    if (!query.trim()) return []
    const rows = this.selectAllStatement.all() as Record<string, unknown>[]
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await embed(query)
    } catch (error) {
      console.warn('Memory semantic search unavailable; using exact keyword search:', error)
    }

    const vectorResults = queryEmbedding
      ? await this.vectorStore.search(queryEmbedding, rows.length, -1)
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
        this.insertStatement.run({ ...record, metadata: JSON.stringify(record.metadata || {}) })
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
          metadata: { sender: record.sender, timestamp: record.timestamp, ...record.metadata },
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
}

export function chatMessagesToMemory(messages: ChatMessage[]): Array<{ sender: string; message: string }> {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim())
    .map((message) => ({ sender: message.role, message: message.content }))
}
