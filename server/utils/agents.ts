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
