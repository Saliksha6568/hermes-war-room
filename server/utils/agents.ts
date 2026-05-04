import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const AGENTS_FILENAME = 'AGENTS.md'
// 64 KiB cap. AGENTS.md is for behavior rules, not a wiki.
const AGENTS_MAX_BYTES = 64 * 1024

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const GLOBAL_AGENTS_PATH = join(HERMES_HOME, AGENTS_FILENAME)

function profilePath(profileDir: string): string {
  return join(profileDir, AGENTS_FILENAME)
}

export interface ReadAgentsResult {
  content: string
  /**
   * `'profile'` when the file lives in the profile dir, `'global'` when we
   * fell back to ~/.hermes/AGENTS.md, `'empty'` when neither exists. The UI
   * uses this to flag "you're editing the inherited global rules" vs. an
   * already-overridden per-profile copy.
   */
  source: 'profile' | 'global' | 'empty'
}

export function readAgents(profileDir: string): ReadAgentsResult {
  const local = profilePath(profileDir)
  if (existsSync(local)) {
    return { content: readFileSync(local, 'utf8'), source: 'profile' }
  }
  if (existsSync(GLOBAL_AGENTS_PATH)) {
    return { content: readFileSync(GLOBAL_AGENTS_PATH, 'utf8'), source: 'global' }
  }
  return { content: '', source: 'empty' }
}

export function writeAgents(profileDir: string, contents: string): void {
  if (Buffer.byteLength(contents, 'utf8') > AGENTS_MAX_BYTES) {
    throw new Error(`AGENTS.md too large (max ${AGENTS_MAX_BYTES} bytes)`)
  }
  const path = profilePath(profileDir)
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, contents, { mode: 0o600 })
    renameSync(tmp, path)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch { /* ignore */ }
    throw e
  }
}

const MANAGED_BEGIN = '<!-- WAR-ROOM-MANAGED:BEGIN — do not edit between markers, regenerated on roster sync -->'
const MANAGED_END = '<!-- WAR-ROOM-MANAGED:END -->'

const MANAGED_BLOCK_BODY = `## War Room rule

Never embed bulk data (long lists, file contents, datasets, full reports) as literals inside a tool call argument. Write them to a file in \`$HERMES_KANBAN_WORKSPACE\` and have the tool read from that path.

For \`kanban_complete\` / \`kanban_block\` / \`kanban_comment\`:
- \`summary\` / \`reason\` / \`body\`: ≤500 chars. Reference workspace files by path for detail.
- \`metadata\`: ≤500 chars total. Compact structured handoff only — ids, counts, file paths, booleans, short enum-like labels. Never put prose, per-item summaries, full reports, or repeated content in \`metadata\` — those go in workspace files; \`metadata\` only carries the path and minimal counts.

Inlining bulk data exhausts the output token budget, truncates the tool call, and the task fails.`

const MANAGED_BLOCK = `${MANAGED_BEGIN}\n${MANAGED_BLOCK_BODY}\n${MANAGED_END}`

const MANAGED_BLOCK_RE = new RegExp(
  `${MANAGED_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  'g'
)

/**
 * Maintain a war-room-managed block inside the profile's AGENTS.md. The block
 * is bracketed with sentinel HTML comments so we can rewrite it idempotently
 * without touching user-authored content. Hermes loads AGENTS.md on every
 * profile turn (orchestrator and worker), so rules written here reach the
 * full fleet — unlike the orchestrator preamble or the team-roster skill
 * which only the orchestrator sees.
 *
 * Idempotent: skip the write if the file already contains the exact block.
 */
export function syncManagedAgentsBlock(profileDir: string): void {
  const path = profilePath(profileDir)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''

  let next: string
  if (MANAGED_BLOCK_RE.test(existing)) {
    MANAGED_BLOCK_RE.lastIndex = 0
    next = existing.replace(MANAGED_BLOCK_RE, MANAGED_BLOCK)
  } else if (existing.trim().length === 0) {
    next = `${MANAGED_BLOCK}\n`
  } else {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n'
    next = `${existing}${sep}${MANAGED_BLOCK}\n`
  }

  if (next === existing) return

  if (Buffer.byteLength(next, 'utf8') > AGENTS_MAX_BYTES) {
    throw new Error(`AGENTS.md too large after managed block update (max ${AGENTS_MAX_BYTES} bytes)`)
  }

  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, next, { mode: 0o600 })
    renameSync(tmp, path)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* ignore */ }
    throw e
  }
}
