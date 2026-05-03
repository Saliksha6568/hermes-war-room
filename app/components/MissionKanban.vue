<script setup lang="ts">
import type { Profile } from '~/types/profile'
import type { CurrentTask } from '~/types/mission'

const { t } = useI18n()

const props = defineProps<{
  tasks: CurrentTask[]
  profiles: Profile[]
}>()

const emit = defineEmits<{
  select: [task: CurrentTask]
}>()

interface Column {
  status: 'todo' | 'ready' | 'running' | 'blocked'
  label: string
  tone: 'todo' | 'ready' | 'running' | 'blocked'
}

const columns = computed<Column[]>(() => [
  { status: 'todo',    label: t('mission.board.col.todo'),    tone: 'todo' },
  { status: 'ready',   label: t('mission.board.col.ready'),   tone: 'ready' },
  { status: 'running', label: t('mission.board.col.running'), tone: 'running' },
  { status: 'blocked', label: t('mission.board.col.blocked'), tone: 'blocked' }
])

const tasksByStatus = computed(() => {
  const map = new Map<string, CurrentTask[]>()
  for (const c of columns.value) map.set(c.status, [])
  for (const task of props.tasks) {
    const arr = map.get(task.status)
    if (arr) arr.push(task)
  }
  // Stable order: priority desc, then created asc.
  for (const arr of map.values()) {
    arr.sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt))
  }
  return map
})

const profileBySlug = computed(() => {
  const m = new Map<string, Profile>()
  for (const p of props.profiles) m.set(p.slug, p)
  return m
})

function callsign(slug: string | null): string {
  if (!slug) return '—'
  const p = profileBySlug.value.get(slug)
  return (p?.givenName || p?.displayName || slug).toUpperCase()
}

function accent(slug: string | null): string {
  if (!slug) return '#9a9485'
  const p = profileBySlug.value.get(slug)
  return p ? '#' + p.backgroundColor : '#9a9485'
}

function shortAgo(unixSec: number | null): string | null {
  if (!unixSec) return null
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function timeLine(task: CurrentTask): string | null {
  if (task.startedAt) {
    return t('mission.board.started', { ago: shortAgo(task.startedAt) })
  }
  return t('mission.board.waiting', { ago: shortAgo(task.createdAt) })
}

const totalTasks = computed(() => props.tasks.length)
</script>

<template>
  <div
    v-if="totalTasks > 0"
    class="board"
  >
    <div
      v-for="col in columns"
      :key="col.status"
      class="col"
      :class="`col--${col.tone}`"
    >
      <header class="col-head">
        <span class="col-label">{{ col.label }}</span>
        <span class="col-count">{{ tasksByStatus.get(col.status)?.length ?? 0 }}</span>
      </header>
      <ul
        v-if="(tasksByStatus.get(col.status)?.length ?? 0) > 0"
        class="card-list"
      >
        <li
          v-for="task in tasksByStatus.get(col.status)"
          :key="task.id"
          class="card"
          :class="`card--${col.tone}`"
          :style="{ '--accent': accent(task.assignee) }"
          @click="emit('select', task)"
        >
          <span class="card-stripe" />
          <div class="card-head">
            <span class="card-callsign">{{ callsign(task.assignee) }}</span>
          </div>
          <p class="card-title">
            {{ task.title || '—' }}
          </p>
          <div class="card-foot">
            <span
              v-if="timeLine(task)"
              class="card-time"
            >
              {{ timeLine(task) }}
            </span>
            <span class="card-id">{{ task.id }}</span>
          </div>
        </li>
      </ul>
      <p
        v-else
        class="col-empty"
      >
        {{ t('mission.board.empty') }}
      </p>
    </div>
  </div>
  <div
    v-else
    class="board-empty"
  >
    {{ t('mission.board.boardEmpty') }}
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  height: 100%;
  min-height: 0;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: rgba(255, 252, 240, 0.55);
  border: 1px solid rgba(28, 26, 20, 0.16);
  border-radius: 3px;
  overflow: hidden;
}

.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  background: rgba(28, 26, 20, 0.06);
  border-bottom: 1px solid rgba(28, 26, 20, 0.12);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.col-label {
  color: #1c1a14;
}
.col-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 1px 6px;
  background: #1c1a14;
  color: #f4efe2;
  border-radius: 999px;
  font-size: 9px;
  letter-spacing: 0.04em;
}

/* Column accents — top stripe matching the same colour the bubble + status
   pill use, so the "running tasks" column reads green at a glance. */
.col--running .col-head { background: rgba(47, 90, 47, 0.12); border-bottom-color: rgba(47, 90, 47, 0.4); }
.col--running .col-count { background: #2f5a2f; }
.col--blocked .col-head { background: rgba(90, 31, 18, 0.12); border-bottom-color: rgba(90, 31, 18, 0.4); }
.col--blocked .col-count { background: #5a1f12; }
.col--ready .col-head { background: rgba(138, 90, 20, 0.12); border-bottom-color: rgba(138, 90, 20, 0.4); }
.col--ready .col-count { background: #8a5a14; }

.card-list {
  list-style: none;
  padding: 8px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}

.card {
  --accent: #9a9485;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px 9px 14px;
  background: #fffaef;
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 2px;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;
}
.card:hover {
  transform: translateX(1px);
  border-color: rgba(28, 26, 20, 0.42);
  background: #fffefa;
}
.card-stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--accent);
  border-radius: 2px 0 0 2px;
}
.card--running { border-color: rgba(47, 90, 47, 0.32); }
.card--blocked { border-color: rgba(90, 31, 18, 0.32); }

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 8.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.card-callsign {
  flex: 1 1 auto;
  min-width: 0;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: #1c1a14;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-title {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 13px;
  line-height: 1.2;
  color: #1c1a14;
  /* Clamp to 3 lines so cards stay roughly uniform height. */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Footer row: time on the left, task id on the right. The id keeps the
   monospace mini-font; we let it wrap below if the time line is long. */
.card-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed rgba(28, 26, 20, 0.14);
  font-family: 'IBM Plex Mono', monospace;
}
.card-time {
  font-size: 8.5px;
  letter-spacing: 0.06em;
  color: #6b6555;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-id {
  font-size: 8px;
  letter-spacing: 0.08em;
  font-weight: 500;
  color: #8a8473;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: all;
}

.col-empty {
  padding: 18px 10px;
  text-align: center;
  color: #8a8473;
  font-size: 9.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-style: italic;
}

.board-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  text-align: center;
  color: #6b6555;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
}
</style>
