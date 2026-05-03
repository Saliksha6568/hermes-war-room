import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')

export interface TaskFeedMessage {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'system' | string
  content: string | null
  toolName: string | null
  toolCalls: unknown
  reasoning: string | null
  timestamp: number | null
  tokenCount: number | null
  finishReason: string | null
}

export interface TaskFeed {
  taskId: string
  /** Profile slug whose state.db we read messages from. */
  profile: string | null
  /** Hermes chat session id (e.g. `20260503_043711_d5aaec`). */
  sessionId: string | null
  /** True if a worker has started for this task (log file exists). */
  started: boolean
  /** Timestamp the worker log file was last modified — used by the UI to
   *  decide whether to keep polling. */
  lastActivityAt: number | null
  /** When the worker log was first created — i.e. when the worker started.
   *  ms since epoch. */
  startedAt: number | null
  messages: TaskFeedMessage[]
  /** Tail of the raw worker log (last ~80 lines). The structured `messages`
   *  array is preferred when populated, but state.db can lag behind the log
   *  while the worker streams; this gives the UI something to show in that
   *  window. */
  logTail: string | null
  /** Total bytes in the log file (lets the UI hint "showing tail of N KB"). */
  logBytes: number | null
  /** Stats derived from the session row when available. */
  totals: {
    messageCount: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    estimatedCostUsd: number
  } | null
}

const LOG_TAIL_BYTES = 24 * 1024 // last ~24 KB
const LOG_TAIL_LINES = 80 // capped to N lines after slicing bytes

function readLogTail(taskId: string): { tail: string | null, bytes: number | null, startedAt: number | null } {
  const path = logPath(taskId)
  if (!existsSync(path)) return { tail: null, bytes: null, startedAt: null }
  try {
    const st = statSync(path)
    const startedAt = Math.floor(st.birthtimeMs || st.ctimeMs || st.mtimeMs)
    const buf = readFileSync(path, { encoding: 'utf8' })
    const sliced = buf.length > LOG_TAIL_BYTES ? buf.slice(buf.length - LOG_TAIL_BYTES) : buf
    /* If we sliced mid-line, drop the partial line at the front so the tail
       reads cleanly. */
    const cleaned = buf.length > LOG_TAIL_BYTES
      ? sliced.slice(sliced.indexOf('\n') + 1)
      : sliced
    const lines = cleaned.split('\n')
    const tail = lines.slice(-LOG_TAIL_LINES).join('\n').trimEnd()
    return { tail: tail || null, bytes: st.size, startedAt }
  } catch {
    return { tail: null, bytes: null, startedAt: null }
  }
}

const SESSION_ID_RE = /Session:\s*([A-Za-z0-9_]+)/
const PROFILE_RE = /Profile:\s*([a-z0-9_-]+)/i

function logPath(taskId: string): string {
  return join(HERMES_HOME, 'kanban', 'logs', `${taskId}.log`)
}

function readLogHead(taskId: string): string | null {
  const path = logPath(taskId)
  if (!existsSync(path)) return null
  try {
    // First ~8 KB is enough for the banner that holds Profile / Session ids.
    return readFileSync(path, { encoding: 'utf8', flag: 'r' }).slice(0, 8192)
  } catch {
    return null
  }
}

function findSessionIdInLog(taskId: string): string | null {
  const head = readLogHead(taskId)
  return head ? (head.match(SESSION_ID_RE)?.[1] ?? null) : null
}

function findProfileInLog(taskId: string): string | null {
  const head = readLogHead(taskId)
  return head ? (head.match(PROFILE_RE)?.[1] ?? null) : null
}

const ASSIGNEE_CACHE = new Map<string, { profile: string | null, mtime: number }>()

function findTaskAssignee(taskId: string): string | null {
  // Read assignee from kanban.db. Cache by mtime to avoid repeated queries
  // when the feed endpoint is polled.
  const dbPath = join(HERMES_HOME, 'kanban.db')
  if (!existsSync(dbPath)) return null
  const mtime = statSync(dbPath).mtimeMs
  const cached = ASSIGNEE_CACHE.get(taskId)
  if (cached && cached.mtime === mtime) return cached.profile
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare('SELECT assignee FROM tasks WHERE id = ?').get(taskId) as
      { assignee: string | null } | undefined
    db.close()
    const profile = row?.assignee ?? null
    ASSIGNEE_CACHE.set(taskId, { profile, mtime })
    return profile
  } catch {
    return null
  }
}

interface RawMessageRow {
  id: number
  role: string
  content: string | null
  tool_name: string | null
  tool_calls: string | null
  reasoning: string | null
  reasoning_content: string | null
  timestamp: number | null
  token_count: number | null
  finish_reason: string | null
}

function parseToolCalls(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function combineReasoning(row: RawMessageRow): string | null {
  // `reasoning` (legacy) and `reasoning_content` (newer) may both be present.
  // We surface whichever has substance, joined.
  const parts: string[] = []
  if (row.reasoning?.trim()) parts.push(row.reasoning.trim())
  if (row.reasoning_content?.trim() && row.reasoning_content.trim() !== row.reasoning?.trim()) {
    parts.push(row.reasoning_content.trim())
  }
  return parts.length ? parts.join('\n\n') : null
}

export function getTaskFeed(taskId: string, opts: { profileHint?: string } = {}): TaskFeed {
  // Profile resolution order: explicit hint → kanban.db assignee → log header.
  // The log fallback covers tasks that were archived/pruned from kanban.db
  // but whose log file is still on disk.
  const profile = opts.profileHint
    ?? findTaskAssignee(taskId)
    ?? findProfileInLog(taskId)
  const log = logPath(taskId)
  const started = existsSync(log)
  const lastActivityAt = started ? statSync(log).mtimeMs : null
  const { tail: logTail, bytes: logBytes, startedAt } = readLogTail(taskId)

  const empty: TaskFeed = {
    taskId,
    profile,
    sessionId: null,
    started,
    lastActivityAt,
    startedAt,
    messages: [],
    logTail,
    logBytes,
    totals: null
  }

  if (!profile) return empty

  const sessionId = findSessionIdInLog(taskId)
  if (!sessionId) return empty

  const stateDbPath = join(HERMES_HOME, 'profiles', profile, 'state.db')
  if (!existsSync(stateDbPath)) {
    return { ...empty, sessionId }
  }

  try {
    const db = new DatabaseSync(stateDbPath, { readOnly: true })

    const sessionRow = db.prepare(
      `SELECT message_count, input_tokens, output_tokens,
              cache_read_tokens, cache_write_tokens, estimated_cost_usd
         FROM sessions WHERE id = ?`
    ).get(sessionId) as {
      message_count: number
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
      estimated_cost_usd: number
    } | undefined

    const rows = db.prepare(
      `SELECT id, role, content, tool_name, tool_calls,
              reasoning, reasoning_content, timestamp, token_count, finish_reason
         FROM messages
        WHERE session_id = ?
        ORDER BY id ASC`
    ).all(sessionId) as unknown as RawMessageRow[]

    db.close()

    const messages: TaskFeedMessage[] = rows.map(r => ({
      id: r.id,
      role: r.role,
      content: r.content,
      toolName: r.tool_name,
      toolCalls: parseToolCalls(r.tool_calls),
      reasoning: combineReasoning(r),
      timestamp: r.timestamp,
      tokenCount: r.token_count,
      finishReason: r.finish_reason
    }))

    return {
      taskId,
      profile,
      sessionId,
      started,
      lastActivityAt,
      startedAt,
      messages,
      logTail,
      logBytes,
      totals: sessionRow
        ? {
            messageCount: sessionRow.message_count ?? 0,
            inputTokens: sessionRow.input_tokens ?? 0,
            outputTokens: sessionRow.output_tokens ?? 0,
            cacheReadTokens: sessionRow.cache_read_tokens ?? 0,
            cacheWriteTokens: sessionRow.cache_write_tokens ?? 0,
            estimatedCostUsd: sessionRow.estimated_cost_usd ?? 0
          }
        : null
    }
  } catch (e) {
    console.error(`[task-feed] read failed for ${taskId} (${profile}/${sessionId}):`, (e as Error).message)
    return { ...empty, sessionId }
  }
}
