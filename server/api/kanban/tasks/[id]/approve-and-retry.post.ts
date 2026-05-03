import { spawn } from 'node:child_process'
import { useDb, type ProfileRow } from '../../../../utils/db'
import { getKanbanDb } from '../../../../utils/kanban'
import { readProfileConfig, writeProfileConfig } from '../../../../utils/profile-config'

interface PostBody {
  /** Dangerous-pattern label to append to the assignee's `command_allowlist`.
   *  Required — the UI pre-fills this from `extractPermissionLabel()` but the
   *  user can edit before submitting, so we trust whatever they send. */
  label?: string
  /** When true, also fire `hermes kanban dispatch --json` after unblock so the
   *  retry happens immediately instead of waiting up to 60 s for the next
   *  gateway tick. Defaults to true. */
  dispatch?: boolean
}

interface ApproveResult {
  taskId: string
  profile: string
  /** Was the label actually new (i.e. did we modify config.yaml)? */
  added: boolean
  /** Updated allowlist after the operation. */
  allowlist: string[]
  unblocked: boolean
  unblockError?: string
  dispatched: boolean
  dispatchError?: string
}

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

export default defineEventHandler(async (event): Promise<ApproveResult> => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing task id' })

  const body = await readBody<PostBody>(event).catch(() => ({} as PostBody)) || {}
  const label = (body.label ?? '').trim()
  if (!label) {
    throw createError({ statusCode: 400, statusMessage: '`label` is required' })
  }
  if (label.length > 200) {
    throw createError({ statusCode: 400, statusMessage: 'label too long (max 200 chars)' })
  }
  const shouldDispatch = body.dispatch !== false

  /* 1. Find the task's assignee in kanban.db. */
  const kdb = getKanbanDb()
  if (!kdb) throw createError({ statusCode: 500, statusMessage: 'kanban.db unavailable' })
  const task = kdb
    .prepare('SELECT assignee FROM tasks WHERE id = ?')
    .get(id) as { assignee: string | null } | undefined
  if (!task) throw createError({ statusCode: 404, statusMessage: 'task not found' })
  if (!task.assignee) {
    throw createError({ statusCode: 400, statusMessage: 'task has no assignee — nothing to allowlist' })
  }

  /* 2. Resolve the profile's hermes_dir from war-room.db. */
  const wrDb = useDb()
  const profile = wrDb
    .prepare('SELECT * FROM profiles WHERE slug = ?')
    .get(task.assignee) as unknown as ProfileRow | undefined
  if (!profile) {
    throw createError({
      statusCode: 404,
      statusMessage: `assignee profile "${task.assignee}" not found in war-room.db`
    })
  }

  /* 3. Append the label to command_allowlist (idempotent). */
  const cfg = readProfileConfig(profile.hermes_dir)
  const existing = new Set(cfg.allowlist)
  const added = !existing.has(label)
  const allowlist = added ? [...cfg.allowlist, label].sort() : cfg.allowlist
  if (added) {
    try {
      writeProfileConfig(profile.hermes_dir, { allowlist })
    } catch (e) {
      throw createError({
        statusCode: 500,
        statusMessage: `Failed to update command_allowlist: ${(e as Error).message}`
      })
    }
  }

  /* 4. Unblock the task. */
  const unblockRes = await runHermes(['kanban', 'unblock', id]).catch((e: Error) => ({
    code: -1, stdout: '', stderr: e.message
  }))
  const unblocked = unblockRes.code === 0
  const unblockError = unblocked ? undefined : (unblockRes.stderr.trim() || `code ${unblockRes.code}`)

  /* 5. Optionally fire a one-shot dispatch so the worker respawns
        immediately instead of waiting for the next gateway tick. */
  let dispatched = false
  let dispatchError: string | undefined
  if (shouldDispatch && unblocked) {
    const dispatchRes = await runHermes(['kanban', 'dispatch', '--json']).catch((e: Error) => ({
      code: -1, stdout: '', stderr: e.message
    }))
    dispatched = dispatchRes.code === 0
    dispatchError = dispatched ? undefined : (dispatchRes.stderr.trim() || `code ${dispatchRes.code}`)
  }

  return {
    taskId: id,
    profile: task.assignee,
    added,
    allowlist,
    unblocked,
    unblockError,
    dispatched,
    dispatchError
  }
})
