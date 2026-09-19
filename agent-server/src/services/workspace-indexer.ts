import chokidar, { type FSWatcher } from 'chokidar'
import crypto from 'node:crypto'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  config,
  getWorkspaceBackupRoot,
  getWorkspaceIndexPath,
  setWorkspaceRoot,
} from '../config.js'
import { decodeFileBuffer } from '../encoding.js'
import { embed } from '../ollama.js'
import { chunkCode, describeChunk } from './workspace-chunker.js'
import { WorkspaceFilter, isIndexableExtension, looksBinary } from './workspace-ignore.js'
import {
  WorkspaceStore,
  type WorkspaceChunkInput,
  type WorkspaceChatMessage,
  type WorkspaceChatSummary,
  type WorkspaceChatSession,
} from './workspace-store.js'
import type {
  WorkspaceChunkMatch,
  WorkspaceStatus,
  WorkspaceTreeEntry,
} from '../types.js'

export interface ApplyChangesResult {
  relPath: string
  absolutePath: string
  created: boolean
  bytesWritten: number
  backupPath: string | null
  previousContent: string | null
}

export interface WorkspaceFileContent {
  relPath: string
  content: string
  size: number
  lines: number
  indexable: boolean
  truncated: boolean
}

/** Directories are hidden from the tree entirely when ignored, so this stays cheap. */
const TREE_ENTRY_LIMIT = 500

function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

function toPosix(relPath: string): string {
  return relPath.split(path.sep).join('/')
}

/**
 * Owns one open project: its file index, its watcher, and every filesystem
 * operation Vibe Coding is allowed to perform on it. A single instance is
 * shared process-wide (see `getWorkspaceManager`) because the watcher and the
 * index are both per-project, not per-request.
 */
export class WorkspaceManager {
  private store: WorkspaceStore | null = null
  private storePath: string | null = null
  private filter: WorkspaceFilter | null = null
  private watcher: FSWatcher | null = null
  private root: string | null = null

  private state: WorkspaceStatus['state'] = 'empty'
  private totalFiles = 0
  private indexedFiles = 0
  private currentFile: string | null = null
  private lastIndexedAt: string | null = null
  private error: string | null = null

  /** Bumped on every open/close/reindex so in-flight indexing work can abandon itself. */
  private generation = 0
  /** Serialises watcher-driven re-indexing so two rapid saves can't interleave. */
  private pendingWatchWork: Promise<void> = Promise.resolve()

  // ===== Lifecycle =====

  /** Reopens whatever project was open when the server last ran. */
  async restorePersisted(): Promise<void> {
    if (!config.workspaceRoot) return
    if (!existsSync(config.workspaceRoot)) {
      console.warn(`Saved workspace folder no longer exists: ${config.workspaceRoot}`)
      return
    }
    try {
      await this.open(config.workspaceRoot, { persist: false })
    } catch (error) {
      console.warn('Could not restore the saved workspace:', error)
    }
  }

  /**
   * Points the workspace at `workspaceRoot`, then indexes and watches it.
   * Indexing runs in the background: a large project takes minutes to embed and
   * the UI needs the file tree immediately, so this resolves as soon as the
   * scan is planned rather than when every chunk is stored.
   */
  async open(workspaceRoot: string, { persist = true }: { persist?: boolean } = {}): Promise<WorkspaceStatus> {
    const resolved = path.resolve(workspaceRoot)
    if (!existsSync(resolved)) throw new Error(`Folder tidak ditemukan: ${resolved}`)
    if (!statSync(resolved).isDirectory()) throw new Error(`Bukan folder: ${resolved}`)

    await this.stopWatching()
    this.generation += 1

    this.root = resolved
    this.filter = WorkspaceFilter.load(resolved)
    this.ensureStore()
    if (persist) setWorkspaceRoot(resolved)

    this.error = null
    this.currentFile = null
    this.indexedFiles = 0
    this.totalFiles = 0

    void this.runFullIndex(this.generation)
    this.startWatching()
    return this.getStatus()
  }

  /** Stops watching and forgets the open project, leaving its index on disk for next time. */
  async close(): Promise<void> {
    this.generation += 1
    await this.stopWatching()
    // Release the SQLite handle too. On Windows an open connection keeps a lock
    // on the file, which would stop the user from moving or deleting the memory
    // folder (Settings > Memory) while the app is still running.
    if (this.store) {
      try {
        this.store.close()
      } catch (error) {
        console.warn('Could not close workspace index database:', error)
      }
      this.store = null
      this.storePath = null
    }
    this.root = null
    this.filter = null
    this.state = 'empty'
    this.totalFiles = 0
    this.indexedFiles = 0
    this.currentFile = null
    this.error = null
  }

  /** Throws the index away and rebuilds it - for when chunking rules or the embed model change. */
  async reindex(): Promise<WorkspaceStatus> {
    const root = this.requireRoot()
    this.generation += 1
    this.filter = WorkspaceFilter.load(root)
    this.ensureStore().clearWorkspace(root)
    this.indexedFiles = 0
    this.error = null
    void this.runFullIndex(this.generation)
    return this.getStatus()
  }

  private ensureStore(): WorkspaceStore {
    const wantedPath = getWorkspaceIndexPath()
    // The memory root can be repointed at runtime (Settings > Memory), which
    // moves the index file with it.
    if (this.store && this.storePath !== wantedPath) {
      this.store.close()
      this.store = null
    }
    if (!this.store) {
      this.store = new WorkspaceStore(wantedPath)
      this.storePath = wantedPath
    }
    return this.store
  }

  private requireRoot(): string {
    if (!this.root) throw new Error('Belum ada workspace yang dibuka')
    return this.root
  }

  private requireFilter(): WorkspaceFilter {
    if (!this.filter) throw new Error('Belum ada workspace yang dibuka')
    return this.filter
  }

  // ===== Status =====

  getStatus(): WorkspaceStatus {
    const chunkCount = this.root && this.store ? this.store.countChunks(this.root) : 0
    return {
      workspaceRoot: this.root,
      isOpen: this.root !== null,
      state: this.state,
      totalFiles: this.totalFiles,
      indexedFiles: this.indexedFiles,
      chunkCount,
      currentFile: this.currentFile,
      watching: this.watcher !== null,
      lastIndexedAt: this.lastIndexedAt,
      error: this.error,
    }
  }

  // ===== Scanning & indexing =====

  /** Every indexable file in the project, relative to the root, ignore rules applied. */
  listIndexableFiles(): string[] {
    const root = this.requireRoot()
    const filter = this.requireFilter()
    const found: string[] = []

    const walk = (absoluteDir: string, relativeDir: string) => {
      let entries: import('node:fs').Dirent[]
      try {
        entries = readdirSync(absoluteDir, { withFileTypes: true })
      } catch {
        return // unreadable directory (permissions, a vanished junction) - skip it
      }
      for (const entry of entries) {
        const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (filter.isIgnored(relPath, true)) continue
          walk(path.join(absoluteDir, entry.name), relPath)
          continue
        }
        if (!entry.isFile()) continue
        if (filter.isIgnored(relPath, false)) continue
        if (!isIndexableExtension(relPath)) continue
        let size = 0
        try {
          size = statSync(path.join(absoluteDir, entry.name)).size
        } catch {
          continue
        }
        if (size > config.workspaceMaxFileBytes) continue
        found.push(relPath)
      }
    }

    walk(root, '')
    return found.sort()
  }

  private async runFullIndex(generation: number): Promise<void> {
    const root = this.root
    if (!root) return

    this.state = 'indexing'
    let files: string[] = []
    try {
      files = this.listIndexableFiles()
    } catch (error) {
      this.state = 'error'
      this.error = error instanceof Error ? error.message : String(error)
      return
    }

    if (generation !== this.generation) return
    this.totalFiles = files.length
    this.indexedFiles = 0

    const store = this.ensureStore()
    // Files deleted while the server was down would otherwise linger in the index.
    store.pruneMissingFiles(root, new Set(files))

    const known = store.getIndexedFiles(root)
    let failures = 0
    let succeeded = 0

    const queue = [...files]
    const worker = async () => {
      while (queue.length) {
        if (generation !== this.generation) return
        const relPath = queue.shift()
        if (!relPath) return
        this.currentFile = relPath
        try {
          const changed = await this.indexFile(root, relPath, known.get(relPath))
          if (changed !== 'failed') succeeded += 1
        } catch (error) {
          failures += 1
          this.error = error instanceof Error ? error.message : String(error)
        }
        this.indexedFiles += 1
      }
    }

    const workerCount = Math.max(1, Math.min(config.workspaceIndexConcurrency, files.length || 1))
    await Promise.all(Array.from({ length: workerCount }, worker))

    if (generation !== this.generation) return
    this.currentFile = null
    this.lastIndexedAt = new Date().toISOString()
    // A handful of unreadable files shouldn't present as a broken workspace;
    // only a total failure (typically Ollama being down) does.
    if (succeeded === 0 && failures > 0) {
      this.state = 'error'
      this.error = this.error || 'Semua file gagal diindeks'
    } else {
      this.state = 'ready'
      if (failures === 0) this.error = null
    }
  }

  /**
   * Embeds and stores one file, skipping the work entirely when its content
   * hash still matches what the index holds.
   */
  private async indexFile(
    root: string,
    relPath: string,
    known?: { size: number; mtimeMs: number; contentHash: string },
  ): Promise<'indexed' | 'skipped' | 'failed'> {
    const absolutePath = path.join(root, relPath)
    let fileStat: Awaited<ReturnType<typeof stat>>
    try {
      fileStat = await stat(absolutePath)
    } catch {
      this.ensureStore().removeFile(root, relPath)
      return 'skipped'
    }
    if (fileStat.size > config.workspaceMaxFileBytes) return 'skipped'

    // Cheap pre-check: same size and mtime almost always means same bytes, and
    // skipping here avoids reading the file at all.
    if (known && known.size === fileStat.size && known.mtimeMs === Math.floor(fileStat.mtimeMs)) {
      return 'skipped'
    }

    let content: string
    try {
      content = decodeFileBuffer(await readFile(absolutePath))
    } catch {
      return 'skipped'
    }
    if (looksBinary(content)) return 'skipped'

    const contentHash = hashContent(content)
    if (known && known.contentHash === contentHash) {
      // Touched but unchanged (a formatter rewrite, a git checkout): refresh the
      // stat fingerprint so the cheap check hits next time, but don't re-embed.
      this.ensureStore().touchFile(root, relPath, fileStat.size, Math.floor(fileStat.mtimeMs), contentHash)
      return 'skipped'
    }

    const chunks = chunkCode(content, {
      maxLines: config.workspaceChunkMaxLines,
      maxChars: config.workspaceChunkMaxChars,
    })
    if (!chunks.length) {
      this.ensureStore().removeFile(root, relPath)
      return 'skipped'
    }

    const prepared: WorkspaceChunkInput[] = []
    for (const chunk of chunks) {
      const embedding = await embed(describeChunk(relPath, chunk))
      prepared.push({
        id: `${hashContent(`${root}:${relPath}`)}:${chunk.chunkIndex}`,
        relPath,
        chunkIndex: chunk.chunkIndex,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbol: chunk.symbol,
        content: chunk.content,
        embedding,
      })
    }

    this.ensureStore().replaceFileChunks(root, {
      relPath,
      size: fileStat.size,
      mtimeMs: Math.floor(fileStat.mtimeMs),
      contentHash,
      chunkCount: prepared.length,
    }, prepared)
    return 'indexed'
  }

  // ===== Watching =====

  private startWatching(): void {
    const root = this.requireRoot()
    const filter = this.requireFilter()

    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      // An editor writing a file in place fires several events; wait for the
      // bytes to settle so we never embed a half-written file.
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      ignorePermissionErrors: true,
      ignored: (testPath: string) => {
        if (testPath === root) return false
        const relPath = path.relative(root, testPath)
        if (!relPath || relPath.startsWith('..')) return false
        // stat() here would cost one syscall per event; treating an
        // extension-less path as a directory is the safe guess, since files
        // without a known extension are dropped by the indexer anyway.
        const isDirectory = path.extname(testPath) === ''
        return filter.isIgnored(relPath, isDirectory)
      },
    })

    const enqueue = (work: () => Promise<void>) => {
      this.pendingWatchWork = this.pendingWatchWork.then(work).catch((error) => {
        console.warn('Workspace watch update failed:', error)
      })
    }

    this.watcher
      .on('add', (absolutePath) => enqueue(() => this.handleFileChanged(absolutePath)))
      .on('change', (absolutePath) => enqueue(() => this.handleFileChanged(absolutePath)))
      .on('unlink', (absolutePath) => enqueue(() => this.handleFileRemoved(absolutePath)))
      .on('unlinkDir', (absolutePath) => enqueue(() => this.handleDirectoryRemoved(absolutePath)))
      .on('error', (error) => console.warn('Workspace watcher error:', error))
  }

  private async stopWatching(): Promise<void> {
    if (!this.watcher) return
    const watcher = this.watcher
    this.watcher = null
    try {
      await watcher.close()
    } catch (error) {
      console.warn('Could not close workspace watcher:', error)
    }
  }

  private async handleFileChanged(absolutePath: string): Promise<void> {
    const root = this.root
    if (!root) return
    const relPath = toPosix(path.relative(root, absolutePath))
    if (!relPath || relPath.startsWith('..')) return

    // Editing .vibeignore changes what belongs in the index, so rebuild.
    if (relPath === '.vibeignore') {
      this.filter = WorkspaceFilter.load(root)
      await this.reindex()
      return
    }

    if (!isIndexableExtension(relPath)) return
    if (this.requireFilter().isIgnored(relPath, false)) return

    const known = this.ensureStore().getIndexedFiles(root).get(relPath)
    try {
      await this.indexFile(root, relPath, known)
      this.lastIndexedAt = new Date().toISOString()
      if (this.state === 'empty') this.state = 'ready'
    } catch (error) {
      console.warn(`Re-indexing ${relPath} failed:`, error)
    }
  }

  private async handleFileRemoved(absolutePath: string): Promise<void> {
    const root = this.root
    if (!root) return
    const relPath = toPosix(path.relative(root, absolutePath))
    if (!relPath || relPath.startsWith('..')) return
    this.ensureStore().removeFile(root, relPath)
  }

  private async handleDirectoryRemoved(absolutePath: string): Promise<void> {
    const root = this.root
    if (!root) return
    const relPath = toPosix(path.relative(root, absolutePath))
    if (!relPath || relPath.startsWith('..')) return
    this.ensureStore().removeDirectory(root, relPath)
  }

  // ===== Retrieval =====

  search(
    queryEmbedding: number[],
    limit: number,
    minScore: number,
    excludeRelPaths?: Set<string>,
    options: { queryText?: string; relativeRatio?: number } = {},
  ): WorkspaceChunkMatch[] {
    const root = this.root
    if (!root || !this.store) return []
    return this.store.search(root, queryEmbedding, limit, minScore, excludeRelPaths, options)
  }

  // ===== AI Coding Assistant chat sessions =====

  listChatSessions(): WorkspaceChatSummary[] {
    const root = this.requireRoot()
    return this.ensureStore().listChats(root)
  }

  getChatSession(id: string): WorkspaceChatSession | null {
    const root = this.requireRoot()
    return this.ensureStore().getChat(root, id)
  }

  saveChatSession(input: { id: string; title: string; messages: WorkspaceChatMessage[] }): WorkspaceChatSummary {
    const root = this.requireRoot()
    return this.ensureStore().saveChat(root, input)
  }

  deleteChatSession(id: string): boolean {
    const root = this.requireRoot()
    return this.ensureStore().deleteChat(root, id)
  }

  // ===== Filesystem access (all of it path-guarded) =====

  /**
   * Resolves a client-supplied relative path to an absolute one that is
   * provably inside the workspace. Rejects traversal ("../"), absolute paths,
   * and symlinks pointing outside - this is the only thing standing between a
   * model-authored path and the rest of the disk.
   */
  resolveSafePath(relPath: string): string {
    const root = this.requireRoot()
    if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Path file tidak boleh kosong')

    const cleaned = relPath.replace(/^[\\/]+/, '').trim()
    if (path.isAbsolute(cleaned)) {
      // Accept an absolute path only when it is already inside the workspace.
      const normalizedAbsolute = path.resolve(cleaned)
      if (this.isInsideRoot(root, normalizedAbsolute)) return normalizedAbsolute
      throw new Error('Path di luar workspace tidak diizinkan')
    }

    const resolved = path.resolve(root, cleaned)
    if (!this.isInsideRoot(root, resolved)) throw new Error('Path di luar workspace tidak diizinkan')

    // Follow symlinks on the nearest existing ancestor: a link inside the
    // project pointing at C:\Windows would otherwise pass the string check.
    let probe = resolved
    while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe)
    try {
      const realProbe = realpathSync.native(probe)
      const realRoot = realpathSync.native(root)
      if (!this.isInsideRoot(realRoot, realProbe)) throw new Error('Path di luar workspace tidak diizinkan')
    } catch (error) {
      if (error instanceof Error && error.message.includes('di luar workspace')) throw error
      // realpath can fail on exotic filesystems; the string check above already passed.
    }
    return resolved
  }

  private isInsideRoot(root: string, candidate: string): boolean {
    const normalizedRoot = path.resolve(root)
    const relative = path.relative(normalizedRoot, path.resolve(candidate))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  /** One directory level, for the lazy-loading file tree. */
  listTree(relDirPath = ''): WorkspaceTreeEntry[] {
    const root = this.requireRoot()
    const filter = this.requireFilter()
    const absoluteDir = relDirPath ? this.resolveSafePath(relDirPath) : root

    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true })
    } catch (error) {
      throw new Error(`Tidak bisa membuka folder: ${error instanceof Error ? error.message : String(error)}`)
    }

    const result: WorkspaceTreeEntry[] = []
    for (const entry of entries) {
      const relPath = toPosix(relDirPath ? `${relDirPath}/${entry.name}` : entry.name)
      const isDirectory = entry.isDirectory()
      if (!isDirectory && !entry.isFile()) continue
      if (filter.isIgnored(relPath, isDirectory)) continue

      let size = 0
      if (!isDirectory) {
        try {
          size = statSync(path.join(absoluteDir, entry.name)).size
        } catch {
          continue
        }
      }
      result.push({
        name: entry.name,
        relPath,
        type: isDirectory ? 'directory' : 'file',
        size,
        indexable: isDirectory ? true : isIndexableExtension(relPath) && size <= config.workspaceMaxFileBytes,
      })
      if (result.length >= TREE_ENTRY_LIMIT) break
    }

    return result.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    })
  }

  async readWorkspaceFile(relPath: string): Promise<WorkspaceFileContent> {
    const absolutePath = this.resolveSafePath(relPath)
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile()) throw new Error('Bukan file')

    const maxBytes = config.workspaceMaxFileBytes
    const raw = decodeFileBuffer(await readFile(absolutePath))
    const truncated = fileStat.size > maxBytes
    const content = truncated ? raw.slice(0, maxBytes) : raw

    return {
      relPath: toPosix(relPath),
      content,
      size: fileStat.size,
      lines: content.split('\n').length,
      indexable: isIndexableExtension(relPath) && !truncated,
      truncated,
    }
  }

  /**
   * Overwrites (or creates) a file with model-authored content.
   *
   * Every write is backed up first, outside the project folder, so a bad
   * suggestion is always recoverable even when the project isn't under git.
   * The write itself goes to a temp file and is renamed into place, so a crash
   * mid-write can't leave a half-written source file behind.
   */
  async applyChanges(relPath: string, newContent: string): Promise<ApplyChangesResult> {
    const root = this.requireRoot()
    const absolutePath = this.resolveSafePath(relPath)
    const normalizedRel = toPosix(path.relative(root, absolutePath))

    if (this.requireFilter().isIgnored(normalizedRel, false)) {
      throw new Error(`"${normalizedRel}" ada di daftar abaikan (.vibeignore) dan tidak boleh ditulis`)
    }

    const exists = existsSync(absolutePath)
    let previousContent: string | null = null
    let backupPath: string | null = null

    if (exists) {
      const existingStat = await stat(absolutePath)
      if (!existingStat.isFile()) throw new Error(`"${normalizedRel}" bukan file`)
      previousContent = await readFile(absolutePath).then(decodeFileBuffer).catch(() => null)

      if (previousContent !== null) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        backupPath = path.join(getWorkspaceBackupRoot(), stamp, normalizedRel)
        await mkdir(path.dirname(backupPath), { recursive: true })
        await copyFile(absolutePath, backupPath)
      }
    }

    await mkdir(path.dirname(absolutePath), { recursive: true })
    const temporaryPath = `${absolutePath}.vibe-tmp-${process.pid}`
    try {
      await writeFile(temporaryPath, newContent, 'utf8')
      await rename(temporaryPath, absolutePath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }

    // The watcher will pick this up too, but doing it inline means the index is
    // already correct by the time the response reaches the UI.
    try {
      const known = this.ensureStore().getIndexedFiles(root).get(normalizedRel)
      await this.indexFile(root, normalizedRel, known)
    } catch (error) {
      console.warn(`Could not re-index ${normalizedRel} after applying changes:`, error)
    }

    return {
      relPath: normalizedRel,
      absolutePath,
      created: !exists,
      bytesWritten: Buffer.byteLength(newContent, 'utf8'),
      backupPath,
      previousContent,
    }
  }
}

let manager: WorkspaceManager | null = null

/** The process-wide workspace instance - the watcher and index are per-project, not per-request. */
export function getWorkspaceManager(): WorkspaceManager {
  if (!manager) manager = new WorkspaceManager()
  return manager
}
