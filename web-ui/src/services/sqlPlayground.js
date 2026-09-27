/**
 * Interactive SQL Playground (#7) - executes SQL for real, against a fresh,
 * throwaway in-memory SQLite database (sql.js, compiled to WebAssembly),
 * never a set of hand-faked "mock" rows. Nothing persists between calls and
 * nothing ever leaves the browser (no server round-trip at all), so it's
 * safe to run directly on AI-generated SQL - there is no real data or
 * database to damage, no matter what the query does.
 */
import initSqlJs from 'sql.js'

let sqlJsPromise = null

function loadSqlJs() {
  if (!sqlJsPromise) {
    // sql-wasm.wasm is copied into web-ui/public (see project setup) so Vite
    // serves it as a plain static file at this path in both dev and build.
    sqlJsPromise = initSqlJs({ locateFile: (file) => `/${file}` })
  }
  return sqlJsPromise
}

/** Pulls column names out of a `CREATE TABLE (...)` statement's own SQL text - good enough for the schema visualizer, not a full SQL grammar parser. */
function extractColumns(createTableSql) {
  const match = createTableSql?.match(/\(([\s\S]*)\)\s*$/)
  if (!match) return []
  // A naive split on "," would break on a column constraint like
  // CHECK (x > 0, y > 0) - skip commas that are inside nested parens.
  const columns = []
  let depth = 0
  let current = ''
  for (const char of match[1]) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      columns.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) columns.push(current)
  return columns
    .map((part) => part.trim().split(/\s+/)[0])
    .filter((name) => name && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(name))
}

/**
 * @param {import('sql.js').Database} db
 * @returns {Array<{ name: string, columns: string[] }>}
 */
function readSchema(db) {
  try {
    const result = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    if (!result.length) return []
    return result[0].values.map(([name, createSql]) => ({
      name: String(name),
      columns: extractColumns(String(createSql)),
    }))
  } catch {
    return []
  }
}

/**
 * Runs one or more semicolon-separated SQL statements (CREATE TABLE, INSERT,
 * SELECT, ...) against a brand-new in-memory database.
 * @param {string} sql
 * @returns {Promise<{
 *   resultSets: Array<{ columns: string[], values: unknown[][] }>,
 *   schema: Array<{ name: string, columns: string[] }>,
 *   error: string | null,
 * }>}
 */
export async function runSql(sql) {
  const SQL = await loadSqlJs()
  const db = new SQL.Database()
  let resultSets = []
  let error = null
  try {
    // db.exec() runs every statement in order and returns a result set only
    // for the ones that produce rows (SELECT, PRAGMA, ...) - a CREATE TABLE
    // or INSERT contributes no entry, which is expected, not an omission.
    resultSets = db.exec(sql)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  const schema = readSchema(db)
  db.close()
  return { resultSets, schema, error }
}
