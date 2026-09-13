import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { browseDirectory, normalizeRequestedPath } from './fs-browser.js'

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
  assert.throws(() => browseDirectory(bogusPath), /tidak ditemukan/i)
})

// ===== Pasted paths =====
// The folder picker lets a path be typed or pasted instead of clicked to, so
// whatever the clipboard happens to hold has to survive the trip.

test('normalizeRequestedPath strips the quotes Windows "Copy as path" adds', () => {
  const quoted = `"${path.join(os.tmpdir(), 'some folder')}"`
  assert.equal(normalizeRequestedPath(quoted), path.join(os.tmpdir(), 'some folder'))
  assert.equal(normalizeRequestedPath("'/home/user/app'"), path.normalize('/home/user/app'))
})

test('normalizeRequestedPath trims whitespace and trailing separators', () => {
  const base = path.join(os.tmpdir(), 'projects')
  assert.equal(normalizeRequestedPath(`  ${base}  `), base)
  assert.equal(normalizeRequestedPath(`${base}${path.sep}`), base)
})

test('normalizeRequestedPath keeps a bare drive letter pointing at its root', () => {
  if (process.platform !== 'win32') return
  // "C:" alone means the current directory on C:, which is not what someone
  // pasting a drive letter means.
  assert.equal(normalizeRequestedPath('C:'), 'C:\\')
  assert.equal(normalizeRequestedPath('C:\\'), 'C:\\')
  assert.equal(normalizeRequestedPath('c:/'), 'c:\\')
})

test('normalizeRequestedPath accepts a file:// URL', () => {
  const decoded = normalizeRequestedPath('file:///C:/Users/test%20folder')
  assert.ok(decoded.includes('test folder'), `expected the %20 to decode, got ${decoded}`)
  assert.ok(!decoded.startsWith('file:'), 'the scheme should be gone')
})

test('browsing a pasted FILE path lands in the folder that contains it', () => {
  const dir = tempDir()
  try {
    mkdirSync(path.join(dir, 'sibling'))
    const filePath = path.join(dir, 'notes.txt')
    writeFileSync(filePath, 'content', 'utf8')

    const result = browseDirectory(filePath)
    assert.equal(result.currentPath, path.normalize(dir))
    assert.deepEqual(result.directories.map((entry) => entry.name), ['sibling'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('browsing accepts a quoted, trailing-separator path the same as a clean one', () => {
  const dir = tempDir()
  try {
    mkdirSync(path.join(dir, 'child'))
    const messy = `  "${dir}${path.sep}"  `
    assert.equal(browseDirectory(messy).currentPath, browseDirectory(dir).currentPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
