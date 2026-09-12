import { readFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import { chunkText } from './chunker.js'
import { embed } from './ollama.js'
import { VectorStore } from './vector-store.js'
import type { DocumentInput, VectorRecord } from './types.js'

export class IngestionService {
  constructor(private readonly store: VectorStore) {}

  async ingest(documents: DocumentInput[]): Promise<{ documents: number; chunks: number }> {
    const records: VectorRecord[] = []
    for (const document of documents) {
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
    const content = await readFile(filePath, 'utf8')
    return this.ingest([{ source: filePath, content }])
  }
}
