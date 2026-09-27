/**
 * Universal Preview Canvas (#27) - Vue SFC compilation for live preview.
 *
 * Uses @vue/compiler-sfc directly (the same low-level API the official Vue
 * SFC Playground is built on) rather than a bundler: parse() splits the
 * source into <template>/<script>/<style> blocks, compileScript() handles
 * both `<script setup>` and a plain `<script>` block (and is skipped
 * entirely for a template-only SFC - it throws "SFC contains no <script>
 * tags" otherwise), and compileTemplate() turns the template into a
 * standalone render function wired to the script's binding metadata so
 * `{{ msg }}` etc. resolve as refs/props/etc. correctly instead of falling
 * back to slow runtime lookups. The two outputs are stitched into one
 * module-scoped code string that previewBundler.js inlines into a
 * `<script type="module">` tag alongside an importmap-resolved `"vue"`.
 */
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const ID = 'xufruz-preview'
const FILENAME = 'Preview.vue'

/**
 * @param {string} source Raw .vue SFC source.
 * @returns {{ ok: true, moduleCode: string, css: string } | { ok: false, error: string }}
 */
export function compileVueSfc(source) {
  try {
    const { descriptor, errors } = parse(source, { filename: FILENAME })
    if (errors.length) {
      return { ok: false, error: errors[0].message }
    }

    const hasScript = Boolean(descriptor.script || descriptor.scriptSetup)
    const scriptResult = hasScript
      ? compileScript(descriptor, { id: ID, inlineTemplate: false })
      : null

    let moduleCode = scriptResult
      ? scriptResult.content.replace('export default', 'const __sfc__ =')
      : 'const __sfc__ = {}'

    if (descriptor.template) {
      const templateResult = compileTemplate({
        source: descriptor.template.content,
        filename: FILENAME,
        id: ID,
        compilerOptions: { bindingMetadata: scriptResult?.bindings },
      })
      if (templateResult.errors.length) {
        const first = templateResult.errors[0]
        return { ok: false, error: typeof first === 'string' ? first : first.message }
      }
      const renderCode = templateResult.code.replace('export function render', 'function __sfc_render__')
      moduleCode += `\n${renderCode}\n__sfc__.render = __sfc_render__`
    }

    return { ok: true, moduleCode, css: descriptor.styles.map((style) => style.content).join('\n') }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
