import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { browseDirectory } from './fs-browser.js'

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'agent-fs-browser-'))
}

test('listing top-level roots never throws and includes a Home shortcut', () => {
  const result = browseDirectory()
  assert.ok(Array.isArray(result.directories))
  assert.ok(result.shortcuts.some((s) => s.name === 'Home'))
})

test('listing a folder only returns subdirectories, not files, and skips dotfolders', () => {
  const dir = tempDir()
  try {
    mkdirSync(path.join(dir, 'subfolder'))
    mkdirSync(path.join(dir, '.hidden'))
    writeFileSync(path.join(dir, 'a-file.txt'), 'content', 'utf8')

    const result = browseDirectory(dir)
    assert.deepEqual(result.directories.map((entry) => entry.name), ['subfolder'])
    assert.equal(result.currentPath, path.normalize(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parentPath points one level up, and entries are sorted case-insensitively', () => {
  const dir = tempDir()
  try {
    mkdirSync(path.join(dir, 'Beta'))
    mkdirSync(path.join(dir, 'alpha'))

    const result = browseDirectory(dir)
    assert.deepEqual(result.directories.map((entry) => entry.name), ['alpha', 'Beta'])
    assert.equal(result.parentPath, path.dirname(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('browsing a non-existent path raises a clear error instead of crashing', () => {
  const bogusPath = path.join(os.tmpdir(), 'this-folder-does-not-exist-12345')
  assert.throws(() => browseDirectory(bogusPath))
})
