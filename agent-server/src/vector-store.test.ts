import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CONVERSATION_SOURCE_PREFIX, VectorStore } from './vector-store.js'
import type { VectorRecord } from './types.js'

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'agent-vector-store-'))
}

function record(id: string, embedding: number[], overrides: Partial<VectorRecord> = {}): VectorRecord {
  return {
    id,
    source: overrides.source ?? `doc-${id}`,
    content: overrides.content ?? `content ${id}`,
    embedding,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  }
}

test('upsert persists incrementally and count reflects stored records', async () => {
  const dir = tempDir()
  try {
    const store = new VectorStore(path.join(dir, 'vector-store.json'))
    assert.equal(await store.count(), 0)
    await store.upsert([record('a', [1, 0, 0]), record('b', [0, 1, 0])])
    assert.equal(await store.count(), 2)
    // Re-upserting the same id updates in place rather than duplicating.
    await store.upsert([record('a', [1, 1, 0])])
    assert.equal(await store.count(), 2)
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search ranks by cosine similarity and respects limit/minScore', async () => {
  const dir = tempDir()
  try {
    const store = new VectorStore(path.join(dir, 'vector-store.json'))
    await store.upsert([
      record('exact', [1, 0, 0]),
      record('close', [0.9, 0.1, 0]),
      record('unrelated', [0, 0, 1]),
    ])
    const results = await store.search([1, 0, 0], 2, 0.5)
    assert.equal(results.length, 2)
    assert.equal(results[0].id, 'exact')
    assert.equal(results[1].id, 'close')
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('search filter predicate can exclude conversation-memory vectors from document retrieval', async () => {
  const dir = tempDir()
  try {
    const store = new VectorStore(path.join(dir, 'vector-store.json'))
    await store.upsert([
      record('doc-1', [1, 0, 0], { source: 'notes.txt' }),
      record('conv-1', [1, 0, 0], { source: `${CONVERSATION_SOURCE_PREFIX}abc` }),
    ])
    const isDocument = (r: VectorRecord) => !r.source.startsWith(CONVERSATION_SOURCE_PREFIX)
    const results = await store.search([1, 0, 0], 10, 0, isDocument)
    assert.equal(results.length, 1)
    assert.equal(results[0].id, 'doc-1')
    store.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a pre-existing legacy vector-store.json is migrated into SQLite once, then backed up', async () => {
  const dir = tempDir()
  try {
    const jsonPath = path.join(dir, 'vector-store.json')
    const legacyRecords = [record('legacy-1', [1, 0, 0]), record('legacy-2', [0, 1, 0])]
    writeFileSync(jsonPath, JSON.stringify({ version: 1, records: legacyRecords }, null, 2), 'utf8')

    const store = new VectorStore(jsonPath)
    assert.equal(await store.count(), 2)
    const results = await store.search([1, 0, 0], 10, 0.9)
    assert.equal(results[0].id, 'legacy-1')

    // The legacy file should be renamed out of the way, not left to be re-read/re-migrated.
    assert.equal(existsSync(jsonPath), false)
    assert.equal(existsSync(`${jsonPath}.migrated`), true)
    store.close()

    // Reopening at the same path must not re-import (would duplicate/reset data).
    const reopened = new VectorStore(jsonPath)
    assert.equal(await reopened.count(), 2)
    reopened.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('records added after migration are preserved across reopening the same path', async () => {
  const dir = tempDir()
  try {
    const jsonPath = path.join(dir, 'vector-store.json')
    const first = new VectorStore(jsonPath)
    await first.upsert([record('x', [1, 0, 0])])
    first.close()

    const second = new VectorStore(jsonPath)
    assert.equal(await second.count(), 1)
    await second.upsert([record('y', [0, 1, 0])])
    second.close()

    const third = new VectorStore(jsonPath)
    assert.equal(await third.count(), 2)
    third.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
