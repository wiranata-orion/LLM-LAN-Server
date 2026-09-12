import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { config } from './config.js'
import { SqliteMemoryCore } from './memory-core.js'
import { VectorStore } from './vector-store.js'

// These exercise a real bug: a fact stated once ("nama saya adalah Wiranata")
// kept getting crowded out of "Relevant Memory" by (a) the user's own
// question repeated across many chats while testing, and (b) the assistant's
// own earlier hedge/placeholder replies getting stored and re-retrieved,
// reinforcing the same bad answer indefinitely. Both must be filtered out so
// the one real fact-bearing message can surface instead.

function withTempMemory<T>(fn: (memory: SqliteMemoryCore) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-memory-quality-'))
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

test('search excludes questions from results, since a question repeated across chats should not out-rank the real answer', () => withTempMemory(async (memory) => {
  await memory.appendMessage('user', 'nama aku wiranata', { conversationId: 'a' })
  for (let i = 0; i < 5; i += 1) {
    await memory.appendMessage('user', 'sebutkan nama saya?', { conversationId: `dup-${i}` })
  }

  const results = await memory.search('sebutkan nama saya?', null)
  assert.ok(results.every((record) => !record.message.trim().endsWith('?')), 'no question should appear in results')
  assert.ok(results.some((record) => record.message.includes('wiranata')), 'the real fact-bearing message should be findable')
}))

test('search excludes low-signal assistant replies (privacy refusals, unfilled placeholders)', () => withTempMemory(async (memory) => {
  await memory.appendMessage('assistant', 'Nama Anda adalah [Nama Anda].', { conversationId: 'a' })
  await memory.appendMessage('assistant', 'Maaf, saya tidak dapat memberikan informasi tentang nama Anda karena privasi pengguna adalah prioritas utama.', { conversationId: 'a' })
  await memory.appendMessage('assistant', 'Nama Anda adalah Wiranata.', { conversationId: 'a' })

  const results = await memory.search('nama saya siapa', null)
  assert.ok(!results.some((record) => record.message.includes('[Nama Anda]')), 'the unfilled placeholder reply must be excluded')
  assert.ok(!results.some((record) => record.message.includes('privasi')), 'the privacy-refusal reply must be excluded')
  assert.ok(results.some((record) => record.message === 'Nama Anda adalah Wiranata.'), 'the real answer must still be findable')
}))

test('search excludes imperative Indonesian requests with no "?" at all, not just interrogative questions', () => withTempMemory(async (memory) => {
  // This is the exact real-world case that slipped through an earlier version
  // of this filter, which only checked for a trailing "?": Indonesian very
  // commonly phrases "tell me my name" as a command ("sebutkan nama saya" /
  // "halo sebut nama saya") with no question mark anywhere in it.
  await memory.appendMessage('user', 'Halo, perkenalkan nama aku wiranata', { conversationId: 'a' })
  await memory.appendMessage('user', 'halo sebut nama saya', { conversationId: 'b' })
  await memory.appendMessage('user', 'sebutkan nama saya', { conversationId: 'c' })
  await memory.appendMessage('user', 'oke sekarang, sebut nama mu', { conversationId: 'd' })

  const results = await memory.search('halo sebut nama saya', null)
  assert.ok(!results.some((record) => record.message === 'halo sebut nama saya'), 'a repeat of the same imperative request must be excluded')
  assert.ok(!results.some((record) => record.message === 'sebutkan nama saya'), 'a differently-worded imperative request must be excluded')
  assert.ok(!results.some((record) => record.message === 'oke sekarang, sebut nama mu'), 'the "-mu" possessive suffix form must be caught too')
  assert.ok(results.some((record) => record.message.includes('wiranata')), 'the actual fact-bearing statement must survive and be findable')
}))

test('a user statement phrased as a question mark is filtered even when it happens to state a fact, by design (a known, accepted trade-off)', () => withTempMemory(async (memory) => {
  // Documents the trade-off explicitly rather than leaving it as a silent gap.
  await memory.appendMessage('user', 'alamat rumah saya jalan merdeka no 5, benar kan?', { conversationId: 'a' })
  const results = await memory.search('alamat rumah saya', null)
  assert.ok(!results.some((record) => record.message.includes('merdeka')), 'question-phrased statements are filtered - a deliberate, documented limitation')
}))
