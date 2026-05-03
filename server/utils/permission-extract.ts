/**
 * Heuristics for pulling the "dangerous-pattern" label out of a free-text
 * failure reason coming from a kanban worker. Hermes' classifier names each
 * dangerous tool call (e.g. `outbound HTTP via curl`, `script execution via
 * heredoc`) and that exact label is what `command_allowlist` matches on.
 *
 * Workers typically surface the denial via:
 *   - kanban_block reason: "permission denied: outbound HTTP via curl"
 *   - run.error:           "Auto-deny: outbound HTTP via curl"
 *   - task comment:        "Tool call denied — outbound HTTP via curl"
 *
 * Best effort: pick the trailing label after the colon/dash. Returns null
 * when the reason doesn't smell like a permission denial — caller should
 * decide whether to expose the approve flow.
 */

const PERMISSION_KEYWORDS = /\b(permission|approval|auto[\s-]*deny|denied|consent[\s-]*required|requires? approval)\b/i

export function looksLikePermissionDenial(reason: string | null | undefined): boolean {
  return !!reason && PERMISSION_KEYWORDS.test(reason)
}

/** Try to extract the bare label. Returns null on miss. */
export function extractPermissionLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  const text = reason.trim()
  if (!text) return null

  /* Common shapes — strip leading prefix + colon/dash, drop trailing
     parenthetical "(denied)" / "(once)" and trailing punctuation. */
  const patterns: RegExp[] = [
    /(?:permission\s+denied|auto[\s-]*deny(?:ied)?|tool\s+call\s+denied|approval\s+denied|access\s+denied)\s*[:—–-]\s*(.+?)\s*(?:\([^)]*\))?\s*$/i,
    /^(?:permission|approval|auto[\s-]*deny)\s*[:—–-]\s*(.+?)\s*(?:\([^)]*\))?\s*$/i,
    /(.+?)\s*\((?:denied|auto-deny|once|session|always)\)\s*$/i
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m && m[1]) {
      const label = m[1].trim().replace(/[.;,]+$/, '').trim()
      if (label && !PERMISSION_KEYWORDS.test(label.split(/\s+/)[0] ?? '')) return label
    }
  }
  /* Fallback: if the text is short enough and doesn't read like a sentence,
     treat it as the label itself. Threshold tuned to typical classifier
     output (5-12 words). */
  if (text.length <= 120 && !/[.!?]/.test(text) && text.split(/\s+/).length <= 16) {
    return text
  }
  return null
}
