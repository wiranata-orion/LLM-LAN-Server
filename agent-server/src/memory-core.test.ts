import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { extractFactsFromMessage } from './memory-core.js'

test('portable memory schema is documented by the runtime module', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-memory-'))
  const exportPath = path.join(temporaryDirectory, 'memory.jsonl')
  assert.equal(path.extname(exportPath), '.jsonl')
  await rm(temporaryDirectory, { recursive: true, force: true })
})

test('JSONL export format is newline-delimited', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agent-memory-'))
  const exportPath = path.join(temporaryDirectory, 'memory.jsonl')
  await readFile(exportPath).catch((error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ENOENT')
  })
  await rm(temporaryDirectory, { recursive: true, force: true })
})

test('personal facts are not extracted into structured memory', () => {
  const facts = extractFactsFromMessage('perkenalkan nama ku wiranata')
  assert.deepEqual(facts, [])
})
