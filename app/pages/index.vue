<script setup lang="ts">
import type { Profile } from '~/types/profile'

const { t } = useI18n()
const { data: profiles, status, error, refresh } = await useFetch<Profile[]>('/api/profiles')

// Home is the live operations floor — only active operatives are on duty here.
const activeProfiles = computed(() => (profiles.value ?? []).filter(p => p.active))

/* Mission stream — singleton; MissionPanel is the writer. We read the active
   mission's id so the kanban poll can scope the floor to its tasks. */
const missionStream = useMissionStream()

/* When this is true (default), the floor only shows tasks tied to the active
   mission via `mission_watched_tasks`. Toggle off to see every task across
   every mission (the global view). Persisted to localStorage so the choice
   sticks across reloads. */
const scopeToMission = useState<boolean>('warroom.scopeToMission', () => {
  if (import.meta.client) {
    const v = localStorage.getItem('warroom.scopeToMission')
    if (v !== null) return v === '1'
  }
  return true
})
watch(scopeToMission, (v) => {
  if (import.meta.client) localStorage.setItem('warroom.scopeToMission', v ? '1' : '0')
})

const activeMissionId = computed(() =>
  scopeToMission.value ? (missionStream.mission.value?.id ?? null) : null
)

const { tasks, taskByAssignee, dispatcherStale } = useKanbanTasks(activeMissionId)

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
</script>

<template>
  <div class="page page--war-room">
    <PageHeader :title="t('warRoom.title')">
      <template #actions>
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
          <button
            v-if="missionStream.mission.value"
            type="button"
            class="strip-scope"
            :class="{ 'strip-scope--mission': scopeToMission, 'strip-scope--global': !scopeToMission }"
            :title="scopeToMission ? t('warRoom.scopeToggle') : t('warRoom.scopeToggleMission')"
            @click="scopeToMission = !scopeToMission"
          >
            <UIcon
              :name="scopeToMission ? 'i-lucide-target' : 'i-lucide-globe'"
              class="size-3"
            />
            {{ scopeToMission ? t('warRoom.missionScope') : t('warRoom.globalScope') }}
          </button>
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
          v-if="activeProfiles.length"
          class="floor-grid"
        >
          <Workstation
            v-for="(p, i) in activeProfiles"
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

/* Scope toggle. Mission-scoped is the default and reads "calmly engaged"
   (amber); global is loud (hot red) so the user always knows when they're
   looking at unfiltered task soup. */
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

.floor-grid {
  display: grid;
  /* Always two stations per row, each capped at the natural station size
     (~220px) so they don't balloon to fill the half-pane width. */
  grid-template-columns: repeat(2, minmax(0, 220px));
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
