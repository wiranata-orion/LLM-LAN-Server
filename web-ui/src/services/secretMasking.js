/**
 * Data Privacy: Secret Key Auto-Masking (Settings > Keamanan & Web).
 * Applied to the user's own outgoing message text - both what gets sent to
 * Ollama and what's stored/displayed in the conversation, since masking it
 * only for the network request but keeping the plaintext secret sitting in
 * chat history/localStorage would defeat the point.
 *
 * Two rules, deliberately conservative (favors missing an unusual format
 * over mangling ordinary text that merely looks hex-ish):
 *  1. A labelled assignment ("api_key = <value>") - same judgment call as
 *     securityScanner.js's own hardcoded-secret rule.
 *  2. A handful of well-known provider key prefixes (OpenAI "sk-", GitHub
 *     tokens, AWS access keys, Google API keys) - these are unambiguous
 *     regardless of any surrounding label.
 */
const LABELLED_SECRET_PATTERN = /(api[_-]?key|secret|token|password|passwd)(\s*[:=]\s*)['"]?([A-Za-z0-9_\-]{12,})['"]?/gi
const KNOWN_KEY_PREFIX_PATTERN = /\b(sk-[A-Za-z0-9]{16,}|gh[po]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g

const MASK = '[SECRET_DIMASKING]'

/** @returns {string} `text` with anything that looks like a hardcoded credential replaced by a placeholder. */
export function maskSecrets(text) {
  if (!text) return text
  let masked = text.replace(LABELLED_SECRET_PATTERN, (_match, label, separator) => `${label}${separator}${MASK}`)
  masked = masked.replace(KNOWN_KEY_PREFIX_PATTERN, MASK)
  return masked
}

/** Whether maskSecrets() would actually change this text - lets a caller warn the user before silently rewriting their message. */
export function containsMaskableSecret(text) {
  return !!text && maskSecrets(text) !== text
}
