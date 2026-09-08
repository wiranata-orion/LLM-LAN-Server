import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkText } from './chunker.js'

test('chunkText creates overlapping non-empty chunks', () => {
  const chunks = chunkText('First paragraph.\n\nSecond paragraph with more words.', 24, 5)
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every((chunk) => chunk.content.length > 0))
  assert.equal(chunks[0]?.index, 0)
})

test('chunkText rejects invalid overlap', () => {
  assert.throws(() => chunkText('content', 10, 10), /greater than overlap/)
})
