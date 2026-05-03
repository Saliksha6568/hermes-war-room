import { useDb, type ProfileRow } from '../utils/db'
import { discoverProfiles } from '../utils/hermes'
import { avatarUrl, defaultSeed, pickColor, type Gesture } from '../utils/avatar'
import { syncRoster } from '../utils/roster'

let rosterPrimed = false

export default defineEventHandler(() => {
  const db = useDb()
  const now = new Date().toISOString()

  const discovered = discoverProfiles()

  const insert = db.prepare(`
    INSERT INTO profiles (slug, display_name, is_default, hermes_dir, avatar_seed, background_color, gesture, first_seen, last_seen, present)
    VALUES (?, ?, ?, ?, ?, ?, 'hand', ?, ?, 1)
    ON CONFLICT(slug) DO UPDATE SET
      display_name = excluded.display_name,
      is_default   = excluded.is_default,
      hermes_dir   = excluded.hermes_dir,
      last_seen    = excluded.last_seen,
      present      = 1
  `)

  // Reconcile: anything not in the current scan is considered absent. We keep
  // the row so a re-created profile recovers its callsign and avatar.
  db.exec('UPDATE profiles SET present = 0')

  for (const p of discovered) {
    insert.run(
      p.slug,
      p.slug,
      p.isDefault ? 1 : 0,
      p.hermesDir,
      defaultSeed(p.slug),
      pickColor(p.slug),
      now,
      now
    )
  }

  const rows = db
    .prepare('SELECT * FROM profiles WHERE present = 1 ORDER BY is_default DESC, slug ASC')
    .all() as unknown as ProfileRow[]

  // Once per server-process lifetime, ensure the team-roster skill and roster
  // file exist on disk so a freshly-installed war-room is usable immediately
  // without waiting for the first mutation.
  if (!rosterPrimed) {
    rosterPrimed = true
    try {
      syncRoster()
    } catch (e) {
      console.error('[roster] initial sync failed:', (e as Error).message)
    }
  }

  return rows.map(r => ({
    slug: r.slug,
    displayName: r.display_name,
    givenName: r.given_name,
    isDefault: r.is_default === 1,
    active: r.active === 1,
    hermesDir: r.hermes_dir,
    backgroundColor: r.background_color,
    gesture: r.gesture as Gesture,
    avatarSeed: r.avatar_seed,
    avatarUrl: avatarUrl({
      seed: r.avatar_seed,
      backgroundColor: r.background_color,
      gesture: r.gesture as Gesture,
      size: 240
    }),
    avatarPortraitUrl: avatarUrl({
      seed: r.avatar_seed,
      gesture: r.gesture as Gesture,
      size: 320,
      transparent: true
    }),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen
  }))
})
