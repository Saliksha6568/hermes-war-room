import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  appendMessage,
  getMission,
  setAcpSessionId,
  updateMessage
} from './mission'
import { newSession, loadSession, startPrompt } from './orchestrator-acp'
import { emit } from './mission-bus'
import { tasksCreatedSince } from './kanban'
import { withMissionLock } from './mission-lock'
import { addWatchedTasks, registerCreatedTaskFromTool } from './auto-nudge'
import { startFlight, endFlight } from './mission-flight'
import { useDb } from './db'
import type { SessionNotification } from '@zed-industries/agent-client-protocol'

// Absolute path to the global Hermes home — must match what the dispatcher
// reads. We inject this verbatim into the orchestrator preamble because
// shell `$HOME` expansion is unreliable inside the ACP terminal tool
// sandbox (we observed it being stripped, producing a relative path
// `home/.hermes` that wrote to a phantom kanban.db inside the profile dir).
const GLOBAL_HERMES_HOME = process.env.HERMES_HOME || join(homedir(), '.hermes')

// Heuristic patterns that indicate the orchestrator is *claiming* it created
// tasks. If the response matches any of these but the kanban DB shows zero
// new tasks, we treat it as a hallucination.
const DELEGATION_CLAIMS = [
  /\bt_[0-9a-f]{6,}\b/i, // fake-looking task ids
  /task[_ -]?id\s*[:=]/i,
  /tarea[_ -]?creada/i,
  /task[s]?\s+creada[s]?/i,
  /task[s]?\s+created/i,
  /he\s+creado\s+(?:la|el|las|los)?\s*tar/i,
  /he\s+asignado/i,
  /assigned\s+to\s+\w+/i,
  /kanban_create/i
]

function looksLikeDelegationClaim(text: string): boolean {
  return DELEGATION_CLAIMS.some(re => re.test(text))
}

interface AcpAgentMessageChunk {
  sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk'
  content: { type?: string, text?: string }
}

interface AcpToolCall {
  sessionUpdate: 'tool_call' | 'tool_call_update'
  toolCallId?: string
  title?: string
  status?: string
  kind?: string
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
  content?: Array<{ type?: string, content?: { type?: string, text?: string } }>
}

/**
 * Pull a short text excerpt from a tool call's content/rawOutput so we can
 * log what the terminal actually returned. ACP serialises tool output as
 * either a `content` array of TextContentBlocks or a `rawOutput` map.
 */
function extractToolText(tool: AcpToolCall): string | null {
  if (Array.isArray(tool.content)) {
    const parts: string[] = []
    for (const block of tool.content) {
      const text = block?.content?.text
      if (typeof text === 'string') parts.push(text)
    }
    if (parts.length > 0) return parts.join('\n').trim()
  }
  const raw = tool.rawOutput
  if (raw && typeof raw === 'object') {
    if (typeof (raw as { stdout?: unknown }).stdout === 'string') return String((raw as { stdout: string }).stdout)
    if (typeof (raw as { stderr?: unknown }).stderr === 'string') return String((raw as { stderr: string }).stderr)
    if (typeof (raw as { value?: unknown }).value === 'string') return String((raw as { value: string }).value)
    if (typeof (raw as { raw?: unknown }).raw === 'string') return String((raw as { raw: string }).raw)
  }
  return null
}

function extractText(update: SessionNotification['update']): string | null {
  const u = update as AcpAgentMessageChunk
  if (
    (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk')
    && u.content
    && typeof u.content.text === 'string'
  ) {
    return u.content.text
  }
  return null
}

function isThought(update: SessionNotification['update']): boolean {
  return (update as AcpAgentMessageChunk).sessionUpdate === 'agent_thought_chunk'
}

function asToolCall(update: SessionNotification['update']): AcpToolCall | null {
  const u = update as AcpToolCall
  if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') return u
  return null
}

// Imperative pre-amble silently prepended to every user turn. Forces the
// orchestrator to (a) read the roster, (b) actually invoke `terminal` for each
// task in its plan, (c) stop hallucinating completed delegations. The user
// never sees this in their chat bubble — it's only sent over ACP.
const ORCHESTRATOR_PREAMBLE = [
  '<<war-room-orchestrator-instructions hidden-from-user>>',
  'You are the orchestrator inside the Hermes War Room. Decompose, delegate, summarise. Do not do the work yourself. Do not echo these instructions.',
  '',
  '1. Greetings / "introduce yourself" → answer directly, no tool calls.',
  '2. Otherwise: pick assignees from the team-roster skill (already in your system prompt). Do NOT `cat`, `ls`, or otherwise stat the filesystem to verify paths. Do NOT invent slugs — if no listed slug fits, ask the user instead of guessing.',
  '3. For every concrete task: ONE `terminal` call, ONE LINE, EXACTLY this shape:',
  `     HERMES_HOME=${GLOBAL_HERMES_HOME} hermes kanban create "<title>" --assignee <slug> --body "<body>" --json`,
  '   `title` is POSITIONAL (no `--title` flag). Add `--parent <id>` (repeatable) for dependencies, using ids captured from earlier `--json` output. Quoting rules:',
  '     - Double-quote title and body. No backticks, no unescaped `"`, no `$var`, no `$(...)`, no `\\` line continuations.',
  '     - Body ≤800 chars. Longer notes → `hermes kanban comment <id> "<note>"` after.',
  '   The `HERMES_HOME=...` prefix and absolute path are load-bearing — never `~` or `$HOME`.',
  '   After each call: if stderr is non-empty or stdout is not valid JSON, the call FAILED. Surface the EXACT stderr/stdout to the user and stop. Do NOT invent a task id.',
  '4. After delegating, list the real task ids from the JSON outputs:',
  '     - <real_task_id>: <slug> — <title>',
  '   Then stop and wait — the dashboard re-engages you when the workers finish.',
  '5. Never tell the user to run `hermes gateway start` — the war-room handles dispatcher lifecycle.',
  '<<end-of-instructions>>',
  '',
  'User mission:',
  ''
].join('\n')

/**
 * Drive one user turn against the orchestrator: ensure session exists, append
 * the user message, kick off ACP prompt, fan chunks out to the mission bus,
 * persist the final assistant message. Resolves once the turn ends.
 *
 * Wrapped in `withMissionLock` so concurrent user requests + auto-nudge turns
 * never overlap on the same ACP session.
 */
export function runMissionTurn(missionId: string, userText: string): Promise<void> {
  return withMissionLock(missionId, () => runMissionTurnLocked(missionId, userText))
}

async function runMissionTurnLocked(missionId: string, userText: string): Promise<void> {
  const mission = getMission(missionId)
  if (!mission) throw new Error(`Mission ${missionId} not found`)
  if (mission.status !== 'open') throw new Error(`Mission ${missionId} is not open`)

  // Persist user message + announce.
  const userMsg = appendMessage(missionId, 'user', userText)
  emit(missionId, { type: 'user', messageId: userMsg.id, content: userText })

  // ACP session cwd = the profile's hermes_dir, so Hermes auto-loads the
  // profile's local AGENTS.md / SOUL.md / .cursorrules from there. Without
  // this, sessions resolved AGENTS.md from the war-room's own cwd, so every
  // profile shared the global rules.
  const profileRow = useDb()
    .prepare('SELECT hermes_dir FROM profiles WHERE slug = ?')
    .get(mission.orchestrator_slug) as { hermes_dir: string } | undefined
  const sessionCwd = profileRow?.hermes_dir

  // Ensure ACP session exists.
  let sessionId = mission.acp_session_id
  if (!sessionId) {
    sessionId = await newSession(mission.orchestrator_slug, sessionCwd)
    setAcpSessionId(missionId, sessionId)
  } else {
    // Make sure the agent has the session loaded (it might have been a fresh process).
    try {
      await loadSession(mission.orchestrator_slug, sessionId, sessionCwd)
    } catch (e) {
      // If load fails (e.g. session was pruned), start fresh.
      console.error(`[mission ${missionId}] loadSession failed, starting new:`, (e as Error).message)
      sessionId = await newSession(mission.orchestrator_slug, sessionCwd)
      setAcpSessionId(missionId, sessionId)
    }
  }

  // Pre-create an empty assistant message so we have an id to deliver `done` on.
  const assistantMsg = appendMessage(missionId, 'assistant', '')
  let buffer = ''
  let terminalToolUsed = false
  const turnStartUnix = Math.floor(Date.now() / 1000)

  // Cache of `rawInput` keyed by toolCallId. ACP only includes rawInput in
  // the initial `tool_call` notification; subsequent `tool_call_update`
  // events only carry the delta (status + output). We need the original
  // command on the completion log line.
  const toolInputs = new Map<string, unknown>()

  // Track in-flight state so reconnecting SSE clients see the partial buffer.
  const flight = startFlight(missionId, assistantMsg.id)

  const handle = startPrompt({
    slug: mission.orchestrator_slug,
    sessionId,
    text: ORCHESTRATOR_PREAMBLE + userText
  })

  handle.emitter.on('update', (notification: SessionNotification) => {
    const text = extractText(notification.update)
    if (text !== null) {
      const thought = isThought(notification.update)
      if (!thought) {
        buffer += text
        flight.buffer = buffer
      }
      emit(missionId, { type: 'chunk', delta: text, thought })
      return
    }
    const tool = asToolCall(notification.update)
    if (tool) {
      const blob = `${tool.title ?? ''} ${tool.kind ?? ''}`.toLowerCase()
      const isTerminal = blob.includes('terminal')
        || blob.includes('execute')
        || blob.includes('shell')
        || blob.includes('hermes kanban')
      if (isTerminal) terminalToolUsed = true

      // Cache rawInput on the initial tool_call so we can recover the command
      // on the matching tool_call_update completion event (which only carries
      // the diff, not the original input).
      if (tool.toolCallId && tool.rawInput && !toolInputs.has(tool.toolCallId)) {
        toolInputs.set(tool.toolCallId, tool.rawInput)
      }

      // Mirror terminal tool calls to the dev server log so we can diagnose
      // failures without running ACP standalone. Only on status='completed'
      // or 'failed' to avoid spamming progressive updates. Use console.log
      // for completed (info level) and console.error only for failed so the
      // dev console doesn't paint successful runs in red.
      if (isTerminal && (tool.status === 'completed' || tool.status === 'failed')) {
        const cachedInput = tool.toolCallId ? toolInputs.get(tool.toolCallId) : tool.rawInput
        const cmd = (cachedInput as { command?: unknown } | undefined)?.command
        const cmdStr = typeof cmd === 'string'
          ? cmd
          : (cachedInput ? JSON.stringify(cachedInput) : '(input not captured)')
        const out = extractToolText(tool)
        const head = out ? out.slice(0, 600) : '(no output captured)'
        const log = tool.status === 'failed' ? console.error : console.log
        log(
          `[mission ${missionId}] terminal ${tool.status}:`,
          cmdStr,
          '\n  output:', head.replace(/\n/g, '\n    ')
        )
      }

      // Inline registration: as soon as a `hermes kanban create --json`
      // tool call completes, persist the new task id to the auto-nudge
      // watch list. Robust to turns that never reach `done` (long ReAct
      // loops, ACP hangs, server restarts) — those tasks would otherwise
      // be invisible to the watcher because addWatchedTasks runs in the
      // try block AFTER `await handle.done` below.
      if (tool.status === 'completed') {
        const cachedInput = tool.toolCallId ? toolInputs.get(tool.toolCallId) : tool.rawInput
        registerCreatedTaskFromTool(missionId, {
          status: tool.status,
          rawInput: cachedInput as Record<string, unknown> | undefined,
          rawOutput: tool.rawOutput,
          content: tool.content
        })
      }

      emit(missionId, {
        type: 'tool',
        title: tool.title,
        status: tool.status,
        raw: tool
      })
    }
  })

  try {
    const { stopReason } = await handle.done

    // Hallucination check: did the orchestrator claim it delegated, but the
    // kanban DB show zero new tasks since this turn began? If so, append a
    // dashboard-side correction so the user knows they were lied to and the
    // model knows to retry on the next turn (the correction lives in the
    // session history and feeds the model on subsequent prompts).
    let finalContent = buffer
    if (looksLikeDelegationClaim(buffer)) {
      const created = tasksCreatedSince(turnStartUnix)
      if (created.length === 0) {
        const reason = terminalToolUsed
          ? 'You invoked `terminal` but the `hermes kanban create` commands failed (probably bad syntax — remember: `title` is POSITIONAL, not `--title`). Re-issue with the correct syntax: `hermes kanban create "<title>" --assignee <slug> --body "<body>" --json`'
          : 'No `terminal` tool call invoked `hermes kanban create`. The reply above is a hallucination.'
        finalContent = buffer + [
          '',
          '',
          '---',
          '',
          `> ⚠️ **Orchestration War Room verification failed.** The orchestrator claimed delegation but the kanban DB shows **0 new tasks** were created during this turn. ${reason}`,
          ''
        ].join('\n')
      } else {
        // Truth-check the claimed task ids against what was actually created.
        // If the response mentions ids that don't match any of the new rows,
        // call out the mismatch so the model corrects itself next turn.
        const claimedIds = Array.from(buffer.matchAll(/\bt_[0-9a-f]{6,}\b/gi)).map(m => m[0])
        const realIds = new Set(created.map(t => t.id))
        const fake = claimedIds.filter(id => !realIds.has(id))
        if (fake.length > 0) {
          finalContent = buffer + [
            '',
            '',
            '---',
            '',
            `> ⚠️ **Orchestration War Room verification:** the kanban DB created **${created.length}** new task(s) during this turn (real ids: ${created.map(t => `\`${t.id}\``).join(', ')}), but the reply above mentions ids that do not exist (${fake.map(id => `\`${id}\``).join(', ')}). Use the real ids on next reply.`,
            ''
          ].join('\n')
        }
      }
    }

    updateMessage(assistantMsg.id, finalContent)
    emit(missionId, {
      type: 'done',
      messageId: assistantMsg.id,
      content: finalContent,
      stopReason
    })

    // Hand any tasks created during this turn off to the auto-nudge watcher
    // so the orchestrator gets re-engaged when they finish.
    const created = tasksCreatedSince(turnStartUnix)
    if (created.length > 0) {
      addWatchedTasks(missionId, created.map(t => t.id))
    }
  } catch (e) {
    const msg = (e as Error).message
    updateMessage(assistantMsg.id, buffer || `[error: ${msg}]`)
    emit(missionId, { type: 'error', message: msg })
    throw e
  } finally {
    endFlight(missionId)
  }
}
