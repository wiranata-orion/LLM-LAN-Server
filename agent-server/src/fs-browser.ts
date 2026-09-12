import { existsSync, readdirSync } from 'node:fs'
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

export function browseDirectory(requestedPath?: string): BrowseResult {
  const homeDir = os.homedir()
  const shortcuts: BrowseEntry[] = [{ name: 'Home', path: homeDir }]

  if (!requestedPath || !requestedPath.trim()) {
    if (isWindows()) {
      return { currentPath: null, parentPath: null, directories: listWindowsDrives(), shortcuts }
    }
    return { currentPath: '/', parentPath: null, directories: listSubdirectories('/'), shortcuts }
  }

  const resolved = path.normalize(requestedPath.trim())
  const directories = listSubdirectories(resolved)
  const parent = path.dirname(resolved)
  // On Windows, path.dirname("C:\\") is "C:\\" (can't go higher); treat that as "back to drive list".
  const atDriveRoot = isWindows() && /^[A-Za-z]:\\?$/.test(resolved)
  const parentPath = atDriveRoot ? null : (parent !== resolved ? parent : null)

  return { currentPath: resolved, parentPath, directories, shortcuts }
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
