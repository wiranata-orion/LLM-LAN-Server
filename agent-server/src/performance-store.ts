import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { TurnPerformanceStats } from './types.js'

type StoredRow = {
  id: string
  timestamp: string
  conversation_id: string
  model: string
  ollama_base_url: string
  rag_enabled: number
  context_ms: number
  generation_ms: number
  tool_rounds: number
  retrieved_chunks: number
  total_duration: number | null
  load_duration: number | null
  prompt_eval_count: number | null
  prompt_eval_duration: number | null
  eval_count: number | null
  eval_duration: number | null
}

function rowToStats(row: StoredRow): TurnPerformanceStats {
  return {
    id: row.id,
    timestamp: row.timestamp,
    conversationId: row.conversation_id,
    model: row.model,
    ollamaBaseUrl: row.ollama_base_url,
    ragEnabled: !!row.rag_enabled,
    contextMs: row.context_ms,
    generationMs: row.generation_ms,
    toolRounds: row.tool_rounds,
    retrievedChunks: row.retrieved_chunks,
    totalDuration: row.total_duration ?? undefined,
    loadDuration: row.load_duration ?? undefined,
    promptEvalCount: row.prompt_eval_count ?? undefined,
    promptEvalDuration: row.prompt_eval_duration ?? undefined,
    evalCount: row.eval_count ?? undefined,
    evalDuration: row.eval_duration ?? undefined,
  }
}

/**
 * Persists one row per chat turn with the full timing breakdown (see
 * TurnPerformanceStats) - what powers the Performance Dashboard's history
 * view and chart. Kept in its own file rather than added to memory-core's
 * database: this is diagnostic data about the *engine*, not part of the
 * user's actual conversation memory, so it has no reason to be included in
 * memory export/import or to grow that file.
 */
export class PerformanceStore {
  private readonly database: Database.Database
  private readonly insertStatement: Database.Statement
  private readonly selectRecentStatement: Database.Statement
  private readonly deleteOlderThanStatement: Database.Statement

  constructor() {
    mkdirSync(path.dirname(config.performanceDbPath), { recursive: true })
    this.database = new Database(config.performanceDbPath)
    this.database.pragma('journal_mode = WAL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS turn_stats (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        model TEXT NOT NULL,
        ollama_base_url TEXT NOT NULL,
        rag_enabled INTEGER NOT NULL,
        context_ms REAL NOT NULL,
        generation_ms REAL NOT NULL,
        tool_rounds INTEGER NOT NULL,
        retrieved_chunks INTEGER NOT NULL,
        total_duration REAL,
        load_duration REAL,
        prompt_eval_count INTEGER,
        prompt_eval_duration REAL,
        eval_count INTEGER,
        eval_duration REAL
      );
      CREATE INDEX IF NOT EXISTS idx_turn_stats_timestamp ON turn_stats(timestamp);
    `)

    this.insertStatement = this.database.prepare(`
      INSERT INTO turn_stats (
        id, timestamp, conversation_id, model, ollama_base_url, rag_enabled,
        context_ms, generation_ms, tool_rounds, retrieved_chunks,
        total_duration, load_duration, prompt_eval_count, prompt_eval_duration, eval_count, eval_duration
      ) VALUES (
        @id, @timestamp, @conversationId, @model, @ollamaBaseUrl, @ragEnabled,
        @contextMs, @generationMs, @toolRounds, @retrievedChunks,
        @totalDuration, @loadDuration, @promptEvalCount, @promptEvalDuration, @evalCount, @evalDuration
      )
    `)
    this.selectRecentStatement = this.database.prepare(
      'SELECT * FROM turn_stats ORDER BY timestamp DESC LIMIT ?',
    )
    // Diagnostic history, not something anyone needs forever - bounds the
    // file's growth on a long-lived server. Run once at startup rather than
    // on every insert - a bit of stale overflow between restarts costs
    // nothing, and it keeps every single chat turn from paying for a scan.
    this.deleteOlderThanStatement = this.database.prepare(
      "DELETE FROM turn_stats WHERE timestamp < datetime('now', ?)",
    )
    this.deleteOlderThanStatement.run('-30 days')
  }

  /** Fire-and-forget from the orchestrator - a dropped stat is not worth failing or delaying a reply over. */
  record(stats: TurnPerformanceStats): void {
    try {
      this.insertStatement.run({
        id: stats.id,
        timestamp: stats.timestamp,
        conversationId: stats.conversationId,
        model: stats.model,
        ollamaBaseUrl: stats.ollamaBaseUrl,
        ragEnabled: stats.ragEnabled ? 1 : 0,
        contextMs: stats.contextMs,
        generationMs: stats.generationMs,
        toolRounds: stats.toolRounds,
        retrievedChunks: stats.retrievedChunks,
        totalDuration: stats.totalDuration ?? null,
        loadDuration: stats.loadDuration ?? null,
        promptEvalCount: stats.promptEvalCount ?? null,
        promptEvalDuration: stats.promptEvalDuration ?? null,
        evalCount: stats.evalCount ?? null,
        evalDuration: stats.evalDuration ?? null,
      })
    } catch (error) {
      console.warn('Failed to record performance stats:', error)
    }
  }

  listRecent(limit = 50): TurnPerformanceStats[] {
    const rows = this.selectRecentStatement.all(limit) as StoredRow[]
    return rows.map(rowToStats)
  }

  close(): void {
    this.database.close()
  }

  /** Reclaims disk space left behind by the 30-day cleanup - see routes.ts's /storage/vacuum. */
  vacuum(): void {
    this.database.exec('VACUUM')
  }
}
