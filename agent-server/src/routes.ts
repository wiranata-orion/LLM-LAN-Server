import { Router } from 'express'
import express from 'express'
import { rm, writeFile } from 'node:fs/promises'
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
  setChatHistoryRoot,
  setMemoryRoot,
} from './config.js'
import { browseDirectory } from './fs-browser.js'
import { ping } from './ollama.js'
import { createWorkspaceRouter } from './routes/workspace.js'
import type { ChatMessage } from './types.js'

const documentSchema = z.object({
  id: z.string().optional(),
  source: z.string().min(1),
  content: z.string().min(1),
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
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
  })).min(1),
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

  router.get('/health', async (_request, response) => {
    try {
      const ollama = await ping()
      response.json({ ok: true, ollama })
    } catch (error) {
      response.status(503).json({ ok: false, error: error instanceof Error ? error.message : 'Ollama unavailable' })
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
          )
          response.write(`${JSON.stringify({ type: 'meta', toolRounds: result.toolRounds, retrievedChunks: result.retrievedChunks, memoryId: result.memoryId })}\n`)
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
      )
      response.json({
        ok: true,
        message: result.message,
        toolRounds: result.toolRounds,
        retrievedChunks: result.retrievedChunks,
        memoryId: result.memoryId,
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
