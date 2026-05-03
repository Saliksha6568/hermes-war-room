import { useDb } from '../../../utils/db'
import { listTools } from '../../../utils/tools'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const db = useDb()
  const row = db
    .prepare('SELECT slug FROM profiles WHERE slug = ?')
    .get(slug) as { slug: string } | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  return listTools(slug)
})
