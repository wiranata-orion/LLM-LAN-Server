import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { config } from './config.js'
import * as chatHistory from './chat-history-store.js'

function withTempRoot<T>(fn: () => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-chat-history-'))
  const previous = config.chatHistoryRoot
  config.chatHistoryRoot = dir
  return fn().finally(() => {
    config.chatHistoryRoot = previous
    rmSync(dir, { recursive: true, force: true })
  })
}

test('saveConversation creates a new file, then updates the same file on re-save', () => withTempRoot(async () => {
  await chatHistory.saveConversation({ conversationId: 'abc', title: 'Hello', messages: [{ role: 'user', content: 'hi' }] })
  const filesAfterFirst = readdirSync(path.join(config.chatHistoryRoot!, 'conversations'))
  assert.equal(filesAfterFirst.length, 1)

  await chatHistory.saveConversation({ conversationId: 'abc', title: 'Hello Updated', messages: [{ role: 'user', content: 'hi again' }] })
  const filesAfterSecond = readdirSync(path.join(config.chatHistoryRoot!, 'conversations'))
  assert.equal(filesAfterSecond.length, 1, 'updating an existing conversation must not create a second file')

  const [conversation] = await chatHistory.listConversations()
  assert.equal(conversation.title, 'Hello Updated')
  assert.equal(conversation.messages.length, 1)
}))

test('a normal save resets any cached embedding; an explicit embedding is persisted', () => withTempRoot(async () => {
  await chatHistory.saveConversation({ conversationId: 'x', messages: [{ role: 'user', content: 'a' }], embedding: [1, 2, 3] })
  let [conversation] = await chatHistory.listConversations()
  assert.deepEqual(conversation.embedding, [1, 2, 3])

  await chatHistory.saveConversation({ conversationId: 'x', messages: [{ role: 'user', content: 'a changed' }] })
  ;[conversation] = await chatHistory.listConversations()
  assert.equal(conversation.embedding, null, 'embedding must be invalidated once messages change without an explicit new embedding')
}))

test('deleteConversation removes only the matching file and reports whether one was found', () => withTempRoot(async () => {
  await chatHistory.saveConversation({ conversationId: 'keep', messages: [{ role: 'user', content: 'a' }] })
  await chatHistory.saveConversation({ conversationId: 'remove', messages: [{ role: 'user', content: 'b' }] })

  const deleted = await chatHistory.deleteConversation('remove')
  assert.equal(deleted, true)
  const remaining = await chatHistory.listConversations()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].conversationId, 'keep')

  const deletedAgain = await chatHistory.deleteConversation('remove')
  assert.equal(deletedAgain, false)
}))

test('folders round-trip through folders.json with sane defaults', () => withTempRoot(async () => {
  assert.deepEqual(await chatHistory.listFolders(), [])
  await chatHistory.saveFolders([{ id: 'f1', name: 'Work', parentId: null, isExpanded: true, createdAt: '2024-01-01' }])
  const folders = await chatHistory.listFolders()
  assert.equal(folders.length, 1)
  assert.equal(folders[0].name, 'Work')
}))

test('global memory defaults to empty and round-trips what is saved', () => withTempRoot(async () => {
  const initial = await chatHistory.readGlobalMemory()
  assert.deepEqual(initial.permanent_instructions, [])
  assert.deepEqual(initial.interactions, [])

  await chatHistory.saveGlobalMemory({ permanent_instructions: ['be concise'], interactions: [{ role: 'user', content: 'hi' }] })
  const updated = await chatHistory.readGlobalMemory()
  assert.deepEqual(updated.permanent_instructions, ['be concise'])
  assert.equal(updated.interactions.length, 1)
}))

test('operations throw a clear error when no chat history folder is configured', async () => {
  const previous = config.chatHistoryRoot
  config.chatHistoryRoot = null
  try {
    await assert.rejects(() => chatHistory.listConversations())
  } finally {
    config.chatHistoryRoot = previous
  }
})

test('saveConversation creates the root folder on disk if it does not exist yet', () => withTempRoot(async () => {
  const nestedRoot = path.join(config.chatHistoryRoot!, 'nested', 'deeper')
  config.chatHistoryRoot = nestedRoot
  await chatHistory.saveConversation({ conversationId: 'y', messages: [{ role: 'user', content: 'a' }] })
  assert.equal(existsSync(path.join(nestedRoot, 'conversations')), true)
}))
