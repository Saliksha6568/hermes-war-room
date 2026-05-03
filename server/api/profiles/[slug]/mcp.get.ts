import { useDb, type ProfileRow } from '../../../utils/db'
import { listMcpServers } from '../../../utils/mcp'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const db = useDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  return { servers: listMcpServers(row.hermes_dir) }
})
