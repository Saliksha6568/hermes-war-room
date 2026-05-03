import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml, parseDocument as parseYamlDocument } from 'yaml'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')

export interface SkillEntry {
  name: string
  category: string | null
  description: string | null
  source: 'builtin' | 'global' | 'profile'
  path: string
}

interface RawFrontmatter {
  name?: string
  description?: string
}

const SKILL_NAME_LIMIT = 200
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

function readFrontmatter(file: string): RawFrontmatter | null {
  try {
    const head = readFileSync(file, 'utf8').slice(0, 4096)
    const match = head.match(FRONTMATTER_RE)
    if (!match || !match[1]) return null
    const parsed = parseYaml(match[1]) as RawFrontmatter
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function walkSkills(root: string, source: SkillEntry['source']): SkillEntry[] {
  if (!existsSync(root)) return []

  const out: SkillEntry[] = []

  const visit = (dir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }

    const skillFile = join(dir, 'SKILL.md')
    if (existsSync(skillFile)) {
      const fm = readFrontmatter(skillFile)
      const rel = relative(root, dir)
      const parts = rel.split(/[\\/]/)
      const name = (fm?.name?.trim() || parts[parts.length - 1] || rel).slice(0, SKILL_NAME_LIMIT)
      const category = parts.length > 1 ? parts.slice(0, -1).join('/') : null
      const description = fm?.description?.trim() || null
      out.push({ name, category, description, source, path: dir })
      // Don't recurse into a skill dir.
      return
    }

    for (const entry of entries) {
      if (entry.startsWith('.')) continue
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) visit(full)
      } catch {
        /* skip */
      }
    }
  }

  visit(root)
  return out
}

export function listGlobalSkills(): SkillEntry[] {
  return [
    ...walkSkills(join(HERMES_HOME, 'hermes-agent', 'skills'), 'builtin'),
    ...walkSkills(join(HERMES_HOME, 'skills'), 'global')
  ]
}

export function listProfileSkills(profileDir: string): SkillEntry[] {
  return walkSkills(join(profileDir, 'skills'), 'profile')
}

function profileConfigPath(profileDir: string): string {
  return join(profileDir, 'config.yaml')
}

export function getDisabledSkills(profileDir: string): string[] {
  const cfgPath = profileConfigPath(profileDir)
  if (!existsSync(cfgPath)) return []
  try {
    const raw = readFileSync(cfgPath, 'utf8')
    const cfg = parseYaml(raw) as { skills?: { disabled?: unknown } } | null
    const disabled = cfg?.skills?.disabled
    if (!Array.isArray(disabled)) return []
    return disabled.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

export function setDisabledSkills(profileDir: string, disabled: string[]): void {
  const cfgPath = profileConfigPath(profileDir)
  if (!existsSync(cfgPath)) {
    throw new Error(`Profile config not found at ${cfgPath}`)
  }
  // Use parseDocument so we preserve comments / formatting where possible.
  const raw = readFileSync(cfgPath, 'utf8')
  const doc = parseYamlDocument(raw)

  const sorted = [...new Set(disabled)].sort()

  // Ensure `skills:` mapping exists, then set `disabled` to the new list.
  if (!doc.has('skills')) {
    doc.set('skills', { disabled: sorted })
  } else {
    doc.setIn(['skills', 'disabled'], sorted)
  }

  // Atomic write (write to temp, rename) to reduce risk of corrupting config.
  const tmp = `${cfgPath}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, doc.toString(), { mode: 0o600 })
    renameSync(tmp, cfgPath)
  } catch (e) {
    try {
      unlinkSync(tmp)
    } catch { /* ignore */ }
    throw e
  }
}
