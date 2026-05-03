import { getKanbanDb } from '../../../../utils/kanban'
import { getFailureContext, distillReason } from '../../../../utils/task-failure'
import { extractPermissionLabel, looksLikePermissionDenial } from '../../../../utils/permission-extract'

export interface TaskFailureResponse {
  taskId: string
  status: string | null
  assignee: string | null
  reason: string
  /** Last comment / run.error / task.result raw — for debugging. */
  lastComment: { author: string, body: string } | null
  lastRunOutcome: string | null
  lastRunError: string | null
  taskResult: string | null
  spawnFailures: number
  /** True when the reason looks like the worker hit Hermes' permission
   *  classifier and got auto-denied. Drives the approve-and-retry UI. */
  permissionDenial: boolean
  /** Best-effort extraction of the dangerous-pattern label that the user
   *  would need to add to `command_allowlist`. Null when extraction fails. */
  suggestedLabel: string | null
}

export default defineEventHandler((event): TaskFailureResponse => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing task id' })

  const db = getKanbanDb()
  let status: string | null = null
  let assignee: string | null = null
  if (db) {
    const row = db
      .prepare('SELECT status, assignee FROM tasks WHERE id = ?')
      .get(id) as { status: string | null, assignee: string | null } | undefined
    if (row) {
      status = row.status
      assignee = row.assignee
    }
  }

  const ctx = getFailureContext(id)
  const reason = distillReason(ctx)
  const permissionDenial = looksLikePermissionDenial(reason)
  const suggestedLabel = permissionDenial ? extractPermissionLabel(reason) : null

  return {
    taskId: id,
    status,
    assignee,
    reason,
    lastComment: ctx.lastComment,
    lastRunOutcome: ctx.lastRunOutcome,
    lastRunError: ctx.lastRunError,
    taskResult: ctx.taskResult,
    spawnFailures: ctx.spawnFailures,
    permissionDenial,
    suggestedLabel
  }
})
