/**
 * In-Browser Multi-Language Code Runner & Execution Sandbox (#28).
 *
 * JS/TS and Python each run in their own dedicated Web Worker (see
 * src/workers/) so a hard timeout can be enforced by actually terminating
 * the worker's thread from here - the only way to stop a genuinely blocking
 * loop, since a Promise race on this (the main) thread can never preempt
 * code that never yields. SQL reuses the already-existing sqlPlayground.js
 * (sql.js/WASM) - it has no "infinite loop" failure mode worth a worker for,
 * a query either returns or throws. Shell is a synchronous simulator with
 * nothing to hang on at all - see shellSimulator.js.
 *
 * @typedef {{
 *   ok: boolean,
 *   logs: Array<{ level: 'log'|'warn'|'error'|'info', message: string }>,
 *   returnValue?: string,
 *   error?: string,
 *   stack?: string,
 *   timedOut?: boolean,
 *   durationMs: number,
 * }} ExecutionResult
 */
import { transform } from 'sucrase'

/**
 * Runs `payload` in `worker` (already constructed by the caller - see why
 * below), enforcing `timeoutMs` by terminating the worker outright if it
 * hasn't reported back in time - not by racing a promise, which cannot
 * interrupt code that never yields back to the event loop.
 *
 * Takes a live Worker instance rather than a URL deliberately: Vite only
 * statically detects and bundles `new Worker(new URL('./file.js',
 * import.meta.url))` as a single, direct expression at the call site - if
 * that URL construction is hoisted into a shared helper like this one
 * instead, Vite can no longer tell a worker file needs bundling at all, and
 * the reference silently 404s at runtime in a production build. Each
 * exported function below does its own `new Worker(new URL(...))` inline
 * for exactly this reason.
 */
function runInWorker(worker, payload, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = performance.now()
    let settled = false
    let timer

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve({ ...result, durationMs: performance.now() - startedAt })
    }

    timer = setTimeout(() => {
      finish({ ok: false, error: `Eksekusi dihentikan - melebihi batas waktu ${(timeoutMs / 1000).toFixed(1)}s`, logs: [], timedOut: true })
    }, timeoutMs)

    worker.onmessage = (event) => {
      const data = event.data
      if (data.type === 'result') finish({ ok: true, logs: data.logs, returnValue: data.returnValue })
      else finish({ ok: false, error: data.message, stack: data.stack, logs: data.logs })
    }
    worker.onerror = (event) => {
      finish({ ok: false, error: event.message || 'Worker error', logs: [] })
    }

    worker.postMessage(payload)
  })
}

/**
 * @param {string} code
 * @param {{ timeoutMs?: number, language?: 'javascript' | 'typescript' }} [options]
 * @returns {Promise<ExecutionResult>}
 */
export function runJavaScript(code, options = {}) {
  const { timeoutMs = 5000, language = 'javascript' } = options
  let toRun = code

  if (language === 'typescript' || language === 'ts' || language === 'tsx') {
    try {
      toRun = transform(code, { transforms: ['typescript'] }).code
    } catch (error) {
      return Promise.resolve({
        ok: false,
        error: `Kesalahan transpile TypeScript: ${error instanceof Error ? error.message : String(error)}`,
        logs: [],
        durationMs: 0,
      })
    }
  }

  const worker = new Worker(new URL('../workers/jsCodeRunnerWorker.js', import.meta.url))
  return runInWorker(worker, { code: toRun }, timeoutMs)
}

/**
 * @param {string} code
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<ExecutionResult>}
 */
export function runPython(code, options = {}) {
  const { timeoutMs = 5000 } = options
  const worker = new Worker(new URL('../workers/pythonWorker.js', import.meta.url))
  return runInWorker(worker, { code }, timeoutMs)
}
