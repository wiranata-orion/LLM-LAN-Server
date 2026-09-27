// mammoth ships no type declarations and there is no @types/mammoth package -
// this covers only the one function file-extract.ts actually calls.
declare module 'mammoth' {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>
}
