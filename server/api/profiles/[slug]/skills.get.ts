import { useDb, type ProfileRow } from '../../../utils/db'
import { listProfileSkills, getDisabledSkills, type SkillEntry } from '../../../utils/skills'
import type { SkillView } from '../../skills.get'

export default defineEventHandler((event): SkillView[] => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const db = useDb()
  const row = db
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(slug) as unknown as ProfileRow | undefined
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  const skills = listProfileSkills(row.hermes_dir)
  const disabled = new Set(getDisabledSkills(row.hermes_dir))

  const seen = new Map<string, SkillEntry>()
  for (const s of skills) {
    if (!seen.has(s.name)) seen.set(s.name, s)
  }

  return [...seen.values()]
    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
    .map(s => ({
      name: s.name,
      category: s.category,
      description: s.description,
      source: s.source,
      enabled: !disabled.has(s.name)
    }))
})
