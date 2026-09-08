import { config } from './config.js'
import { embed } from './ollama.js'
import { JsonVectorStore } from './vector-store.js'

export class Retriever {
  constructor(private readonly store: JsonVectorStore) {}

  async search(query: string) {
    if (!query.trim()) return []
    return this.store.search(await embed(query), config.maxRetrievedChunks, config.ragMinScore)
  }
}
