import { spawn } from 'node:child_process'
import { useDb, type ProfileRow } from '../../utils/db'
import { syncRoster } from '../../utils/roster'

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

  const db = useDb()
  const existing = db
    .prepare('SELECT slug, is_default FROM profiles WHERE slug = ?')
    .get(slug) as Pick<ProfileRow, 'slug' | 'is_default'> | undefined
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Profile not found' })

  if (existing.is_default === 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Cannot fire the default profile — Hermes needs it to function.'
    })
  }

  const { code, stderr } = await runHermes(['profile', 'delete', slug, '--yes']).catch((e: Error) => {
    throw createError({ statusCode: 500, statusMessage: `Failed to invoke hermes: ${e.message}` })
  })

  if (code !== 0) {
    throw createError({
      statusCode: 500,
      statusMessage: stderr.trim() || `hermes profile delete exited with code ${code}`
    })
  }

  db.prepare('DELETE FROM profiles WHERE slug = ?').run(slug)

  try {
    syncRoster()
  } catch (e) {
    console.error('[roster] sync failed after fire:', (e as Error).message)
  }

  setResponseStatus(event, 204)
  return null
})
