import { randomUUID } from 'node:crypto'
import { useDb, type ProfileRow } from '../../utils/db'
import { avatarUrl, type Gesture } from '../../utils/avatar'
import { syncRoster } from '../../utils/roster'

interface PatchBody {
  givenName?: string | null
  rerollAvatar?: boolean
  active?: boolean
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody<PatchBody>(event) || {}
  const db = useDb()

  const existing = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  const updates: string[] = []
  const values: (string | number | null)[] = []
  let rosterAffected = false

  if ('givenName' in body) {
    const trimmed = typeof body.givenName === 'string' ? body.givenName.trim() : null
    updates.push('given_name = ?')
    values.push(trimmed && trimmed.length > 0 ? trimmed : null)
    rosterAffected = true
  }

  if (body.rerollAvatar) {
    updates.push('avatar_seed = ?')
    values.push(randomUUID())
  }

  if (typeof body.active === 'boolean') {
    updates.push('active = ?')
    values.push(body.active ? 1 : 0)
    rosterAffected = true
  }

  if (updates.length === 0) throw createError({ statusCode: 400, statusMessage: 'No-op' })

  values.push(slug)
  db.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE slug = ?`).run(...values)

  if (rosterAffected) {
    try {
      syncRoster()
    } catch (e) {
      console.error('[roster] sync failed after patch:', (e as Error).message)
    }
  }

  const r = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow

  return {
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
  }
})
