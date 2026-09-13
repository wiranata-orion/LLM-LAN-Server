import { Router } from 'express'
import { z } from 'zod'
import { clearWorkspaceRoot, config, getWorkspaceRootInfo } from '../config.js'
import { chatStream } from '../ollama.js'
import { getWorkspaceManager } from '../services/workspace-indexer.js'
import { buildWorkspaceContext } from '../services/workspace-rag.js'
import type { WorkspaceChatMessage } from '../services/workspace-store.js'
import type { ChatMessage } from '../types.js'

const openSchema = z.object({
  path: z.string().min(1),
})

const applyChangesSchema = z.object({
  filePath: z.string().min(1),
  newContent: z.string(),
  /**
   * Optimistic concurrency: the content the client believed the file held.
   * When it no longer matches, the file changed underneath the suggestion
   * (another edit, a git pull) and blindly overwriting would silently
   * discard that work - so the write is refused instead.
   */
  expectedContent: z.string().optional(),
})

const chatOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  num_ctx: z.number().int().positive().optional(),
  num_predict: z.number().int().optional(),
})

const workspaceChatSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  targetPath: z.string().optional(),
  ollamaBaseUrl: z.string().url().optional(),
  options: chatOptionsSchema.optional(),
  history: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
  })).optional(),
})

const saveChatSessionSchema = z.object({
  title: z.string(),
  // Stored as-is (role + content + whatever extra fields the client tracks,
  // e.g. contextBlocks) - this is a save slot for the UI's own message list,
  // not something the server interprets.
  messages: z.array(z.record(z.unknown())),
})

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Vibe Coding endpoints: opening a project, browsing and reading its files,
 * asking the model about them with real code context, and writing accepted
 * changes back to disk.
 */
export function createWorkspaceRouter(): Router {
  const router = Router()
  const manager = getWorkspaceManager()

  // ===== Project lifecycle =====

  router.get('/status', (_request, response) => {
    response.json({ ok: true, ...manager.getStatus(), ...getWorkspaceRootInfo() })
  })

  router.post('/open', async (request, response) => {
    try {
      const body = openSchema.parse(request.body)
      const status = await manager.open(body.path)
      response.json({ ok: true, ...status })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membuka workspace') })
    }
  })

  router.post('/close', async (_request, response) => {
    try {
      await manager.close()
      clearWorkspaceRoot()
      response.json({ ok: true, ...manager.getStatus() })
    } catch (error) {
      response.status(500).json({ ok: false, error: errorMessage(error, 'Gagal menutup workspace') })
    }
  })

  router.post('/reindex', async (_request, response) => {
    try {
      const status = await manager.reindex()
      response.json({ ok: true, ...status })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal mengindeks ulang') })
    }
  })

  // ===== Browsing =====

  router.get('/tree', (request, response) => {
    try {
      const relPath = typeof request.query.path === 'string' ? request.query.path : ''
      response.json({ ok: true, path: relPath, entries: manager.listTree(relPath) })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membaca folder') })
    }
  })

  /** Flat path list backing the "@" autocomplete in the chat input. */
  router.get('/files', (_request, response) => {
    try {
      response.json({ ok: true, files: manager.listIndexableFiles() })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membaca daftar file') })
    }
  })

  router.get('/file', async (request, response) => {
    try {
      const relPath = typeof request.query.path === 'string' ? request.query.path : ''
      if (!relPath) throw new Error('Parameter "path" wajib diisi')
      response.json({ ok: true, ...await manager.readWorkspaceFile(relPath) })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membaca file') })
    }
  })

  // ===== Writing =====

  router.post('/apply-changes', async (request, response) => {
    try {
      const body = applyChangesSchema.parse(request.body)

      if (body.expectedContent !== undefined) {
        const current = await manager.readWorkspaceFile(body.filePath).catch(() => null)
        const currentContent = current?.content ?? null
        if (currentContent !== null && currentContent !== body.expectedContent) {
          response.status(409).json({
            ok: false,
            conflict: true,
            error: 'File sudah berubah sejak saran ini dibuat. Muat ulang file lalu minta AI membuat ulang perubahannya.',
          })
          return
        }
      }

      const result = await manager.applyChanges(body.filePath, body.newContent)
      response.json({
        ok: true,
        filePath: result.relPath,
        created: result.created,
        bytesWritten: result.bytesWritten,
        backupPath: result.backupPath,
      })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal menulis file') })
    }
  })

  // ===== AI Coding Assistant chat sessions (saved per project) =====

  router.get('/chats', (_request, response) => {
    try {
      response.json({ ok: true, chats: manager.listChatSessions() })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membaca riwayat chat') })
    }
  })

  router.get('/chats/:id', (request, response) => {
    try {
      const chat = manager.getChatSession(request.params.id)
      if (!chat) {
        response.status(404).json({ ok: false, error: 'Chat tidak ditemukan' })
        return
      }
      response.json({ ok: true, chat })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membaca chat') })
    }
  })

  router.put('/chats/:id', (request, response) => {
    try {
      const body = saveChatSessionSchema.parse(request.body)
      const summary = manager.saveChatSession({
        id: request.params.id,
        title: body.title,
        messages: body.messages as unknown as WorkspaceChatMessage[],
      })
      response.json({ ok: true, chat: summary })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal menyimpan chat') })
    }
  })

  router.delete('/chats/:id', (request, response) => {
    try {
      const deleted = manager.deleteChatSession(request.params.id)
      response.json({ ok: true, deleted })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal menghapus chat') })
    }
  })

  // ===== Prompt inspection =====

  /** Returns the exact prompt a question would produce, without running the model. */
  router.post('/context-preview', async (request, response) => {
    try {
      const body = workspaceChatSchema.parse(request.body)
      const context = await buildWorkspaceContext(body.prompt, body.targetPath)
      response.json({
        ok: true,
        blocks: context.blocks,
        promptPreview: context.promptPreview,
        usedCharacters: context.usedCharacters,
        budgetCharacters: context.budgetCharacters,
        budgetExceeded: context.budgetExceeded,
      })
    } catch (error) {
      response.status(400).json({ ok: false, error: errorMessage(error, 'Gagal membangun context') })
    }
  })

  // ===== Chat =====

  /**
   * Streaming ndjson, same wire format as the conversation endpoint so the
   * web-ui can reuse its reader. Deliberately does NOT write to conversation
   * memory: code Q&A would otherwise flood long-term memory with snippets
   * that are meaningless once the file changes.
   */
  router.post('/chat', async (request, response) => {
    const upstreamAbort = new AbortController()
    response.on('close', () => {
      if (!response.writableEnded) upstreamAbort.abort()
    })

    try {
      const body = workspaceChatSchema.parse(request.body)
      if (!manager.getStatus().isOpen) throw new Error('Belum ada workspace yang dibuka')

      response.status(200)
      response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache, no-transform')
      response.setHeader('Connection', 'keep-alive')
      response.flushHeaders()

      const write = (payload: Record<string, unknown>) => {
        if (response.writableEnded) return
        response.write(`${JSON.stringify(payload)}\n`)
      }

      write({ type: 'context-start' })
      const context = await buildWorkspaceContext(body.prompt, body.targetPath, {
        history: body.history as ChatMessage[] | undefined,
      })
      write({
        type: 'context',
        blocks: context.blocks,
        usedCharacters: context.usedCharacters,
        budgetCharacters: context.budgetCharacters,
        budgetExceeded: context.budgetExceeded,
      })

      try {
        await chatStream(
          context.messages,
          [],
          body.model || config.chatModel,
          (content) => write({ type: 'token', content }),
          body.options,
          body.ollamaBaseUrl,
          upstreamAbort.signal,
        )
        write({ type: 'done' })
        response.end()
      } catch (error) {
        if (response.writableEnded || upstreamAbort.signal.aborted) return
        write({ type: 'error', content: errorMessage(error, 'Permintaan ke model gagal') })
        write({ type: 'done' })
        response.end()
      }
    } catch (error) {
      if (response.writableEnded || upstreamAbort.signal.aborted) return
      if (response.headersSent) {
        response.write(`${JSON.stringify({ type: 'error', content: errorMessage(error, 'Workspace chat gagal') })}\n`)
        response.write(`${JSON.stringify({ type: 'done' })}\n`)
        response.end()
        return
      }
      response.status(400).json({ ok: false, error: errorMessage(error, 'Workspace chat gagal') })
    }
  })

  return router
}
