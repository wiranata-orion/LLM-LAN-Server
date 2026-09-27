import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { config } from './config.js'
import { PerformanceStore } from './performance-store.js'
import type { TurnPerformanceStats } from './types.js'

function withTempPerformanceStore<T>(fn: (store: PerformanceStore) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-performance-store-'))
  const previousPath = config.performanceDbPath
  config.performanceDbPath = path.join(dir, 'performance.sqlite')

  const store = new PerformanceStore()
  try {
    return fn(store)
  } finally {
    store.close()
    config.performanceDbPath = previousPath
    rmSync(dir, { recursive: true, force: true })
  }
}

function stats(overrides: Partial<TurnPerformanceStats> = {}): TurnPerformanceStats {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    conversationId: 'c1',
    model: 'llama3.2:latest',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ragEnabled: true,
    contextMs: 100,
    generationMs: 2000,
    toolRounds: 0,
    retrievedChunks: 2,
    totalDuration: 2_100_000_000,
    loadDuration: 0,
    promptEvalCount: 50,
    promptEvalDuration: 100_000_000,
    evalCount: 30,
    evalDuration: 2_000_000_000,
    ...overrides,
  }
}

test('record persists a turn and listRecent returns it back', () => withTempPerformanceStore((store) => {
  const entry = stats()
  store.record(entry)
  const recent = store.listRecent(10)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].id, entry.id)
  assert.equal(recent[0].model, entry.model)
  assert.equal(recent[0].evalCount, entry.evalCount)
  assert.equal(recent[0].ragEnabled, true)
}))

test('listRecent orders newest first and respects the limit', () => withTempPerformanceStore((store) => {
  const older = stats({ timestamp: '2020-01-01T00:00:00.000Z' })
  const newer = stats({ timestamp: '2020-01-02T00:00:00.000Z' })
  store.record(older)
  store.record(newer)

  const recent = store.listRecent(1)
  assert.equal(recent.length, 1)
  assert.equal(recent[0].id, newer.id)
}))

test('optional Ollama stats fields survive a round trip as undefined when absent', () => withTempPerformanceStore((store) => {
  const entry = stats({ totalDuration: undefined, loadDuration: undefined, promptEvalCount: undefined, promptEvalDuration: undefined, evalCount: undefined, evalDuration: undefined })
  store.record(entry)
  const [recent] = store.listRecent(1)
  assert.equal(recent.totalDuration, undefined)
  assert.equal(recent.loadDuration, undefined)
  assert.equal(recent.evalCount, undefined)
}))

test('ragEnabled false round-trips correctly', () => withTempPerformanceStore((store) => {
  store.record(stats({ ragEnabled: false }))
  const [recent] = store.listRecent(1)
  assert.equal(recent.ragEnabled, false)
}))
