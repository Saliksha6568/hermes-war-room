<script setup lang="ts">
import type { Profile } from '~/types/profile'

const { t } = useI18n()
const { data: profiles, status, error, refresh } = await useFetch<Profile[]>('/api/profiles')

// Home is the live operations floor — only active operatives are on duty here.
const activeProfiles = computed(() => (profiles.value ?? []).filter(p => p.active))

/* Mission stream — singleton; MissionPanel is the writer. We read the active
   mission's id so the kanban poll can scope the floor to its tasks. */
const missionStream = useMissionStream()

/* List of currently open (non-archived) missions, fed into the scope dropdown
   below the title. Polls every 10 s so newly-created missions appear without a
   manual refresh; light query, scoped to status=open. */
interface OpenMission {
  id: string
  title: string | null
  orchestratorSlug: string
  lastMessageAt: string
}
const openMissions = ref<OpenMission[]>([])
async function refreshOpenMissions() {
  try {
    const res = await $fetch<{ missions: OpenMission[] }>(
      '/api/missions?status=open&pageSize=50'
    )
    openMissions.value = res.missions
  } catch {
    /* network blips are fine — keep the previous list */
  }
}
let missionsTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  refreshOpenMissions()
  missionsTimer = setInterval(refreshOpenMissions, 10000)
})
onBeforeUnmount(() => {
  if (missionsTimer) clearInterval(missionsTimer)
})

/* The floor scopes itself to whichever mission id is selected here. `null` =
   show every kanban task across every mission (global view). Persisted to
   localStorage so reloads remember the user's choice. The default tries to
   stick to the active mission of the home's orchestrator if known. */
const SENTINEL_ALL = '__all__'
const scopeMissionId = useState<string | null>('warroom.scopeMissionId', () => {
  if (import.meta.client) {
    const v = localStorage.getItem('warroom.scopeMissionId')
    if (v === SENTINEL_ALL) return null
    if (typeof v === 'string' && v.length > 0) return v
  }
  // Resolved to active mission below once it loads.
  return null
})
watch(scopeMissionId, (v) => {
  if (import.meta.client) {
    localStorage.setItem('warroom.scopeMissionId', v ?? SENTINEL_ALL)
  }
})

/* If the user hasn't picked a mission yet (cold start) and the home's
   orchestrator gets an active mission, default-scope to it. Once the user
   picks anything (including "Todas"), we don't override their choice. */
const userPicked = ref(false)
watch(scopeMissionId, () => {
  userPicked.value = true
})
watch(() => missionStream.mission.value?.id, (id) => {
  if (!userPicked.value && id && scopeMissionId.value === null) {
    scopeMissionId.value = id
    /* Re-arm the "user hasn't picked" guard since this was an auto-default. */
    nextTick(() => {
      userPicked.value = false
    })
  }
})

const { tasks, taskByAssignee, dispatcherStale } = useKanbanTasks(scopeMissionId)

/* Floor ordering: operatives with live work float to the front, idle ones drop
   to the back. Within each band we keep the original profile order so the
   layout doesn't churn on every task transition. Bands:
     0 — running                  (worker live, current step in progress)
     1 — pending                  (ready/blocked/todo or any non-terminal status)
     2 — idle                     (no current task) */
function bandFor(status: string | undefined): number {
  if (!status) return 2
  if (status === 'running') return 0
  if (status === 'done' || status === 'archived') return 2
  return 1
}
const sortedActiveProfiles = computed(() => {
  const list = (profiles.value ?? []).filter(p => p.active)
  return list
    .map((p, i) => ({ p, i, band: bandFor(taskByAssignee.value.get(p.slug)?.status) }))
    .sort((a, b) => a.band - b.band || a.i - b.i)
    .map(x => x.p)
})

const { usage: tokenUsage } = useTokenUsage()

// Floor-wide singleton: the registry tracks every Workstation's screen
// position so DelegationOverlay can draw arrows between them. The floor el
// ref is wired up in onMounted.
const registry = provideStationRegistry()
const floorEl = ref<HTMLElement | null>(null)
onMounted(() => registry.setFloor(floorEl.value))

// Drill-down side panel — clicking a Workstation opens a slideover with the
// operative's full dossier (current task body, parents, delegated subtasks).
const selectedSlug = ref<string | null>(null)
const slideOpen = computed({
  get: () => selectedSlug.value !== null,
  set: (v) => { if (!v) selectedSlug.value = null }
})
const selectedProfile = computed<Profile | null>(() => {
  if (!selectedSlug.value) return null
  return activeProfiles.value.find(p => p.slug === selectedSlug.value) ?? null
})
function onSelect(p: Profile) {
  selectedSlug.value = p.slug
}

// Mission stream is a singleton: useMissionStream subscribes to the same
// reactive state that MissionPanel mutates. We read three things from it:
//   - busySlug: which orchestrator is mid-turn (drives bubble + ticker).
//   - lastStep: latest tool call or thought fragment (feeds the ticker).
const busySlug = computed(() => {
  if (!missionStream.streaming.value) return null
  return missionStream.mission.value?.orchestratorSlug ?? null
})
const lastStep = missionStream.lastStep

const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const clock = computed(() => {
  const d = now.value
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${h}:${m}:${s} UTC`
})

/* Items for the scope dropdown: "Todas" sentinel at the top, then each open
   mission. We use SENTINEL_ALL as the value for "all" because USelectMenu
   v-model can't distinguish `null` from "no selection". */
const scopeItems = computed(() => {
  const items: { label: string, value: string, mission?: OpenMission }[] = [
    { label: t('warRoom.scopeAll'), value: SENTINEL_ALL }
  ]
  for (const m of openMissions.value) {
    const title = m.title?.trim()
      ? m.title.length > 56 ? m.title.slice(0, 56) + '…' : m.title
      : `(sin título)`
    items.push({ label: `${title} · ${m.orchestratorSlug}`, value: m.id, mission: m })
  }
  return items
})

/* The current scope's display label — "Todas" or the selected mission's
   title. Used by the dropdown trigger and the screen-reader label. */
const toast = useToast()
/* "Nueva misión" archives the current mission and clears the panel — same
   behavior as the equivalent button inside MissionPanel, mirrored up here so
   it sits next to the page title. */
async function onNewMission() {
  if (!missionStream.mission.value) return
  try {
    await missionStream.archive()
    toast.add({ title: t('mission.archived'), color: 'primary', icon: 'i-lucide-check' })
    /* Clear the scope selector since the previous mission's id is now stale. */
    scopeMissionId.value = null
    userPicked.value = false
    refreshOpenMissions()
  } catch (e) {
    toast.add({
      title: t('mission.failure'),
      description: (e as Error).message,
      color: 'error'
    })
  }
}

/* Force-dispatch: kick `hermes kanban dispatch --json` server-side so the
   gateway picks up `ready` tasks immediately instead of waiting for its next
   tick. Useful when the dispatcher banner says "stale" or after editing a
   profile's allowlist. */
const dispatching = ref(false)
async function onForceDispatch() {
  if (dispatching.value) return
  dispatching.value = true
  try {
    const res = await $fetch<{ ok: boolean, stderr: string, code: number }>(
      '/api/kanban/dispatch',
      { method: 'POST' }
    )
    if (res.ok) {
      toast.add({ title: t('common.forceDispatchOk'), color: 'primary', icon: 'i-lucide-check' })
    } else {
      toast.add({
        title: t('common.forceDispatchFailed'),
        description: res.stderr.trim() || `code ${res.code}`,
        color: 'error'
      })
    }
  } catch (e) {
    toast.add({
      title: t('common.forceDispatchFailed'),
      description: (e as Error).message,
      color: 'error'
    })
  } finally {
    dispatching.value = false
  }
}

const scopeLabel = computed(() => {
  if (!scopeMissionId.value) return t('warRoom.scopeAll')
  const found = openMissions.value.find(m => m.id === scopeMissionId.value)
  if (!found) return t('warRoom.scopeMissingFallback')
  const title = found.title?.trim() || t('warRoom.scopeUntitledMission')
  return title.length > 32 ? title.slice(0, 32) + '…' : title
})
</script>

<template>
  <div class="page page--war-room page--locked">
    <PageHeader :title="t('warRoom.title')">
      <template #leadingActions>
        <UButton
          v-if="missionStream.mission.value"
          icon="i-lucide-archive"
          size="sm"
          variant="ghost"
          color="neutral"
          @click="onNewMission"
        >
          {{ t('mission.newMission') }}
        </UButton>
      </template>
      <template #actions>
        <USelectMenu
          :model-value="scopeMissionId ?? SENTINEL_ALL"
          :items="scopeItems"
          value-key="value"
          :search-input="false"
          :ui="{
            base: 'strip-scope-trigger',
            content: 'min-w-[260px]',
            item: 'gap-2'
          }"
          @update:model-value="(v: string) => scopeMissionId = v === SENTINEL_ALL ? null : v"
        >
          <template #default>
            <button
              type="button"
              class="strip-scope"
              :class="{ 'strip-scope--mission': !!scopeMissionId, 'strip-scope--global': !scopeMissionId }"
            >
              <UIcon
                :name="scopeMissionId ? 'i-lucide-target' : 'i-lucide-globe'"
                class="size-3"
              />
              <span class="strip-scope-label">{{ scopeLabel }}</span>
              <UIcon
                name="i-lucide-chevron-down"
                class="size-3 strip-scope-chevron"
              />
            </button>
          </template>
          <template #item="{ item }">
            <span class="scope-row">
              <UIcon
                :name="item.value === SENTINEL_ALL ? 'i-lucide-globe' : 'i-lucide-target'"
                class="size-3 scope-row-icon"
              />
              <span class="scope-row-label">{{ item.label }}</span>
            </span>
          </template>
        </USelectMenu>
        <UButton
          icon="i-lucide-zap"
          variant="ghost"
          color="neutral"
          :loading="dispatching"
          @click="onForceDispatch"
        >
          {{ t('common.forceDispatch') }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          color="neutral"
          :loading="status === 'pending'"
          @click="refresh()"
        >
          {{ t('common.rescan') }}
        </UButton>
      </template>
    </PageHeader>

    <!-- Two equal vertical columns: mission control on the left, the live
         operatives floor on the right. Stacks top/bottom on narrow viewports. -->
    <div class="split">
      <section class="split-mission">
        <MissionPanel
          :orchestrators="activeProfiles"
          :dispatcher-stale="dispatcherStale"
          :tasks="tasks"
          @select-task="(task) => task.assignee && (selectedSlug = task.assignee)"
        />
      </section>

      <section
        ref="floorEl"
        class="split-agents floor"
      >
        <!-- SVG arrows between delegating stations. Inside the agents pane
             so its coordinate space matches what the registry records. -->
        <DelegationOverlay
          :tasks="tasks"
          :profiles="activeProfiles"
        />

        <div class="floor-strip">
          <span class="strip-label">
            <span class="strip-dot" />
            {{ t('warRoom.operationsFloor') }}
          </span>
          <span class="strip-meta">
            {{ t('warRoom.operativesCount', { count: activeProfiles.length }, activeProfiles.length) }}
          </span>
          <ClientOnly>
            <span class="strip-clock">{{ clock }}</span>
            <template #fallback>
              <span class="strip-clock">--:--:-- UTC</span>
            </template>
          </ClientOnly>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          :title="t('warRoom.errorTitle')"
          :description="error.message"
          class="floor-alert"
        />

        <div
          v-if="sortedActiveProfiles.length"
          class="floor-grid"
        >
          <Workstation
            v-for="(p, i) in sortedActiveProfiles"
            :key="p.slug"
            :profile="p"
            :index="i"
            :current-task="taskByAssignee.get(p.slug) ?? null"
            :busy="busySlug === p.slug"
            :last-step="busySlug === p.slug ? lastStep : null"
            :token-usage="tokenUsage[p.slug] ?? null"
            @select="onSelect"
          />
        </div>

        <div
          v-else-if="status === 'success'"
          class="floor-empty"
        >
          <i18n-t keypath="warRoom.empty">
            <template #dir>
              <code class="font-mono">~/.hermes</code>
            </template>
          </i18n-t>
        </div>
      </section>
    </div>

    <WorkstationDetailSlide
      v-model:open="slideOpen"
      :profile="selectedProfile"
      :tasks="tasks"
      :profiles="activeProfiles"
    />
  </div>
</template>

<style scoped>
.page--war-room {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/* Two-column split: mission left, agents right. The vertical divider is the
   right border of the left column; on narrow viewports it collapses to a
   horizontal divider as the panes stack top/bottom. */
.split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* Pin the implicit row to the container height — without this, a grid
     row of `auto` track sizes to its content's min-height, so when the
     mission transcript or the agents floor have a lot of content the row
     grows past the viewport and the inner `overflow-y: auto` boxes never
     get a definite height to scroll inside. `minmax(0, 1fr)` lets the row
     shrink below content too, which is what `min-height: 0` is for the
     children. */
  grid-template-rows: minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
  align-items: stretch;
}

.split-mission {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1.5px solid #1c1a14;
  overflow: hidden;
}
.split-mission > * {
  flex: 1 1 auto;
  min-height: 0;
}

.split-agents {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

@media (max-width: 1024px) {
  .split {
    grid-template-columns: 1fr;
    grid-template-rows: 50vh 50vh;
  }
  .split-mission {
    border-right: 0;
    border-bottom: 1.5px solid #1c1a14;
  }
}

.floor {
  position: relative;
  /* Architectural plan: cream paper + fine grid + stronger accent every 4 cells. */
  background-color: #f4efe2;
  background-image:
    linear-gradient(rgba(28, 26, 20, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(28, 26, 20, 0.06) 1px, transparent 1px),
    linear-gradient(rgba(28, 26, 20, 0.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(28, 26, 20, 0.14) 1px, transparent 1px);
  background-size: 36px 36px, 36px 36px, 144px 144px, 144px 144px;
  background-position: -1px -1px, -1px -1px, -1px -1px, -1px -1px;
  padding: 20px 28px 96px;
  color: #2a261c;
}

.floor-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  padding: 13px 20px;
  margin-bottom: 36px;
  border-top: 1.5px solid #1c1a14;
  border-bottom: 1.5px solid #1c1a14;
  background:
    repeating-linear-gradient(
      135deg,
      rgba(28, 26, 20, 0.025) 0,
      rgba(28, 26, 20, 0.025) 1px,
      transparent 1px,
      transparent 6px
    ),
    rgba(255, 252, 240, 0.85);
  color: #2a261c;
}

.strip-label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #1c1a14;
  font-weight: 600;
}
.strip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c8421f;
  box-shadow:
    0 0 0 2px rgba(255, 252, 240, 0.7),
    0 0 8px rgba(200, 66, 31, 0.85);
  animation: pulse 1.8s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.85); }
}

.strip-meta {
  color: #2a261c;
}

.strip-clock {
  color: #8a4a08;
  font-weight: 600;
  letter-spacing: 0.18em;
}

/* Scope dropdown trigger. Looks like the old pill; click → menu of open
   missions plus the "Todas" sentinel. Amber when scoped to a mission
   (calmly engaged), hot red when global (unfiltered task soup). */
.strip-scope {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
  max-width: 260px;
  background: transparent;
}
.strip-scope-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.strip-scope-chevron {
  margin-left: 2px;
  opacity: 0.6;
}
.strip-scope--mission {
  background: rgba(243, 169, 59, 0.12);
  border: 1px solid rgba(243, 169, 59, 0.55);
  color: #8a5a14;
}
.strip-scope--mission:hover {
  background: rgba(243, 169, 59, 0.22);
}
.strip-scope--global {
  background: rgba(200, 66, 31, 0.1);
  border: 1px solid rgba(200, 66, 31, 0.55);
  color: #c8421f;
}
.strip-scope--global:hover {
  background: rgba(200, 66, 31, 0.22);
}
/* Hide USelectMenu's default chrome (caret etc.) — our custom slot owns the
   visual. The trigger element is a contents-only wrapper so .strip-scope
   stays the visible button. */
:deep(.strip-scope-trigger) {
  background: transparent !important;
  border: 0 !important;
  padding: 0 !important;
  box-shadow: none !important;
}

/* Each row inside the dropdown menu. */
.scope-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.scope-row-icon { flex-shrink: 0; opacity: 0.7; }
.scope-row-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
}

.floor-grid {
  display: grid;
  /* Pack as many 220px stations as fit; collapse empty tracks so the row
     centres tightly instead of leaving holes on the right. */
  grid-template-columns: repeat(auto-fit, 220px);
  justify-content: center;
  gap: 48px 28px;
  justify-items: center;
  padding: 16px 0 24px;
}

.floor-alert {
  margin-bottom: 24px;
}

.floor-empty {
  text-align: center;
  padding: 96px 16px;
  color: #5e5947;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.1em;
}
</style>
