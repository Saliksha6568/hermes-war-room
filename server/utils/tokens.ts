import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface TokenUsage {
  /** Sum of input tokens across all sessions ever recorded for this profile. */
  totalIn: number
  /** Sum of output tokens across all sessions. */
  totalOut: number
  /** Sum of cache-read + cache-write tokens (Anthropic-style cached prompts). */
  totalCache: number
  /** Token sum of the most-recently-active session only. */
  sessionIn: number
  sessionOut: number
  /** Tokens accrued in sessions whose `started_at > now - 60s`. Acts as a
   *  rough "live burn rate" — not exact, but gives the chip something to
   *  flicker on while a turn is in flight. */
  recentIn: number
  recentOut: number
  /** Estimated USD cost (sum of `estimated_cost_usd` across all sessions). */
  totalCostUsd: number
  /** Last-message timestamp (unix seconds) — drives the "stale" indicator
   *  when no activity has been recorded for a while. */
  lastActivityAt: number | null
  /** True when the profile's state.db exists. False profiles surface zeros
   *  rather than 404, so the chip can render "—" instead of error. */
  present: boolean
}

const ZERO_USAGE: TokenUsage = {
  totalIn: 0,
  totalOut: 0,
  totalCache: 0,
  sessionIn: 0,
  sessionOut: 0,
  recentIn: 0,
  recentOut: 0,
  totalCostUsd: 0,
  lastActivityAt: null,
  present: false
}

interface CachedHandle {
  db: DatabaseSync
  mtime: number
}
const handles = new Map<string, CachedHandle>()

function getDb(profileDir: string): DatabaseSync | null {
  const path = join(profileDir, 'state.db')
  if (!existsSync(path)) return null
  const cached = handles.get(path)
  if (cached) return cached.db
  try {
    const db = new DatabaseSync(path, { readOnly: true })
    handles.set(path, { db, mtime: 0 })
    return db
  } catch {
    return null
  }
}

const RECENT_WINDOW_S = 60

export function readTokenUsage(profileDir: string): TokenUsage {
  const db = getDb(profileDir)
  if (!db) return ZERO_USAGE

  try {
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)        AS totalIn,
        COALESCE(SUM(output_tokens), 0)       AS totalOut,
        COALESCE(SUM(cache_read_tokens), 0)
          + COALESCE(SUM(cache_write_tokens), 0) AS totalCache,
        COALESCE(SUM(estimated_cost_usd), 0)  AS totalCostUsd,
        MAX(COALESCE(ended_at, started_at))   AS lastActivityAt
      FROM sessions
    `).get() as {
      totalIn: number
      totalOut: number
      totalCache: number
      totalCostUsd: number
      lastActivityAt: number | null
    }

    const latest = db.prepare(`
      SELECT
        COALESCE(input_tokens, 0)  AS sessionIn,
        COALESCE(output_tokens, 0) AS sessionOut
      FROM sessions
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as { sessionIn: number, sessionOut: number } | undefined

    const cutoff = Math.floor(Date.now() / 1000) - RECENT_WINDOW_S
    const recent = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0)  AS recentIn,
        COALESCE(SUM(output_tokens), 0) AS recentOut
      FROM sessions
      WHERE started_at > ?
    `).get(cutoff) as { recentIn: number, recentOut: number }

    return {
      totalIn: totals.totalIn,
      totalOut: totals.totalOut,
      totalCache: totals.totalCache,
      sessionIn: latest?.sessionIn ?? 0,
      sessionOut: latest?.sessionOut ?? 0,
      recentIn: recent.recentIn,
      recentOut: recent.recentOut,
      totalCostUsd: totals.totalCostUsd,
      lastActivityAt: totals.lastActivityAt,
      present: true
    }
  } catch (e) {
    // Schema mismatch on older Hermes installs etc. — log once and return zeros.
    console.error(`[tokens] failed to read ${profileDir}:`, (e as Error).message)
    return { ...ZERO_USAGE, present: true }
  }
}
