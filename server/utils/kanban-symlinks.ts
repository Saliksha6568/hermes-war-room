import { existsSync, lstatSync, readlinkSync, realpathSync, unlinkSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { useDb } from './db'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const GLOBAL_KANBAN = join(HERMES_HOME, 'kanban.db')

function realPathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
const HERMES_HOME_REAL = realPathOrSelf(HERMES_HOME)

// Hermes's `-p <slug>` flag sets HERMES_HOME=<profile-dir> for the spawned
// process. That makes per-profile kanban_db_path() resolve to
// `<profile-dir>/kanban.db` — empty stub files instead of the global board.
// Workers spawned by the dispatcher with `-p <slug>` then can't find the
// task they were sent to work on. Symlinking every profile's kanban.db to
// the global one fixes this without needing Hermes-side changes.
//
// We also link the WAL and SHM sidecar files so SQLite doesn't get confused.
const SQLITE_SUFFIXES = ['', '-shm', '-wal'] as const

function ensureSymlink(profileDir: string): boolean {
  // Defensive: refuse to operate if the profile dir IS the global home —
  // otherwise the link path equals the target path and we'd self-loop.
  if (realPathOrSelf(profileDir) === HERMES_HOME_REAL) return false
  let touched = false
  for (const suffix of SQLITE_SUFFIXES) {
    const target = `${GLOBAL_KANBAN}${suffix}`
    const link = join(profileDir, `kanban.db${suffix}`)
    if (resolve(link) === resolve(target)) continue
    try {
      if (existsSync(link)) {
        const st = lstatSync(link)
        if (st.isSymbolicLink()) {
          // Already a symlink — check target.
          const current = readlinkSync(link)
          if (current === target) continue
        }
        unlinkSync(link)
      }
      symlinkSync(target, link)
      touched = true
    } catch (e) {
      // Skip the SHM/WAL files if they don't exist yet — SQLite recreates
      // them on next write. Only the main .db link is mandatory.
      if (suffix === '') {
        console.error(
          `[kanban-symlinks] failed to link ${link} → ${target}:`,
          (e as Error).message
        )
      }
    }
  }
  return touched
}

/**
 * Walk the profiles table and replace each profile's local `kanban.db` (plus
 * its `-shm` / `-wal` sidecars) with a symlink to the global one. Idempotent
 * — already-correct symlinks are left untouched.
 *
 * Profiles whose `hermes_dir` resolves to the same path as `HERMES_HOME` are
 * skipped: they ARE the global home, so symlinking would point the file at
 * itself and trash the database (it has happened — don't do it again).
 */
export function ensureKanbanSymlinks(): { updated: string[], skipped: string[] } {
  if (!existsSync(GLOBAL_KANBAN)) return { updated: [], skipped: [] }
  const db = useDb()
  const rows = db
    .prepare('SELECT slug, hermes_dir FROM profiles WHERE present = 1')
    .all() as { slug: string, hermes_dir: string }[]
  const updated: string[] = []
  const skipped: string[] = []
  for (const r of rows) {
    // Resolve symlinks and `..` so we can't be tricked into self-linking by
    // a profile dir that happens to be a relative path equal to HERMES_HOME.
    const profileReal = realPathOrSelf(r.hermes_dir)
    if (profileReal === HERMES_HOME_REAL) {
      skipped.push(r.slug)
      continue
    }
    if (ensureSymlink(r.hermes_dir)) updated.push(r.slug)
  }
  return { updated, skipped }
}
