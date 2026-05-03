import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface DiscoveredProfile {
  slug: string
  isDefault: boolean
  hermesDir: string
}

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')

export function discoverProfiles(): DiscoveredProfile[] {
  const out: DiscoveredProfile[] = []

  try {
    statSync(HERMES_HOME)
    out.push({ slug: 'default', isDefault: true, hermesDir: HERMES_HOME })
  } catch {
    return out
  }

  const profilesDir = join(HERMES_HOME, 'profiles')
  let entries: string[] = []
  try {
    entries = readdirSync(profilesDir)
  } catch {
    return out
  }

  for (const name of entries) {
    const dir = join(profilesDir, name)
    try {
      if (statSync(dir).isDirectory()) {
        out.push({ slug: name, isDefault: false, hermesDir: dir })
      }
    } catch { /* skip */ }
  }

  return out
}
