import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable, Transform } from 'node:stream'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type SessionNotification,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ContentBlock
} from '@zed-industries/agent-client-protocol'

/**
 * Transform stream that fixes a known SDK/server schema mismatch in
 * @zed-industries/agent-client-protocol@0.4.5: its Zod schema for
 * `session/update`'s `rawInput` and `rawOutput` requires `Record<string, unknown>`
 * (an object), but Hermes' ACP server sends them as JSON-serialised strings.
 * The strict schema rejects every notification with a tool result, breaking
 * the entire mission stream.
 *
 * We sit between the child process stdout and the SDK's NDJSON parser. For
 * each complete line:
 *   1. Try JSON.parse.
 *   2. If `params.update.rawInput` or `rawOutput` is a string, JSON.parse it
 *      (or wrap as `{ raw: <string> }` if it isn't valid JSON) so the SDK's
 *      `z.record(z.unknown())` validator passes.
 *   3. Re-serialise and pass through.
 *
 * Invalid lines (non-JSON garbage) are passed through untouched so the SDK
 * can produce its own error if needed.
 */
function fixupRawIO(): Transform {
  let buffer = ''
  return new Transform({
    transform(chunk: Buffer | string, _enc: string, cb: (err?: Error | null) => void) {
      buffer += chunk.toString('utf8')
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        try {
          const obj = JSON.parse(line) as { params?: { update?: Record<string, unknown> } }
          const update = obj?.params?.update
          if (update) {
            for (const key of ['rawInput', 'rawOutput'] as const) {
              const v = update[key]
              if (typeof v === 'string') {
                try {
                  const parsed = JSON.parse(v)
                  // The SDK requires an object — if Hermes sent a JSON
                  // primitive (string/number/array), wrap it.
                  update[key] = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? parsed
                    : { value: parsed }
                } catch {
                  update[key] = { raw: v }
                }
              }
            }
          }
          this.push(JSON.stringify(obj) + '\n')
        } catch {
          // Not JSON — pass through verbatim with the newline preserved.
          this.push(line + '\n')
        }
        nl = buffer.indexOf('\n')
      }
      cb()
    },
    flush(cb: (err?: Error | null) => void) {
      if (buffer.length > 0) this.push(buffer)
      cb()
    }
  })
}

// 60 min — long enough that switching tabs / coffee breaks don't pay the
// ~5-15s Python+MCP cold start again. Override via WARROOM_ACP_IDLE_MS.
const IDLE_TIMEOUT_MS = Number(process.env.WARROOM_ACP_IDLE_MS) || 60 * 60 * 1000
const REAPER_INTERVAL_MS = 60 * 1000

interface PoolEntry {
  slug: string
  child: ChildProcess
  conn: ClientSideConnection
  initialized: boolean
  sessionEmitters: Map<string, EventEmitter>
  inFlight: Set<string>
  lastActivityMs: number
}

const pool = new Map<string, PoolEntry>()

class WarRoomClient implements Client {
  constructor(private slug: string) {}

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const entry = pool.get(this.slug)
    if (!entry) return
    entry.lastActivityMs = Date.now()
    const emitter = entry.sessionEmitters.get(params.sessionId)
    if (emitter) emitter.emit('update', params)
  }

  async requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    // v1: deny anything that requires interactive approval. Tools the profile
    // already has enabled don't go through this path; this only fires for
    // "ask first" / dangerous shell commands. UI surfacing is v2.
    return { outcome: { outcome: 'cancelled' } }
  }
}

function spawnEntry(slug: string): Promise<PoolEntry> {
  return new Promise((resolveEntry, rejectEntry) => {
    // Preload the team-roster skill so its playbook lands in the system prompt
    // even if the model never decides to call `skill_view` itself. This is
    // load-bearing for orchestrators with smaller models — they tend to skip
    // skill discovery and pattern-match the user's request.
    //
    // `-t` overrides the default `hermes-acp` toolset bundle (defined in
    // `~/.hermes/hermes-agent/toolsets.py`) which would otherwise include
    // `execute_code`, `read_file`, `web_search`, `browser_*` — all paths the
    // orchestrator would happily use to "just do the work" instead of
    // delegating. We narrow it to the minimum needed to:
    //   - terminal: invoke `hermes kanban create / comment / show`
    //   - skills:   load `team-roster` via skill_view
    //   - todo:     internal planning before delegation
    //   - memory:   carry context across turns
    //   - clarify:  ask the user back when unsure
    //   - messaging: cross-platform notifications (cheap, no exec surface)
    // The `tool list --platform cli` config we expose in the war-room only
    // affects CLI sessions; ACP needs its own toolset list passed at spawn.
    const TOOLSETS = 'terminal,skills,todo,memory,clarify,messaging'
    const child = spawn(
      'hermes',
      ['-p', slug, '--skills', 'team-roster', '-t', TOOLSETS, 'acp'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      }
    )

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => {
      // Forward to our stderr but tag for grep-ability.
      process.stderr.write(`[acp:${slug}] ${d}`)
    })

    let exited = false
    child.on('error', (err: Error) => {
      console.error(`[acp:${slug}] spawn error:`, err)
      pool.delete(slug)
      if (!exited) rejectEntry(err)
    })
    child.on('exit', (code: number | null, signal: string | null) => {
      exited = true
      console.error(`[acp:${slug}] exited code=${code} signal=${signal}`)
      pool.delete(slug)
    })

    if (!child.stdin || !child.stdout) {
      child.kill('SIGKILL')
      rejectEntry(new Error('hermes acp spawned without stdio pipes'))
      return
    }

    // Convert Node streams to Web streams for ndJsonStream. We pipe stdout
    // through a Transform that repairs the rawInput/rawOutput shape so the
    // SDK's strict Zod schema doesn't reject every tool_call_update.
    const repaired = child.stdout.pipe(fixupRawIO())
    const input = Readable.toWeb(repaired) as ReadableStream<Uint8Array>
    const output = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>
    const stream = ndJsonStream(output, input)

    const client = new WarRoomClient(slug)
    const conn = new ClientSideConnection(() => client, stream)

    const entry: PoolEntry = {
      slug,
      child,
      conn,
      initialized: false,
      sessionEmitters: new Map(),
      inFlight: new Set(),
      lastActivityMs: Date.now()
    }
    pool.set(slug, entry)

    conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      }
    }).then(() => {
      entry.initialized = true
      resolveEntry(entry)
    }).catch((err) => {
      try {
        child.kill('SIGTERM')
      } catch { /* ignore */ }
      pool.delete(slug)
      rejectEntry(err)
    })
  })
}

async function getEntry(slug: string): Promise<PoolEntry> {
  const existing = pool.get(slug)
  if (existing && !existing.child.killed && existing.initialized) {
    existing.lastActivityMs = Date.now()
    return existing
  }
  if (existing) pool.delete(slug)
  return spawnEntry(slug)
}

function defaultCwd(): string {
  // Run the orchestrator from the user's home so file ops it might attempt have
  // a sane root. Most orchestrator work is via kanban tools, not direct fs.
  return process.env.HERMES_HOME || homedir()
}

/**
 * SIGTERM the live ACP child for `slug`, if any. Used after config edits so
 * the next prompt respawns with the fresh config.yaml on disk (Hermes reads
 * config at process start; running children keep the old values in memory).
 *
 * Safe to call when there's no live child — returns `{ killed: false }`.
 */
export function restart(slug: string): { killed: boolean } {
  const entry = pool.get(slug)
  if (!entry) return { killed: false }
  try {
    entry.child.kill('SIGTERM')
  } catch { /* ignore */ }
  pool.delete(slug)
  return { killed: true }
}

/**
 * Eagerly spawn (or no-op if already alive) the ACP child for `slug` so the
 * user's first prompt doesn't pay the ~5-15s Python+MCP cold start. Idempotent
 * and safe to call repeatedly.
 */
export async function warmup(slug: string): Promise<{ alreadyWarm: boolean }> {
  const existing = pool.get(slug)
  if (existing?.initialized && !existing.child.killed) {
    existing.lastActivityMs = Date.now()
    return { alreadyWarm: true }
  }
  await getEntry(slug)
  return { alreadyWarm: false }
}

export async function newSession(slug: string, cwd?: string): Promise<string> {
  const entry = await getEntry(slug)
  const res = await entry.conn.newSession({
    mcpServers: [],
    cwd: cwd ?? defaultCwd()
  })
  return res.sessionId
}

export async function loadSession(slug: string, sessionId: string, cwd?: string): Promise<void> {
  const entry = await getEntry(slug)
  await entry.conn.loadSession({
    sessionId,
    mcpServers: [],
    cwd: cwd ?? defaultCwd()
  })
}

export interface PromptHandle {
  emitter: EventEmitter
  done: Promise<{ stopReason: string }>
  cancel: () => Promise<void>
}

export interface StartPromptOpts {
  slug: string
  sessionId: string
  text: string
}

/**
 * Send a user message to an existing session and stream chunks via the returned
 * emitter. The `done` promise resolves when the agent's turn completes.
 *
 * Emitter events:
 *   - 'update' (SessionNotification): every session/update notification.
 *   - 'done'   ({ stopReason }): turn ended.
 *   - 'error'  (Error): RPC failure.
 */
export function startPrompt(opts: StartPromptOpts): PromptHandle {
  const emitter = new EventEmitter()

  const done = (async () => {
    const entry = await getEntry(opts.slug)
    if (entry.inFlight.has(opts.sessionId)) {
      throw new Error(`Session ${opts.sessionId} already has a prompt in flight`)
    }
    entry.inFlight.add(opts.sessionId)
    entry.sessionEmitters.set(opts.sessionId, emitter)
    entry.lastActivityMs = Date.now()

    try {
      const res = await entry.conn.prompt({
        sessionId: opts.sessionId,
        prompt: [{ type: 'text', text: opts.text }] as ContentBlock[]
      })
      const stopReason = res.stopReason
      emitter.emit('done', { stopReason })
      return { stopReason }
    } catch (e) {
      emitter.emit('error', e)
      throw e
    } finally {
      entry.inFlight.delete(opts.sessionId)
      entry.sessionEmitters.delete(opts.sessionId)
      entry.lastActivityMs = Date.now()
    }
  })()

  // Swallow unhandled rejection — caller is expected to consume `done` or listen on emitter.
  done.catch(() => { /* delivered via emitter */ })

  return {
    emitter,
    done,
    cancel: async () => {
      const entry = pool.get(opts.slug)
      if (!entry) return
      await entry.conn.cancel({ sessionId: opts.sessionId })
    }
  }
}

let reaperStarted = false
function ensureReaper(): void {
  if (reaperStarted) return
  reaperStarted = true
  const reaper = setInterval(() => {
    const now = Date.now()
    for (const [slug, entry] of pool) {
      if (entry.inFlight.size > 0) continue
      if (now - entry.lastActivityMs > IDLE_TIMEOUT_MS) {
        console.error(`[acp:${slug}] idle ${(now - entry.lastActivityMs) / 1000}s, shutting down`)
        try {
          entry.child.kill('SIGTERM')
        } catch { /* ignore */ }
        pool.delete(slug)
      }
    }
  }, REAPER_INTERVAL_MS)
  ;(reaper as { unref?: () => void }).unref?.()
}
ensureReaper()

function shutdownAll(): void {
  for (const [slug, entry] of pool) {
    try {
      entry.child.kill('SIGTERM')
    } catch { /* ignore */ }
    pool.delete(slug)
  }
}
process.once('SIGINT', shutdownAll)
process.once('SIGTERM', shutdownAll)
process.once('beforeExit', shutdownAll)
