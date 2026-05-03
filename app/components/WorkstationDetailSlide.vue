<script setup lang="ts">
import type { Profile } from '~/types/profile'
import type { CurrentTask } from '~/types/mission'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  profile: Profile | null
  /** All currently active tasks. Used to find this operative's task graph. */
  tasks: CurrentTask[]
  /** All operatives on the floor — for resolving parent task assignees. */
  profiles: Profile[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Mission stream is a singleton — calling the composable here gives us the
// SAME refs that MissionPanel uses, so the thread + steps update in real time
// without any explicit subscription.
const missionStream = useMissionStream()

/** True iff the operative we're inspecting is the active orchestrator. */
const isOrchestrator = computed(() => {
  return !!props.profile
    && missionStream.mission.value?.orchestratorSlug === props.profile.slug
})

const isStreaming = computed(() => isOrchestrator.value && missionStream.streaming.value)

const callsign = computed(() =>
  props.profile ? (props.profile.givenName || props.profile.displayName).toUpperCase() : ''
)

const profileBySlug = computed(() => {
  const m = new Map<string, Profile>()
  for (const p of props.profiles) m.set(p.slug, p)
  return m
})

const taskById = computed(() => {
  const m = new Map<string, CurrentTask>()
  for (const t of props.tasks) m.set(t.id, t)
  return m
})

/** All tasks currently assigned to this operative, ordered by status. */
const myTasks = computed<CurrentTask[]>(() => {
  if (!props.profile) return []
  return props.tasks.filter(t => t.assignee === props.profile!.slug)
})

/** Top task = first running, otherwise first by status order from the API. */
const currentTask = computed(() => myTasks.value[0] ?? null)

/** Tasks this operative has delegated (children of any task they own). */
const delegatedTasks = computed<CurrentTask[]>(() => {
  if (!props.profile) return []
  const myIds = new Set(myTasks.value.map(t => t.id))
  return props.tasks.filter(t => t.parentIds.some(pid => myIds.has(pid)))
})

/** Parents of currentTask whose assignee is also on the floor. */
const delegatedBy = computed(() => {
  if (!currentTask.value) return [] as { task: CurrentTask, profile: Profile | null }[]
  return currentTask.value.parentIds
    .map(id => taskById.value.get(id))
    .filter((t): t is CurrentTask => !!t)
    .map(t => ({
      task: t,
      profile: t.assignee ? profileBySlug.value.get(t.assignee) ?? null : null
    }))
})

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString()
}

function ageS(unix: number): number {
  return Math.max(0, Math.floor(Date.now() / 1000) - unix)
}

function statusColor(status: string): 'primary' | 'error' | 'warning' | 'neutral' {
  switch (status) {
    case 'running': return 'primary'
    case 'blocked': return 'error'
    case 'ready':
    case 'todo': return 'warning'
    default: return 'neutral'
  }
}

function shortTime(unixMs: number): string {
  const d = new Date(unixMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

// Task feed: pull the worker's full conversation (messages + reasoning) for
// the current task. Polls while the task is still live; one-shot on done.
const feedTaskId = computed(() => (props.open ? currentTask.value?.id ?? null : null))
const feedLive = computed(() => {
  const s = currentTask.value?.status
  return props.open && (s === 'running' || s === 'blocked' || s === 'ready' || s === 'todo')
})
const { feed: taskFeed, loading: taskFeedLoading } = useTaskFeed(feedTaskId, feedLive)

const visibleMessages = computed(() =>
  (taskFeed.value?.messages ?? []).filter(m => m.role !== 'system')
)

function roleVariant(role: string): 'user' | 'assistant' | 'tool' | 'other' {
  if (role === 'user' || role === 'assistant' || role === 'tool') return role
  return 'other'
}

function roleGlyph(role: string): string {
  if (role === 'user') return 'i-lucide-user'
  if (role === 'assistant') return 'i-lucide-sparkles'
  if (role === 'tool') return 'i-lucide-wrench'
  return 'i-lucide-circle'
}

function summarizeToolCalls(calls: unknown): string | null {
  if (!Array.isArray(calls) || calls.length === 0) return null
  return calls
    .map(c => (c as { function?: { name?: string }, name?: string }).function?.name
      ?? (c as { name?: string }).name
      ?? '?')
    .join(', ')
}

function fmt(n: number): string {
  return n.toLocaleString()
}

function shortTimeFromSec(unixSec: number | null): string {
  if (unixSec === null) return ''
  return shortTime(unixSec * 1000)
}
</script>

<template>
  <USlideover
    :open="open"
    side="right"
    :ui="{ content: 'max-w-md w-full' }"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <template #content>
      <div
        v-if="profile"
        class="slide"
      >
        <header
          class="slide-header"
          :style="{ '--accent': '#' + profile.backgroundColor }"
        >
          <div class="header-portrait">
            <div class="header-disc" />
            <img
              :src="profile.avatarPortraitUrl"
              :alt="callsign"
              class="header-character"
            >
          </div>
          <div class="header-meta">
            <p class="header-eyebrow">
              {{ t('warRoom.detail.title') }}
            </p>
            <h2 class="header-callsign">
              {{ callsign }}
            </h2>
            <p class="header-slug">
              {{ profile.displayName }}
            </p>
          </div>
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            color="neutral"
            class="header-close"
            @click="emit('update:open', false)"
          />
        </header>

        <section class="section">
          <h3 class="section-title">
            {{ t('warRoom.detail.currentTask') }}
          </h3>
          <div
            v-if="currentTask"
            class="task-card"
          >
            <div class="task-card-head">
              <UBadge
                :color="statusColor(currentTask.status)"
                variant="subtle"
                size="sm"
              >
                {{ currentTask.status }}
              </UBadge>
              <span class="task-id">{{ currentTask.id }}</span>
            </div>
            <h4 class="task-title">
              {{ currentTask.title }}
            </h4>
            <p
              v-if="currentTask.body"
              class="task-body"
            >
              {{ currentTask.body }}
            </p>
            <ul class="task-meta">
              <li v-if="currentTask.startedAt">
                {{ t('warRoom.detail.started', { time: formatTime(currentTask.startedAt) }) }}
              </li>
              <li v-if="currentTask.lastHeartbeatAt">
                {{ t('warRoom.detail.heartbeat', { ago: ageS(currentTask.lastHeartbeatAt) }) }}
              </li>
            </ul>

            <div
              v-if="delegatedBy.length"
              class="delegators"
            >
              <p class="delegators-title">
                {{ t('warRoom.detail.delegatedBy') }}
              </p>
              <ul>
                <li
                  v-for="(d, i) in delegatedBy"
                  :key="i"
                  class="delegator"
                >
                  <span
                    v-if="d.profile"
                    class="delegator-dot"
                    :style="{ background: '#' + d.profile.backgroundColor }"
                  />
                  <span class="delegator-name">
                    {{ d.profile?.givenName || d.profile?.displayName || d.task.assignee || '—' }}
                  </span>
                  <span class="delegator-task">{{ d.task.title }}</span>
                </li>
              </ul>
            </div>
          </div>
          <p
            v-else
            class="empty"
          >
            {{ t('warRoom.detail.noTask') }}
          </p>
        </section>

        <section class="section">
          <h3 class="section-title">
            {{ t('warRoom.detail.subtasks') }}
          </h3>
          <ul
            v-if="delegatedTasks.length"
            class="subtask-list"
          >
            <li
              v-for="t in delegatedTasks"
              :key="t.id"
              class="subtask"
            >
              <UBadge
                :color="statusColor(t.status)"
                variant="subtle"
                size="xs"
              >
                {{ t.status }}
              </UBadge>
              <div class="subtask-body">
                <p class="subtask-title">
                  {{ t.title }}
                </p>
                <p class="subtask-meta">
                  {{ t.assignee ?? '—' }} · {{ t.id }}
                </p>
              </div>
            </li>
          </ul>
          <p
            v-else
            class="empty"
          >
            {{ t('warRoom.detail.noSubtasks') }}
          </p>
        </section>

        <!-- Task activity: full message + reasoning thread of the worker
             processing the current kanban task. Read-only. Polled while
             the task is alive. -->
        <section
          v-if="feedTaskId"
          class="section"
        >
          <h3 class="section-title">
            {{ t('warRoom.detail.taskFeed') }}
            <span
              v-if="feedLive"
              class="live-pip"
            >
              <span class="live-pip-dot" />
              {{ t('warRoom.detail.live') }}
            </span>
            <span
              v-if="taskFeed?.totals"
              class="feed-totals"
              :title="t('warRoom.detail.taskFeedTotalsTitle', {
                input: fmt(taskFeed.totals.inputTokens),
                output: fmt(taskFeed.totals.outputTokens)
              })"
            >
              {{ taskFeed.totals.messageCount }} · {{ fmt(taskFeed.totals.inputTokens + taskFeed.totals.outputTokens) }} tok
            </span>
          </h3>
          <p
            v-if="taskFeedLoading && !taskFeed"
            class="empty"
          >
            {{ t('warRoom.detail.taskFeedLoading') }}
          </p>
          <p
            v-else-if="!taskFeed?.started"
            class="empty"
          >
            {{ t('warRoom.detail.taskFeedNotStarted') }}
          </p>
          <p
            v-else-if="!taskFeed.sessionId"
            class="empty"
          >
            {{ t('warRoom.detail.taskFeedNoSession') }}
          </p>
          <p
            v-else-if="!visibleMessages.length"
            class="empty"
          >
            {{ t('warRoom.detail.taskFeedEmpty') }}
          </p>
          <ul
            v-else
            class="feed-list"
          >
            <li
              v-for="m in visibleMessages"
              :key="m.id"
              class="feed-msg"
              :class="`feed-msg--${roleVariant(m.role)}`"
            >
              <div class="feed-msg-head">
                <UIcon
                  :name="roleGlyph(m.role)"
                  class="feed-msg-glyph"
                />
                <span class="feed-msg-role">{{ m.role }}</span>
                <span
                  v-if="m.toolName"
                  class="feed-msg-tool"
                >· {{ m.toolName }}</span>
                <span
                  v-else-if="summarizeToolCalls(m.toolCalls)"
                  class="feed-msg-tool"
                >· {{ summarizeToolCalls(m.toolCalls) }}</span>
                <span
                  v-if="m.timestamp"
                  class="feed-msg-time"
                >{{ shortTimeFromSec(m.timestamp) }}</span>
              </div>
              <details
                v-if="m.reasoning"
                class="feed-msg-reasoning"
              >
                <summary>{{ t('warRoom.detail.taskFeedReasoning') }}</summary>
                <pre>{{ m.reasoning }}</pre>
              </details>
              <pre
                v-if="m.content"
                class="feed-msg-content"
              >{{ m.content }}</pre>
            </li>
          </ul>
        </section>

        <!-- Recent activity: rolling list of tool calls + thought fragments
             coming off the SSE stream. Only meaningful for the orchestrator
             of the current mission. -->
        <section
          v-if="isOrchestrator"
          class="section"
        >
          <h3 class="section-title">
            {{ t('warRoom.detail.lastSteps') }}
            <span
              v-if="isStreaming"
              class="live-pip"
            >
              <span class="live-pip-dot" />
              {{ t('warRoom.detail.live') }}
            </span>
          </h3>
          <ul
            v-if="missionStream.recentSteps.value.length"
            class="step-list"
          >
            <li
              v-for="(step, i) in missionStream.recentSteps.value"
              :key="`${step.ts}-${i}`"
              class="step"
              :class="`step--${step.kind}`"
            >
              <span class="step-time">{{ shortTime(step.ts) }}</span>
              <UIcon
                :name="step.kind === 'tool' ? 'i-lucide-arrow-right' : 'i-lucide-brain'"
                class="step-glyph"
              />
              <span class="step-label">{{ step.label }}</span>
            </li>
          </ul>
          <p
            v-else
            class="empty"
          >
            {{ t('warRoom.detail.noSteps') }}
          </p>
        </section>

        <!-- Mission thread: user/assistant messages from the active mission
             with this operative as orchestrator. Read-only here; users still
             reply via MissionPanel on the floor. -->
        <section
          v-if="isOrchestrator"
          class="section section--thread"
        >
          <h3 class="section-title">
            {{ t('warRoom.detail.missionThread') }}
          </h3>
          <ul
            v-if="missionStream.messages.value.length"
            class="thread"
          >
            <li
              v-for="msg in missionStream.messages.value"
              :key="`${msg.id}-${msg.createdAt}`"
              class="msg"
              :class="`msg--${msg.role}`"
            >
              <span class="msg-role">{{ msg.role }}</span>
              <p
                class="msg-body"
                :class="{ 'msg-body--pending': msg.pending }"
              >
                {{ msg.content }}
                <span
                  v-if="msg.pending"
                  class="msg-cursor"
                >▍</span>
              </p>
            </li>
          </ul>
          <p
            v-else
            class="empty"
          >
            {{ t('warRoom.detail.noMission') }}
          </p>
        </section>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.slide {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f4efe2;
  color: #1c1a14;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  overflow-y: auto;
}

.slide-header {
  --accent: #ddd;
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 22px 24px 22px 24px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 28%, #f4efe2) 0%,
      #f4efe2 100%);
  border-bottom: 1px solid rgba(28, 26, 20, 0.12);
}

.header-portrait {
  position: relative;
  width: 76px;
  aspect-ratio: 1 / 1;
  flex-shrink: 0;
}
.header-disc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 35%,
      color-mix(in srgb, var(--accent) 94%, white) 0%,
      var(--accent) 60%,
      color-mix(in srgb, var(--accent) 75%, #1c1a14) 100%);
  border: 1px solid color-mix(in srgb, var(--accent) 50%, #1c1a14);
}
.header-character {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 140%;
  aspect-ratio: 1 / 1;
  height: auto;
  object-fit: contain;
  object-position: bottom center;
  /* Same masking trick as Workstation: head free above the disc's equator,
     body clipped to the bottom semicircle so the silhouette follows the
     circle's curve. Numbers come from a 140% bottom-anchored square img
     where the disc occupies the bottom 71.4% (1 / 1.4). */
  -webkit-mask:
    linear-gradient(#000, #000) top / 100% 64.3% no-repeat,
    radial-gradient(ellipse 35.7% 35.7% at 50% 64.3%, #000 99%, transparent 100%) no-repeat;
  mask:
    linear-gradient(#000, #000) top / 100% 64.3% no-repeat,
    radial-gradient(ellipse 35.7% 35.7% at 50% 64.3%, #000 99%, transparent 100%) no-repeat;
}

.header-meta {
  min-width: 0;
}
.header-eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(28, 26, 20, 0.55);
  margin-bottom: 4px;
}
.header-callsign {
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 26px;
  letter-spacing: 0.04em;
  line-height: 1;
}
.header-slug {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: rgba(28, 26, 20, 0.55);
  margin-top: 4px;
  letter-spacing: 0.06em;
}
.header-close {
  align-self: start;
}

.section {
  padding: 18px 24px;
  border-bottom: 1px solid rgba(28, 26, 20, 0.08);
}
.section-title {
  font-size: 9.5px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(28, 26, 20, 0.55);
  margin-bottom: 12px;
}

.empty {
  font-size: 11.5px;
  color: rgba(28, 26, 20, 0.5);
  font-style: italic;
}

.task-card {
  background: rgba(255, 252, 240, 0.6);
  border: 1px solid rgba(28, 26, 20, 0.12);
  border-radius: 4px;
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.task-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}
.task-id {
  font-size: 10px;
  color: rgba(28, 26, 20, 0.45);
  letter-spacing: 0.04em;
  word-break: break-all;
}
.task-title {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 18px;
  line-height: 1.2;
  color: #1c1a14;
}
.task-body {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  line-height: 1.45;
  color: rgba(28, 26, 20, 0.78);
  white-space: pre-wrap;
  max-height: 14em;
  overflow-y: auto;
}
.task-meta {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: rgba(28, 26, 20, 0.5);
  text-transform: uppercase;
}

.delegators {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px dashed rgba(28, 26, 20, 0.18);
}
.delegators-title {
  font-size: 9.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgba(28, 26, 20, 0.5);
  margin-bottom: 6px;
}
.delegators ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.delegator {
  display: grid;
  grid-template-columns: 12px auto 1fr;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}
.delegator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.delegator-name {
  font-weight: 600;
  color: #1c1a14;
}
.delegator-task {
  color: rgba(28, 26, 20, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subtask-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subtask {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: start;
  padding: 8px 12px;
  background: rgba(255, 252, 240, 0.6);
  border: 1px solid rgba(28, 26, 20, 0.1);
  border-radius: 3px;
}
.subtask-body {
  min-width: 0;
}
.subtask-title {
  font-size: 12px;
  line-height: 1.25;
  color: #1c1a14;
}
.subtask-meta {
  font-size: 9.5px;
  letter-spacing: 0.06em;
  color: rgba(28, 26, 20, 0.55);
  margin-top: 2px;
  word-break: break-all;
}

/* "Live" pip in the section title when the SSE stream is connected. */
.live-pip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 1px 6px;
  background: rgba(200, 66, 31, 0.12);
  color: #c8421f;
  border-radius: 999px;
  font-size: 8.5px;
  letter-spacing: 0.18em;
  vertical-align: middle;
}
.feed-totals {
  margin-left: auto;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: rgba(40, 36, 26, 0.6);
  cursor: help;
}

/* Task feed: chronological worker activity. Roles get distinct treatments —
   user (the kanban prompt) calmer, assistant (the worker speaking) primary,
   tool (calls + outputs) muted technical. */
.feed-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 28em;
  overflow-y: auto;
}
.feed-msg {
  border-left: 2px solid rgba(28, 26, 20, 0.18);
  padding: 4px 0 4px 10px;
}
.feed-msg-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(40, 36, 26, 0.65);
  margin-bottom: 3px;
}
.feed-msg-glyph {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
}
.feed-msg-role {
  font-weight: 600;
}
.feed-msg-tool {
  text-transform: none;
  letter-spacing: 0.04em;
  font-weight: 500;
}
.feed-msg-time {
  margin-left: auto;
  opacity: 0.65;
}
.feed-msg-content {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11.5px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-wrap: break-word;
  margin: 0;
  color: #1c1a14;
  max-height: 14em;
  overflow-y: auto;
  background: rgba(28, 26, 20, 0.04);
  padding: 6px 8px;
  border-radius: 3px;
}
.feed-msg--user {
  border-left-color: rgba(200, 66, 31, 0.45);
}
.feed-msg--user .feed-msg-content {
  background: rgba(200, 66, 31, 0.08);
}
.feed-msg--tool {
  border-left-color: rgba(40, 36, 26, 0.28);
}
.feed-msg--tool .feed-msg-content {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  background: rgba(28, 26, 20, 0.08);
  color: #2a261c;
}
.feed-msg-reasoning {
  margin-bottom: 4px;
  font-size: 10.5px;
}
.feed-msg-reasoning summary {
  cursor: pointer;
  color: rgba(40, 36, 26, 0.55);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  user-select: none;
}
.feed-msg-reasoning summary:hover {
  color: #1c1a14;
}
.feed-msg-reasoning pre {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  margin: 4px 0 0;
  padding: 6px 8px;
  background: rgba(243, 169, 59, 0.1);
  border-left: 2px solid rgba(243, 169, 59, 0.5);
  color: #4a3a14;
  max-height: 12em;
  overflow-y: auto;
}
.live-pip-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c8421f;
  box-shadow: 0 0 4px rgba(200, 66, 31, 0.7);
  animation: live-pulse 1.6s ease-in-out infinite;
}
@keyframes live-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

/* Step timeline. Newest at the top; thought entries get a subtler glyph
   tint than tool entries (which are amber for visibility). */
.step-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 22em;
  overflow-y: auto;
}
.step {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(255, 252, 240, 0.55);
  border-left: 2px solid rgba(28, 26, 20, 0.18);
  font-size: 11px;
  line-height: 1.3;
}
.step--tool {
  border-left-color: #f3a93b;
}
.step--thought {
  border-left-color: rgba(28, 26, 20, 0.32);
}
.step-time {
  font-size: 9.5px;
  color: rgba(28, 26, 20, 0.45);
  letter-spacing: 0.04em;
}
.step-glyph {
  width: 11px;
  height: 11px;
  color: rgba(28, 26, 20, 0.55);
  flex-shrink: 0;
}
.step--tool .step-glyph {
  color: #c47b1c;
}
.step-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step:hover .step-label {
  white-space: normal;
  overflow: visible;
}

/* Mission thread — read-only chat-style transcript. */
.section--thread {
  flex: 1 1 auto;
  min-height: 0;
}
.thread {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px 10px;
  background: rgba(255, 252, 240, 0.6);
  border: 1px solid rgba(28, 26, 20, 0.1);
  border-radius: 4px;
}
.msg--user {
  background: rgba(28, 26, 20, 0.92);
  color: #f4efe2;
  border-color: transparent;
}
.msg-role {
  font-size: 8.5px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  opacity: 0.55;
}
.msg-body {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-body--pending {
  color: rgba(28, 26, 20, 0.7);
}
.msg--user .msg-body--pending {
  color: rgba(244, 239, 226, 0.85);
}
.msg-cursor {
  display: inline-block;
  margin-left: 1px;
  animation: cursor-blink 1s steps(2, start) infinite;
}
@keyframes cursor-blink {
  to { visibility: hidden; }
}
</style>
