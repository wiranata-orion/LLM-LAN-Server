import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { utils, write } from 'xlsx'
import { extractTextFromBinaryFile } from './file-extract.js'

// A hand-rolled minimal PDF (no proper xref table) - pdf.js recovers text
// from it without needing a real PDF producer, which is enough to prove the
// extractor is wired up correctly end to end.
const MINIMAL_PDF = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj
trailer
<< /Size 6 /Root 1 0 R >>
%%EOF`, 'utf-8')

test('extracts text from a PDF', async () => {
  const text = await extractTextFromBinaryFile('laporan.pdf', MINIMAL_PDF)
  assert.match(text, /Hello World/)
})

test('extracts text from a DOCX', async () => {
  // mammoth ships this fixture as part of its own published package - a real
  // .docx is a ZIP of XML files, not something worth hand-rolling in a test.
  const fixture = path.join(process.cwd(), 'node_modules/mammoth/test/test-data/comments.docx')
  const buffer = await readFile(fixture)
  const text = await extractTextFromBinaryFile('catatan.docx', buffer)
  assert.match(text, /Ouch/)
})

test('extracts text from an XLSX, one CSV block per sheet', async () => {
  const workbook = utils.book_new()
  const sheet = utils.aoa_to_sheet([['Nama', 'Umur'], ['Budi', 30]])
  utils.book_append_sheet(workbook, sheet, 'Data')
  const buffer = write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const text = await extractTextFromBinaryFile('data.xlsx', buffer)
  assert.match(text, /## Data/)
  assert.match(text, /Budi,30/)
})

test('rejects an unsupported extension with a clear error instead of garbage text', async () => {
  await assert.rejects(
    () => extractTextFromBinaryFile('archive.zip', Buffer.from('PK')),
    /not a supported document type/i,
  )
})
