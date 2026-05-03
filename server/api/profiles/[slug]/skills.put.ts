import { useDb, type ProfileRow } from '../../../utils/db'
import { setDisabledSkills } from '../../../utils/skills'

interface PutBody {
  disabled?: unknown
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody<PutBody>(event) || {}
  if (!Array.isArray(body.disabled)) {
    throw createError({ statusCode: 400, statusMessage: '`disabled` must be an array of skill names' })
  }
  const disabled = body.disabled.filter((v): v is string => typeof v === 'string' && v.trim() !== '')

  const db = useDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  try {
    setDisabledSkills(row.hermes_dir, disabled)
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `Failed to update skills: ${(e as Error).message}` })
  }

  return { ok: true, disabled: [...new Set(disabled)].sort() }
})
