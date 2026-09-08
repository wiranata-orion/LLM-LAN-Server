import { Router } from 'express'
import express from 'express'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { config } from './config.js'
import { IngestionService } from './ingestion.js'
import type { MemoryCore } from './memory-core.js'
import { AgentOrchestrator } from './orchestrator.js'
import { ping } from './ollama.js'
import type { ChatMessage } from './types.js'

const documentSchema = z.object({
  id: z.string().optional(),
  source: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
})

const chatSchema = z.object({
  model: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  stream: z.boolean().optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
  })).min(1),
})

export function createRouter(ingestion: IngestionService, orchestrator: AgentOrchestrator, memory: MemoryCore): Router {
  const router = Router()

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
      const result = await ingestion.ingest(body.documents)
      response.status(201).json({ ok: true, ...result })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Invalid ingestion request' })
    }
  })

  router.post('/chat', async (request, response) => {
    try {
      const body = chatSchema.parse(request.body)

      if (body.stream) {
        response.status(200)
        response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.flushHeaders()

        const result = await orchestrator.runStream(
          body.messages as ChatMessage[],
          body.model,
          body.conversationId || 'default',
          (content) => response.write(`${JSON.stringify({ type: 'token', content })}\n`),
        )
        response.write(`${JSON.stringify({ type: 'meta', toolRounds: result.toolRounds, retrievedChunks: result.retrievedChunks })}\n`)
        response.write(`${JSON.stringify({ type: 'done' })}\n`)
        response.end()
        return
      }

      const result = await orchestrator.run(body.messages as ChatMessage[], body.model, body.conversationId || 'default')
      response.json({
        ok: true,
        message: result.message,
        toolRounds: result.toolRounds,
        retrievedChunks: result.retrievedChunks,
      })
    } catch (error) {
      response.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Agent request failed' })
    }
  })

  router.get('/memory/export', async (_request, response) => {
    const exportPath = path.join(config.memoryRoot, `memory-export-${Date.now()}.jsonl`)
    try {
      await memory.exportJsonl(exportPath)
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
      const imported = await memory.importJsonl(importPath)
      response.status(201).json({ ok: true, imported })
    } catch (error) {
      response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Memory import failed' })
    } finally {
      await rm(importPath, { force: true })
    }
  })

  return router
}
