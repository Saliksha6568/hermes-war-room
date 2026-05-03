import { useDb } from '../../../utils/db'
import { warmup } from '../../../utils/orchestrator-acp'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const db = useDb()
  const profile = db
    .prepare('SELECT slug, active FROM profiles WHERE slug = ? AND present = 1')
    .get(slug) as { slug: string, active: number } | undefined
  if (!profile) throw createError({ statusCode: 404, statusMessage: `Profile "${slug}" not found` })
  if (!profile.active) throw createError({ statusCode: 400, statusMessage: `Profile "${slug}" is inactive` })

  const startedAt = Date.now()
  try {
    const { alreadyWarm } = await warmup(slug)
    return {
      ok: true,
      alreadyWarm,
      elapsedMs: Date.now() - startedAt
    }
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `Warmup failed: ${(e as Error).message}` })
  }
})
