/**
 * Universal Preview Canvas (#27) - React/JSX/TSX compilation for live
 * preview. Uses @babel/standalone (the same in-browser Babel used by the
 * official React/Babel REPLs) with the classic JSX runtime (React.createElement
 * calls) so previewBundler.js can mount the result against the plain global
 * `React`/`ReactDOM` UMD builds it loads via ordinary <script> tags - that
 * avoids the automatic runtime's `react/jsx-runtime` import, which has no
 * global-script equivalent and would force an ESM/importmap setup just for
 * React the way Vue needs one for its own ESM-only browser build.
 *
 * A component must `export default` itself - that's the one convention this
 * relies on to know what to mount, same as any AI-generated single-file
 * snippet naturally does (`export default function App() {...}`).
 */
import * as Babel from '@babel/standalone'

const DEFAULT_EXPORT_RE = /export\s+default\s+/

/**
 * @param {string} source Raw .jsx/.tsx source.
 * @param {{ typescript?: boolean }} [options]
 * @returns {{ ok: true, code: string } | { ok: false, error: string }}
 */
export function compileReactComponent(source, options = {}) {
  if (!DEFAULT_EXPORT_RE.test(source)) {
    return { ok: false, error: 'Komponen React harus memiliki `export default` (contoh: `export default function App() { ... }`) agar tahu apa yang harus ditampilkan.' }
  }

  try {
    const presets = [['react', { runtime: 'classic' }]]
    if (options.typescript) presets.push('typescript')
    const filename = options.typescript ? 'Preview.tsx' : 'Preview.jsx'

    const result = Babel.transform(source, { presets, filename })
    const code = result.code.replace(DEFAULT_EXPORT_RE, 'window.__xufruzPreviewComponent__ = ')
    return { ok: true, code }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
