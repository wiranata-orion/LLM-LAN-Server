/**
 * Smart Web & Research Agent (#16) - the model-facing `fetch_url` tool
 * (see tools/registry.ts) fetches a page server-side (the browser's own CORS
 * would block most sites anyway) and reduces it to plain readable text, so
 * the model gets an article's actual content instead of nav bars,
 * scripts, and markup noise.
 *
 * This is a lightweight regex-based extractor, not a full HTML parser or a
 * Mozilla-Readability-style port - pulling in jsdom just for this would be a
 * heavy dependency for a "local first" app. It does noticeably worse than a
 * real readability algorithm on a heavily-templated page, but handles the
 * common case (an article-shaped page) well enough for research/summarization.
 */

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // hard cap so one huge page can't blow up memory
const MAX_EXTRACTED_CHARS = 20_000 // orchestrator.ts's own context budgeting trims further anyway; this just keeps one tool result sane on its own

export interface FetchedPage {
  url: string
  title: string
  text: string
  truncated: boolean
}

const PRIVATE_HOSTNAME_PATTERN = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\])/i

/**
 * A research tool that fetches arbitrary URLs must not become a way to probe
 * this machine's own LAN (e.g. a prompt-injected page telling the model to
 * "also fetch http://192.168.1.50:11434/api/..." to leak the Ollama engine's
 * internals back out as "page content"). This is a hostname-literal check,
 * not real DNS-rebinding protection - proportionate for a personal,
 * single-user local app, not a hardened multi-tenant service.
 */
function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOSTNAME_PATTERN.test(hostname)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return match ? decodeEntities(match[1]).trim() : ''
}

/** Strips non-content elements entirely, then all remaining tags, then collapses whitespace. */
function extractReadableText(html: string): string {
  let text = html
  for (const tag of ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript', 'svg', 'form']) {
    text = text.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ')
  }
  // Block-level tags become paragraph breaks before the tags themselves are
  // stripped, so the extracted text still reads as separate lines/paragraphs
  // instead of one unbroken run-on wall of text.
  text = text.replace(/<\/(p|div|li|h[1-6]|br|tr)>/gi, '\n')
  text = text.replace(/<[^>]+>/g, ' ')
  text = decodeEntities(text)
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; XufruzLLM-ResearchAgent/1.0)'

/**
 * @param signal Caller-initiated abort (client disconnect) - combined with
 * this call's own timeout below via AbortSignal.any(), so whichever fires
 * first cancels the fetch either way.
 * @param options Settings > Keamanan & Web, forwarded per request - falls
 * back to the built-in defaults above when omitted.
 */
export async function fetchAndExtract(
  rawUrl: string,
  signal?: AbortSignal,
  options?: { timeoutMs?: number; userAgent?: string },
): Promise<FetchedPage> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`"${rawUrl}" is not a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs can be fetched')
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error(`Refusing to fetch a private/internal address: ${parsed.hostname}`)
  }

  const timeoutSignal = AbortSignal.timeout(options?.timeoutMs || DEFAULT_TIMEOUT_MS)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const response = await fetch(parsed.toString(), {
    signal: combinedSignal,
    headers: { 'user-agent': options?.userAgent || DEFAULT_USER_AGENT },
  })
  if (!response.ok) throw new Error(`Failed to fetch ${parsed.toString()}: HTTP ${response.status}`)

  const contentType = response.headers.get('content-type') || ''
  if (!/text\/html|text\/plain|application\/json|application\/xhtml/i.test(contentType)) {
    throw new Error(`Unsupported content type for research: ${contentType || 'unknown'}`)
  }

  // Read up to MAX_RESPONSE_BYTES rather than the whole body - a multi-hundred-MB
  // response (a misconfigured server, a non-HTML file slipping past the
  // content-type check) must not be buffered into memory in full first.
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  if (reader) {
    while (totalBytes < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalBytes += value.byteLength
    }
    void reader.cancel().catch(() => {})
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
  const html = buffer.toString('utf-8')

  const title = extractTitle(html)
  const text = extractReadableText(html)
  const truncated = text.length > MAX_EXTRACTED_CHARS
  return {
    url: parsed.toString(),
    title,
    text: truncated ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n[...dipotong, halaman terlalu panjang...]` : text,
    truncated,
  }
}
