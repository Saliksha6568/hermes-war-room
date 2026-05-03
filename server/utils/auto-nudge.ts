/**
 * Auto-nudge: when an orchestrator delegates kanban tasks during a mission
 * turn, we register those task IDs against the mission. A background watcher
 * polls them every few seconds; when a watched task transitions into a
 * terminal state (done/blocked) we synthesise a system-style message to
 * the orchestrator so it can summarise the result back to the human user.
 *
 * Without this, the user sees the orchestrator delegate and then go silent
 * forever — the kanban worker completes asynchronously and the orchestrator
 * has no built-in way to be re-engaged.
 */

import { getKanbanDb, type KanbanTask } from './kanban'
import { getMission, appendMessage, updateMessage } from './mission'
import { withMissionLock } from './mission-lock'
import { startPrompt } from './orchestrator-acp'
import { emit } from './mission-bus'
import { startFlight, endFlight } from './mission-flight'
import { useDb } from './db'

/* Failure-context helpers moved to ./task-failure.ts so the new
   approve-and-retry endpoint can reuse them too. */
import { getFailureContext, distillReason } from './task-failure'

const POLL_MS = 5000
const NUDGE_DEBOUNCE_MS = 3000

interface WatchedTask {
  /** Snapshot of the task's status when first watched. Used so an already-
   *  done task that is added to the watch list still fires a nudge once. */
  addedStatus: string
}

interface MissionState {
  /** Tasks we're tracking → snapshot at watch time. Removed once nudged. */
  watched: Map<string, WatchedTask>
  /** Tasks observed as completed since the last nudge. Drained when fired. */
  pendingCompleted: KanbanTask[]
  /** Debounce handle for the pending nudge. */
  debounce: ReturnType<typeof setTimeout> | null
}

const TERMINAL_STATUSES = new Set(['done', 'blocked'])

const state = new Map<string, MissionState>()

function ensureState(missionId: string): MissionState {
  let s = state.get(missionId)
  if (!s) {
    s = { watched: new Map(), pendingCompleted: [], debounce: null }
    state.set(missionId, s)
  }
  return s
}

/**
 * Register a batch of task IDs (the orchestrator just created them in this
 * turn). The current status of each is snapshotted so we can detect either
 * a transition from in-flight → done OR an already-done task whose result
 * the orchestrator hasn't yet seen. Persisted to SQLite so we recover the
 * watch list across Nitro restarts.
 */
export function addWatchedTasks(missionId: string, taskIds: string[]): void {
  if (taskIds.length === 0) return
  const db = getKanbanDb()
  if (!db) return

  const placeholders = taskIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, status FROM tasks WHERE id IN (${placeholders})`
  ).all(...taskIds as never[]) as { id: string, status: string }[]

  const s = ensureState(missionId)
  const wrDb = useDb()
  const insert = wrDb.prepare(`
    INSERT OR IGNORE INTO mission_watched_tasks (mission_id, task_id, added_status, added_at)
    VALUES (?, ?, ?, ?)
  `)
  const now = Math.floor(Date.now() / 1000)
  let added = 0
  for (const r of rows) {
    if (!s.watched.has(r.id)) {
      s.watched.set(r.id, { addedStatus: r.status })
      insert.run(missionId, r.id, r.status, now)
      added++
    }
  }
  if (added > 0) console.log(`[auto-nudge] watching +${added} task(s) on mission ${missionId} (total ${s.watched.size})`)
}

/** Drop everything for a mission (e.g. archive). */
export function removeMission(missionId: string): void {
  const s = state.get(missionId)
  if (s?.debounce) clearTimeout(s.debounce)
  state.delete(missionId)
  useDb().prepare('DELETE FROM mission_watched_tasks WHERE mission_id = ?').run(missionId)
}

/**
 * On boot, rehydrate the in-memory watch list from SQLite. Any rows whose
 * `notified_at` is still NULL are still pending — drop them straight back
 * into the tracker so the next polling cycle picks them up.
 */
export function loadWatchedFromDb(): void {
  const wrDb = useDb()
  const rows = wrDb.prepare(`
    SELECT mission_id, task_id, added_status FROM mission_watched_tasks
    WHERE notified_at IS NULL
  `).all() as { mission_id: string, task_id: string, added_status: string }[]

  for (const r of rows) {
    const s = ensureState(r.mission_id)
    if (!s.watched.has(r.task_id)) {
      s.watched.set(r.task_id, { addedStatus: r.added_status })
    }
  }
  if (rows.length > 0) {
    console.log(`[auto-nudge] resumed watching ${rows.length} task(s) across ${state.size} mission(s) from disk`)
  }
}

/**
 * Try to extract the new task id from a `hermes kanban create ... --json`
 * tool call that just completed. Used to register tasks for the watcher
 * IMMEDIATELY when the orchestrator creates them, instead of waiting for
 * the (possibly never-arriving) end of the turn.
 */
interface PartialAcpToolCall {
  status?: string | null
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
  content?: unknown[]
}
export function registerCreatedTaskFromTool(missionId: string, tool: PartialAcpToolCall): void {
  if (tool.status !== 'completed') return
  const cmd = String((tool.rawInput as { command?: unknown } | undefined)?.command ?? '')
  if (!/hermes\s+kanban\s+create/i.test(cmd)) return

  // Find the textual output. Prefer ACP's `content` array; fall back to
  // common rawOutput shapes.
  let text: string | null = null
  if (Array.isArray(tool.content)) {
    const parts: string[] = []
    for (const block of tool.content) {
      const t = (block as { content?: { text?: unknown } } | null)?.content?.text
      if (typeof t === 'string') parts.push(t)
    }
    if (parts.length > 0) text = parts.join('\n').trim()
  }
  if (!text && tool.rawOutput) {
    const ro = tool.rawOutput as { stdout?: unknown, value?: unknown, raw?: unknown }
    if (typeof ro.stdout === 'string') text = ro.stdout
    else if (typeof ro.value === 'string') text = ro.value
    else if (typeof ro.raw === 'string') text = ro.raw
  }
  if (!text) return

  // Some shells leave warning lines before the JSON — find the first {...}.
  const jsonStart = text.indexOf('{')
  if (jsonStart < 0) return
  try {
    const parsed = JSON.parse(text.slice(jsonStart)) as { id?: unknown }
    const id = parsed.id
    if (typeof id === 'string' && /^t_/.test(id)) {
      addWatchedTasks(missionId, [id])
    }
  } catch {
    /* not JSON or no id field — ignore. */
  }
}

/** Mark these task IDs as notified so they aren't re-watched on the next boot. */
function markNotified(missionId: string, taskIds: string[]): void {
  if (taskIds.length === 0) return
  const placeholders = taskIds.map(() => '?').join(',')
  useDb().prepare(`
    UPDATE mission_watched_tasks SET notified_at = ?
    WHERE mission_id = ? AND task_id IN (${placeholders})
  `).run(Math.floor(Date.now() / 1000), missionId, ...taskIds)
}

/** Hidden preamble describing what just landed; orchestrator reads it as a
 *  user message but is told NOT to echo it. */
function buildNudgeText(completed: KanbanTask[]): string {
  const lines = [
    '<<war-room-task-update hidden-from-user>>',
    'The following kanban tasks have just reached a terminal state since your last reply.',
    'For any task whose status is `blocked` OR whose run failed (crashed, timed_out, spawn_failed), TELL THE USER what went wrong using the failure-reason text below — do not glaze over it. Permission errors, missing credentials, model auth failures, and similar should be surfaced verbatim so the user can fix them.',
    'Do NOT re-delegate unless the user explicitly asked for follow-ups. Do NOT echo this system update verbatim.',
    ''
  ]
  for (const t of completed) {
    lines.push(`- \`${t.id}\` (${t.assignee ?? '?'}) — ${t.status}: "${t.title}"`)
    if (t.body) {
      const body = t.body.trim().replace(/\s+/g, ' ').slice(0, 400)
      lines.push(`    body: ${body}${t.body.length > 400 ? '…' : ''}`)
    }
    const ctx = getFailureContext(t.id)
    const reason = distillReason(ctx)
    if (reason) {
      lines.push(`    failure-reason: ${reason}`)
    }
    if (ctx.lastRunOutcome && ctx.lastRunOutcome !== 'completed') {
      lines.push(`    last-run-outcome: ${ctx.lastRunOutcome}`)
    }
    if (ctx.spawnFailures > 0) {
      lines.push(`    spawn-failures: ${ctx.spawnFailures}`)
    }
  }
  lines.push('<<end-of-task-update>>')
  return lines.join('\n')
}

/** Short user-facing pill so the human sees what triggered the orchestrator.
 *  Server-side message — Spanish hard-coded for now since the war-room runs
 *  with es as the default locale. TODO: persist `mission.locale` so this can
 *  pick the right language per mission. */
function buildVisibleNudge(completed: KanbanTask[]): string {
  const anyFailed = completed.some(t => t.status === 'blocked')
  const head = completed.length === 1
    ? (anyFailed ? `[Sala de Guerra] ⚠ Tarea con problemas:` : `[Sala de Guerra] Tarea completada:`)
    : (anyFailed ? `[Sala de Guerra] ⚠ ${completed.length} tareas con resultado:` : `[Sala de Guerra] ${completed.length} tareas completadas:`)
  const verb = (status: string) => status === 'done' ? 'finalizada' : status === 'blocked' ? 'bloqueada' : status
  const lines: string[] = []
  for (const t of completed) {
    lines.push(`  • ${t.id} (${t.assignee ?? '?'}): ${verb(t.status)} — ${t.title}`)
    /* For blocked or otherwise-failed tasks, surface the worker's reason in
       the visible message too — saves the user a click into the dossier when
       all they need is "auth token missing", "permission denied", etc. */
    const ctx = getFailureContext(t.id)
    const reason = distillReason(ctx)
    const isFailure = t.status === 'blocked'
      || (ctx.lastRunOutcome && ctx.lastRunOutcome !== 'completed')
      || ctx.spawnFailures > 0
    if (reason && isFailure) {
      const oneLine = reason.replace(/\s+/g, ' ').slice(0, 200)
      lines.push(`      ↳ ${oneLine}${reason.length > 200 ? '…' : ''}`)
    }
  }
  return [head, ...lines].join('\n')
}

/**
 * Drive a nudge turn against the orchestrator. Persists a user-side message
 * (so the human sees the trigger) plus an empty assistant message that gets
 * filled by the streamed reply. Same shape as runMissionTurn but with a
 * different preamble and skipping the user-typed text path entirely.
 */
async function runNudgeTurn(missionId: string, completed: KanbanTask[]): Promise<void> {
  const mission = getMission(missionId)
  if (!mission || mission.status !== 'open' || !mission.acp_session_id) {
    console.log(`[auto-nudge] skipping ${missionId} — mission not open or has no ACP session`)
    return
  }

  const visible = buildVisibleNudge(completed)
  const userMsg = appendMessage(missionId, 'user', visible)
  emit(missionId, { type: 'user', messageId: userMsg.id, content: visible })

  const assistantMsg = appendMessage(missionId, 'assistant', '')
  let buffer = ''
  const flight = startFlight(missionId, assistantMsg.id)

  const handle = startPrompt({
    slug: mission.orchestrator_slug,
    sessionId: mission.acp_session_id,
    text: buildNudgeText(completed)
  })

  handle.emitter.on('update', (notification: { update: Record<string, unknown> }) => {
    const u = notification.update as {
      sessionUpdate?: string
      content?: { text?: string }
      title?: string
      status?: string
      kind?: string
    }
    if (
      (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk')
      && u.content
      && typeof u.content.text === 'string'
    ) {
      const thought = u.sessionUpdate === 'agent_thought_chunk'
      if (!thought) {
        buffer += u.content.text
        flight.buffer = buffer
      }
      emit(missionId, { type: 'chunk', delta: u.content.text, thought })
      return
    }
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      emit(missionId, { type: 'tool', title: u.title, status: u.status, raw: u })
      // If the orchestrator delegated MORE work during a nudge response,
      // pick those new tasks up immediately too.
      registerCreatedTaskFromTool(missionId, u as PartialAcpToolCall)
    }
  })

  try {
    const { stopReason } = await handle.done
    updateMessage(assistantMsg.id, buffer)
    emit(missionId, {
      type: 'done',
      messageId: assistantMsg.id,
      content: buffer,
      stopReason
    })
  } catch (e) {
    const msg = (e as Error).message
    updateMessage(assistantMsg.id, buffer || `[error: ${msg}]`)
    emit(missionId, { type: 'error', message: msg })
    console.error(`[auto-nudge] turn failed on ${missionId}:`, msg)
  } finally {
    endFlight(missionId)
  }
}

/** Schedule (or extend) the debounced nudge for a mission. */
function scheduleNudge(missionId: string, completed: KanbanTask[]): void {
  const s = ensureState(missionId)
  s.pendingCompleted.push(...completed)
  if (s.debounce) clearTimeout(s.debounce)
  s.debounce = setTimeout(() => {
    const batch = s.pendingCompleted
    s.pendingCompleted = []
    s.debounce = null
    if (batch.length === 0) return

    // Serialise behind any user turn currently in flight on the same mission.
    void withMissionLock(missionId, () => runNudgeTurn(missionId, batch))
      .then(() => {
        // Mark these as notified so a Nitro restart doesn't re-fire them.
        markNotified(missionId, batch.map(t => t.id))
      })
      .catch(e => console.error(`[auto-nudge] nudge failed on ${missionId}:`, (e as Error).message))
  }, NUDGE_DEBOUNCE_MS)
}

/**
 * Single poll: walk every watched task, fetch its current status, fire a
 * nudge for any that landed in a terminal state since the last cycle.
 */
function checkAll(): void {
  if (state.size === 0) return
  const db = getKanbanDb()
  if (!db) return

  for (const [missionId, s] of state) {
    if (s.watched.size === 0) continue
    const ids = [...s.watched.keys()]
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, title, body, assignee, status, priority,
              worker_pid, started_at, claim_expires, last_heartbeat_at, created_at
       FROM tasks WHERE id IN (${placeholders})`
    ).all(...ids as never[]) as unknown as Array<{
      id: string
      title: string
      body: string | null
      assignee: string | null
      status: string
      priority: number
      worker_pid: number | null
      started_at: number | null
      claim_expires: number | null
      last_heartbeat_at: number | null
      created_at: number
    }>

    const justCompleted: KanbanTask[] = []
    for (const r of rows) {
      const watch = s.watched.get(r.id)
      if (!watch) continue
      if (TERMINAL_STATUSES.has(r.status)) {
        // Either we just observed the transition, or the task was already
        // done at watch time and we never told the orchestrator.
        justCompleted.push({
          id: r.id,
          title: r.title,
          body: r.body,
          assignee: r.assignee,
          status: r.status,
          priority: r.priority,
          workerPid: r.worker_pid,
          startedAt: r.started_at,
          claimExpires: r.claim_expires,
          lastHeartbeatAt: r.last_heartbeat_at,
          createdAt: r.created_at,
          parentIds: []
        })
        s.watched.delete(r.id)
      }
    }

    if (justCompleted.length > 0) {
      console.log(`[auto-nudge] ${missionId}: ${justCompleted.length} task(s) completed, scheduling nudge`)
      scheduleNudge(missionId, justCompleted)
    }
  }
}

let interval: ReturnType<typeof setInterval> | null = null

export function startAutoNudge(): void {
  if (interval) return
  // Run one immediate pass for catch-up: any tasks that completed while the
  // server was down (and were rehydrated by loadWatchedFromDb) get nudged
  // now instead of waiting POLL_MS.
  checkAll()
  interval = setInterval(checkAll, POLL_MS)
  console.log('[auto-nudge] watcher started, polling every', POLL_MS, 'ms')
}

export function stopAutoNudge(): void {
  if (interval) clearInterval(interval)
  interval = null
}
