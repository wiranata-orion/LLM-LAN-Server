import { Router } from 'express'
import express from 'express'
import { rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AppContext } from './app-context.js'
import * as chatHistory from './chat-history-store.js'
import {
  clearChatHistoryRoot,
  config,
  getChatHistoryRootInfo,
  getMemoryRootInfo,
  resetMemoryRootToDefault,
  setActiveOllamaBaseUrl,
  setChatHistoryRoot,
  setMemoryRoot,
} from './config.js'
import { browseDirectory } from './fs-browser.js'
import { deleteModel, listRunningModels, ping, pullModel, supportsTools, supportsVision } from './ollama.js'
import { createWorkspaceRouter } from './routes/workspace.js'
import type { ChatMessage } from './types.js'

const performanceQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
})

const runningModelsQuerySchema = z.object({
  ollamaBaseUrl: z.string().url().optional(),
})

const pullModelSchema = z.object({
  model: z.string().min(1),
  ollamaBaseUrl: z.string().url().optional(),
})

const deleteModelQuerySchema = z.object({
  model: z.string().min(1),
  ollamaBaseUrl: z.string().url().optional(),
})

const supportsToolsQuerySchema = z.object({
  model: z.string().min(1),
  ollamaBaseUrl: z.string().url().optional(),
})

const supportsVisionQuerySchema = z.object({
  model: z.string().min(1),
  ollamaBaseUrl: z.string().url().optional(),
})

const documentSchema = z.object({
  id: z.string().optional(),
  source: z.string().min(1),
  content: z.string().min(1),
  // 'base64' means `content` is a base64-encoded binary file (PDF/DOCX/XLSX -
  // see file-extract.ts) that still needs text extraction before it can be
  // chunked/embedded. Defaults to 'utf8' for plain-text documents, unchanged
  // from before this field existed.
  encoding: z.enum(['utf8', 'base64']).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
})

const chatOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  num_ctx: z.number().int().positive().optional(),
  num_predict: z.number().int().optional(),
})

const chatSchema = z.object({
  model: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  stream: z.boolean().optional(),
  // Lets the client (web-ui) route inference to whichever Ollama instance is
  // currently active (Laptop vs PC Server) instead of the agent-server's own fixed default.
  ollamaBaseUrl: z.string().url().optional(),
  options: chatOptionsSchema.optional(),
  // Settings > Parameter AI > "Enable RAG / Context Retrieval". Defaults to on
  // so older clients that never send this field keep today's behavior.
  useContextRetrieval: z.boolean().optional(),
  // Settings > Parameter AI > "Instruksi Tambahan / Persona" - appended after
  // the base agentInstruction (see orchestrator.ts), not a replacement for
  // it, so the identity/safety rules there always still apply.
  customInstructions: z.string().max(4000).optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    // Base64-encoded images (no data: URI prefix) for vision models - see ChatMessage.images.
    images: z.array(z.string()).optional(),
  })).min(1),
})

const healthQuerySchema = z.object({
  // Optional: also probe reachability of whichever Ollama instance is
  // currently active (Laptop vs PC Server), reported as non-blocking extra
  // info - see the /health handler for why this never fails the request.
  ollamaBaseUrl: z.string().url().optional(),
})

const activeEngineSchema = z.object({
  ollamaBaseUrl: z.string().url(),
})

const storagePathSchema = z.object({
  path: z.string().min(1),
})

const conversationSaveSchema = z.object({
  title: z.string().optional(),
  folderId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  messages: z.array(z.record(z.unknown())),
  embedding: z.array(z.number()).nullable().optional(),
})

const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable().default(null),
  isExpanded: z.boolean().default(true),
  createdAt: z.string(),
})

const globalMemorySchema = z.object({
  permanent_instructions: z.array(z.string()).optional(),
  interactions: z.array(z.record(z.unknown())).optional(),
})

export function createRouter(context: AppContext): Router {
  const router = Router()

  // Vibe Coding workspace (file index, code RAG, apply-changes) - see
  // routes/workspace.ts. Mounted as a sub-router because it owns its own
  // project-scoped state rather than the shared memory/vector services.
  router.use('/workspace', createWorkspaceRouter())

  // "ok" here means the agent-server (and its SQLite-backed long-term memory)
  // is reachable - that storage never depends on Ollama, so this must stay
  // true regardless of whether Ollama is installed, slow, or mid-generation
  // on a busy PC Server. The web-ui's "Ingatan" badge is driven by this ok
  // flag alone. Ollama reachability is reported separately, best-effort, with
  // a short timeout - it's diagnostic info, not a reason to fail this check
  // (a slow/unreachable engine over LAN must not flicker "Ingatan" off while
  // it's mid-reply, which a fully-blocking ping here previously did).
  router.get('/health', async (request, response) => {
    const parsedQuery = healthQuerySchema.safeParse(request.query)
    let ollama: { ok: boolean; version?: string; error?: string } = { ok: false, error: 'Invalid ollamaBaseUrl' }
    if (parsedQuery.success) {
      try {
        const result = await ping(parsedQuery.data.ollamaBaseUrl, AbortSignal.timeout(4000))
        ollama = { ok: true, version: result.version }
      } catch (error) {
        ollama = { ok: false, error: error instanceof Error ? error.message : 'Ollama unavailable' }
      }
    }
    response.json({ ok: true, ollama })
  })

  // Performance Dashboard (see web-ui's PerformanceDashboard.vue) - history of
  // past turns' timing breakdown, persisted by orchestrator.ts via
  // performance-store.ts. Purely diagnostic, so a failure here never means the
  // dashboard can't show anything else (running models / server status still
  // work independently).
  router.get('/performance/history', (request, response) => {
    try {
      const query = performanceQuerySchema.parse(request.query)
      response.json({ ok: true, history: context.current.performanceStore.listRecent(query.limit ?? 50) })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to load performance history' })
    }
  })

  // What's actually resident in VRAM right now on the given engine (Ollama's
  // own GET /api/ps) - the direct way to see whether the chat model and
  // embedding model are coexisting or evicting each other, instead of
  // inferring it indirectly from how long a turn took.
  router.get('/performance/running-models', async (request, response) => {
    try {
      const query = runningModelsQuerySchema.parse(request.query)
      const models = await listRunningModels(query.ollamaBaseUrl, AbortSignal.timeout(10_000))
      response.json({ ok: true, models })
    } catch (error) {
      response.status(200).json({ ok: false, models: [], error: error instanceof Error ? error.message : 'Failed to list running models' })
    }
  })

  // ===== Model Management (pull / delete) =====
  // Installed models WITH sizes are already available to the web-ui directly
  // from Ollama's own GET /api/tags (see getModels() in api.js) - no need to
  // duplicate that here. Only the two mutating operations go through the
  // agent-server, to reuse its timeout/keep-alive/error-handling plumbing
  // (see ollama.ts) for what can be a very long-running download.
  router.post('/models/pull', async (request, response) => {
    const upstreamAbort = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) upstreamAbort.abort()
    })
    try {
      const body = pullModelSchema.parse(request.body)
      response.status(200)
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('Connection', 'keep-alive')
      response.flushHeaders()
      try {
        await pullModel(
          body.model,
          (progress) => {
            if (response.writableEnded) return
            response.write(`${JSON.stringify(progress)}\n`)
          },
          body.ollamaBaseUrl,
          upstreamAbort.signal,
        )
        response.write(`${JSON.stringify({ status: 'done' })}\n`)
        response.end()
      } catch (error) {
        if (response.writableEnded || upstreamAbort.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Gagal mengunduh model'
        response.write(`${JSON.stringify({ status: 'error', error: message })}\n`)
        response.end()
      }
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid pull request' })
    }
  })

  router.delete('/models', async (request, response) => {
    try {
      const query = deleteModelQuerySchema.parse(request.query)
      await deleteModel(query.model, query.ollamaBaseUrl)
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Gagal menghapus model' })
    }
  })

  // Whether a given model declares Ollama's "tools" capability - lets the
  // web-ui show this per model (see ModelManager.vue) instead of tool support
  // only ever showing up as a silent fallback deep in a chat request. Modeled
  // on /performance/running-models: a 200 with ok:false rather than a hard
  // error, since "can't tell yet" (engine unreachable) is a display state,
  // not a request failure.
  router.get('/models/supports-tools', async (request, response) => {
    try {
      const query = supportsToolsQuerySchema.parse(request.query)
      const supported = await supportsTools(query.model, query.ollamaBaseUrl || config.ollamaBaseUrl)
      response.json({ ok: true, supported })
    } catch (error) {
      response.status(200).json({ ok: false, supported: false, error: error instanceof Error ? error.message : 'Failed to check tool support' })
    }
  })

  // Whether a given model declares Ollama's "vision" capability - lets the
  // web-ui show/hide the image-attach button in the composer per model
  // (see ChatInput.vue), instead of the user only discovering it doesn't
  // support images after Ollama rejects the request. Same shape/behavior as
  // /models/supports-tools above.
  router.get('/models/supports-vision', async (request, response) => {
    try {
      const query = supportsVisionQuerySchema.parse(request.query)
      const supported = await supportsVision(query.model, query.ollamaBaseUrl || config.ollamaBaseUrl)
      response.json({ ok: true, supported })
    } catch (error) {
      response.status(200).json({ ok: false, supported: false, error: error instanceof Error ? error.message : 'Failed to check vision support' })
    }
  })

  // Lets the web-ui push whichever engine (Laptop / PC Server) it currently
  // has active as the agent-server's own default Ollama target - see
  // setActiveOllamaBaseUrl in config.ts for why this exists in addition to
  // /chat's own per-request ollamaBaseUrl: background embedding work (Vibe
  // Coding's file-watcher re-indexing, in particular) has no HTTP request to
  // carry a per-request override on, so it can only ever follow this shared
  // default. The web-ui calls this on load and on every engine switch.
  router.post('/engine/active', (request, response) => {
    try {
      const body = activeEngineSchema.parse(request.body)
      response.json({ ok: true, ...setActiveOllamaBaseUrl(body.ollamaBaseUrl) })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid ollamaBaseUrl' })
    }
  })

  router.post('/ingest', async (request, response) => {
    try {
      const body = z.object({ documents: z.array(documentSchema).min(1) }).parse(request.body)
      const result = await context.current.ingestion.ingest(body.documents)
      response.status(201).json({ ok: true, ...result })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid ingestion request' })
    }
  })

  // What is actually in the RAG store and feeding "Retrieved local context".
  // Without this there was no way to see - let alone remove - a document that
  // shouldn't have been ingested.
  router.get('/documents', async (_request, response) => {
    try {
      response.json({ ok: true, documents: await context.current.store.listDocumentSources() })
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to list documents' })
    }
  })

  router.delete('/documents/:source', async (request, response) => {
    try {
      const removed = await context.current.store.deleteBySource(request.params.source)
      response.json({ ok: true, removed })
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to delete document' })
    }
  })

  router.post('/chat', async (request, response) => {
    // Cancels the actual upstream Ollama request the moment the client
    // disconnects (e.g. the Stop button), instead of leaving Ollama to keep
    // generating the whole reply in the background for a response nobody is
    // reading anymore - see ollama.ts / orchestrator.ts for the rest of the
    // signal plumbing. Declared before the try block so the catch clause can
    // always reference it, even if request parsing itself fails.
    const upstreamAbort = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) upstreamAbort.abort()
    })

    try {
      const body = chatSchema.parse(request.body)
      const { orchestrator } = context.current

      if (body.stream) {
        response.status(200)
        response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders()

        try {
          const result = await orchestrator.runStream(
            body.messages as ChatMessage[],
            body.model,
            body.conversationId || 'default',
            (content) => response.write(`${JSON.stringify({ type: 'token', content })}\n`),
            body.options,
            body.ollamaBaseUrl,
            upstreamAbort.signal,
            // Lets the client show a live "Membaca ingatan..." / "Menulis
            // ingatan..." indicator instead of the memory subsystem being a
            // silent black box - see MemoryIndicator.vue on the web-ui side.
            (event) => {
              if (response.writableEnded) return
              response.write(`${JSON.stringify({ type: 'memory', phase: event.phase, status: event.status, detail: event.detail })}\n`)
            },
            body.useContextRetrieval,
            body.customInstructions,
          )
          response.write(`${JSON.stringify({ type: 'meta', toolRounds: result.toolRounds, retrievedChunks: result.retrievedChunks, memoryId: result.memoryId, performance: result.performance })}\n`)
          response.write(`${JSON.stringify({ type: 'done' })}\n`)
          response.end()
          return
        } catch (error) {
          // The client is already gone (that's what triggered the abort) - there
          // is nothing left to write to, and trying would just throw again.
          if (response.writableEnded || upstreamAbort.signal.aborted) return
          const message = error instanceof Error ? error.message : 'Agent request failed'
          response.write(`${JSON.stringify({ type: 'error', content: message })}\n`)
          response.write(`${JSON.stringify({ type: 'done' })}\n`)
          response.end()
          return
        }
      }

      const result = await orchestrator.run(
        body.messages as ChatMessage[],
        body.model,
        body.conversationId || 'default',
        body.options,
        body.ollamaBaseUrl,
        upstreamAbort.signal,
        undefined,
        body.useContextRetrieval,
        body.customInstructions,
      )
      response.json({
        ok: true,
        message: result.message,
        toolRounds: result.toolRounds,
        retrievedChunks: result.retrievedChunks,
        memoryId: result.memoryId,
        performance: result.performance,
      })
    } catch (error) {
      if (response.writableEnded || upstreamAbort.signal.aborted) return
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Agent request failed' })
    }
  })

  // Yes/No feedback on a specific past reply (see MessageBubble.vue). Persisted
  // into that memory record's metadata so future retrieval of this exchange
  // carries the feedback into the model's context - see orchestrator.ts.
  router.post('/memory/messages/:id/rating', async (request, response) => {
    try {
      const body = z.object({ rating: z.enum(['good', 'bad']).nullable() }).parse(request.body)
      const found = await context.current.memory.rateMessage(request.params.id, body.rating)
      if (!found) {
        response.status(404).json({ ok: false, error: 'Message not found in memory' })
        return
      }
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to save rating' })
    }
  })

  router.get('/memory/layers', async (request, response) => {
    try {
      const sessionId = String(request.query.sessionId || 'default')
      response.json(await context.current.memory.getLayerSnapshot(sessionId))
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Memory layer snapshot failed' })
    }
  })

  router.get('/memory/export', async (_request, response) => {
    const exportPath = path.join(config.memoryRoot, `memory-export-${Date.now()}.jsonl`)
    try {
      await context.current.memory.exportJsonl(exportPath)
      response.download(exportPath, 'memory.jsonl', async (error) => {
        await rm(exportPath, { force: true })
        if (error && !response.headersSent) response.status(500).json({ ok: false, error: error.message })
      })
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Memory export failed' })
    }
  })

  router.post('/memory/import', express.text({ type: ['application/x-ndjson', 'application/jsonl', 'text/plain'], limit: '100mb' }), async (request, response) => {
    const importPath = path.join(config.memoryRoot, `memory-import-${Date.now()}.jsonl`)
    try {
      if (typeof request.body !== 'string' || !request.body.trim()) throw new Error('Expected JSONL memory content')
      await writeFile(importPath, request.body, 'utf8')
      const imported = await context.current.memory.importJsonl(importPath)
      response.status(201).json({ ok: true, imported })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Memory import failed' })
    } finally {
      await rm(importPath, { force: true })
    }
  })

  // Where memory (conversation history + vector store) is currently stored on
  // this server, so the UI can show/change it (see Settings > Memory).
  router.get('/memory/storage', (_request, response) => {
    response.json({ ok: true, ...getMemoryRootInfo() })
  })

  router.post('/memory/storage', (request, response) => {
    try {
      const body = storagePathSchema.parse(request.body)
      const result = setMemoryRoot(body.path)
      context.reinitialize()
      response.json({ ok: true, ...result, ...getMemoryRootInfo() })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid storage path' })
    }
  })

  router.post('/memory/storage/reset', (_request, response) => {
    try {
      const result = resetMemoryRootToDefault()
      context.reinitialize()
      response.json({ ok: true, ...result, ...getMemoryRootInfo() })
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to reset storage path' })
    }
  })

  // Disk usage of the SQLite files that grow over time (Settings > Penyimpanan)
  // - most relevant when memoryRoot sits inside a synced folder (OneDrive,
  // Dropbox, etc.), where an ever-growing WAL file means an ever-busy sync
  // client. `exists: false` for a store that hasn't written anything yet is
  // normal, not an error.
  router.get('/storage/usage', async (_request, response) => {
    const targets = [
      { key: 'memory', label: 'Memori & Riwayat Chat', path: config.memoryDbPath },
      { key: 'vectors', label: 'Vector Store (RAG/Embedding)', path: config.vectorStorePath.replace(/\.json$/i, '.sqlite') },
      { key: 'performance', label: 'Riwayat Performa', path: config.performanceDbPath },
    ]
    const usage = await Promise.all(targets.map(async (target) => {
      try {
        const info = await stat(target.path)
        return { key: target.key, label: target.label, path: target.path, bytes: info.size, exists: true }
      } catch {
        return { key: target.key, label: target.label, path: target.path, bytes: 0, exists: false }
      }
    }))
    response.json({ ok: true, usage, memoryRoot: config.memoryRoot })
  })

  // Reclaims space SQLite leaves behind after deletes/updates (WAL churn,
  // cleared ratings, the performance store's 30-day prune, etc.) - the file
  // shrinking on disk is the whole point for someone worried about OneDrive
  // sync load, so this runs synchronously and only responds once it's done.
  router.post('/storage/vacuum', (_request, response) => {
    try {
      context.current.memory.vacuum()
      context.current.store.vacuum()
      context.current.performanceStore.vacuum()
      response.json({ ok: true })
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to vacuum storage' })
    }
  })

  // Read-only folder browser so the UI can offer a "Pilih Folder" button for the
  // memory location, the same way the browser's native picker works for the
  // chat-history folder. The browser's File System Access API never exposes a
  // real absolute path, so this has to be a small server-side directory listing.
  router.get('/memory/browse', (request, response) => {
    try {
      const requestedPath = typeof request.query.path === 'string' ? request.query.path : undefined
      const result = browseDirectory(requestedPath)
      response.json({ ok: true, ...result })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to browse folder' })
    }
  })

  // ===== Chat history storage (Settings > Memory > "Folder Penyimpanan Fisik") =====
  // Server-mediated so it can reuse the same folder-browsing UI/endpoint as the
  // memory location above - the browser's native folder picker can't hand a real
  // path to a separate process, so this cannot be done purely client-side.
  router.get('/chat-history/storage', (_request, response) => {
    response.json({ ok: true, ...getChatHistoryRootInfo() })
  })

  router.post('/chat-history/storage', (request, response) => {
    try {
      const body = storagePathSchema.parse(request.body)
      const result = setChatHistoryRoot(body.path)
      response.json({ ok: true, ...result, ...getChatHistoryRootInfo() })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid storage path' })
    }
  })

  router.post('/chat-history/storage/reset', (_request, response) => {
    const result = clearChatHistoryRoot()
    response.json({ ok: true, ...result, ...getChatHistoryRootInfo() })
  })

  router.get('/chat-history/conversations', async (_request, response) => {
    try {
      response.json({ ok: true, conversations: await chatHistory.listConversations() })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to list conversations' })
    }
  })

  router.put('/chat-history/conversations/:id', async (request, response) => {
    try {
      const body = conversationSaveSchema.parse(request.body)
      await chatHistory.saveConversation({ conversationId: request.params.id, ...body })
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to save conversation' })
    }
  })

  router.delete('/chat-history/conversations/:id', async (request, response) => {
    try {
      const deleted = await chatHistory.deleteConversation(request.params.id)
      response.json({ ok: true, deleted })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to delete conversation' })
    }
  })

  router.get('/chat-history/folders', async (_request, response) => {
    try {
      response.json({ ok: true, folders: await chatHistory.listFolders() })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to list folders' })
    }
  })

  router.put('/chat-history/folders', async (request, response) => {
    try {
      const body = z.object({ folders: z.array(folderSchema) }).parse(request.body)
      await chatHistory.saveFolders(body.folders)
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to save folders' })
    }
  })

  router.get('/chat-history/global-memory', async (_request, response) => {
    try {
      response.json({ ok: true, memory: await chatHistory.readGlobalMemory() })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to read global memory' })
    }
  })

  router.put('/chat-history/global-memory', async (request, response) => {
    try {
      const body = globalMemorySchema.parse(request.body)
      await chatHistory.saveGlobalMemory(body)
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to save global memory' })
    }
  })

  return router
}
