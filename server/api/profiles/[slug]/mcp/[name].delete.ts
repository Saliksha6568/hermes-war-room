import { useDb, type ProfileRow } from '../../../../utils/db'
import { removeMcpServer } from '../../../../utils/mcp'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  const name = getRouterParam(event, 'name')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Missing MCP server name' })

  const db = useDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  let removed = false
  try {
    removed = removeMcpServer(row.hermes_dir, name)
  } catch (e) {
    throw createError({ statusCode: 500, statusMessage: `Failed to remove MCP server: ${(e as Error).message}` })
  }

  if (!removed) {
    throw createError({ statusCode: 404, statusMessage: `MCP server "${name}" not found in profile "${slug}"` })
  }

  return { ok: true }
})
