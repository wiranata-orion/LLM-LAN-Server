/**
 * Line diff for the Vibe Coding "Diff View".
 *
 * Written by hand rather than pulled in as a dependency: this needs one
 * function, and the whole app currently ships without a diff library.
 *
 * A plain LCS table is O(oldLines x newLines) in memory, which a 5000-line
 * file would turn into 25M cells. Two things keep that in check:
 *   1. Identical head and tail lines are trimmed first - an AI edit usually
 *      touches a small region, so the table typically covers a few dozen lines.
 *   2. Anything still too large after trimming falls back to a block replace,
 *      which renders correctly, just less precisely.
 */

const MAX_LCS_CELLS = 4_000_000

/**
 * @typedef {Object} DiffRow
 * @property {'equal'|'add'|'remove'} type
 * @property {number|null} oldLine 1-based line number in the original, null for additions.
 * @property {number|null} newLine 1-based line number in the replacement, null for removals.
 * @property {string} text
 */

/**
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ rows: DiffRow[], added: number, removed: number, unchanged: number, approximate: boolean }}
 */
export function diffLines(oldText, newText) {
  const oldLines = normalize(oldText)
  const newLines = normalize(newText)

  // ---- Trim the identical head.
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) {
    head += 1
  }

  // ---- Trim the identical tail (never past the head).
  let tail = 0
  while (
    tail < oldLines.length - head
    && tail < newLines.length - head
    && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail += 1
  }

  const oldMiddle = oldLines.slice(head, oldLines.length - tail)
  const newMiddle = newLines.slice(head, newLines.length - tail)

  const rows = []
  for (let index = 0; index < head; index += 1) {
    rows.push({ type: 'equal', oldLine: index + 1, newLine: index + 1, text: oldLines[index] })
  }

  let approximate = false
  if (oldMiddle.length * newMiddle.length > MAX_LCS_CELLS) {
    // Too big to align precisely - show the changed region as a wholesale replace.
    approximate = true
    oldMiddle.forEach((text, index) => {
      rows.push({ type: 'remove', oldLine: head + index + 1, newLine: null, text })
    })
    newMiddle.forEach((text, index) => {
      rows.push({ type: 'add', oldLine: null, newLine: head + index + 1, text })
    })
  } else {
    rows.push(...alignMiddle(oldMiddle, newMiddle, head))
  }

  for (let index = 0; index < tail; index += 1) {
    const oldLine = oldLines.length - tail + index + 1
    const newLine = newLines.length - tail + index + 1
    rows.push({ type: 'equal', oldLine, newLine, text: oldLines[oldLine - 1] })
  }

  let added = 0
  let removed = 0
  let unchanged = 0
  for (const row of rows) {
    if (row.type === 'add') added += 1
    else if (row.type === 'remove') removed += 1
    else unchanged += 1
  }

  return { rows, added, removed, unchanged, approximate }
}

function normalize(text) {
  if (typeof text !== 'string') return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

/** Standard LCS alignment over the changed region only. */
function alignMiddle(oldLines, newLines, offset) {
  const rows = []
  const height = oldLines.length
  const width = newLines.length

  if (!height && !width) return rows
  if (!height) {
    return newLines.map((text, index) => ({ type: 'add', oldLine: null, newLine: offset + index + 1, text }))
  }
  if (!width) {
    return oldLines.map((text, index) => ({ type: 'remove', oldLine: offset + index + 1, newLine: null, text }))
  }

  // table[i][j] = LCS length of oldLines[i..] and newLines[j..]
  const stride = width + 1
  const table = new Int32Array((height + 1) * stride)
  for (let i = height - 1; i >= 0; i -= 1) {
    for (let j = width - 1; j >= 0; j -= 1) {
      table[i * stride + j] = oldLines[i] === newLines[j]
        ? table[(i + 1) * stride + (j + 1)] + 1
        : Math.max(table[(i + 1) * stride + j], table[i * stride + (j + 1)])
    }
  }

  let i = 0
  let j = 0
  while (i < height && j < width) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: 'equal', oldLine: offset + i + 1, newLine: offset + j + 1, text: oldLines[i] })
      i += 1
      j += 1
    } else if (table[(i + 1) * stride + j] >= table[i * stride + (j + 1)]) {
      rows.push({ type: 'remove', oldLine: offset + i + 1, newLine: null, text: oldLines[i] })
      i += 1
    } else {
      rows.push({ type: 'add', oldLine: null, newLine: offset + j + 1, text: newLines[j] })
      j += 1
    }
  }
  while (i < height) {
    rows.push({ type: 'remove', oldLine: offset + i + 1, newLine: null, text: oldLines[i] })
    i += 1
  }
  while (j < width) {
    rows.push({ type: 'add', oldLine: null, newLine: offset + j + 1, text: newLines[j] })
    j += 1
  }
  return rows
}

/**
 * Collapses long stretches of unchanged lines into a marker row, so a
 * three-line edit in a thousand-line file doesn't render a thousand rows.
 *
 * @param {DiffRow[]} rows
 * @param {number} contextLines How many unchanged lines to keep either side of a change.
 */
export function collapseUnchanged(rows, contextLines = 3) {
  const keep = new Array(rows.length).fill(false)
  rows.forEach((row, index) => {
    if (row.type === 'equal') return
    for (let offset = -contextLines; offset <= contextLines; offset += 1) {
      const target = index + offset
      if (target >= 0 && target < rows.length) keep[target] = true
    }
  })

  const output = []
  let skipped = 0
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        output.push({ type: 'gap', oldLine: null, newLine: null, text: `${skipped} baris tidak berubah` })
        skipped = 0
      }
      output.push(row)
      return
    }
    skipped += 1
  })
  if (skipped > 0) {
    output.push({ type: 'gap', oldLine: null, newLine: null, text: `${skipped} baris tidak berubah` })
  }
  return output
}
