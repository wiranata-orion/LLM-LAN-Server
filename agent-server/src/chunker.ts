export interface Chunk {
  index: number
  content: string
}

export function chunkText(content: string, chunkSize = 900, overlap = 120): Chunk[] {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  if (chunkSize <= overlap) throw new Error('chunkSize must be greater than overlap')

  const chunks: Chunk[] = []
  let start = 0
  let index = 0
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length)
    let boundary = end
    if (end < normalized.length) {
      const paragraphBoundary = normalized.lastIndexOf('\n\n', end)
      const sentenceBoundary = normalized.lastIndexOf('. ', end)
      boundary = Math.max(paragraphBoundary, sentenceBoundary, normalized.lastIndexOf(' ', end))
      if (boundary <= start + Math.floor(chunkSize * 0.5)) boundary = end
    }
    const piece = normalized.slice(start, boundary).trim()
    if (piece) chunks.push({ index, content: piece })
    if (boundary >= normalized.length) break
    start = Math.max(boundary - overlap, start + 1)
    index += 1
  }
  return chunks
}
