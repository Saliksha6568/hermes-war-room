<script setup lang="ts">
import type { Profile } from '~/types/profile'

interface MissionSummary {
  id: string
  orchestratorSlug: string
  acpSessionId: string | null
  title: string | null
  status: 'open' | 'archived'
  createdAt: string
  lastMessageAt: string
}

interface MissionMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface ListResponse {
  missions: MissionSummary[]
  page: number
  pageSize: number
  totalPages: number
  filteredTotal: number
  hasMore: boolean
  totals: { open: number, archived: number, all: number }
}

interface DetailResponse {
  mission: MissionSummary
  messages: MissionMessage[]
}

const { t } = useI18n()

const filter = ref<'all' | 'open' | 'archived'>('all')
const page = ref(1)
const PAGE_SIZE = 25

// Reset to page 1 whenever the filter switches.
watch(filter, () => { page.value = 1 })

const url = computed(() => {
  const qs = new URLSearchParams({ page: String(page.value), pageSize: String(PAGE_SIZE) })
  if (filter.value !== 'all') qs.set('status', filter.value)
  return `/api/missions?${qs.toString()}`
})

const {
  data: list,
  status: listStatus,
  error: listError,
  refresh: refreshList
} = await useFetch<ListResponse>(url, { watch: [url] })

function goPrev() {
  if (page.value > 1) page.value -= 1
}
function goNext() {
  if (list.value && page.value < list.value.totalPages) page.value += 1
}

const { data: profiles } = await useFetch<Profile[]>('/api/profiles')

const profileBySlug = computed(() => {
  const m = new Map<string, Profile>()
  for (const p of profiles.value ?? []) m.set(p.slug, p)
  return m
})

// Selected mission detail (loaded on demand into a slideover).
const selectedId = ref<string | null>(null)
const slideOpen = computed({
  get: () => selectedId.value !== null,
  set: (v) => { if (!v) selectedId.value = null }
})

const detailUrl = computed(() => selectedId.value ? `/api/missions/${selectedId.value}` : null)
const { data: detail, status: detailStatus } = await useFetch<DetailResponse>(detailUrl, { watch: [selectedId] })

function selectMission(id: string) {
  selectedId.value = id
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  // dd MMM HH:mm — short, local, scannable
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
    + ' · '
    + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function relativeTime(iso: string): string {
  const diffS = (Date.now() - new Date(iso).getTime()) / 1000
  if (diffS < 60) return `${Math.floor(diffS)}s`
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m`
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h`
  return `${Math.floor(diffS / 86400)}d`
}

function callsign(slug: string): string {
  const p = profileBySlug.value.get(slug)
  return (p?.givenName || p?.displayName || slug).toUpperCase()
}

function accent(slug: string): string {
  const p = profileBySlug.value.get(slug)
  return p ? '#' + p.backgroundColor : '#d4d4d4'
}
</script>

<template>
  <div class="page page--missions">
    <PageHeader
      :title="t('warRoom.history.title')"
      :subtitle="t('warRoom.history.subtitle')"
    >
      <template #actions>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          color="neutral"
          :loading="listStatus === 'pending'"
          @click="refreshList()"
        >
          {{ t('common.rescan') }}
        </UButton>
      </template>
    </PageHeader>

    <div class="archive">
      <header class="archive-header">
        <div class="filter">
          <button
            v-for="f in ['all', 'open', 'archived'] as const"
            :key="f"
            type="button"
            class="filter-tab"
            :class="{ 'is-active': filter === f }"
            @click="filter = f"
          >
            {{ t('warRoom.history.' + f) }}
            <span class="filter-count">{{ list?.totals[f] ?? 0 }}</span>
          </button>
        </div>
      </header>

      <UAlert
        v-if="listError"
        color="error"
        variant="subtle"
        :title="t('warRoom.history.loadFailed')"
        :description="listError.message"
        class="archive-alert"
      />

      <ul v-if="list?.missions?.length" class="mission-list">
        <li
          v-for="m in list.missions"
          :key="m.id"
          class="mission"
          :class="{ 'is-archived': m.status === 'archived' }"
          :style="{ '--accent': accent(m.orchestratorSlug) }"
          @click="selectMission(m.id)"
        >
          <span class="mission-stripe" />
          <div class="mission-meta">
            <span class="mission-orch">
              <span class="mission-orch-dot" />
              {{ callsign(m.orchestratorSlug) }}
            </span>
            <UBadge
              :color="m.status === 'open' ? 'primary' : 'neutral'"
              variant="subtle"
              size="xs"
            >
              {{ t('warRoom.history.' + m.status) }}
            </UBadge>
          </div>
          <h3 class="mission-title">
            {{ m.title || '—' }}
          </h3>
          <div class="mission-times">
            <span :title="formatDate(m.createdAt)">
              {{ t('warRoom.history.createdAt', { when: formatDate(m.createdAt) }) }}
            </span>
            <span class="mission-times-sep">·</span>
            <span :title="formatDate(m.lastMessageAt)">
              {{ t('warRoom.history.updatedAt', { when: relativeTime(m.lastMessageAt) }) }}
            </span>
          </div>
        </li>
      </ul>

      <p
        v-else-if="listStatus === 'success'"
        class="archive-empty"
      >
        {{ t('warRoom.history.empty') }}
      </p>

      <nav
        v-if="list && list.totalPages > 1"
        class="pager"
        aria-label="Pagination"
      >
        <button
          type="button"
          class="pager-btn"
          :disabled="page <= 1"
          @click="goPrev"
        >
          <UIcon name="i-lucide-chevron-left" class="pager-glyph" />
          {{ t('warRoom.history.prev') }}
        </button>
        <span class="pager-status">
          {{ t('warRoom.history.page', { current: list.page, total: list.totalPages }) }}
        </span>
        <button
          type="button"
          class="pager-btn"
          :disabled="!list.hasMore"
          @click="goNext"
        >
          {{ t('warRoom.history.next') }}
          <UIcon name="i-lucide-chevron-right" class="pager-glyph" />
        </button>
      </nav>
    </div>

    <USlideover
      :open="slideOpen"
      side="right"
      :ui="{ content: 'max-w-2xl w-full' }"
      @update:open="(v: boolean) => (slideOpen = v)"
    >
      <template #content>
        <div v-if="detail" class="mdetail">
          <header
            class="mdetail-header"
            :style="{ '--accent': accent(detail.mission.orchestratorSlug) }"
          >
            <span class="mdetail-stripe" />
            <div class="mdetail-meta">
              <p class="mdetail-eyebrow">
                {{ callsign(detail.mission.orchestratorSlug) }}
              </p>
              <h2 class="mdetail-title">
                {{ detail.mission.title || '—' }}
              </h2>
              <p class="mdetail-stats">
                {{ formatDate(detail.mission.createdAt) }}
                <span class="mdetail-stats-sep">·</span>
                {{ t('warRoom.history.messageCount', detail.messages.length, { count: detail.messages.length }) }}
              </p>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              @click="selectedId = null"
            />
          </header>

          <ul v-if="detail.messages.length" class="thread">
            <li
              v-for="msg in detail.messages"
              :key="msg.id"
              class="msg"
              :class="`msg--${msg.role}`"
            >
              <div class="msg-head">
                <span class="msg-role">{{ msg.role }}</span>
                <span class="msg-time">{{ formatDate(msg.createdAt) }}</span>
              </div>
              <p class="msg-body">
                {{ msg.content }}
              </p>
            </li>
          </ul>
          <p v-else class="thread-empty">
            {{ t('warRoom.history.empty') }}
          </p>
        </div>
        <div v-else-if="detailStatus === 'pending'" class="mdetail-loading">
          …
        </div>
      </template>
    </USlideover>
  </div>
</template>

<style scoped>
.page--missions {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.archive {
  /* No min-height — the surrounding UDashboardPanel body owns the scroll
     container. Setting one here was double-stretching the layout and
     swallowing the scroll on long lists. */
  position: relative;
  background: #f4efe2;
  background-image:
    linear-gradient(rgba(28, 26, 20, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(28, 26, 20, 0.05) 1px, transparent 1px);
  background-size: 36px 36px;
  background-position: -1px -1px;
  padding: 24px 32px 56px;
  color: #1c1a14;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

.archive-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 14px;
  border-bottom: 1.5px solid #1c1a14;
}
.archive-subtitle {
  font-size: 11.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #4a4536;
}

.filter {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: rgba(28, 26, 20, 0.06);
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 4px;
}
.filter-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #4a4536;
  border-radius: 3px;
  transition: color 0.15s ease, background 0.15s ease;
}
.filter-tab:hover {
  color: #1c1a14;
}
.filter-tab.is-active {
  color: #f4efe2;
  background: #1c1a14;
}
.filter-count {
  display: inline-block;
  padding: 1px 6px;
  background: rgba(255, 252, 240, 0.18);
  color: inherit;
  border-radius: 999px;
  font-size: 9.5px;
  letter-spacing: 0.06em;
}
.filter-tab:not(.is-active) .filter-count {
  background: rgba(28, 26, 20, 0.12);
}

.mission-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.mission {
  --accent: #d4d4d4;
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
  grid-template-areas:
    "stripe meta times"
    "stripe title times";
  align-items: center;
  gap: 4px 18px;
  padding: 14px 18px 14px 24px;
  background: rgba(255, 252, 240, 0.7);
  border: 1px solid rgba(28, 26, 20, 0.14);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}
.mission:hover {
  background: rgba(255, 252, 240, 1);
  transform: translateX(2px);
  border-color: rgba(28, 26, 20, 0.32);
}
.mission.is-archived {
  background: rgba(255, 252, 240, 0.45);
}
.mission-stripe {
  grid-area: stripe;
  width: 4px;
  align-self: stretch;
  background: var(--accent);
  border-radius: 2px;
}
.mission-meta {
  grid-area: meta;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.mission-orch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 11.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #1c1a14;
}
.mission-orch-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}
.mission-title {
  grid-area: title;
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 18px;
  line-height: 1.25;
  color: #1c1a14;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mission-times {
  grid-area: times;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: #6b6555;
  text-transform: uppercase;
  white-space: nowrap;
}
.mission-times-sep {
  opacity: 0.5;
}

.archive-empty,
.thread-empty {
  text-align: center;
  padding: 64px 16px;
  color: #6b6555;
  font-size: 12px;
  letter-spacing: 0.1em;
}
.archive-alert {
  margin-bottom: 18px;
}

/* Pagination — sits below the list, paper-on-tinta style matching the rest. */
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  padding: 12px 16px;
  background: rgba(255, 252, 240, 0.6);
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 4px;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid rgba(28, 26, 20, 0.32);
  border-radius: 3px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #1c1a14;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.pager-btn:hover:not(:disabled) {
  background: #1c1a14;
  color: #f4efe2;
  border-color: #1c1a14;
}
.pager-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.pager-glyph {
  width: 13px;
  height: 13px;
}
.pager-status {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #4a4536;
}

/* === Detail slideover === */
.mdetail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f4efe2;
  color: #1c1a14;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  overflow-y: auto;
}
.mdetail-header {
  --accent: #d4d4d4;
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 16px;
  align-items: center;
  padding: 22px 24px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 24%, #f4efe2) 0%,
      #f4efe2 100%);
  border-bottom: 1.5px solid #1c1a14;
}
.mdetail-stripe {
  width: 4px;
  align-self: stretch;
  background: var(--accent);
  border-radius: 2px;
  min-height: 56px;
}
.mdetail-meta {
  min-width: 0;
}
.mdetail-eyebrow {
  font-size: 9.5px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #4a4536;
  margin-bottom: 4px;
}
.mdetail-title {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 24px;
  line-height: 1.15;
  color: #1c1a14;
}
.mdetail-stats {
  margin-top: 6px;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: #6b6555;
}
.mdetail-stats-sep {
  margin: 0 6px;
  opacity: 0.5;
}
.mdetail-loading {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 14px;
  color: #6b6555;
}

.thread {
  list-style: none;
  padding: 16px 24px 32px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  padding: 10px 14px 12px;
  border: 1px solid rgba(28, 26, 20, 0.12);
  background: rgba(255, 252, 240, 0.7);
  border-radius: 4px;
}
.msg--user {
  background: #1c1a14;
  color: #f4efe2;
  border-color: transparent;
}
.msg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 9px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}
.msg-role {
  font-weight: 600;
  opacity: 0.6;
}
.msg-time {
  font-size: 9.5px;
  letter-spacing: 0.1em;
  opacity: 0.45;
}
.msg-body {
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
