<script setup lang="ts">
import type { Profile } from '~/types/profile'
import type { Mission, MissionMessage, CurrentTask } from '~/types/mission'

interface Props {
  orchestrators: Profile[]
  /** Live kanban tasks polled by the parent (home page). Used to render the
   *  "Board" tab. */
  tasks?: CurrentTask[]
}
const props = withDefaults(defineProps<Props>(), { tasks: () => [] })

const emit = defineEmits<{
  /** Bubble a click on a board card up to the parent so it can open the
   *  operative slideover. */
  selectTask: [task: CurrentTask]
}>()

type Tab = 'chat' | 'board'
const tab = ref<Tab>('chat')

const { t } = useI18n()
const toast = useToast()

const STORAGE_KEY = 'hermes-war-room.lastOrchestratorSlug'

const stream = useMissionStream()
const draft = ref('')
const sending = ref(false)
const dispatcherStale = defineModel<boolean>('dispatcherStale', { default: false })

const orchestratorOptions = computed(() => props.orchestrators.map(p => ({
  label: p.givenName ?? p.displayName,
  value: p.slug
})))

const selectedSlug = ref<string | null>(null)

function chooseInitialSlug() {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  const candidates = props.orchestrators.map(p => p.slug)
  if (stored && candidates.includes(stored)) {
    selectedSlug.value = stored
    return
  }
  if (candidates.includes('lider')) {
    selectedSlug.value = 'lider'
    return
  }
  selectedSlug.value = candidates[0] ?? null
}

watch(() => props.orchestrators.length, () => {
  if (!selectedSlug.value) chooseInitialSlug()
}, { immediate: true })

watch(selectedSlug, (slug) => {
  if (typeof window !== 'undefined' && slug) {
    localStorage.setItem(STORAGE_KEY, slug)
  }
})

const selectedOrchestrator = computed(() =>
  props.orchestrators.find(p => p.slug === selectedSlug.value) ?? null
)

const orchestratorLabel = computed(() => selectedOrchestrator.value?.givenName ?? selectedOrchestrator.value?.displayName ?? '')

async function loadActive() {
  if (!selectedSlug.value) return
  try {
    const res = await $fetch<{ mission: Mission | null, messages: MissionMessage[] }>(
      `/api/missions/active?orchestrator=${encodeURIComponent(selectedSlug.value)}`
    )
    if (res.mission) {
      stream.attach(res.mission, res.messages)
    } else {
      stream.reset()
    }
  } catch (e) {
    console.error('loadActive failed', e)
  }
}

// Fire-and-forget pre-warm for the selected orchestrator's ACP child. Saves
// the ~5-15s Python+MCP cold start on the user's first prompt. We don't await
// nor surface errors — if it fails the regular send path will just hit the
// cold start as before.
const warming = ref(false)
function warmupOrchestrator(slug: string) {
  if (warming.value) return
  warming.value = true
  $fetch(`/api/orchestrators/${encodeURIComponent(slug)}/warmup`, { method: 'POST' })
    .catch((e) => {
      console.warn('orchestrator warmup failed', e)
    })
    .finally(() => {
      warming.value = false
    })
}

watch(selectedSlug, (slug) => {
  loadActive()
  if (slug) warmupOrchestrator(slug)
})
onMounted(() => {
  loadActive()
  if (selectedSlug.value) warmupOrchestrator(selectedSlug.value)
})

async function handleSend() {
  const text = draft.value.trim()
  if (!text || sending.value || !selectedSlug.value) return
  sending.value = true
  try {
    if (stream.mission.value) {
      await stream.send(text)
    } else {
      await stream.start(selectedSlug.value, text)
    }
    draft.value = ''
  } catch (e) {
    toast.add({
      title: t('mission.failure'),
      description: (e as Error).message,
      color: 'error'
    })
  } finally {
    sending.value = false
  }
}

async function handleArchive() {
  await stream.archive()
  toast.add({ title: t('mission.archived'), color: 'primary', icon: 'i-lucide-check' })
}

const transcriptRef = ref<HTMLElement | null>(null)
watch(() => stream.messages.value.length, () => {
  nextTick(() => {
    if (transcriptRef.value) transcriptRef.value.scrollTop = transcriptRef.value.scrollHeight
  })
})
watch(() => stream.messages.value[stream.messages.value.length - 1]?.content, () => {
  nextTick(() => {
    if (transcriptRef.value) transcriptRef.value.scrollTop = transcriptRef.value.scrollHeight
  })
})

const hasMission = computed(() => stream.mission.value !== null)
</script>

<template>
  <section class="mission">
    <header class="mission-header">
      <div class="mission-orch">
        <UAvatar
          v-if="selectedOrchestrator"
          :src="selectedOrchestrator.avatarUrl"
          size="sm"
        />
        <USelect
          :model-value="selectedSlug ?? undefined"
          :items="orchestratorOptions"
          value-key="value"
          variant="ghost"
          size="sm"
          class="mission-orch-select"
          @update:model-value="(v: string) => selectedSlug = v"
        >
          <template #leading>
            <UIcon
              name="i-lucide-radio"
              class="size-3.5"
            />
          </template>
        </USelect>
      </div>
      <div class="mission-title">
        <UIcon
          name="i-lucide-target"
          class="mission-title-glyph"
        />
        {{ t('mission.title') }}
      </div>
      <div class="mission-actions">
        <UButton
          v-if="hasMission"
          icon="i-lucide-archive"
          size="xs"
          variant="ghost"
          color="neutral"
          @click="handleArchive"
        >
          {{ t('mission.newMission') }}
        </UButton>
      </div>
    </header>

    <div
      v-if="dispatcherStale"
      class="mission-warn"
    >
      <UIcon
        name="i-lucide-triangle-alert"
        class="size-3.5"
      />
      {{ t('mission.dispatcherWarning') }}
    </div>

    <!-- Tab strip — switches the body between the chat transcript and the
         live kanban board. The composer at the bottom stays mounted in
         both views so the user can keep talking to the orchestrator while
         watching the board. -->
    <div class="mission-tabs">
      <button
        type="button"
        class="mission-tab"
        :class="{ 'is-active': tab === 'chat' }"
        @click="tab = 'chat'"
      >
        <UIcon name="i-lucide-message-square" class="mission-tab-glyph" />
        {{ t('mission.tabs.chat') }}
      </button>
      <button
        type="button"
        class="mission-tab"
        :class="{ 'is-active': tab === 'board' }"
        @click="tab = 'board'"
      >
        <UIcon name="i-lucide-kanban-square" class="mission-tab-glyph" />
        {{ t('mission.tabs.board') }}
        <span
          v-if="tasks.length"
          class="mission-tab-count"
        >{{ tasks.length }}</span>
      </button>
    </div>

    <MissionKanban
      v-if="tab === 'board'"
      class="mission-board"
      :tasks="tasks"
      :profiles="orchestrators"
      @select="(task) => emit('selectTask', task)"
    />

    <div
      v-if="tab === 'chat' && hasMission"
      ref="transcriptRef"
      class="mission-transcript"
    >
      <div
        v-for="m in stream.messages.value"
        :key="m.id"
        class="mission-msg"
        :class="`mission-msg-${m.role}`"
      >
        <div class="mission-bubble">
          <span
            v-if="m.pending && m.content === ''"
            class="mission-thinking"
          >
            <span class="mission-dot" />
            <span class="mission-dot" />
            <span class="mission-dot" />
          </span>
          <template v-else-if="m.role === 'assistant'">
            <!-- eslint-disable vue/no-v-html -->
            <div
              class="mission-md"
              v-html="renderMarkdown(m.content)"
            />
            <!-- eslint-enable vue/no-v-html -->
            <span
              v-if="m.pending"
              class="mission-caret"
            >▍</span>
          </template>
          <template v-else>
            {{ m.content }}<span
              v-if="m.pending"
              class="mission-caret"
            >▍</span>
          </template>
        </div>
      </div>
      <div
        v-if="stream.error.value"
        class="mission-error"
      >
        <UIcon
          name="i-lucide-circle-alert"
          class="size-3.5"
        />
        {{ stream.error.value }}
      </div>
    </div>

    <form
      class="mission-input"
      @submit.prevent="handleSend"
    >
      <p
        v-if="stream.streaming.value"
        class="mission-input-status"
      >
        <span class="mission-input-status-dot" />
        {{ t('mission.thinking', { orch: orchestratorLabel }) }}
      </p>
      <div class="mission-composer">
        <UTextarea
          v-model="draft"
          :placeholder="hasMission
            ? t('mission.input.followUp')
            : t('mission.empty.placeholder', { orch: orchestratorLabel })"
          :rows="2"
          autoresize
          :disabled="sending || !selectedSlug"
          class="mission-textarea"
          @keydown.enter.exact.prevent="handleSend"
        />
        <UButton
          type="submit"
          icon="i-lucide-send-horizontal"
          color="primary"
          size="sm"
          class="mission-send"
          :loading="sending || stream.streaming.value"
          :disabled="!draft.trim() || !selectedSlug"
          :aria-label="t('mission.send')"
        />
      </div>
    </form>
  </section>
</template>

<style scoped>
.mission {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(255, 252, 240, 0.85);
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 4px;
  padding: 14px 18px 16px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  color: #2a261c;
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.6) inset, 0 6px 14px -10px rgba(28, 26, 20, 0.35);
  min-height: 0;
}

.mission-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px dashed rgba(28, 26, 20, 0.2);
  margin-bottom: 12px;
}

.mission-orch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.mission-orch-select {
  min-width: 0;
}

.mission-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: #1c1a14;
  white-space: nowrap;
}
.mission-title-glyph {
  width: 14px;
  height: 14px;
  color: #c8421f;
}

.mission-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.mission-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: rgba(243, 169, 59, 0.18);
  border: 1px solid rgba(243, 169, 59, 0.45);
  border-radius: 3px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #6b4a13;
}

/* Tab strip — Chat | Board switcher */
.mission-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  margin-bottom: 12px;
  background: rgba(28, 26, 20, 0.06);
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 4px;
  align-self: flex-start;
}
.mission-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  background: transparent;
  border: 0;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #4a4536;
  border-radius: 3px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}
.mission-tab:hover {
  color: #1c1a14;
}
.mission-tab.is-active {
  color: #f4efe2;
  background: #1c1a14;
}
.mission-tab-glyph {
  width: 12px;
  height: 12px;
}
.mission-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 1px 5px;
  background: #c8421f;
  color: #f4efe2;
  border-radius: 999px;
  font-size: 9px;
  letter-spacing: 0.04em;
}
.mission-tab.is-active .mission-tab-count {
  background: rgba(255, 252, 240, 0.22);
}

.mission-board {
  flex: 1 1 auto;
  min-height: 0;
  margin-bottom: 10px;
}

.mission-transcript {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 12px;
  margin-bottom: 10px;
  scroll-behavior: smooth;
}

.mission-msg {
  display: flex;
}
.mission-msg-user {
  justify-content: flex-end;
}
.mission-msg-assistant {
  justify-content: flex-start;
}
.mission-bubble {
  max-width: 76%;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.mission-msg-user .mission-bubble {
  background: #1c1a14;
  color: #f4efe2;
  border-bottom-right-radius: 1px;
}
.mission-msg-assistant .mission-bubble {
  background: rgba(28, 26, 20, 0.06);
  color: #1c1a14;
  border: 1px solid rgba(28, 26, 20, 0.12);
  border-bottom-left-radius: 1px;
}

/* Markdown rendering inside assistant bubbles. Scoped attr is added by Vue,
   but :deep() lets us style children produced by v-html. */
.mission-md :deep(p) { margin: 0 0 8px; }
.mission-md :deep(p:last-child) { margin-bottom: 0; }
.mission-md :deep(ul),
.mission-md :deep(ol) { margin: 0 0 8px; padding-left: 22px; }
.mission-md :deep(li) { margin: 2px 0; }
.mission-md :deep(strong) { font-weight: 600; }
.mission-md :deep(em) { font-style: italic; }
.mission-md :deep(a) {
  color: #c8421f;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mission-md :deep(h1),
.mission-md :deep(h2),
.mission-md :deep(h3),
.mission-md :deep(h4) {
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  margin: 10px 0 6px;
  letter-spacing: 0.04em;
}
.mission-md :deep(h1) { font-size: 16px; }
.mission-md :deep(h2) { font-size: 14px; }
.mission-md :deep(h3) { font-size: 13px; }
.mission-md :deep(h4) { font-size: 12px; }
.mission-md :deep(code) {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  background: rgba(28, 26, 20, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
}
.mission-md :deep(pre) {
  background: #1c1a14;
  color: #f4efe2;
  padding: 10px 12px;
  border-radius: 4px;
  margin: 6px 0 10px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}
.mission-md :deep(pre code) {
  background: transparent;
  color: inherit;
  padding: 0;
}
.mission-md :deep(blockquote) {
  border-left: 3px solid rgba(28, 26, 20, 0.25);
  padding-left: 10px;
  margin: 6px 0;
  color: rgba(28, 26, 20, 0.7);
  font-style: italic;
}
.mission-md :deep(table) {
  border-collapse: collapse;
  margin: 6px 0 10px;
  font-size: 12px;
}
.mission-md :deep(th),
.mission-md :deep(td) {
  border: 1px solid rgba(28, 26, 20, 0.2);
  padding: 4px 8px;
  text-align: left;
}
.mission-md :deep(th) {
  background: rgba(28, 26, 20, 0.08);
  font-weight: 600;
}
.mission-md :deep(hr) {
  border: none;
  border-top: 1px dashed rgba(28, 26, 20, 0.25);
  margin: 10px 0;
}

.mission-thinking {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.mission-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(28, 26, 20, 0.4);
  animation: mission-dot 1.2s ease-in-out infinite;
}
.mission-dot:nth-child(2) { animation-delay: 0.2s; }
.mission-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes mission-dot {
  0%, 100% { opacity: 0.25; transform: translateY(0); }
  50%      { opacity: 1;    transform: translateY(-2px); }
}

.mission-caret {
  display: inline-block;
  margin-left: 1px;
  font-weight: 700;
  color: #c8421f;
  animation: caret 1s steps(2) infinite;
}
@keyframes caret {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.mission-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(200, 66, 31, 0.12);
  border: 1px solid rgba(200, 66, 31, 0.35);
  border-radius: 3px;
  font-size: 11px;
  color: #c8421f;
  align-self: flex-start;
}

/* Input zone — always pinned to the bottom of the panel column thanks to
   `margin-top: auto`. Even when the transcript is short the composer stays
   anchored at the floor so the user always knows where to type. */
.mission-input {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mission-input-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 4px;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #1c1a14;
}
.mission-input-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #c8421f;
  box-shadow: 0 0 6px rgba(200, 66, 31, 0.7);
  animation: caret 1.4s ease-in-out infinite;
}

/* Composer — textarea + send button stacked in the same box. The button
   sits absolute at the bottom-right corner so the icon hugs the input
   even as it grows with autoresize. */
.mission-composer {
  position: relative;
  width: 100%;
}
.mission-textarea {
  width: 100%;
}
/* Reserve space inside the textarea so the user's caret never collides
   with the absolute-positioned send button. */
.mission-textarea :deep(textarea) {
  padding-right: 52px;
  resize: none;
}
.mission-send {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  border-radius: 3px;
  padding: 6px;
  min-width: 32px;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
