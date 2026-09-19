/**
 * Decodes a file's raw bytes into text, honouring a BOM instead of always
 * assuming UTF-8.
 *
 * Without this, a UTF-16 file (the default "Save As" encoding for Notepad and
 * PowerShell's `>`/`Out-File` on Windows) gets read as if every character
 * were followed by a literal NUL byte - which is both fed to the model as
 * "the file's current content" (producing a hallucinated, unrelated reply
 * since the real content was never actually visible to it) and flagged as
 * binary data by the NUL-byte heuristics in workspace-ignore.ts/ingestion.ts.
 */
export function decodeFileBuffer(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le')
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString('utf16le')
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8')
  }
  return buffer.toString('utf8')
}
