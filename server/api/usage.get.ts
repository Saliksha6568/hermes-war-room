import { useDb, type ProfileRow } from '../utils/db'
import { readTokenUsage, type TokenUsage } from '../utils/tokens'

export default defineEventHandler(() => {
  const db = useDb()
  const rows = db
    .prepare('SELECT slug, hermes_dir FROM profiles WHERE present = 1')
    .all() as unknown as Pick<ProfileRow, 'slug' | 'hermes_dir'>[]

  const usage: Record<string, TokenUsage> = {}
  for (const r of rows) {
    usage[r.slug] = readTokenUsage(r.hermes_dir)
  }
  return { usage, generatedAt: Date.now() }
})
