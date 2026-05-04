import { unlinkSync, rmdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { useDb, type ProfileRow } from './db'
import { readSoul } from './soul'
import { syncManagedAgentsBlock } from './agents'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')

// Legacy artefacts that previous war-room versions wrote — we stop generating
// them and delete on every sync so the orchestrator can never accidentally
// load a stale roster from disk.
const LEGACY_ROSTER_FILE = join(HERMES_HOME, 'team-roster.md')
const LEGACY_GLOBAL_SKILL_DIR = join(HERMES_HOME, 'skills', 'team-roster')

const ROLE_FIELDS = ['Role', 'Creature', 'Vibe', 'Mission']
const ROLE_LINE_RE = new RegExp(`^[*\\-]?\\s*\\*\\*(${ROLE_FIELDS.join('|')}):\\*\\*\\s*(.+?)\\s*$`, 'i')

const ROLE_MAX_CHARS = 240

export function extractRole(soul: string): string | null {
  if (!soul) return null

  const lines = soul.split(/\r?\n/)

  // First pass: look for a known field (Role / Creature / Vibe / Mission).
  for (const raw of lines) {
    const m = raw.match(ROLE_LINE_RE)
    if (m && m[2]) {
      return m[2].replace(/\*\*/g, '').trim().slice(0, ROLE_MAX_CHARS)
    }
  }

  // Fallback: first non-trivial line that isn't a heading or italic-only callout.
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) continue
    if (/^[_*].*[_*]$/.test(line) && !/[a-z0-9].*[a-z0-9]/i.test(line.replace(/[_*]/g, ''))) continue
    if (line.startsWith('---')) continue
    if (/^who am i\??$/i.test(line)) continue
    return line.replace(/^\*\*|\*\*$/g, '').replace(/\*\*/g, '').slice(0, ROLE_MAX_CHARS)
  }

  return null
}

/**
 * Build the active-roster bullet list ready to inline into the orchestrator
 * preamble. Composed live from the war-room DB so every user turn carries the
 * current team — mid-mission hires/fires/activations propagate without an ACP
 * session restart.
 */
export function buildRosterMarkdown(): string {
  const db = useDb()
  const rows = db
    .prepare('SELECT * FROM profiles WHERE present = 1 AND active = 1 ORDER BY is_default DESC, slug ASC')
    .all() as unknown as ProfileRow[]

  if (rows.length === 0) {
    return '_No active profiles. Hire one in the war-room or activate an existing profile before delegating._'
  }

  const lines: string[] = []
  for (const r of rows) {
    const callsign = r.given_name?.trim() || r.display_name
    const soul = readSoul(r.hermes_dir)
    const role = extractRole(soul) ?? '(no description — edit SOUL.md to describe what this agent does)'
    const callsignSuffix = callsign && callsign !== r.slug ? ` (${callsign})` : ''
    lines.push(`- \`${r.slug}\`${callsignSuffix} — ${role}`)
  }
  return lines.join('\n')
}

function safeUnlink(path: string): boolean {
  try {
    if (existsSync(path)) {
      unlinkSync(path)
      return true
    }
  } catch (e) {
    console.error(`[roster] failed to unlink ${path}:`, (e as Error).message)
  }
  return false
}

function safeRmdir(path: string): boolean {
  try {
    if (existsSync(path) && statSync(path).isDirectory() && readdirSync(path).length === 0) {
      rmdirSync(path)
      return true
    }
  } catch (e) {
    console.error(`[roster] failed to rmdir ${path}:`, (e as Error).message)
  }
  return false
}

/**
 * Tear down the legacy team-roster artefacts (the standalone team-roster.md
 * data file and the per-profile/global SKILL.md installs). The orchestrator
 * now reads the roster directly from the per-turn preamble; leaving the old
 * files around lets a stale system prompt drift from the live DB.
 *
 * Idempotent: skips anything that doesn't exist.
 */
function cleanupLegacyRosterArtefacts(): void {
  // Standalone data file.
  safeUnlink(LEGACY_ROSTER_FILE)

  // Global skill directory.
  safeUnlink(join(LEGACY_GLOBAL_SKILL_DIR, 'SKILL.md'))
  safeRmdir(LEGACY_GLOBAL_SKILL_DIR)

  // Per-profile skill copies.
  const db = useDb()
  const rows = db
    .prepare('SELECT hermes_dir FROM profiles WHERE present = 1')
    .all() as unknown as { hermes_dir: string }[]
  for (const row of rows) {
    const skillDir = join(row.hermes_dir, 'skills', 'team-roster')
    safeUnlink(join(skillDir, 'SKILL.md'))
    safeRmdir(skillDir)
  }
}

/** Refresh state owned by the war-room that depends on the active-profile
 *  list: per-profile AGENTS.md managed block, per-profile kanban.db symlinks,
 *  and tear-down of legacy team-roster files. The roster itself now lives in
 *  the orchestrator preamble (see `buildRosterMarkdown`) so there's no
 *  on-disk team-roster artefact to keep in sync. Safe to call on every write. */
export function syncRoster(): void {
  cleanupLegacyRosterArtefacts()

  const db = useDb()
  const rows = db
    .prepare('SELECT hermes_dir FROM profiles WHERE present = 1')
    .all() as unknown as { hermes_dir: string }[]
  for (const row of rows) {
    try {
      syncManagedAgentsBlock(row.hermes_dir)
    } catch (e) {
      console.error(`[roster] failed to sync AGENTS.md block in ${row.hermes_dir}:`, (e as Error).message)
    }
  }

  // Lazy import to avoid circular dep — kanban-symlinks reads from db.ts
  // which is also loaded here.
  void (async () => {
    const { ensureKanbanSymlinks } = await import('./kanban-symlinks')
    try {
      const { updated } = ensureKanbanSymlinks()
      if (updated.length > 0) {
        console.log(`[kanban-symlinks] refreshed for: ${updated.join(', ')}`)
      }
    } catch (e) {
      console.error('[kanban-symlinks] sync failed:', (e as Error).message)
    }
  })()
}
