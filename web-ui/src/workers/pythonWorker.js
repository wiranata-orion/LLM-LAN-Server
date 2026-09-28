/**
 * In-Browser Code Runner (#28) - Python worker, via Pyodide (CPython
 * compiled to WebAssembly). Runs inside a real Web Worker for the same
 * reason as jsCodeRunnerWorker.js: a synchronous Python infinite loop can
 * only actually be stopped by the browser terminating this worker's thread
 * from the outside (see codeExecutionEngine.js) - racing it against a
 * setTimeout on the main thread cannot preempt a tight loop with no await
 * points, since Pyodide would otherwise be running on that same main thread.
 *
 * A classic (non-module) worker on purpose - Pyodide's own CDN bundle is a
 * plain script exposing a global `loadPyodide`, meant to be loaded via
 * importScripts() inside a worker exactly like this, not as an ES module.
 *
 * Loaded lazily from jsDelivr's CDN, not self-hosted: Pyodide's full
 * distribution is a large, many-file bundle (the WASM runtime plus the
 * Python standard library) - impractical to vendor into this app's own
 * `public/` folder the way the much smaller sql.js WASM binary was. This is
 * the one deliberate exception to this app's "local first" stance: running
 * Python here needs internet access the first time (the browser then caches
 * it), everything else in this app works fully offline.
 */
const PYODIDE_CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.js'

let pyodideReadyPromise = null

async function getPyodide() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      importScripts(PYODIDE_CDN_URL)
      // eslint-disable-next-line no-undef -- loadPyodide is a global injected by the importScripts() call above
      return await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/' })
    })()
  }
  return pyodideReadyPromise
}

self.onmessage = async (event) => {
  const { code } = event.data
  const logs = []

  let pyodide
  try {
    pyodide = await getPyodide()
  } catch (error) {
    self.postMessage({
      type: 'error',
      logs,
      message: `Gagal memuat runtime Python (Pyodide) dari CDN - periksa koneksi internet: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }

  pyodide.setStdout({ batched: (text) => logs.push({ level: 'log', message: text }) })
  pyodide.setStderr({ batched: (text) => logs.push({ level: 'error', message: text }) })

  try {
    const result = await pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'result',
      logs,
      returnValue: result === undefined ? undefined : String(result),
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      logs,
      // Pyodide's own PythonError already formats a readable Python traceback.
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
