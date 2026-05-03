import { useDb } from '../../../utils/db'
import { applyToolState, listTools } from '../../../utils/tools'

interface PutBody {
  enabled?: unknown
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody<PutBody>(event) || {}
  if (!Array.isArray(body.enabled)) {
    throw createError({ statusCode: 400, statusMessage: '`enabled` must be an array of toolset names' })
  }
  const requested = new Set(body.enabled.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))

  const db = useDb()
  const row = db
    .prepare('SELECT slug FROM profiles WHERE slug = ?')
    .get(slug) as { slug: string } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  const current = await listTools(slug)
  const known = new Set(current.map(t => t.name))

  // Filter requested down to known toolsets so we don't pass garbage to the CLI.
  const target = new Set([...requested].filter(n => known.has(n)))

  const toEnable: string[] = []
  const toDisable: string[] = []
  for (const t of current) {
    const wantOn = target.has(t.name)
    if (wantOn && !t.enabled) toEnable.push(t.name)
    else if (!wantOn && t.enabled) toDisable.push(t.name)
  }

  try {
    await applyToolState(slug, toEnable, toDisable)
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `Failed to update tools: ${(e as Error).message}` })
  }

  return { ok: true, enabled: [...target].sort() }
})
