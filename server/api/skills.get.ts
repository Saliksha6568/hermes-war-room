import { listGlobalSkills, type SkillEntry } from '../utils/skills'

export interface SkillView {
  name: string
  category: string | null
  description: string | null
  source: SkillEntry['source']
  enabled: boolean
}

export default defineEventHandler((): SkillView[] => {
  const skills = listGlobalSkills()
  // Dedupe by name (builtin wins over global if there's an overlap).
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
      enabled: true
    }))
})
