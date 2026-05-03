import { getKanbanDb } from './kanban'

/* Extra context we can attach to a task so the orchestrator (and the
   approve-and-retry UI) knows WHY a task ended where it did.
   Pulled from kanban.db on demand:
     - lastComment: most recent task_comments row (workers post their failure
       reason here when calling `hermes kanban block "<reason>"`).
     - taskResult:  the `tasks.result` column (set on `kanban complete`).
     - lastRunOutcome / lastRunError: latest `task_runs` row — captures
       crashes, timeouts and spawn failures that never reach the comment
       path. */
export interface FailureContext {
  lastComment: { author: string, body: string } | null
  taskResult: string | null
  lastRunOutcome: string | null
  lastRunError: string | null
  spawnFailures: number
}

export function getFailureContext(taskId: string): FailureContext {
  const empty: FailureContext = {
    lastComment: null,
    taskResult: null,
    lastRunOutcome: null,
    lastRunError: null,
    spawnFailures: 0
  }
  const db = getKanbanDb()
  if (!db) return empty
  try {
    const task = db.prepare(
      `SELECT result, spawn_failures FROM tasks WHERE id = ?`
    ).get(taskId) as { result: string | null, spawn_failures: number | null } | undefined

    const comment = db.prepare(
      `SELECT author, body FROM task_comments WHERE task_id = ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(taskId) as { author: string, body: string } | undefined

    const run = db.prepare(
      `SELECT outcome, error FROM task_runs WHERE task_id = ?
       ORDER BY started_at DESC LIMIT 1`
    ).get(taskId) as { outcome: string | null, error: string | null } | undefined

    return {
      lastComment: comment ?? null,
      taskResult: task?.result ?? null,
      lastRunOutcome: run?.outcome ?? null,
      lastRunError: run?.error ?? null,
      spawnFailures: task?.spawn_failures ?? 0
    }
  } catch {
    return empty
  }
}

/** Pick the most informative single-string reason for the user. Empty when
 *  nothing useful is available. */
export function distillReason(ctx: FailureContext): string {
  if (ctx.lastComment?.body) {
    return ctx.lastComment.body.trim().replace(/\s+/g, ' ').slice(0, 600)
  }
  if (ctx.lastRunError) {
    return ctx.lastRunError.trim().replace(/\s+/g, ' ').slice(0, 600)
  }
  if (ctx.taskResult) {
    return ctx.taskResult.trim().replace(/\s+/g, ' ').slice(0, 600)
  }
  if (ctx.lastRunOutcome && ctx.lastRunOutcome !== 'completed') {
    return `worker run outcome: ${ctx.lastRunOutcome}`
  }
  return ''
}
