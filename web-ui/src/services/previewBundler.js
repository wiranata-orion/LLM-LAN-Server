/**
 * Universal Preview Canvas (#27) - assembles the final `srcdoc` HTML document
 * for whichever kind of block WorkspaceCodeBlock.vue is previewing (raw
 * HTML/SVG, a Vue SFC, or a React JSX/TSX component), always with the same
 * console/error relay script injected so UniversalPreviewCanvas.vue's output
 * panel works identically across all three.
 *
 * The relay just forwards console.* calls and window error/unhandledrejection
 * events to the parent via postMessage - the sandboxed iframe (see
 * UniversalPreviewCanvas.vue for why it has no allow-same-origin) has an
 * opaque origin, so this is the only channel back to the host page at all.
 *
 * Vue is loaded as its official ESM browser build via an importmap (Vue only
 * ships that way, no global UMD build for v3); React is loaded as its
 * official UMD build via plain <script> tags instead, specifically so the
 * classic-runtime output from reactPreviewCompiler.js can reference the
 * global `React`/`ReactDOM` directly - that sidesteps needing an import map
 * entry for "react"/"react-dom", which (unlike Vue) don't have an
 * off-the-shelf single-file ESM build to point at.
 */
import { compileVueSfc } from './vuePreviewCompiler.js'
import { compileReactComponent } from './reactPreviewCompiler.js'

const VUE_CDN_URL = 'https://unpkg.com/vue@3.5.41/dist/vue.esm-browser.js'
const REACT_CDN_URL = 'https://unpkg.com/react@18.3.1/umd/react.development.js'
const REACT_DOM_CDN_URL = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js'

const RELAY_SCRIPT = `<script>
(function () {
  var TAG = 'xufruz-preview';
  function post(payload) {
    try { parent.postMessage(Object.assign({ source: TAG }, payload), '*'); } catch (e) {}
  }
  function stringify(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  ['log', 'warn', 'error', 'info'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      post({ type: 'console', level: level, message: args.map(stringify).join(' ') });
      if (original) original.apply(console, args);
    };
  });
  window.addEventListener('error', function (event) {
    post({ type: 'error', message: event.message, stack: event.error ? event.error.stack : '' });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post({ type: 'error', message: 'Unhandled promise rejection: ' + stringify(reason), stack: reason && reason.stack ? reason.stack : '' });
  });
})();
<\/script>`

/** A compiled module/script is embedded as literal <script> text - escape any `</script` inside it so the tag can't be closed early by user code containing that substring in a string/comment. */
function escapeForInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script')
}

function buildHtmlDocument(rawHtml) {
  if (/<head[^>]*>/i.test(rawHtml)) return rawHtml.replace(/<head[^>]*>/i, (match) => `${match}\n${RELAY_SCRIPT}`)
  if (/<html[^>]*>/i.test(rawHtml)) return rawHtml.replace(/<html[^>]*>/i, (match) => `${match}\n${RELAY_SCRIPT}`)
  return `${RELAY_SCRIPT}\n${rawHtml}`
}

function buildVueDocument(source) {
  const compiled = compileVueSfc(source)
  if (!compiled.ok) return compiled

  const srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${compiled.css}</style>
<script type="importmap">{"imports":{"vue":"${VUE_CDN_URL}"}}<\/script>
${RELAY_SCRIPT}
</head>
<body>
<div id="app"></div>
<script type="module">
import { createApp } from 'vue'
try {
${escapeForInlineScript(compiled.moduleCode)}
createApp(__sfc__).mount('#app')
} catch (e) {
  parent.postMessage({ source: 'xufruz-preview', type: 'error', message: e.message, stack: e.stack }, '*')
}
<\/script>
</body>
</html>`
  return { ok: true, srcdoc }
}

function buildReactDocument(source, { typescript } = {}) {
  const compiled = compileReactComponent(source, { typescript })
  if (!compiled.ok) return compiled

  const srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
${RELAY_SCRIPT}
<script src="${REACT_CDN_URL}" crossorigin><\/script>
<script src="${REACT_DOM_CDN_URL}" crossorigin><\/script>
</head>
<body>
<div id="root"></div>
<script>
try {
${escapeForInlineScript(compiled.code)}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(window.__xufruzPreviewComponent__))
} catch (e) {
  parent.postMessage({ source: 'xufruz-preview', type: 'error', message: e.message, stack: e.stack }, '*')
}
<\/script>
</body>
</html>`
  return { ok: true, srcdoc }
}

/**
 * @param {{ kind: 'html' | 'vue' | 'react', code: string, typescript?: boolean }} input
 * @returns {{ ok: true, srcdoc: string } | { ok: false, error: string }}
 */
export function buildPreviewDocument({ kind, code, typescript }) {
  if (kind === 'vue') return buildVueDocument(code)
  if (kind === 'react') return buildReactDocument(code, { typescript })
  return { ok: true, srcdoc: buildHtmlDocument(code) }
}
