import { existsSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface BrowseEntry {
  name: string
  path: string
}

export interface BrowseResult {
  /** null when listing top-level roots (drives on Windows, "/" on POSIX). */
  currentPath: string | null
  parentPath: string | null
  directories: BrowseEntry[]
  shortcuts: BrowseEntry[]
}

/**
 * A minimal, read-only directory browser so the web-ui can offer a "Pilih
 * Folder" button for the agent-server's memory location, the same way the
 * browser's native folder picker works for the client-side chat history
 * folder. This has to live server-side: the browser's File System Access API
 * deliberately never exposes a real absolute path, only a sandboxed handle,
 * so there is no way to hand the Node process a path from that API.
 */
function listWindowsDrives(): BrowseEntry[] {
  const drives: BrowseEntry[] = []
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
    const letter = String.fromCharCode(code)
    const drivePath = `${letter}:\\`
    if (existsSync(drivePath)) drives.push({ name: drivePath, path: drivePath })
  }
  return drives
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Cleans up a hand-typed or pasted path before it is used.
 *
 * The clipboard rarely holds something `path.normalize` is happy with:
 * Windows Explorer's "Copy as path" wraps the whole thing in double quotes,
 * terminals and file managers add stray whitespace, and people paste paths
 * with a trailing separator. A drive root ("C:\\") keeps its separator,
 * because "C:" alone means "the current directory on C:", not the root.
 */
export function normalizeRequestedPath(rawPath: string): string {
  let value = rawPath.trim()
  // Surrounding single or double quotes, as added by "Copy as path".
  if (value.length >= 2 && /^["']/.test(value) && value.endsWith(value[0])) {
    value = value.slice(1, -1).trim()
  }
  // file:/// URLs, as produced by dragging from some file managers.
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(value.replace(/^file:\/\/\/?/i, ''))
      if (isWindows()) value = value.replace(/^\/+/, '')
    } catch {
      // Not a decodable URL - fall through and use it as typed.
    }
  }
  if (!value) return value

  // A bare drive letter is resolved before normalize() gets a chance to turn
  // "C:" into "C:." - on Windows "C:" means "the current directory on drive
  // C:", which is never what someone pasting a drive letter intends.
  if (isWindows() && /^[A-Za-z]:[\\/]?$/.test(value)) {
    return `${value.slice(0, 2)}\\`
  }

  const normalized = path.normalize(value)
  // Drop a trailing separator so "D:\projects\" and "D:\projects" behave alike.
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, '') : normalized
}

export function browseDirectory(requestedPath?: string): BrowseResult {
  const homeDir = os.homedir()
  const shortcuts: BrowseEntry[] = [{ name: 'Home', path: homeDir }]

  if (!requestedPath || !requestedPath.trim()) {
    if (isWindows()) {
      return { currentPath: null, parentPath: null, directories: listWindowsDrives(), shortcuts }
    }
    return { currentPath: '/', parentPath: null, directories: listSubdirectories('/'), shortcuts }
  }

  const resolved = normalizeRequestedPath(requestedPath)
  if (!existsSync(resolved)) {
    throw new Error(`Folder tidak ditemukan: ${resolved}`)
  }

  // Pasting a *file* path lands in the folder that contains it. Windows
  // Explorer's "Copy as path" on a file is a very common way to get a path
  // onto the clipboard, and erroring out on it would be needlessly strict.
  let target = resolved
  try {
    if (!statSync(resolved).isDirectory()) target = path.dirname(resolved)
  } catch {
    // Unreadable entry - let listSubdirectories below produce the real error.
  }

  const directories = listSubdirectories(target)
  const parent = path.dirname(target)
  // On Windows, path.dirname("C:\\") is "C:\\" (can't go higher); treat that as "back to drive list".
  const atDriveRoot = isWindows() && /^[A-Za-z]:\\?$/.test(target)
  const parentPath = atDriveRoot ? null : (parent !== target ? parent : null)

  return { currentPath: target, parentPath, directories, shortcuts }
}

function listSubdirectories(directoryPath: string): BrowseEntry[] {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Tidak bisa membuka folder: ${error instanceof Error ? error.message : String(error)}`)
  }

  const directories: BrowseEntry[] = []
  for (const entry of entries) {
    // Skip hidden/system-ish dotfolders to keep the list usable; junctions/symlinks
    // to directories are still shown since isDirectory() follows them.
    if (entry.name.startsWith('.')) continue
    let isDirectory = false
    try {
      isDirectory = entry.isDirectory()
    } catch {
      isDirectory = false
    }
    if (!isDirectory) continue
    directories.push({ name: entry.name, path: path.join(directoryPath, entry.name) })
  }
  return directories.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}
