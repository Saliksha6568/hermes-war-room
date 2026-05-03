import type { Mission, MissionMessage, MissionEvent } from '~/types/mission'

/**
 * Latest "thinking step" surfaced from the SSE stream — used by the floor
 * to drive the per-operative ticker. Two kinds:
 *  - `tool`: a tool call (e.g. "Read README.md"). Label is the tool title.
 *  - `thought`: streamed reasoning text (model's inner monologue). Label is
 *               a trimmed tail of the running thought buffer.
 */
export interface ThoughtStep {
  kind: 'tool' | 'thought'
  label: string
  ts: number
}

export interface UseMissionStream {
  mission: Ref<Mission | null>
  messages: Ref<MissionMessage[]>
  streaming: Ref<boolean>
  connected: Ref<boolean>
  error: Ref<string | null>
  /** Most recent step from the active run, or null when idle. */
  lastStep: Ref<ThoughtStep | null>
  /** Rolling buffer of the last N steps (newest first). */
  recentSteps: Ref<ThoughtStep[]>
  start: (orchestratorSlug: string, message: string) => Promise<void>
  send: (message: string) => Promise<void>
  attach: (mission: Mission, initialMessages: MissionMessage[]) => void
  archive: () => Promise<void>
  reset: () => void
}

const RECENT_STEPS_CAP = 30

// Module-scoped connection state — there is only ever one EventSource per
// browser tab regardless of how many components subscribe via the composable.
let es: EventSource | null = null
let pendingAssistant: MissionMessage | null = null

// Rolling buffer of the streamed reasoning text. We surface only the tail
// (last sentence-ish) since long thoughts would blow out the ticker line.
let thoughtBuffer = ''
const THOUGHT_TAIL = 90 // chars

function lastThoughtSnippet(buf: string): string {
  if (buf.length <= THOUGHT_TAIL) return buf.trim()
  // Prefer the start of a sentence near the end of the buffer.
  const tail = buf.slice(-THOUGHT_TAIL)
  const breakAt = tail.search(/[.!?\n]\s+/)
  if (breakAt >= 0 && breakAt < tail.length - 8) {
    return tail.slice(breakAt + 1).trim()
  }
  return tail.trimStart()
}

function toolLabel(evt: { title?: string, status?: string, raw: unknown }): string {
  if (evt.title && evt.title.trim()) return evt.title.trim()
  // Fall back to a generic name from the raw payload if present.
  const raw = evt.raw as { name?: string, tool?: string } | undefined
  return raw?.name ?? raw?.tool ?? 'tool'
}

/**
 * Singleton-per-app composable backed by `useState`. Every call returns the
 * same reactive refs, so `MissionPanel` (which mutates) and `index.vue`
 * (which observes "is the orchestrator thinking") see the same state.
 */
export function useMissionStream(): UseMissionStream {
  const mission = useState<Mission | null>('mission.active', () => null)
  const messages = useState<MissionMessage[]>('mission.messages', () => [])
  const streaming = useState<boolean>('mission.streaming', () => false)
  const connected = useState<boolean>('mission.connected', () => false)
  const error = useState<string | null>('mission.error', () => null)
  const lastStep = useState<ThoughtStep | null>('mission.lastStep', () => null)
  const recentSteps = useState<ThoughtStep[]>('mission.recentSteps', () => [])

  /**
   * Push a step into both refs. Recent buffer is FIFO with a cap; the
   * `lastStep` for "thought" updates the head in place rather than appending,
   * so the bubble shows the growing snippet without spamming the timeline
   * with one entry per chunk.
   */
  function pushStep(step: ThoughtStep) {
    lastStep.value = step
    if (step.kind === 'thought' && recentSteps.value[0]?.kind === 'thought') {
      // Replace the head — same reasoning fragment, growing.
      recentSteps.value = [step, ...recentSteps.value.slice(1)]
    } else {
      const next = [step, ...recentSteps.value]
      if (next.length > RECENT_STEPS_CAP) next.length = RECENT_STEPS_CAP
      recentSteps.value = next
    }
  }

  function ensureStream(missionId: string) {
    if (es) return
    if (typeof window === 'undefined') return

    const source = new EventSource(`/api/missions/${missionId}/stream`)

    source.addEventListener('open', () => {
      connected.value = true
      error.value = null
    })

    source.addEventListener('error', () => {
      connected.value = false
    })

    const handle = (raw: MessageEvent<string>) => {
      let evt: MissionEvent
      try {
        evt = JSON.parse(raw.data) as MissionEvent
      } catch {
        return
      }
      if (evt.type === 'user') {
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'user' && last.id < 0) {
          last.id = evt.messageId
        }
      } else if (evt.type === 'chunk') {
        if (evt.thought) {
          // Inner monologue: feed the rolling buffer, surface the tail to
          // the floor ticker, but keep it out of the chat transcript.
          thoughtBuffer += evt.delta
          pushStep({
            kind: 'thought',
            label: lastThoughtSnippet(thoughtBuffer),
            ts: Date.now()
          })
          return
        }
        if (!pendingAssistant) {
          pendingAssistant = {
            id: -1,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
            pending: true
          }
          messages.value = [...messages.value, pendingAssistant]
        }
        pendingAssistant.content += evt.delta
        messages.value = [...messages.value]
        streaming.value = true
      } else if (evt.type === 'tool') {
        // Tool calls get their own ticker step. Thought buffer also resets
        // because a tool boundary marks the end of a reasoning fragment.
        thoughtBuffer = ''
        pushStep({
          kind: 'tool',
          label: toolLabel(evt),
          ts: Date.now()
        })
      } else if (evt.type === 'state') {
        // Snapshot from the server on (re)connect. Lets a tab that joined
        // mid-turn flip into "streaming" without waiting for the next chunk.
        streaming.value = !!evt.streaming
        if (evt.streaming && evt.messageId !== null) {
          // Hook pendingAssistant onto the existing message so subsequent
          // chunks accumulate into it instead of creating a duplicate.
          const existing = messages.value.find(m => m.id === evt.messageId)
          if (existing) {
            existing.content = evt.content
            existing.pending = true
            pendingAssistant = existing
            messages.value = [...messages.value]
          } else {
            // The message hadn't been loaded yet — synthesize it.
            pendingAssistant = {
              id: evt.messageId,
              role: 'assistant',
              content: evt.content,
              createdAt: new Date().toISOString(),
              pending: true
            }
            messages.value = [...messages.value, pendingAssistant]
          }
        }
      } else if (evt.type === 'done') {
        if (pendingAssistant) {
          pendingAssistant.id = evt.messageId
          pendingAssistant.content = evt.content
          pendingAssistant.pending = false
          messages.value = [...messages.value]
          pendingAssistant = null
        } else {
          // No pendingAssistant in memory (e.g. reconnected after the
          // mid-turn buffer flushed) — update the existing persisted
          // message in place rather than appending a duplicate.
          const existing = messages.value.find(m => m.id === evt.messageId)
          if (existing) {
            existing.content = evt.content
            existing.pending = false
            messages.value = [...messages.value]
          } else {
            messages.value = [
              ...messages.value,
              {
                id: evt.messageId,
                role: 'assistant',
                content: evt.content,
                createdAt: new Date().toISOString(),
                pending: false
              }
            ]
          }
        }
        streaming.value = false
        // Clear the ticker once the turn lands — the avatar goes back to idle.
        // Recent steps are kept so the side panel still shows the timeline of
        // what the orchestrator just did.
        thoughtBuffer = ''
        lastStep.value = null
      } else if (evt.type === 'error') {
        error.value = evt.message
        streaming.value = false
      }
    }

    source.addEventListener('user', handle as EventListener)
    source.addEventListener('chunk', handle as EventListener)
    source.addEventListener('tool', handle as EventListener)
    source.addEventListener('done', handle as EventListener)
    source.addEventListener('error', handle as EventListener)
    source.addEventListener('state', handle as EventListener)

    es = source
  }

  function close() {
    if (es) {
      es.close()
      es = null
    }
    connected.value = false
  }

  function attach(m: Mission, initialMessages: MissionMessage[]) {
    mission.value = m
    messages.value = [...initialMessages]
    streaming.value = false
    error.value = null
    pendingAssistant = null
    ensureStream(m.id)
  }

  async function start(orchestratorSlug: string, text: string) {
    error.value = null
    streaming.value = true
    pendingAssistant = null
    const optimistic: MissionMessage = {
      id: -Date.now(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    }
    messages.value = [optimistic]

    try {
      const res = await $fetch<{ mission: Mission }>('/api/missions', {
        method: 'POST',
        body: { orchestratorSlug, message: text }
      })
      mission.value = res.mission
      ensureStream(res.mission.id)
    } catch (e) {
      streaming.value = false
      error.value = (e as Error).message
      throw e
    }
  }

  async function send(text: string) {
    if (!mission.value) throw new Error('No active mission')
    error.value = null
    streaming.value = true
    pendingAssistant = null
    const optimistic: MissionMessage = {
      id: -Date.now(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    }
    messages.value = [...messages.value, optimistic]
    try {
      await $fetch(`/api/missions/${mission.value.id}/messages`, {
        method: 'POST',
        body: { message: text }
      })
    } catch (e) {
      streaming.value = false
      error.value = (e as Error).message
      throw e
    }
  }

  async function archive() {
    if (!mission.value) return
    try {
      await $fetch(`/api/missions/${mission.value.id}/archive`, { method: 'POST' })
    } finally {
      reset()
    }
  }

  function reset() {
    close()
    mission.value = null
    messages.value = []
    streaming.value = false
    error.value = null
    pendingAssistant = null
    thoughtBuffer = ''
    lastStep.value = null
    recentSteps.value = []
  }

  return { mission, messages, streaming, connected, error, lastStep, recentSteps, start, send, attach, archive, reset }
}
