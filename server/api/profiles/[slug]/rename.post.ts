import { spawn } from 'node:child_process'
import { useDb, type ProfileRow } from '../../../utils/db'
import { discoverProfiles } from '../../../utils/hermes'
import { syncRoster } from '../../../utils/roster'
import { avatarUrl, type Gesture } from '../../../utils/avatar'

const NAME_RE = /^[a-z0-9]+$/

function runHermes(args: string[]): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: string) => stdout += d)
    child.stderr.on('data', (d: string) => stderr += d)
    child.on('error', reject)
    child.on('close', (code: number | null) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const body = await readBody<{ newSlug?: string }>(event) || {}
  const newSlug = (body.newSlug ?? '').trim()

  if (!newSlug) throw createError({ statusCode: 400, statusMessage: 'newSlug required' })
  if (!NAME_RE.test(newSlug)) {
    throw createError({ statusCode: 400, statusMessage: 'Profile name must be lowercase alphanumeric' })
  }
  if (newSlug === slug) {
    throw createError({ statusCode: 400, statusMessage: 'newSlug must differ from current slug' })
  }

  const db = useDb()
  const existing = db.prepare('SELECT * FROM profiles WHERE slug = ?').get(slug) as ProfileRow | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
  if (existing.is_default === 1) {
    throw createError({ statusCode: 400, statusMessage: 'Cannot rename the default profile' })
  }

  const conflict = db.prepare('SELECT slug FROM profiles WHERE slug = ?').get(newSlug)
  if (conflict) {
    throw createError({ statusCode: 409, statusMessage: `Profile "${newSlug}" already exists` })
  }

  const { code, stderr } = await runHermes(['profile', 'rename', slug, newSlug]).catch((e: Error) => {
    throw createError({ statusCode: 500, statusMessage: `Failed to invoke hermes: ${e.message}` })
  })
  if (code !== 0) {
    throw createError({
      statusCode: 500,
      statusMessage: stderr.trim() || `hermes profile rename exited with code ${code}`
    })
  }

  const discovered = discoverProfiles().find(p => p.slug === newSlug)
  const newHermesDir = discovered?.hermesDir ?? existing.hermes_dir.replace(/[/\\][^/\\]+$/, '/' + newSlug)

  db.prepare(`
    UPDATE profiles
       SET slug = ?, display_name = ?, hermes_dir = ?
     WHERE slug = ?
  `).run(newSlug, newSlug, newHermesDir, slug)

  try {
    syncRoster()
  } catch (e) {
    console.error('[roster] sync failed after rename:', (e as Error).message)
  }

  const r = db.prepare('SELECT * FROM profiles WHERE slug = ?').get(newSlug) as ProfileRow
  return {
    slug: r.slug,
    displayName: r.display_name,
    givenName: r.given_name,
    isDefault: r.is_default === 1,
    active: r.active === 1,
    hermesDir: r.hermes_dir,
    backgroundColor: r.background_color,
    gesture: r.gesture as Gesture,
    avatarSeed: r.avatar_seed,
    avatarUrl: avatarUrl({
      seed: r.avatar_seed,
      backgroundColor: r.background_color,
      gesture: r.gesture as Gesture,
      size: 240
    }),
    avatarPortraitUrl: avatarUrl({
      seed: r.avatar_seed,
      gesture: r.gesture as Gesture,
      size: 320,
      transparent: true
    }),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen
  }
})
