import 'dotenv/config'
import path from 'node:path'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_CHAT_MODEL: z.string().min(1).default('llama3.2:latest'),
  OLLAMA_EMBED_MODEL: z.string().min(1).default('nomic-embed-text:latest'),
  MEMORY_ROOT: z.string().min(1).default('./data'),
  VECTOR_STORE_PATH: z.string().min(1).default('./data/vector-store.json'),
  MEMORY_DB_PATH: z.string().min(1).default('./data/memory_core.sqlite'),
  MAX_RETRIEVED_CHUNKS: z.coerce.number().int().positive().default(6),
  MEMORY_SUMMARY_THRESHOLD: z.coerce.number().int().positive().default(6),
  MEMORY_FACT_LIMIT: z.coerce.number().int().positive().default(20),
  RAG_MIN_SCORE: z.coerce.number().min(-1).max(1).default(0.18),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MAX_TOOL_ROUNDS: z.coerce.number().int().positive().default(5),
})

const parsed = envSchema.parse(process.env)
const root = process.cwd()

export const config = {
  port: parsed.PORT,
  ollamaBaseUrl: parsed.OLLAMA_BASE_URL.replace(/\/$/, ''),
  chatModel: parsed.OLLAMA_CHAT_MODEL,
  embedModel: parsed.OLLAMA_EMBED_MODEL,
  memoryRoot: path.resolve(root, parsed.MEMORY_ROOT),
  vectorStorePath: path.resolve(root, parsed.VECTOR_STORE_PATH),
  memoryDbPath: path.resolve(root, parsed.MEMORY_DB_PATH),
  maxRetrievedChunks: parsed.MAX_RETRIEVED_CHUNKS,
  memorySummaryThreshold: parsed.MEMORY_SUMMARY_THRESHOLD,
  memoryFactLimit: parsed.MEMORY_FACT_LIMIT,
  ragMinScore: parsed.RAG_MIN_SCORE,
  corsOrigin: parsed.CORS_ORIGIN,
  corsOrigins: parsed.CORS_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean),
  maxToolRounds: parsed.MAX_TOOL_ROUNDS,
} as const
