import { spawn } from 'node:child_process'

interface RunRow {
  id: number
  profile: string
  status: string
  worker_pid: number | null
  ended_at: number | null
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

function killPid(pid: number, signal: NodeJS.Signals): { ok: boolean, error?: string } {
  try {
    process.kill(pid, signal)
    return { ok: true }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return { ok: true } // already gone
    if (code === 'EPERM') return { ok: false, error: 'no permission' }
    return { ok: false, error: (e as Error).message }
  }
}

interface KillResult {
  taskId: string
  workersKilled: number[]
  workersFailed: { pid: number, reason: string }[]
  archived: boolean
  archiveError?: string
}

export default defineEventHandler(async (event): Promise<KillResult> => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing task id' })

  const body = await readBody<{ reason?: string }>(event).catch(() => ({} as { reason?: string })) || {}
  const reason = (body.reason ?? 'killed via war-room').trim() || 'killed via war-room'

  /* 1. Find the live worker PIDs via `hermes kanban runs <id> --json`.
     2. SIGTERM each (allow Hermes' cleanup to fire).
        If still alive after a beat, escalate to SIGKILL.
     3. Mark the kanban task `blocked` with the reason. */
  const runsResult = await runHermes(['kanban', 'runs', id, '--json']).catch((e: Error) => {
    throw createError({ statusCode: 500, statusMessage: `Failed to list runs: ${e.message}` })
  })
  if (runsResult.code !== 0) {
    throw createError({
      statusCode: 500,
      statusMessage: runsResult.stderr.trim() || `hermes kanban runs exited with code ${runsResult.code}`
    })
  }

  let runs: RunRow[] = []
  try {
    runs = JSON.parse(runsResult.stdout || '[]') as RunRow[]
  } catch {
    runs = []
  }
  const livePids = runs
    .filter(r => r.status === 'running' && !r.ended_at && typeof r.worker_pid === 'number')
    .map(r => r.worker_pid as number)

  const workersKilled: number[] = []
  const workersFailed: { pid: number, reason: string }[] = []

  for (const pid of livePids) {
    const term = killPid(pid, 'SIGTERM')
    if (!term.ok) {
      workersFailed.push({ pid, reason: term.error ?? 'unknown' })
      continue
    }
    workersKilled.push(pid)
  }

  /* Give SIGTERM a brief moment, then SIGKILL anything still alive. */
  if (workersKilled.length) {
    await new Promise(r => setTimeout(r, 600))
    for (const pid of workersKilled) {
      try {
        process.kill(pid, 0) // probe
        killPid(pid, 'SIGKILL') // still alive → escalate
      } catch { /* gone, good */ }
    }
  }

  /* Mark blocked first (so the dispatcher won't requeue it) and then archive
     it so it disappears from the active board. The user explicitly asked for
     killed tasks to disappear, not stick around as `blocked`. The reason is
     attached as a comment by `block`, then `archive` removes it from the
     active list — both states are recoverable via `hermes kanban` if needed. */
  await runHermes(['kanban', 'block', id, reason]).catch(() => null)

  const archiveResult = await runHermes(['kanban', 'archive', id]).catch((e: Error) => ({
    code: -1, stdout: '', stderr: e.message
  }))
  const archived = archiveResult.code === 0

  return {
    taskId: id,
    workersKilled,
    workersFailed,
    archived,
    archiveError: archived ? undefined : (archiveResult.stderr.trim() || `code ${archiveResult.code}`)
  }
})
