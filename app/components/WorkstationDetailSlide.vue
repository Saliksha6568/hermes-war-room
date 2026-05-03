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
const { feed: taskFeed, loading: taskFeedLoading, refresh: refreshFeed } = useTaskFeed(feedTaskId, feedLive)

interface FullLog {
  taskId: string
  exists: boolean
  bytes: number | null
  startedAt: number | null
  lastActivityAt: number | null
  truncated: boolean
  content: string | null
}
const fullLog = ref<FullLog | null>(null)
const fullLogLoading = ref(false)
const logExpanded = ref(false)

async function loadFullLog() {
  if (!feedTaskId.value) return
  fullLogLoading.value = true
  try {
    fullLog.value = await $fetch<FullLog>(`/api/kanban/tasks/${feedTaskId.value}/log`)
  } catch (e) {
    console.error('full log load failed', e)
  } finally {
    fullLogLoading.value = false
  }
}

function onLogToggle(open: boolean) {
  logExpanded.value = open
  if (open && !fullLog.value) loadFullLog()
}

/* Reset the full-log cache when the task changes — otherwise we'd show the
   prior task's log under the new task's header. */
watch(feedTaskId, () => {
  fullLog.value = null
  logExpanded.value = false
})

const logTailEl = ref<HTMLPreElement | null>(null)
/* Auto-stick to the bottom of the log when new content arrives (most natural
   for tailing a running worker). If the user has scrolled UP to read history,
   we don't yank them back — only auto-scroll when they were already near the
   bottom (within 64 px). */
function scrollLogToBottom(force = false) {
  const el = logTailEl.value
  if (!el) return
  if (!force) {
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > 64) return
  }
  el.scrollTop = el.scrollHeight
}
watch(
  () => fullLog.value?.content ?? taskFeed.value?.logTail ?? '',
  () => nextTick(() => scrollLogToBottom())
)
watch(logExpanded, (open) => {
  if (open) nextTick(() => scrollLogToBottom(true))
})

const toast = useToast()
const killing = ref(false)
const confirmKill = ref(false)

async function killTask() {
  if (!currentTask.value) return
  killing.value = true
  try {
    const id = currentTask.value.id
    const res = await $fetch<{ workersKilled: number[], archived: boolean }>(
      `/api/kanban/tasks/${id}/kill`,
      { method: 'POST', body: { reason: 'killed via war-room' } }
    )
    toast.add({
      title: t('warRoom.detail.taskKilled'),
      description: `pids: ${res.workersKilled.join(', ') || '—'} · archived: ${res.archived}`,
      color: 'primary',
      icon: 'i-lucide-skull'
    })
    confirmKill.value = false
    /* The kanban poll picks up the new status within a tick; nudge the feed
       endpoint too so token totals settle. */
    await refreshFeed()
  } catch (e) {
    const err = e as { data?: { message?: string }, message?: string }
    toast.add({
      title: t('warRoom.detail.taskKillFailed'),
      description: err.data?.message ?? err.message,
      color: 'error'
    })
  } finally {
    killing.value = false
  }
}

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

/** Human-readable duration since a unix-ms timestamp. */
function humanDuration(unixMs: number): string {
  const totalS = Math.max(0, Math.floor((Date.now() - unixMs) / 1000))
  if (totalS < 60) return `${totalS}s`
  const m = Math.floor(totalS / 60)
  if (m < 60) return `${m}m ${totalS % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

const fmtCost = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
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
              v-for="sub in delegatedTasks"
              :key="sub.id"
              class="subtask"
            >
              <UBadge
                :color="statusColor(sub.status)"
                variant="subtle"
                size="xs"
              >
                {{ sub.status }}
              </UBadge>
              <div class="subtask-body">
                <p class="subtask-title">
                  {{ sub.title }}
                </p>
                <p class="subtask-meta">
                  {{ sub.assignee ?? '—' }} · {{ sub.id }}
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
          </h3>

          <!-- Always-visible meta strip: duration, session id, token chips. -->
          <div
            v-if="taskFeed"
            class="feed-meta"
          >
            <span
              v-if="taskFeed.startedAt"
              class="feed-meta-chip"
              :title="new Date(taskFeed.startedAt).toLocaleString()"
            >
              <UIcon
                name="i-lucide-timer"
                class="size-3"
              />
              {{ t('warRoom.detail.taskFeedDuration', { duration: humanDuration(taskFeed.startedAt) }) }}
            </span>
            <span
              v-if="taskFeed.sessionId"
              class="feed-meta-chip feed-meta-chip--mono"
              :title="t('warRoom.detail.taskFeedSession') + ': ' + taskFeed.sessionId"
            >
              <UIcon
                name="i-lucide-fingerprint"
                class="size-3"
              />
              {{ taskFeed.sessionId.slice(-12) }}
            </span>
          </div>

          <!-- Token breakdown — input / output / cache / cost as inline chips. -->
          <div
            v-if="taskFeed?.totals"
            class="feed-tokens"
          >
            <span class="feed-token feed-token--in">
              <span class="feed-token-label">{{ t('warRoom.detail.tokenInput') }}</span>
              <span class="feed-token-value">{{ fmt(taskFeed.totals.inputTokens) }}</span>
            </span>
            <span class="feed-token feed-token--out">
              <span class="feed-token-label">{{ t('warRoom.detail.tokenOutput') }}</span>
              <span class="feed-token-value">{{ fmt(taskFeed.totals.outputTokens) }}</span>
            </span>
            <span
              v-if="taskFeed.totals.cacheReadTokens"
              class="feed-token feed-token--cache"
            >
              <span class="feed-token-label">{{ t('warRoom.detail.tokenCacheRead') }}</span>
              <span class="feed-token-value">{{ fmt(taskFeed.totals.cacheReadTokens) }}</span>
            </span>
            <span
              v-if="taskFeed.totals.cacheWriteTokens"
              class="feed-token feed-token--cache"
            >
              <span class="feed-token-label">{{ t('warRoom.detail.tokenCacheWrite') }}</span>
              <span class="feed-token-value">{{ fmt(taskFeed.totals.cacheWriteTokens) }}</span>
            </span>
            <span
              v-if="taskFeed.totals.estimatedCostUsd > 0"
              class="feed-token feed-token--cost"
            >
              <span class="feed-token-label">{{ t('warRoom.detail.tokenCost') }}</span>
              <span class="feed-token-value">{{ fmtCost(taskFeed.totals.estimatedCostUsd) }}</span>
            </span>
          </div>

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
          <ul
            v-else-if="visibleMessages.length"
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
          <p
            v-else-if="taskFeed && !taskFeed.sessionId && !taskFeed.logTail"
            class="empty"
          >
            {{ t('warRoom.detail.taskFeedNoSession') }}
          </p>
          <p
            v-else-if="taskFeed && !visibleMessages.length && !taskFeed.logTail"
            class="empty"
          >
            {{ t('warRoom.detail.taskFeedEmpty') }}
          </p>

          <!-- Worker log. Collapsed by default when there's a structured feed,
               auto-expanded when state.db is empty so the user always has
               something to read. The summary is the toggle; expanding fires
               loadFullLog() so we don't ship MBs in every poll. -->
          <details
            v-if="taskFeed?.logTail || taskFeed?.started"
            class="feed-log"
            :open="!visibleMessages.length || logExpanded"
            @toggle="onLogToggle(($event.target as HTMLDetailsElement).open)"
          >
            <summary class="feed-log-summary">
              <UIcon
                name="i-lucide-terminal"
                class="size-3.5"
              />
              <span>{{ t('warRoom.detail.taskFeedLog') }}</span>
              <span
                v-if="(fullLog?.bytes ?? taskFeed?.logBytes) !== null && (fullLog?.bytes ?? taskFeed?.logBytes) !== undefined"
                class="feed-log-size"
              >{{ fmt(Math.round(((fullLog?.bytes ?? taskFeed?.logBytes) as number) / 1024)) }} KB</span>
            </summary>

            <div
              v-if="taskFeed?.startedAt && taskFeed?.lastActivityAt"
              class="feed-log-span"
            >
              <UIcon
                name="i-lucide-clock"
                class="size-3"
              />
              {{ t('warRoom.detail.taskFeedLogSpan', {
                from: new Date(taskFeed.startedAt).toLocaleTimeString(),
                to:   new Date(taskFeed.lastActivityAt).toLocaleTimeString()
              }) }}
              <span class="feed-log-span-sep">·</span>
              {{ t('warRoom.detail.taskFeedLastActivity', {
                ago: humanDuration(taskFeed.lastActivityAt)
              }) }}
              <button
                type="button"
                class="feed-log-reload"
                :disabled="fullLogLoading"
                @click="loadFullLog"
              >
                <UIcon
                  name="i-lucide-refresh-cw"
                  class="size-3"
                  :class="{ 'feed-log-reload-spin': fullLogLoading }"
                />
                {{ t('warRoom.detail.taskFeedLogReload') }}
              </button>
            </div>

            <p
              v-if="fullLog?.truncated && fullLog?.bytes"
              class="feed-log-hint"
            >
              {{ t('warRoom.detail.taskFeedLogTruncated', {
                bytes: fmt(Math.round((fullLog.content?.length ?? 0) / 1024)) + ' KB',
                total: fmt(Math.round(fullLog.bytes / 1024)) + ' KB'
              }) }}
            </p>
            <p
              v-else-if="!fullLog && !fullLogLoading"
              class="feed-log-hint"
            >
              {{ t('warRoom.detail.taskFeedLogHint') }}
            </p>
            <p
              v-if="fullLogLoading && !fullLog"
              class="feed-log-hint"
            >
              {{ t('warRoom.detail.taskFeedLogLoading') }}
            </p>

            <pre
              ref="logTailEl"
              class="feed-log-tail"
            >{{ fullLog?.content ?? taskFeed?.logTail ?? '' }}</pre>
          </details>

          <!-- Kill button. Only meaningful while the worker is alive. -->
          <div
            v-if="currentTask && (currentTask.status === 'running' || currentTask.status === 'blocked')"
            class="feed-kill"
          >
            <button
              v-if="!confirmKill"
              type="button"
              class="feed-kill-btn"
              :disabled="killing"
              @click="confirmKill = true"
            >
              <UIcon
                name="i-lucide-skull"
                class="size-3.5"
              />
              <span>{{ t('warRoom.detail.taskKill') }}</span>
            </button>
            <div
              v-else
              class="feed-kill-confirm"
            >
              <p class="feed-kill-title">
                {{ t('warRoom.detail.taskKillConfirmTitle', { id: currentTask.id }) }}
              </p>
              <p class="feed-kill-body">
                {{ t('warRoom.detail.taskKillConfirmBody') }}
              </p>
              <div class="feed-kill-actions">
                <button
                  type="button"
                  class="feed-kill-cancel"
                  :disabled="killing"
                  @click="confirmKill = false"
                >
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="feed-kill-confirm-btn"
                  :disabled="killing"
                  @click="killTask"
                >
                  <UIcon
                    v-if="killing"
                    name="i-lucide-loader"
                    class="size-3.5 feed-kill-spin"
                  />
                  <UIcon
                    v-else
                    name="i-lucide-skull"
                    class="size-3.5"
                  />
                  <span>{{ killing ? t('warRoom.detail.taskKilling') : t('warRoom.detail.taskKillConfirmAction') }}</span>
                </button>
              </div>
            </div>
          </div>
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

/* Meta strip: duration + session id, sits between the section title and the
   token chips. */
.feed-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 8px;
}
.feed-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  background: rgba(40, 36, 26, 0.05);
  border: 1px solid rgba(40, 36, 26, 0.16);
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: rgba(40, 36, 26, 0.78);
}
.feed-meta-chip--mono {
  letter-spacing: 0.02em;
}

/* Token breakdown — input/output/cache/cost. Each chip has a small label on
   top-line, a number underneath, a thin colored left border so the eye reads
   the four/five values as a row of meters. */
.feed-tokens {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 4px;
  margin: 0 0 12px;
}
.feed-token {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 8px;
  background: rgba(255, 252, 240, 0.6);
  border: 1px solid rgba(28, 26, 20, 0.14);
  border-left-width: 3px;
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  min-width: 0;
}
.feed-token--in    { border-left-color: #2f5a2f; }
.feed-token--out   { border-left-color: #c8421f; }
.feed-token--cache { border-left-color: #6b6555; }
.feed-token--cost  { border-left-color: #8a5a14; }
.feed-token-label {
  font-size: 8.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(40, 36, 26, 0.55);
}
.feed-token-value {
  font-size: 12px;
  font-weight: 600;
  color: rgba(28, 26, 20, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Raw log tail. Folded by default when there's structured feed; opens up
   when the worker has only emitted log lines so far. */
.feed-log {
  margin-top: 6px;
  border: 1px solid rgba(40, 36, 26, 0.18);
  border-radius: 3px;
  background: #1c1a14;
  color: #e6dfc8;
}
.feed-log-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 9px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  color: #f3a93b;
  list-style: none;
}
.feed-log-summary::-webkit-details-marker { display: none; }
.feed-log-summary::before {
  content: '▸';
  display: inline-block;
  font-size: 10px;
  color: #f3a93b;
  transition: transform 0.12s ease;
}
.feed-log[open] .feed-log-summary::before {
  transform: rotate(90deg);
}
.feed-log-size {
  margin-left: auto;
  color: rgba(243, 169, 59, 0.6);
  letter-spacing: 0.05em;
}
.feed-log-hint {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 11px;
  color: rgba(230, 223, 200, 0.55);
  margin: 0;
  padding: 0 12px 4px;
  line-height: 1.35;
}
.feed-log-tail {
  margin: 0;
  padding: 8px 12px 12px;
  background: transparent;
  color: #e6dfc8;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow-y: auto;
}

/* Log timing strip — sits between the summary and the log body. Shows the
   timestamp range of the file (we can't add per-line timestamps without
   instrumenting hermes, but the file's birth/mtime gives the user the
   bracketing window). */
.feed-log-span {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: rgba(243, 169, 59, 0.78);
}
.feed-log-span-sep {
  opacity: 0.4;
}
.feed-log-reload {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: transparent;
  border: 1px solid rgba(243, 169, 59, 0.32);
  border-radius: 2px;
  font: inherit;
  color: rgba(243, 169, 59, 0.85);
  cursor: pointer;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-size: 9px;
}
.feed-log-reload:hover:not(:disabled) {
  background: rgba(243, 169, 59, 0.08);
  border-color: rgba(243, 169, 59, 0.6);
}
.feed-log-reload:disabled { opacity: 0.5; cursor: not-allowed; }
.feed-log-reload-spin {
  animation: feedlog-spin 1s linear infinite;
}
@keyframes feedlog-spin { to { transform: rotate(360deg); } }

/* Kill control. Quiet skull link until the user clicks it; flips to a red
   confirmation strip with the consequences spelled out. */
.feed-kill {
  margin-top: 10px;
}
.feed-kill-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid rgba(40, 36, 26, 0.22);
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(40, 36, 26, 0.65);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.feed-kill-btn:hover:not(:disabled) {
  background: rgba(200, 66, 31, 0.08);
  border-color: rgba(200, 66, 31, 0.6);
  color: #c8421f;
}
.feed-kill-confirm {
  background: rgba(200, 66, 31, 0.08);
  border: 1px solid rgba(200, 66, 31, 0.5);
  border-radius: 3px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.feed-kill-title {
  margin: 0;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #c8421f;
}
.feed-kill-body {
  margin: 0;
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 12.5px;
  line-height: 1.4;
  color: rgba(40, 36, 26, 0.78);
}
.feed-kill-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.feed-kill-cancel,
.feed-kill-confirm-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
}
.feed-kill-cancel {
  background: transparent;
  border: 1px solid rgba(40, 36, 26, 0.22);
  color: rgba(40, 36, 26, 0.65);
}
.feed-kill-confirm-btn {
  background: #c8421f;
  border: 1px solid #c8421f;
  color: #f4efe2;
  font-weight: 600;
}
.feed-kill-confirm-btn:hover:not(:disabled) {
  background: #a83716;
}
.feed-kill-cancel:disabled, .feed-kill-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.feed-kill-spin { animation: feedlog-spin 1s linear infinite; }

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
