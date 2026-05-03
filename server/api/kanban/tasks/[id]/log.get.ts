import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')

/* Hard cap to keep a runaway log from OOM'ing the browser (or our http
   buffer). Anything larger gets truncated from the FRONT — the UI is meant
   for tailing recent activity, so the most recent N MB win. */
const MAX_BYTES = 4 * 1024 * 1024

export interface TaskLogResponse {
  taskId: string
  exists: boolean
  bytes: number | null
  /** ms since epoch — file create / first write. */
  startedAt: number | null
  /** ms since epoch — file last modified. */
  lastActivityAt: number | null
  /** True when we trimmed bytes off the FRONT to keep under MAX_BYTES. */
  truncated: boolean
  content: string | null
}

export default defineEventHandler((event): TaskLogResponse => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing task id' })

  const path = join(HERMES_HOME, 'kanban', 'logs', `${id}.log`)
  if (!existsSync(path)) {
    return {
      taskId: id,
      exists: false,
      bytes: null,
      startedAt: null,
      lastActivityAt: null,
      truncated: false,
      content: null
    }
  }

  const st = statSync(path)
  const startedAt = Math.floor(st.birthtimeMs || st.ctimeMs || st.mtimeMs)
  const lastActivityAt = st.mtimeMs

  let content = readFileSync(path, { encoding: 'utf8' })
  let truncated = false
  if (content.length > MAX_BYTES) {
    /* Slice from the front; align to a newline so the first visible line is
       complete. */
    content = content.slice(content.length - MAX_BYTES)
    const nl = content.indexOf('\n')
    if (nl > 0) content = content.slice(nl + 1)
    truncated = true
  }

  return {
    taskId: id,
    exists: true,
    bytes: st.size,
    startedAt,
    lastActivityAt,
    truncated,
    content
  }
})
