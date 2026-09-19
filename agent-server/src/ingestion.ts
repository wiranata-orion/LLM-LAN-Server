import { readFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import { chunkText } from './chunker.js'
import { decodeFileBuffer } from './encoding.js'
import { embed } from './ollama.js'
import { VectorStore } from './vector-store.js'
import type { DocumentInput, VectorRecord } from './types.js'

const REPLACEMENT_CHAR = 0xfffd
const BINARY_NOISE_RATIO = 0.05

/**
 * A binary file read as text (a .sqlite, .pdf, an image) decodes into NUL
 * bytes and replacement characters. Ingesting that produces chunks of pure
 * noise which still score high enough to be retrieved, so they get injected
 * into every prompt as "Retrieved local context" - crowding out the real
 * conversation and giving the model garbage to hallucinate from.
 */
function looksBinary(content: string): boolean {
  const sample = content.slice(0, 4000)
  if (!sample.length) return false

  let suspicious = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)
    if (code === 0) return true // a NUL byte is conclusive on its own
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13
    if (isControl || code === REPLACEMENT_CHAR) suspicious += 1
  }
  return suspicious / sample.length > BINARY_NOISE_RATIO
}

// The app's own storage files must never become RAG documents: feeding memory
// back in as a "document" duplicates it into every prompt and has the model
// citing its own stored JSON back at itself.
const INTERNAL_STORAGE_FILE = /(^|[\\/])(global_memory\.json|memory_core\.sqlite|vector-store\.(json|sqlite))(\.[^\\/]*)?$/i

export class IngestionService {
  constructor(private readonly store: VectorStore) {}

  async ingest(documents: DocumentInput[]): Promise<{ documents: number; chunks: number }> {
    const records: VectorRecord[] = []
    for (const document of documents) {
      if (INTERNAL_STORAGE_FILE.test(document.source)) {
        throw new Error(`"${document.source}" is one of the app's own memory files and cannot be added as a document`)
      }
      if (looksBinary(document.content)) {
        throw new Error(`"${document.source}" looks like a binary file, not text - only text documents can be added`)
      }
      const chunks = chunkText(document.content)
      for (const chunk of chunks) {
        const id = document.id
          ? `${document.id}:${chunk.index}`
          : crypto.createHash('sha256').update(`${document.source}:${chunk.index}:${chunk.content}`).digest('hex')
        records.push({
          id,
          source: document.source,
          content: chunk.content,
          embedding: await embed(chunk.content),
          metadata: { ...(document.metadata ?? {}), chunkIndex: chunk.index },
          createdAt: new Date().toISOString(),
        })
      }
    }
    await this.store.upsert(records)
    return { documents: documents.length, chunks: records.length }
  }

  async ingestFile(filePath: string): Promise<{ documents: number; chunks: number }> {
    const content = decodeFileBuffer(await readFile(filePath))
    return this.ingest([{ source: filePath, content }])
  }
}
