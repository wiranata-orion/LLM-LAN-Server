import cors from 'cors'
import express from 'express'
import { AppContext } from './app-context.js'
import { config } from './config.js'
import { createRouter } from './routes.js'
import { getWorkspaceManager } from './services/workspace-indexer.js'

const context = new AppContext()

const app = express()

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin) || config.corsOrigin === '*') {
      callback(null, true)
      return
    }
    callback(null, false)
  },
}))
// 2mb was fine for text-only chat, but a /chat request can now carry base64
// images (vision models - see ChatMessage.images) plus the full conversation
// history resent every turn, which adds up across several image messages in
// one conversation. This is a single-user local app behind CORS, not a public
// API, so a generous limit costs nothing meaningful in exchange.
app.use(express.json({ limit: '30mb' }))
app.use('/api', createRouter(context))
app.use((_request, response) => response.status(404).json({ ok: false, error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', error)
  response.status(500).json({ ok: false, error: 'Internal server error' })
})

app.listen(config.port, () => {
  console.log(`Agent server listening on http://127.0.0.1:${config.port}`)
  // Starting this server never itself starts/contacts Ollama - no request is
  // made until a chat, embed, or health check actually needs one. This is
  // just the boot default (OLLAMA_BASE_URL) and gets overwritten the moment
  // the web-ui loads and reports its active engine - see setActiveOllamaBaseUrl.
  console.log(`Ollama default (until web-ui syncs its active engine): ${config.ollamaBaseUrl}`)
  console.log(`Memory storage: ${config.memoryRoot}`)

  // Reopen (and re-watch) whichever project Vibe Coding had open last time, so
  // the workspace is warm instead of asking for the folder again on every boot.
  void getWorkspaceManager().restorePersisted().then(() => {
    const status = getWorkspaceManager().getStatus()
    if (status.workspaceRoot) console.log(`Workspace: ${status.workspaceRoot}`)
  })
})
