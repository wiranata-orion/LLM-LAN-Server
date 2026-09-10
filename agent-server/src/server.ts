import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { IngestionService } from './ingestion.js'
import { AgentOrchestrator } from './orchestrator.js'
import { createRouter } from './routes.js'
import { Retriever } from './retriever.js'
import { JsonVectorStore } from './vector-store.js'
import { SqliteMemoryCore } from './memory-core.js'

const app = express()
const store = new JsonVectorStore()
const memory = new SqliteMemoryCore(store)
const ingestion = new IngestionService(store)
const retriever = new Retriever(store)
const orchestrator = new AgentOrchestrator(retriever, memory)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.corsOrigins.includes(origin) || config.corsOrigin === '*') {
      callback(null, true)
      return
    }
    callback(null, false)
  },
}))
app.use(express.json({ limit: '2mb' }))
app.use('/api', createRouter(ingestion, orchestrator, memory))
app.use((_request, response) => response.status(404).json({ ok: false, error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', error)
  response.status(500).json({ ok: false, error: 'Internal server error' })
})

app.listen(config.port, () => {
  console.log(`Agent server listening on http://127.0.0.1:${config.port}`)
  console.log(`Ollama endpoint: ${config.ollamaBaseUrl}`)
})
