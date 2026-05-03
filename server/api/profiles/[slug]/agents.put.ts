import { useDb, type ProfileRow } from '../../../utils/db'
import { writeAgents } from '../../../utils/agents'

interface PutBody {
  content?: unknown
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody<PutBody>(event) || {}
  if (typeof body.content !== 'string') {
    throw createError({ statusCode: 400, statusMessage: '`content` must be a string' })
  }

  const db = useDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  try {
    writeAgents(row.hermes_dir, body.content)
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `Failed to write AGENTS.md: ${(e as Error).message}` })
  }

  return { ok: true }
})
