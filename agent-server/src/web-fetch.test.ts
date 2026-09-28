import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAndExtract } from './web-fetch.js'

const originalFetch = globalThis.fetch

function mockFetch(response: { ok: boolean; status?: number; contentType?: string; body: string }) {
  globalThis.fetch = (async () => ({
    ok: response.ok,
    status: response.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (response.contentType ?? 'text/html; charset=utf-8') : null) },
    body: {
      getReader: () => {
        let sent = false
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined }
            sent = true
            return { done: false, value: new TextEncoder().encode(response.body) }
          },
          cancel: async () => {},
        }
      },
    },
  })) as unknown as typeof fetch
}

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('extracts the title and strips scripts/nav/tags down to readable text', async () => {
  mockFetch({
    ok: true,
    body: `<html><head><title>Judul Artikel</title></head><body>
      <nav>Menu Navigasi</nav>
      <script>alert('noise')</script>
      <h1>Judul Artikel</h1>
      <p>Ini adalah <b>paragraf</b> pertama.</p>
      <p>Paragraf kedua dengan &amp; entity.</p>
      <footer>Copyright 2026</footer>
    </body></html>`,
  })

  const page = await fetchAndExtract('https://example.com/article')
  assert.equal(page.title, 'Judul Artikel')
  assert.doesNotMatch(page.text, /Menu Navigasi/)
  assert.doesNotMatch(page.text, /alert\('noise'\)/)
  assert.doesNotMatch(page.text, /Copyright/)
  assert.match(page.text, /paragraf pertama/)
  assert.match(page.text, /Paragraf kedua dengan & entity/)
  assert.equal(page.truncated, false)
})

test('rejects a non-http(s) URL', async () => {
  await assert.rejects(() => fetchAndExtract('ftp://example.com/file'), /http\/https/i)
})

test('rejects a malformed URL', async () => {
  await assert.rejects(() => fetchAndExtract('not a url'), /not a valid URL/i)
})

test('refuses to fetch a private/internal address (SSRF guard)', async () => {
  await assert.rejects(() => fetchAndExtract('http://192.168.1.50:11434/api/tags'), /private\/internal/i)
  await assert.rejects(() => fetchAndExtract('http://localhost:3000/'), /private\/internal/i)
  await assert.rejects(() => fetchAndExtract('http://127.0.0.1/'), /private\/internal/i)
})

test('surfaces a clear error on a non-2xx response', async () => {
  mockFetch({ ok: false, status: 404, body: '' })
  await assert.rejects(() => fetchAndExtract('https://example.com/missing'), /404/)
})

test('rejects an unsupported content type', async () => {
  mockFetch({ ok: true, contentType: 'application/pdf', body: '%PDF-1.4' })
  await assert.rejects(() => fetchAndExtract('https://example.com/file.pdf'), /Unsupported content type/i)
})

test('truncates a very long page and flags it', async () => {
  const longBody = `<title>Long</title><p>${'kata '.repeat(10_000)}</p>`
  mockFetch({ ok: true, body: longBody })
  const page = await fetchAndExtract('https://example.com/long')
  assert.equal(page.truncated, true)
  assert.match(page.text, /dipotong/)
})

test('sends a custom User-Agent when provided (Settings > Keamanan & Web)', async () => {
  let capturedHeaders: Record<string, string> | undefined
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedHeaders = init?.headers as Record<string, string>
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), cancel: async () => {} }) },
    }
  }) as unknown as typeof fetch

  await fetchAndExtract('https://example.com/', undefined, { userAgent: 'MyCustomBot/2.0' })
  assert.equal(capturedHeaders?.['user-agent'], 'MyCustomBot/2.0')
})

test('falls back to the default User-Agent when none is provided', async () => {
  let capturedHeaders: Record<string, string> | undefined
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedHeaders = init?.headers as Record<string, string>
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), cancel: async () => {} }) },
    }
  }) as unknown as typeof fetch

  await fetchAndExtract('https://example.com/')
  assert.match(capturedHeaders?.['user-agent'] ?? '', /XufruzLLM-ResearchAgent/)
})

test('respects a custom timeoutMs by aborting a slow response', async () => {
  // AbortSignal.timeout()'s own internal timer is unref'd (by design - it
  // shouldn't itself keep a process alive), so a mock that ONLY ever settles
  // via that abort listener can get force-cancelled by the test runner if
  // nothing else is scheduled. A real (ref'd) setTimeout well past the
  // timeout keeps the event loop alive long enough for the abort - which
  // must fire first, well before this one - to actually be observed.
  globalThis.fetch = ((_url: string, init?: RequestInit) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')))
    setTimeout(() => resolve({ ok: true, status: 200, headers: { get: () => 'text/html' }, body: null } as unknown as Response), 200)
  })) as unknown as typeof fetch

  await assert.rejects(
    () => fetchAndExtract('https://example.com/slow', undefined, { timeoutMs: 20 }),
    /AbortError|aborted/i,
  )
})
