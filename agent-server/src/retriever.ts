import { config } from './config.js'
import { embed } from './ollama.js'
import { CONVERSATION_SOURCE_PREFIX, VectorStore } from './vector-store.js'
import type { VectorRecord } from './types.js'

export class Retriever {
  constructor(private readonly store: VectorStore) {}

  /**
   * @param query The user's message.
   * @param queryEmbedding Pass an already-computed embedding for this exact
   * query to avoid a second redundant embedding call (the orchestrator also
   * needs it for memory search). Omit to have this method embed it itself.
   */
  async search(query: string, queryEmbedding?: number[] | null) {
    if (!query.trim()) return []
    const embedding = queryEmbedding !== undefined ? queryEmbedding : await embed(query)
    if (!embedding) return []
    // This store also holds conversation-memory vectors (see memory-core.ts);
    // only ingested documents belong in "retrieved local context".
    const isDocument = (record: VectorRecord) => !record.source.startsWith(CONVERSATION_SOURCE_PREFIX)
    return this.store.search(embedding, config.maxRetrievedChunks, config.ragMinScore, isDocument)
  }
}
