import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

let cached: DatabaseSync | null = null

export function useDb(): DatabaseSync {
  if (cached) return cached

  const dbPath = resolve(process.cwd(), 'data/war-room.db')
  mkdirSync(dirname(dbPath), { recursive: true })

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      slug              TEXT PRIMARY KEY,
      display_name      TEXT NOT NULL,
      is_default        INTEGER NOT NULL DEFAULT 0,
      hermes_dir        TEXT NOT NULL,
      avatar_seed       TEXT NOT NULL,
      background_color  TEXT NOT NULL,
      gesture           TEXT NOT NULL DEFAULT 'hand',
      first_seen        TEXT NOT NULL,
      last_seen         TEXT NOT NULL
    );
  `)

  const cols = db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('given_name')) {
    db.exec('ALTER TABLE profiles ADD COLUMN given_name TEXT;')
  }
  if (!colNames.has('present')) {
    db.exec('ALTER TABLE profiles ADD COLUMN present INTEGER NOT NULL DEFAULT 1;')
  }
  if (!colNames.has('active')) {
    db.exec('ALTER TABLE profiles ADD COLUMN active INTEGER NOT NULL DEFAULT 1;')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id                 TEXT PRIMARY KEY,
      orchestrator_slug  TEXT NOT NULL,
      acp_session_id     TEXT,
      title              TEXT,
      status             TEXT NOT NULL DEFAULT 'open',
      created_at         TEXT NOT NULL,
      last_message_at    TEXT NOT NULL
    );
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mission_messages_mission
      ON mission_messages(mission_id, id);
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_missions_active
      ON missions(orchestrator_slug, status, last_message_at);
  `)

  /* Auto-nudge watch list — persisted so it survives Nitro restarts. The
     in-memory state is rehydrated from this table at boot. `notified_at`
     is set once we've successfully fired a nudge for that task; rows with
     it NULL are still pending. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_watched_tasks (
      mission_id    TEXT NOT NULL,
      task_id       TEXT NOT NULL,
      added_status  TEXT NOT NULL,
      added_at      INTEGER NOT NULL,
      notified_at   INTEGER,
      PRIMARY KEY (mission_id, task_id)
    );
  `)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_watched_pending
      ON mission_watched_tasks(notified_at, mission_id);
  `)

  cached = db
  return db
}

export interface MissionRow {
  id: string
  orchestrator_slug: string
  acp_session_id: string | null
  title: string | null
  status: string
  created_at: string
  last_message_at: string
}

export interface MissionMessageRow {
  id: number
  mission_id: string
  role: string
  content: string
  created_at: string
}

export interface ProfileRow {
  slug: string
  display_name: string
  is_default: number
  hermes_dir: string
  avatar_seed: string
  background_color: string
  gesture: string
  first_seen: string
  last_seen: string
  given_name: string | null
  present: number
  active: number
}
