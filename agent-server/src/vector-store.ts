import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import type { VectorRecord } from './types.js'

interface LegacyStoreFile {
  version: 1
  records: VectorRecord[]
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0
}

/**
 * If `configuredPath` is the legacy `*.json` flat-file location, the actual
 * SQLite file lives next to it as `*.sqlite`. A pre-existing JSON file at the
 * legacy path (from before this store moved to SQLite) is migrated in once.
 */
function resolveSqlitePath(configuredPath: string): { sqlitePath: string; legacyJsonPath: string | null } {
  if (configuredPath.toLowerCase().endsWith('.json')) {
    return { sqlitePath: configuredPath.replace(/\.json$/i, '.sqlite'), legacyJsonPath: configuredPath }
  }
  return { sqlitePath: configuredPath, legacyJsonPath: null }
}

type StoredRow = {
  id: string
  source: string
  content: string
  embedding: string
  metadata: string
  created_at: string
}

function rowToRecord(row: StoredRow): VectorRecord {
  return {
    id: row.id,
    source: row.source,
    content: row.content,
    embedding: JSON.parse(row.embedding) as number[],
    metadata: JSON.parse(row.metadata) as VectorRecord['metadata'],
    createdAt: row.created_at,
  }
}

/**
 * Embeddings for both ingested RAG documents and conversation memory live
 * here. Previously this was a single JSON file rewritten from scratch on
 * every upsert, which meant every chat message re-serialized the entire
 * store (it had grown to 11MB+ in real usage) - increasingly slow and hard
 * on removable/flash storage. SQLite gives incremental, indexed writes
 * instead, while an in-memory cache keeps search just as fast as before.
 */
export class VectorStore {
  private readonly database: Database.Database
  private readonly upsertStatement: Database.Statement
  private readonly selectAllStatement: Database.Statement
  private readonly countStatement: Database.Statement
  private cache: VectorRecord[] | null = null

  constructor(configuredPath: string) {
    const { sqlitePath, legacyJsonPath } = resolveSqlitePath(configuredPath)
    mkdirSync(path.dirname(sqlitePath), { recursive: true })
    this.database = new Database(sqlitePath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(source);
    `)

    this.upsertStatement = this.database.prepare(`
      INSERT INTO vectors (id, source, content, embedding, metadata, created_at)
      VALUES (@id, @source, @content, @embedding, @metadata, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        content = excluded.content,
        embedding = excluded.embedding,
        metadata = excluded.metadata,
        created_at = excluded.created_at
    `)
    this.selectAllStatement = this.database.prepare(
      'SELECT id, source, content, embedding, metadata, created_at FROM vectors',
    )
    this.countStatement = this.database.prepare('SELECT COUNT(*) AS count FROM vectors')

    this.migrateLegacyJsonIfPresent(legacyJsonPath)
  }

  private migrateLegacyJsonIfPresent(legacyJsonPath: string | null): void {
    if (!legacyJsonPath || !existsSync(legacyJsonPath)) return
    const alreadyMigrated = (this.countStatement.get() as { count: number }).count > 0
    if (alreadyMigrated) return

    try {
      const raw = readFileSync(legacyJsonPath, 'utf8')
      const parsed = JSON.parse(raw) as LegacyStoreFile
      const records = Array.isArray(parsed.records) ? parsed.records : []
      if (records.length) {
        const transaction = this.database.transaction((items: VectorRecord[]) => {
          for (const item of items) this.runUpsert(item)
        })
        transaction(records)
        console.log(`Migrated ${records.length} legacy vector records from ${legacyJsonPath} into SQLite.`)
      }
      renameSync(legacyJsonPath, `${legacyJsonPath}.migrated`)
    } catch (error) {
      console.warn(`Legacy vector store migration from ${legacyJsonPath} failed:`, error)
    }
  }

  private runUpsert(record: VectorRecord): void {
    this.upsertStatement.run({
      id: record.id,
      source: record.source,
      content: record.content,
      embedding: JSON.stringify(record.embedding),
      metadata: JSON.stringify(record.metadata ?? {}),
      createdAt: record.createdAt,
    })
  }

  private ensureCache(): VectorRecord[] {
    if (!this.cache) {
      this.cache = (this.selectAllStatement.all() as StoredRow[]).map(rowToRecord)
    }
    return this.cache
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    if (!records.length) return
    const transaction = this.database.transaction((items: VectorRecord[]) => {
      for (const item of items) this.runUpsert(item)
    })
    transaction(records)

    // Keep the in-memory cache in sync without a full reload from disk.
    if (this.cache) {
      const incoming = new Map(records.map((record) => [record.id, record]))
      this.cache = [...this.cache.filter((record) => !incoming.has(record.id)), ...records]
    }
  }

  async count(): Promise<number> {
    return (this.countStatement.get() as { count: number }).count
  }

  /**
   * Ingested documents grouped by source, so the UI can show what is actually
   * being fed into "Retrieved local context" and remove anything that
   * shouldn't be there. Conversation-memory vectors are excluded - those
   * belong to memory-core, not to the document store.
   */
  async listDocumentSources(): Promise<Array<{ source: string; chunks: number; characters: number }>> {
    return this.ensureCache()
      .filter((record) => !record.source.startsWith(CONVERSATION_SOURCE_PREFIX))
      .reduce((groups: Array<{ source: string; chunks: number; characters: number }>, record) => {
        const existing = groups.find((group) => group.source === record.source)
        if (existing) {
          existing.chunks += 1
          existing.characters += record.content.length
        } else {
          groups.push({ source: record.source, chunks: 1, characters: record.content.length })
        }
        return groups
      }, [])
      .sort((left, right) => right.characters - left.characters)
  }

  async deleteBySource(source: string): Promise<number> {
    const result = this.database.prepare('DELETE FROM vectors WHERE source = ?').run(source)
    if (this.cache) this.cache = this.cache.filter((record) => record.source !== source)
    return result.changes
  }

  async search(
    queryEmbedding: number[],
    limit: number,
    minScore: number,
    filter?: (record: VectorRecord) => boolean,
  ): Promise<Array<VectorRecord & { score: number }>> {
    const records = this.ensureCache()
    const pool = filter ? records.filter(filter) : records
    return pool
      .map((record) => ({ ...record, score: cosineSimilarity(queryEmbedding, record.embedding) }))
      .filter((record) => record.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }

  close(): void {
    this.database.close()
  }

  /** Reclaims disk space left behind by deletes/updates - see routes.ts's /storage/vacuum. */
  vacuum(): void {
    this.database.exec('VACUUM')
  }
}

/** Records whose id/source marks them as conversation memory, not an ingested document. */
export const CONVERSATION_SOURCE_PREFIX = 'sqlite:conversations:'
