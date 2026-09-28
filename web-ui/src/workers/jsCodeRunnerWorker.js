/**
 * In-Browser Code Runner (#28) - JS/TS worker.
 *
 * Runs on its own thread (a real OS-level Web Worker, not just an async
 * task on the main thread) for two reasons: it keeps the UI responsive
 * while arbitrary AI-generated code runs, and - critically - it's the only
 * way a hard timeout can actually work. A `Promise.race()` against a
 * setTimeout on the MAIN thread cannot interrupt a genuinely blocking
 * synchronous loop (`while(true){}`) running on that SAME thread; the only
 * way to stop it is for a DIFFERENT thread to call worker.terminate(),
 * which the browser enforces regardless of whether the stuck code ever
 * cooperates. See codeExecutionEngine.js, which owns that termination timer.
 *
 * TypeScript is transpiled to plain JS on the MAIN thread with sucrase
 * before the code ever reaches this worker (see codeExecutionEngine.js) -
 * this worker only ever executes plain JS, keeping it small and simple.
 *
 * Not a module worker on purpose (see codeExecutionEngine.js's `new
 * Worker(...)` call - no `type: 'module'`) so this stays consistent with
 * pythonWorker.js, which needs classic-worker `importScripts()` for Pyodide.
 */

self.onmessage = async (event) => {
  const { code } = event.data
  const logs = []

  const record = (level) => (...args) => {
    logs.push({
      level,
      message: args.map((arg) => {
        if (typeof arg === 'string') return arg
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }).join(' '),
    })
  }

  // Workers have their OWN console (separate from the main thread's) - safe
  // to override for the lifetime of this one execution without affecting
  // anything else, and this worker is terminated right after anyway.
  console.log = record('log')
  console.warn = record('warn')
  console.error = record('error')
  console.info = record('info')

  try {
    // New Function() runs in the worker's global scope, not with access to
    // this closure's local variables - about as sandboxed as executing
    // arbitrary JS can get without a second layer like an iframe, which a
    // Worker already can't create anyway (no DOM access at all in here).
    const run = new Function(`return (async () => {\n${code}\n})()`)
    const returnValue = await run()
    self.postMessage({
      type: 'result',
      logs,
      returnValue: returnValue === undefined ? undefined : safeStringify(returnValue),
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      logs,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }
}

function safeStringify(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
