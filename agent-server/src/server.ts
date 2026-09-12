import cors from 'cors'
import express from 'express'
import { AppContext } from './app-context.js'
import { config } from './config.js'
import { createRouter } from './routes.js'

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
app.use(express.json({ limit: '2mb' }))
app.use('/api', createRouter(context))
app.use((_request, response) => response.status(404).json({ ok: false, error: 'Not found' }))
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', error)
  response.status(500).json({ ok: false, error: 'Internal server error' })
})

app.listen(config.port, () => {
  console.log(`Agent server listening on http://127.0.0.1:${config.port}`)
  console.log(`Ollama endpoint: ${config.ollamaBaseUrl}`)
  console.log(`Memory storage: ${config.memoryRoot}`)
})
