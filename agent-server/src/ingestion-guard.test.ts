import assert from 'node:assert/strict'
import test from 'node:test'
import { IngestionService } from './ingestion.js'

// The real failure this guards against: a .sqlite database and the app's own
// global_memory.json were ingested as "documents". The binary file decoded
// into ~4700 characters of NUL/control-character noise, and both were then
// injected into every single prompt as "Retrieved local context" - crowding
// the actual conversation out of the context window and giving the model
// garbage to hallucinate from.

// The store is never reached for rejected input, so a stub is enough.
const stubStore = { upsert: async () => {} } as unknown as ConstructorParameters<typeof IngestionService>[0]

function makeBinaryContent(): string {
  // What a SQLite file looks like once read with utf8 decoding.
  return `SQLite format 3${String.fromCharCode(0)}${String.fromCharCode(0).repeat(500)}`
}

test('a binary file (e.g. a .sqlite database) is rejected instead of ingested as noise', async () => {
  const ingestion = new IngestionService(stubStore)
  await assert.rejects(
    () => ingestion.ingest([{ source: 'notes.sqlite', content: makeBinaryContent() }]),
    /binary file/i,
  )
})

test("content full of control characters is rejected even without a NUL byte", async () => {
  const ingestion = new IngestionService(stubStore)
  const noisy = 'a'.repeat(100) + String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 11, 14, 15).repeat(10)
  await assert.rejects(
    () => ingestion.ingest([{ source: 'weird.bin', content: noisy }]),
    /binary file/i,
  )
})

test("the app's own memory files cannot be ingested as documents", async () => {
  const ingestion = new IngestionService(stubStore)
  for (const source of [
    'global_memory.json',
    'memory_core.sqlite',
    'vector-store.sqlite',
    'C:\\Users\\Someone\\Xufruz Memory\\global_memory.json',
    '/home/someone/memory/vector-store.json',
  ]) {
    await assert.rejects(
      () => ingestion.ingest([{ source, content: 'plain readable text content here' }]),
      /own memory files/i,
      `expected ${source} to be rejected`,
    )
  }
})

test('ordinary text documents are still accepted', async () => {
  let upserted = 0
  const store = { upsert: async (records: unknown[]) => { upserted = records.length } } as unknown as ConstructorParameters<typeof IngestionService>[0]
  const ingestion = new IngestionService(store)
  // Embedding requires Ollama; if it isn't reachable the call throws, which
  // still proves the content passed validation rather than being rejected.
  await ingestion
    .ingest([{ source: 'notes.md', content: 'Sebuah catatan biasa tentang pipa sepanjang 60 km.' }])
    .then(() => assert.ok(upserted > 0, 'valid text should produce chunks'))
    .catch((error: Error) => {
      assert.doesNotMatch(error.message, /binary file|own memory files/i, 'valid text must not be rejected by the guards')
    })
})
