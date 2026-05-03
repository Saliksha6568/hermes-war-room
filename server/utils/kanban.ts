import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { getFailureContext, distillReason } from './task-failure'
import { looksLikePermissionDenial } from './permission-extract'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')
const KANBAN_DB_PATH = join(HERMES_HOME, 'kanban.db')

let cached: DatabaseSync | null = null

export function getKanbanDb(): DatabaseSync | null {
  if (cached) return cached
  if (!existsSync(KANBAN_DB_PATH)) return null
  const db = new DatabaseSync(KANBAN_DB_PATH, { readOnly: true })
  // WAL mode is set by the writer; we only need to read.
  cached = db
  return db
}

export interface KanbanTask {
  id: string
  title: string
  body: string | null
  assignee: string | null
  status: string
  priority: number
  workerPid: number | null
  startedAt: number | null
  claimExpires: number | null
  lastHeartbeatAt: number | null
  createdAt: number
  /** IDs of parent tasks (delegators). Pulled from the task_links table. */
  parentIds: string[]
  /** True when the task's failure looks like Hermes' permission classifier
   *  auto-denied a tool call. Drives the "PERMISO PENDIENTE" badge on the
   *  workstation bubble + the approve flow in the slideover. */
  pendingPermission?: boolean
}

interface RawTaskRow {
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
}

function rowToTask(r: RawTaskRow): KanbanTask {
  return {
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
  }
}

const ACTIVE_STATUSES = ['running', 'ready', 'todo', 'blocked'] as const

export function listActiveTasks(assignee?: string): KanbanTask[] {
  const db = getKanbanDb()
  if (!db) return []
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',')
  const params: unknown[] = [...ACTIVE_STATUSES]
  let where = `status IN (${placeholders})`
  if (assignee) {
    where += ' AND assignee = ?'
    params.push(assignee)
  }
  const rows = db.prepare(
    `SELECT id, title, body, assignee, status, priority,
            worker_pid, started_at, claim_expires, last_heartbeat_at, created_at
     FROM tasks
     WHERE ${where}
     ORDER BY
       CASE status WHEN 'running' THEN 0 WHEN 'blocked' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END,
       priority DESC,
       created_at ASC`
  ).all(...params as never[]) as unknown as RawTaskRow[]
  const tasks = rows.map(rowToTask)

  // Hydrate parentIds from task_links in a single query. Only edges where
  // both ends are in the active set are useful for visualisation, so we
  // restrict to childs that we already loaded.
  if (tasks.length > 0) {
    const ids = tasks.map(t => t.id)
    const placeholdersIds = ids.map(() => '?').join(',')
    const links = db.prepare(
      `SELECT parent_id, child_id FROM task_links WHERE child_id IN (${placeholdersIds})`
    ).all(...ids as never[]) as unknown as { parent_id: string, child_id: string }[]
    const byChild = new Map<string, string[]>()
    for (const l of links) {
      const arr = byChild.get(l.child_id) ?? []
      arr.push(l.parent_id)
      byChild.set(l.child_id, arr)
    }
    for (const t of tasks) {
      const parents = byChild.get(t.id)
      if (parents) t.parentIds = parents
    }
  }

  /* Hydrate `pendingPermission` for blocked tasks. We only check blocked
     ones because that's where Hermes' auto-deny lands. Cheap: one lookup
     per blocked task and there's rarely more than a handful at a time. */
  const blocked = tasks.filter(t => t.status === 'blocked')
  for (const t of blocked) {
    const ctx = getFailureContext(t.id)
    const reason = distillReason(ctx)
    if (looksLikePermissionDenial(reason)) t.pendingPermission = true
  }

  return tasks
}

/**
 * Most relevant task for an assignee — prefer running, fall back to oldest
 * ready/todo/blocked. Returns null if the agent has nothing on its plate.
 */
export function currentTaskByAssignee(assignee: string): KanbanTask | null {
  const tasks = listActiveTasks(assignee)
  if (tasks.length === 0) return null
  return tasks[0] ?? null
}

/**
 * Total number of tasks in the kanban DB. Used to bracket a mission turn so
 * we can detect orchestrators hallucinating fake task ids without actually
 * calling `hermes kanban create`.
 */
export function totalTaskCount(): number {
  const db = getKanbanDb()
  if (!db) return 0
  const row = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number } | undefined
  return row?.count ?? 0
}

/**
 * Tasks created strictly after a Unix-second timestamp. Used by the war-room
 * to verify "did the orchestrator actually delegate during this turn".
 */
export function tasksCreatedSince(unixSec: number): KanbanTask[] {
  const db = getKanbanDb()
  if (!db) return []
  const rows = db.prepare(
    `SELECT id, title, body, assignee, status, priority,
            worker_pid, started_at, claim_expires, last_heartbeat_at, created_at
     FROM tasks
     WHERE created_at > ?
     ORDER BY created_at ASC`
  ).all(unixSec) as unknown as RawTaskRow[]
  return rows.map(rowToTask)
}

const STALE_READY_AGE_S = 5 * 60

/**
 * Heuristic: if there are tasks `ready` (or `todo` with no parents pending) for
 * more than 5 minutes, the dispatcher is likely not running.
 */
export function dispatcherLikelyStale(): boolean {
  const db = getKanbanDb()
  if (!db) return false
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - STALE_READY_AGE_S
  const row = db.prepare(
    `SELECT COUNT(*) as count FROM tasks
     WHERE status = 'ready' AND created_at < ?`
  ).get(cutoff) as { count: number } | undefined
  return (row?.count ?? 0) > 0
}
