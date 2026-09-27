import { getSettings, saveSettingsToStorage } from './api.js'

/**
 * Quick slash-command templates (#8 in the feature roadmap) - typing "/" as
 * the very first character of a message (and nothing else yet - see
 * ChatInput.vue's updateSlashState, which anchors the match to `^\/...$`
 * against the whole input, not just wherever the caret is) opens a picker;
 * selecting one replaces the draft with the template text, ready to paste
 * code after it.
 */
export const DEFAULT_TEMPLATES = [
  {
    trigger: 'refactor',
    label: 'Refactor kode',
    text: 'Refactor kode berikut agar lebih bersih, mudah dibaca, dan mengikuti best practice, tanpa mengubah perilakunya:\n\n',
  },
  {
    trigger: 'test',
    label: 'Tulis unit test',
    text: 'Tulis unit test untuk kode berikut, cakup kasus normal, edge case, dan kegagalan:\n\n',
  },
  {
    trigger: 'doc',
    label: 'Tulis dokumentasi',
    text: 'Tulis dokumentasi (docstring/komentar) untuk kode berikut:\n\n',
  },
  {
    trigger: 'explain',
    label: 'Jelaskan kode',
    text: 'Jelaskan secara detail, baris per baris jika perlu, apa yang dilakukan kode berikut:\n\n',
  },
  {
    trigger: 'bug',
    label: 'Cari bug',
    text: 'Cari kemungkinan bug atau kesalahan logika pada kode berikut, dan jelaskan cara memperbaikinya:\n\n',
  },
  {
    trigger: 'optimize',
    label: 'Optimalkan performa',
    text: 'Optimalkan performa kode berikut dan jelaskan trade-off dari setiap perubahan:\n\n',
  },
]

/**
 * Merges the built-in templates with the user's own (Settings > Parameter AI
 * > Template Prompt). A custom entry with the same trigger as a default one
 * overrides it - Map insertion order preserves "defaults first, then
 * customs" for the picker's default ordering, and last-write-wins gives the
 * override.
 */
export function getPromptTemplates() {
  const settings = getSettings()
  const custom = Array.isArray(settings.promptTemplates) ? settings.promptTemplates : []
  const byTrigger = new Map(DEFAULT_TEMPLATES.map((t) => [t.trigger, t]))
  for (const template of custom) {
    const trigger = (template?.trigger || '').trim().toLowerCase().replace(/^\//, '')
    if (!trigger || !template.text) continue
    byTrigger.set(trigger, { trigger, label: template.label || trigger, text: template.text })
  }
  return [...byTrigger.values()]
}

/** Only ever stores the user's own additions/overrides - the defaults above are never persisted. */
export function saveCustomTemplates(templates) {
  saveSettingsToStorage({ promptTemplates: templates })
}

export function getCustomTemplates() {
  const settings = getSettings()
  return Array.isArray(settings.promptTemplates) ? settings.promptTemplates : []
}
