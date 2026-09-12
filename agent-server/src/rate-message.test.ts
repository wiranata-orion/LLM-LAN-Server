import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { config } from './config.js'
import { SqliteMemoryCore } from './memory-core.js'
import { VectorStore } from './vector-store.js'

function withTempMemory<T>(fn: (memory: SqliteMemoryCore) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-rate-message-'))
  const previousDbPath = config.memoryDbPath
  const previousVectorPath = config.vectorStorePath
  config.memoryDbPath = path.join(dir, 'memory_core.sqlite')
  config.vectorStorePath = path.join(dir, 'vector-store.json')

  const store = new VectorStore(config.vectorStorePath)
  const memory = new SqliteMemoryCore(store)
  return fn(memory).finally(() => {
    memory.close()
    store.close()
    config.memoryDbPath = previousDbPath
    config.vectorStorePath = previousVectorPath
    rmSync(dir, { recursive: true, force: true })
  })
}

test('rateMessage stores the rating in the record metadata and can clear it again', () => withTempMemory(async (memory) => {
  const appended = await memory.appendMessage('assistant', 'The answer is 42.', { conversationId: 'c1' })

  const setGood = await memory.rateMessage(appended.id, 'good')
  assert.equal(setGood, true)
  let snapshot = await memory.getLayerSnapshot('c1')
  assert.equal(snapshot.workingBuffer.find((m) => m.id === appended.id)?.metadata.rating, 'good')

  const setBad = await memory.rateMessage(appended.id, 'bad')
  assert.equal(setBad, true)
  snapshot = await memory.getLayerSnapshot('c1')
  assert.equal(snapshot.workingBuffer.find((m) => m.id === appended.id)?.metadata.rating, 'bad')

  const cleared = await memory.rateMessage(appended.id, null)
  assert.equal(cleared, true)
  snapshot = await memory.getLayerSnapshot('c1')
  assert.equal(snapshot.workingBuffer.find((m) => m.id === appended.id)?.metadata.rating, undefined)
}))

test('rateMessage returns false for an id that does not exist', () => withTempMemory(async (memory) => {
  const found = await memory.rateMessage('does-not-exist', 'good')
  assert.equal(found, false)
}))

test('rating a message preserves its other metadata fields', () => withTempMemory(async (memory) => {
  const appended = await memory.appendMessage('assistant', 'Hello', { conversationId: 'c2', provider: 'agent-server' })
  await memory.rateMessage(appended.id, 'good')
  const snapshot = await memory.getLayerSnapshot('c2')
  const record = snapshot.workingBuffer.find((m) => m.id === appended.id)
  assert.equal(record?.metadata.provider, 'agent-server')
  assert.equal(record?.metadata.rating, 'good')
}))
