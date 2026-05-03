import { useDb, type ProfileRow } from '../../../utils/db'
import { writeSoul } from '../../../utils/soul'
import { syncRoster } from '../../../utils/roster'

interface PutBody {
  soul?: unknown
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody<PutBody>(event) || {}
  if (typeof body.soul !== 'string') {
    throw createError({ statusCode: 400, statusMessage: '`soul` must be a string' })
  }

  const db = useDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  try {
    writeSoul(row.hermes_dir, body.soul)
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `Failed to write SOUL.md: ${(e as Error).message}` })
  }

  try {
    syncRoster()
  } catch (e) {
    console.error('[roster] sync failed after soul update:', (e as Error).message)
  }

  return { ok: true }
})
