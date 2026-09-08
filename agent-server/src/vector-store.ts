import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config.js'
import type { VectorRecord } from './types.js'

interface StoreFile {
  version: 1
  records: VectorRecord[]
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0
}

export class JsonVectorStore {
  private records: VectorRecord[] = []
  private loaded = false

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(config.vectorStorePath, 'utf8')
      const parsed = JSON.parse(raw) as StoreFile
      this.records = Array.isArray(parsed.records) ? parsed.records : []
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      this.records = []
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(config.vectorStorePath), { recursive: true })
    const payload: StoreFile = { version: 1, records: this.records }
    await writeFile(config.vectorStorePath, JSON.stringify(payload, null, 2), 'utf8')
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    await this.load()
    const incoming = new Map(records.map((record) => [record.id, record]))
    this.records = [...this.records.filter((record) => !incoming.has(record.id)), ...records]
    await this.persist()
  }

  async search(queryEmbedding: number[], limit: number, minScore: number): Promise<Array<VectorRecord & { score: number }>> {
    await this.load()
    return this.records
      .map((record) => ({ ...record, score: cosineSimilarity(queryEmbedding, record.embedding) }))
      .filter((record) => record.score >= minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
  }
}
