/**
 * Security & Vulnerability Scanner (#9) - heuristic pattern matching, not a
 * real AST parser. A genuine multi-language (PHP/JS/Python/SQL/...) AST-based
 * scanner is a whole separate tool in its own right (that's what Semgrep/
 * ESLint security plugins are for); this instead flags the same handful of
 * unmistakable anti-patterns the spec names by name (eval, hardcoded
 * secrets, string-concatenated SQL, innerHTML/XSS) via regex, which catches
 * the common, obvious cases without the cost of shipping a parser per
 * language. It will miss anything obfuscated and can false-positive on a
 * pattern that happens to appear inside a comment or string literal - it's a
 * quick heads-up, not a security audit.
 */

const RULES = [
  {
    id: 'eval',
    pattern: /\beval\s*\(/,
    severity: 'high',
    message: 'Penggunaan eval() - risiko eksekusi kode arbitrer jika argumennya berasal dari input yang tidak tepercaya.',
  },
  {
    id: 'hardcoded-secret',
    pattern: /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i,
    severity: 'high',
    message: 'Kemungkinan API key/secret/password ditulis langsung di kode (hardcoded).',
  },
  {
    id: 'sql-concat',
    pattern: /(SELECT|INSERT|UPDATE|DELETE)\b[^;]*['"]\s*(\+|\.\s*concat|\$\{)/i,
    severity: 'high',
    message: 'Kemungkinan SQL Injection - query dibangun dengan concatenation/template string, bukan parameterized query.',
  },
  {
    id: 'inner-html',
    pattern: /\.innerHTML\s*=(?!=)/,
    severity: 'medium',
    message: 'innerHTML - risiko XSS jika isinya berasal dari input pengguna. Pertimbangkan textContent atau sanitasi.',
  },
  {
    id: 'document-write',
    pattern: /document\.write\s*\(/,
    severity: 'medium',
    message: 'document.write() - risiko XSS dan praktik usang; sebaiknya hindari.',
  },
  {
    id: 'shell-exec',
    pattern: /\b(exec|execSync|shell_exec|system|popen)\s*\(/,
    severity: 'high',
    message: 'Eksekusi shell/command - risiko command injection jika argumennya berasal dari input pengguna.',
  },
  {
    id: 'dangerously-set-inner-html',
    pattern: /dangerouslySetInnerHTML/,
    severity: 'medium',
    message: 'dangerouslySetInnerHTML - risiko XSS jika isinya berasal dari input pengguna.',
  },
]

/**
 * @typedef {{ line: number, ruleId: string, severity: 'high' | 'medium', message: string, snippet: string }} SecurityFinding
 * @param {string} code
 * @returns {SecurityFinding[]}
 */
export function scanForVulnerabilities(code) {
  const findings = []
  const lines = (code || '').split('\n')

  lines.forEach((line, index) => {
    // A comment/string-literal line is where this heuristic is most likely
    // to false-positive (e.g. a rule's own pattern name mentioned in a code
    // comment) - not filtered out here, since reliably telling "is this
    // inside a string/comment" apart needs a real parser, exactly what this
    // intentionally isn't. Kept simple and over-inclusive rather than
    // under-inclusive.
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          line: index + 1,
          ruleId: rule.id,
          severity: rule.severity,
          message: rule.message,
          snippet: line.trim().slice(0, 200),
        })
      }
    }
  })

  return findings
}
