import { PDFParse } from 'pdf-parse'
import { extractRawText } from 'mammoth'
import { read, utils } from 'xlsx'

/**
 * Turns a binary document (PDF/DOCX/XLSX) into the plain text ingestion.ts
 * chunks and embeds - those formats decode to NUL bytes and mostly-garbage
 * characters when read as text (see ingestion.ts's looksBinary), so they need
 * their own extraction before they can become RAG context at all.
 *
 * `filename` only picks the extractor (by extension); the actual bytes are
 * always `buffer`.
 */
export async function extractTextFromBinaryFile(filename: string, buffer: Buffer): Promise<string> {
  const extension = filename.toLowerCase().split('.').pop() ?? ''

  switch (extension) {
    case 'pdf':
      return extractPdfText(buffer)
    case 'docx':
      return extractDocxText(buffer)
    case 'xlsx':
    case 'xls':
      return extractSpreadsheetText(buffer)
    default:
      throw new Error(`"${filename}" is not a supported document type (didukung: PDF, DOCX, XLSX/XLS)`)
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await extractRawText({ buffer })
  return result.value
}

/** Renders every sheet as CSV text, headed by its sheet name, so a multi-sheet workbook stays readable once chunked. */
function extractSpreadsheetText(buffer: Buffer): string {
  const workbook = read(buffer, { type: 'buffer' })
  return workbook.SheetNames
    .map((name) => `## ${name}\n${utils.sheet_to_csv(workbook.Sheets[name])}`)
    .join('\n\n')
}
