import { config } from './config.js'
import { IngestionService } from './ingestion.js'
import { AgentOrchestrator } from './orchestrator.js'
import { PerformanceStore } from './performance-store.js'
import { Retriever } from './retriever.js'
import { VectorStore } from './vector-store.js'
import { SqliteMemoryCore } from './memory-core.js'

interface AppServices {
  store: VectorStore
  memory: SqliteMemoryCore
  ingestion: IngestionService
  retriever: Retriever
  orchestrator: AgentOrchestrator
  performanceStore: PerformanceStore
}

function buildServices(): AppServices {
  const store = new VectorStore(config.vectorStorePath)
  const memory = new SqliteMemoryCore(store)
  const ingestion = new IngestionService(store)
  const retriever = new Retriever(store)
  const performanceStore = new PerformanceStore()
  const orchestrator = new AgentOrchestrator(retriever, memory, performanceStore)
  return { store, memory, ingestion, retriever, orchestrator, performanceStore }
}

/**
 * Holds the live memory/vector-store/orchestrator instances and lets the
 * storage-path endpoints (see routes.ts) swap them at runtime when the user
 * points memory storage at a different folder from Settings, without
 * requiring a server restart.
 */
export class AppContext {
  current: AppServices = buildServices()

  reinitialize(): void {
    const previous = this.current
    this.current = buildServices()
    try {
      previous.memory.close()
    } catch (error) {
      console.warn('Failed to close previous memory database:', error)
    }
    try {
      previous.store.close()
    } catch (error) {
      console.warn('Failed to close previous vector store:', error)
    }
    try {
      previous.performanceStore.close()
    } catch (error) {
      console.warn('Failed to close previous performance store:', error)
    }
  }
}
