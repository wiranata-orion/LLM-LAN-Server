import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { chunkCode } from './workspace-chunker.js'
import { WorkspaceFilter, isIndexableExtension, looksBinary } from './workspace-ignore.js'
import { parsePromptReferences } from './workspace-rag.js'
import { WorkspaceStore } from './workspace-store.js'

function makeTempWorkspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vibe-test-'))
  for (const [relPath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relPath)
    mkdirSync(path.dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, content, 'utf8')
  }
  return root
}

// ===== Chunker =====

test('chunkCode splits at function boundaries and labels each chunk', () => {
  // Bodies are padded so two of them exceed the size cap: the split must land
  // on the declaration boundary, not mid-function. (chunkCode floors maxChars
  // at 500, so a smaller cap here would be silently raised.)
  const body = (name: string) => [
    `export function ${name}() {`,
    ...Array.from({ length: 6 }, (_, index) => `  const ${name}Step${index} = compute(${index}, "${name}-padding-value")`),
    `  return ${name}Step0`,
    '}',
  ].join('\n')

  const source = `import fs from "fs"\n\n${body('alpha')}\n\n${body('beta')}`
  const chunks = chunkCode(source, { maxLines: 160, maxChars: 500 })

  assert.ok(chunks.length >= 2, `expected a split between the two functions, got ${chunks.length} chunk(s)`)
  const symbols = chunks.map((chunk) => chunk.symbol)
  assert.ok(symbols.includes('alpha'), `expected an "alpha" chunk, got ${JSON.stringify(symbols)}`)
  assert.ok(symbols.includes('beta'), `expected a "beta" chunk, got ${JSON.stringify(symbols)}`)
  // A boundary split must never cut a function in half.
  const betaChunk = chunks.find((chunk) => chunk.symbol === 'beta')
  assert.ok(betaChunk?.content.startsWith('export function beta()'))
  assert.ok(betaChunk?.content.trimEnd().endsWith('}'))
})

test('chunkCode packs small declarations together instead of emitting tiny chunks', () => {
  const source = Array.from({ length: 8 }, (_, index) => `export const helper${index} = () => ${index}`).join('\n')
  const chunks = chunkCode(source, { maxLines: 160, maxChars: 6000 })
  assert.equal(chunks.length, 1, 'eight one-line helpers should pack into a single chunk')
  assert.equal(chunks[0].startLine, 1)
  assert.equal(chunks[0].endLine, 8)
})

test('chunkCode hard-splits a block with no boundaries so nothing exceeds the cap', () => {
  const source = Array.from({ length: 500 }, (_, index) => `  data[${index}] = ${index}`).join('\n')
  const chunks = chunkCode(source, { maxLines: 50, maxChars: 6000 })
  assert.ok(chunks.length >= 10)
  for (const chunk of chunks) {
    assert.ok(chunk.endLine - chunk.startLine + 1 <= 50, 'no chunk may exceed the line cap')
  }
})

test('chunkCode reports 1-based inclusive line ranges', () => {
  const chunks = chunkCode('line one\nline two\nline three', { maxLines: 160, maxChars: 6000 })
  assert.equal(chunks[0].startLine, 1)
  assert.equal(chunks[0].endLine, 3)
})

test('chunkCode returns nothing for whitespace-only input', () => {
  assert.deepEqual(chunkCode('   \n\n  \n', { maxLines: 160, maxChars: 6000 }), [])
})

test('chunkCode splits a Vue single-file component at its block tags', () => {
  const source = [
    '<script setup>',
    'const value = 1',
    '</script>',
    '',
    '<template>',
    '  <div>{{ value }}</div>',
    '</template>',
  ].join('\n')
  const chunks = chunkCode(source, { maxLines: 10, maxChars: 40 })
  const symbols = chunks.map((chunk) => chunk.symbol)
  assert.ok(symbols.includes('script') || symbols.includes('template'))
})

// ===== Ignore filter =====

test('WorkspaceFilter blocks dependency, build and secret paths by default', () => {
  const root = makeTempWorkspace()
  try {
    const filter = WorkspaceFilter.load(root)
    assert.equal(filter.isIgnored('node_modules', true), true)
    assert.equal(filter.isIgnored('node_modules/vue/index.js', false), true)
    assert.equal(filter.isIgnored('.git/config', false), true)
    assert.equal(filter.isIgnored('dist/app.js', false), true)
    assert.equal(filter.isIgnored('build', true), true)
    assert.equal(filter.isIgnored('vendor/autoload.php', false), true)
    assert.equal(filter.isIgnored('.env', false), true)
    assert.equal(filter.isIgnored('.env.production', false), true)
    assert.equal(filter.isIgnored('package-lock.json', false), true)
    assert.equal(filter.isIgnored('src/app.ts', false), false)
    assert.equal(filter.isIgnored('src/components/Button.vue', false), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('WorkspaceFilter honours .vibeignore, including "!" un-ignore', () => {
  const root = makeTempWorkspace({
    '.vibeignore': ['# project rules', 'secret/', '*.generated.ts', '!dist/keep-me.js'].join('\n'),
  })
  try {
    const filter = WorkspaceFilter.load(root)
    assert.equal(filter.isIgnored('secret/keys.ts', false), true)
    assert.equal(filter.isIgnored('src/types.generated.ts', false), true)
    assert.equal(filter.isIgnored('src/types.ts', false), false)
    // A project rule can re-include something a built-in rule excluded.
    assert.equal(filter.isIgnored('dist/keep-me.js', false), false)
    assert.equal(filter.isIgnored('dist/other.js', false), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('isIndexableExtension accepts source and docs, rejects binaries', () => {
  for (const good of ['a.ts', 'a.js', 'a.py', 'a.php', 'a.vue', 'a.html', 'a.css', 'a.json', 'a.md', 'Dockerfile']) {
    assert.equal(isIndexableExtension(good), true, `${good} should be indexable`)
  }
  for (const bad of ['a.png', 'a.jpg', 'a.zip', 'a.exe', 'a.sqlite', 'a.woff2', 'a.mp4']) {
    assert.equal(isIndexableExtension(bad), false, `${bad} should not be indexable`)
  }
})

test('looksBinary catches NUL bytes that slipped past the extension check', () => {
  assert.equal(looksBinary('export const a = 1'), false)
  assert.equal(looksBinary('PK\u0000\u0000binary'), true)
})

// ===== Prompt reference parsing =====

test('parsePromptReferences separates explicit files from @workspace', () => {
  assert.deepEqual(
    parsePromptReferences('@src/routes.ts tolong tambahkan endpoint'),
    { explicitPaths: ['src/routes.ts'], wantsWorkspaceSearch: false },
  )
  assert.deepEqual(
    parsePromptReferences('@workspace di mana auth ditangani?'),
    { explicitPaths: [], wantsWorkspaceSearch: true },
  )
  const both = parsePromptReferences('bandingkan @src/a.ts dan @src/b.ts')
  assert.deepEqual(both.explicitPaths, ['src/a.ts', 'src/b.ts'])
})

test('parsePromptReferences ignores plain @mentions that are not paths', () => {
  assert.deepEqual(parsePromptReferences('hei @budi lihat ini'), { explicitPaths: [], wantsWorkspaceSearch: false })
})

// ===== Store =====

test('WorkspaceStore ranks by cosine similarity and survives a delete', () => {
  const root = makeTempWorkspace()
  const databasePath = path.join(root, 'index.sqlite')
  const store = new WorkspaceStore(databasePath)
  try {
    const workspace = 'C:/project'
    store.replaceFileChunks(workspace, {
      relPath: 'src/auth.ts', size: 10, mtimeMs: 1, contentHash: 'a', chunkCount: 1,
    }, [{
      id: 'auth:0', relPath: 'src/auth.ts', chunkIndex: 0, startLine: 1, endLine: 5,
      symbol: 'login', content: 'login code', embedding: [1, 0, 0],
    }])
    store.replaceFileChunks(workspace, {
      relPath: 'src/ui.ts', size: 10, mtimeMs: 1, contentHash: 'b', chunkCount: 1,
    }, [{
      id: 'ui:0', relPath: 'src/ui.ts', chunkIndex: 0, startLine: 1, endLine: 5,
      symbol: 'render', content: 'render code', embedding: [0, 1, 0],
    }])

    assert.equal(store.countChunks(workspace), 2)

    const hits = store.search(workspace, [1, 0, 0], 5, 0.1)
    assert.equal(hits[0].relPath, 'src/auth.ts')
    assert.ok(hits[0].score > 0.99, 'an identical vector should score ~1')
    assert.equal(hits[0].symbol, 'login')

    // The exclude set is what keeps a fully-inlined file out of search results.
    const excluded = store.search(workspace, [1, 0, 0], 5, 0.1, new Set(['src/auth.ts']))
    assert.ok(!excluded.some((hit) => hit.relPath === 'src/auth.ts'))

    store.removeFile(workspace, 'src/auth.ts')
    assert.equal(store.countChunks(workspace), 1)
    assert.equal(store.search(workspace, [1, 0, 0], 5, 0.1).some((hit) => hit.relPath === 'src/auth.ts'), false)
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('WorkspaceStore keeps two projects apart', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    for (const workspace of ['C:/one', 'C:/two']) {
      store.replaceFileChunks(workspace, {
        relPath: 'a.ts', size: 1, mtimeMs: 1, contentHash: workspace, chunkCount: 1,
      }, [{
        id: `${workspace}:a:0`, relPath: 'a.ts', chunkIndex: 0, startLine: 1, endLine: 1,
        symbol: null, content: workspace, embedding: [1, 0],
      }])
    }
    assert.equal(store.countChunks('C:/one'), 1)
    assert.equal(store.search('C:/one', [1, 0], 5, 0)[0].content, 'C:/one')

    store.clearWorkspace('C:/one')
    assert.equal(store.countChunks('C:/one'), 0)
    assert.equal(store.countChunks('C:/two'), 1, 'clearing one project must not touch the other')
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('WorkspaceStore.pruneMissingFiles drops files deleted while the server was down', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    const workspace = 'C:/project'
    for (const relPath of ['kept.ts', 'gone.ts']) {
      store.replaceFileChunks(workspace, { relPath, size: 1, mtimeMs: 1, contentHash: relPath, chunkCount: 1 }, [{
        id: `${relPath}:0`, relPath, chunkIndex: 0, startLine: 1, endLine: 1,
        symbol: null, content: relPath, embedding: [1, 0],
      }])
    }
    const removed = store.pruneMissingFiles(workspace, new Set(['kept.ts']))
    assert.equal(removed, 1)
    assert.equal(store.countChunks(workspace), 1)
    assert.deepEqual([...store.getIndexedFiles(workspace).keys()], ['kept.ts'])
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ===== Retrieval scoring =====
// These lock in the two corrections made after measuring real embeddings:
// nomic-embed-text scores Indonesian-query/English-code pairs so low and so
// flatly that an absolute cutoff cannot separate relevant from irrelevant.

test('WorkspaceStore gates results relative to the best hit, not an absolute score', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    const workspace = 'C:/project'
    const add = (relPath: string, embedding: number[]) => {
      store.replaceFileChunks(workspace, { relPath, size: 1, mtimeMs: 1, contentHash: relPath, chunkCount: 1 }, [{
        id: `${relPath}:0`, relPath, chunkIndex: 0, startLine: 1, endLine: 1,
        symbol: null, content: relPath, embedding,
      }])
    }
    add('strong.ts', [1, 0, 0])       // ~1.00 against the query
    add('close.ts', [0.95, 0.31, 0])  // ~0.95 - comparably good, should ride along
    add('weak.ts', [0.4, 0.92, 0])    // ~0.40 - far behind the leader, should drop

    const query = [1, 0, 0]
    // Without relative gating a low floor lets everything through.
    assert.equal(store.search(workspace, query, 10, 0.2).length, 3)

    // With it, only chunks within 82% of the top score survive.
    const gated = store.search(workspace, query, 10, 0.2, undefined, { relativeRatio: 0.82 })
    assert.deepEqual(gated.map((hit) => hit.relPath), ['strong.ts', 'close.ts'])
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('WorkspaceStore relative gating always keeps the single best match', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    const workspace = 'C:/project'
    store.replaceFileChunks(workspace, { relPath: 'only.ts', size: 1, mtimeMs: 1, contentHash: 'x', chunkCount: 1 }, [{
      id: 'only:0', relPath: 'only.ts', chunkIndex: 0, startLine: 1, endLine: 1,
      symbol: null, content: 'code', embedding: [0.3, 0.95, 0],
    }])
    // A weak-but-best match (the Indonesian-prompt case) must still come back
    // rather than the search returning nothing at all.
    const hits = store.search(workspace, [1, 0, 0], 5, 0.25, undefined, { relativeRatio: 0.82 })
    assert.equal(hits.length, 1)
    assert.equal(hits[0].relPath, 'only.ts')
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('WorkspaceStore blends keyword overlap so identifiers beat vector-only noise', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    const workspace = 'C:/project'
    // Identical embeddings: only the keyword blend can separate these, which is
    // what rescues a query naming a real function across a language gap.
    store.replaceFileChunks(workspace, { relPath: 'cart.ts', size: 1, mtimeMs: 1, contentHash: 'a', chunkCount: 1 }, [{
      id: 'cart:0', relPath: 'cart.ts', chunkIndex: 0, startLine: 1, endLine: 9,
      symbol: 'calculateCartTotal', content: 'export function calculateCartTotal(items) { return 0 }', embedding: [1, 0],
    }])
    store.replaceFileChunks(workspace, { relPath: 'logger.ts', size: 1, mtimeMs: 1, contentHash: 'b', chunkCount: 1 }, [{
      id: 'logger:0', relPath: 'logger.ts', chunkIndex: 0, startLine: 1, endLine: 9,
      symbol: 'writeLog', content: 'export function writeLog(line) { return line }', embedding: [1, 0],
    }])

    const hits = store.search(workspace, [1, 0], 5, 0, undefined, { queryText: 'calculate cart total' })
    assert.equal(hits[0].relPath, 'cart.ts', 'the chunk naming the function must rank first')
    assert.ok(hits[0].score > hits[1].score)
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('WorkspaceStore keyword blending splits camelCase and paths', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    const workspace = 'C:/project'
    store.replaceFileChunks(workspace, { relPath: 'src/auth/session.ts', size: 1, mtimeMs: 1, contentHash: 'a', chunkCount: 1 }, [{
      id: 'a:0', relPath: 'src/auth/session.ts', chunkIndex: 0, startLine: 1, endLine: 3,
      symbol: 'createSessionToken', content: 'export function createSessionToken() {}', embedding: [1, 0],
    }])
    store.replaceFileChunks(workspace, { relPath: 'src/ui/button.ts', size: 1, mtimeMs: 1, contentHash: 'b', chunkCount: 1 }, [{
      id: 'b:0', relPath: 'src/ui/button.ts', chunkIndex: 0, startLine: 1, endLine: 3,
      symbol: 'renderButton', content: 'export function renderButton() {}', embedding: [1, 0],
    }])

    // "session token" only matches once camelCase is split; "auth" only via the path.
    assert.equal(store.search(workspace, [1, 0], 5, 0, undefined, { queryText: 'session token' })[0].relPath, 'src/auth/session.ts')
    assert.equal(store.search(workspace, [1, 0], 5, 0, undefined, { queryText: 'auth' })[0].relPath, 'src/auth/session.ts')
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})

// ===== Chat sessions =====

test('WorkspaceStore saves, lists, reads and deletes chat sessions, scoped per project', () => {
  const root = makeTempWorkspace()
  const store = new WorkspaceStore(path.join(root, 'index.sqlite'))
  try {
    const projectA = 'C:/project-a'
    const projectB = 'C:/project-b'

    const saved = store.saveChat(projectA, {
      id: 'chat-1',
      title: 'Refactor auth',
      messages: [{ role: 'user', content: 'kenapa login gagal?' }, { role: 'assistant', content: 'coba cek token' }],
    })
    assert.equal(saved.id, 'chat-1')
    assert.equal(saved.messageCount, 2)
    assert.ok(saved.createdAt)

    // A chat saved under a different project must not show up here.
    store.saveChat(projectB, { id: 'chat-2', title: 'Unrelated', messages: [{ role: 'user', content: 'x' }] })

    const listA = store.listChats(projectA)
    assert.equal(listA.length, 1)
    assert.equal(listA[0].title, 'Refactor auth')
    assert.equal(listA[0].messageCount, 2)

    const fetched = store.getChat(projectA, 'chat-1')
    assert.ok(fetched)
    assert.deepEqual(fetched.messages, [
      { role: 'user', content: 'kenapa login gagal?' },
      { role: 'assistant', content: 'coba cek token' },
    ])

    // Re-saving keeps the original createdAt but bumps updatedAt.
    const resaved = store.saveChat(projectA, { id: 'chat-1', title: 'Refactor auth (v2)', messages: [{ role: 'user', content: 'x' }] })
    assert.equal(resaved.createdAt, saved.createdAt)
    assert.equal(store.getChat(projectA, 'chat-1')?.title, 'Refactor auth (v2)')

    assert.equal(store.deleteChat(projectA, 'chat-1'), true)
    assert.equal(store.getChat(projectA, 'chat-1'), null)
    assert.equal(store.deleteChat(projectA, 'does-not-exist'), false)

    // The other project's chat must be untouched by all of this.
    assert.equal(store.listChats(projectB).length, 1)
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
})
