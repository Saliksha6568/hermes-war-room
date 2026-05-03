<script setup lang="ts">
import type { Profile } from '~/types/profile'

const props = defineProps<{
  profile: Profile
  editable?: boolean
}>()

const emit = defineEmits<{
  update: [profile: Profile]
  retrain: [profile: Profile]
}>()

const { t } = useI18n()
const toast = useToast()

const editing = ref(false)
const draft = ref(props.profile.givenName ?? '')
const saving = ref(false)
const rerolling = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

watch(() => props.profile.givenName, (v) => {
  if (!editing.value) draft.value = v ?? ''
})

async function startEdit() {
  if (!props.editable) return
  draft.value = props.profile.givenName ?? ''
  editing.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function cancelEdit() {
  editing.value = false
  draft.value = props.profile.givenName ?? ''
}

async function patch(body: { givenName?: string | null, rerollAvatar?: boolean, active?: boolean }): Promise<void> {
  const updated = await $fetch<Profile>(`/api/profiles/${props.profile.slug}`, {
    method: 'PATCH',
    body
  })
  emit('update', updated)
}

async function saveName() {
  if (!editing.value) return
  const trimmed = draft.value.trim()
  const current = props.profile.givenName ?? ''
  if (trimmed === current) {
    editing.value = false
    return
  }
  saving.value = true
  try {
    await patch({ givenName: trimmed })
    editing.value = false
    toast.add({ title: t('badge.callsignAssigned'), color: 'primary', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({ title: t('badge.saveFailed'), color: 'error', description: (e as Error).message })
  } finally {
    saving.value = false
  }
}

async function rerollAvatar() {
  rerolling.value = true
  try {
    await patch({ rerollAvatar: true })
  } catch (e) {
    toast.add({ title: t('badge.rerollFailed'), color: 'error', description: (e as Error).message })
  } finally {
    rerolling.value = false
  }
}

const togglingActive = ref(false)
async function toggleActive(next: boolean) {
  togglingActive.value = true
  try {
    await patch({ active: next })
    toast.add({ title: t('badge.activeUpdated'), color: 'primary', icon: 'i-lucide-check' })
  } catch (e) {
    toast.add({ title: t('badge.activeFailed'), color: 'error', description: (e as Error).message })
  } finally {
    togglingActive.value = false
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const issued = computed(() => {
  const d = new Date(props.profile.firstSeen)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
})

const issuedLabel = computed(() => t('badge.issued', { date: issued.value }))

const serial = computed(() => {
  const hex = (hash(props.profile.slug).toString(16).toUpperCase() + '0000').slice(0, 4)
  return `SR-${hex}`
})

const bars = computed(() => {
  let h = hash(props.profile.slug)
  const out: number[] = []
  for (let i = 0; i < 38; i++) {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0
    out.push((h % 3) + 1)
  }
  return out
})

const statusLabel = computed(() => {
  const key = `badge.gesture.${props.profile.gesture}`
  return t(key, props.profile.gesture)
})
</script>

<template>
  <article
    class="badge"
    :class="{ inactive: !profile.active }"
  >
    <div class="lanyard">
      <span class="lanyard-caption">{{ t('badge.operativeFile') }}</span>
      <span class="hole" />
    </div>

    <header
      class="band"
      :style="{ '--accent': '#' + profile.backgroundColor }"
    >
      <span class="band-title">
        <UIcon
          name="i-lucide-radio-tower"
          class="band-glyph"
        />
        Hermes
      </span>
      <span class="band-serial">№ {{ serial }}</span>
    </header>

    <div
      class="portrait"
      :style="{ backgroundColor: '#' + profile.backgroundColor }"
    >
      <span class="cmark cmark-tl" />
      <span class="cmark cmark-tr" />
      <span class="cmark cmark-bl" />
      <span class="cmark cmark-br" />
      <img
        :src="profile.avatarUrl"
        :alt="`${profile.givenName ?? profile.displayName} portrait`"
        loading="lazy"
      >
      <span
        v-if="profile.isDefault"
        class="stamp"
      >{{ t('badge.primary') }}</span>
      <span
        v-if="!profile.active"
        class="stamp stamp-off"
      >{{ t('badge.inactive') }}</span>
    </div>

    <div class="fields">
      <div class="field">
        <label>{{ t('badge.callsign') }}</label>
        <div
          v-if="editable && editing"
          class="callsign-edit"
        >
          <input
            ref="inputRef"
            v-model="draft"
            type="text"
            maxlength="32"
            spellcheck="false"
            :disabled="saving"
            :placeholder="t('badge.assignCallsign')"
            @keyup.enter="saveName"
            @keyup.escape="cancelEdit"
            @blur="saveName"
          >
        </div>
        <div
          v-else
          class="callsign-display"
          :class="{ unset: !profile.givenName, clickable: editable }"
          @click="startEdit"
        >
          <span class="callsign-text">
            {{ profile.givenName ?? t('badge.unnamed') }}
          </span>
          <UIcon
            v-if="editable"
            name="i-lucide-pencil"
            class="edit-glyph"
          />
        </div>
      </div>

      <div class="field-row">
        <div class="field">
          <label>{{ t('badge.profileId') }}</label>
          <span class="value-mono">{{ profile.displayName }}</span>
        </div>
        <div class="field">
          <label>{{ t('badge.status') }}</label>
          <span class="value-mono status">
            <span class="status-dot" />{{ statusLabel }}
          </span>
        </div>
      </div>

      <div
        v-if="editable"
        class="active-row"
      >
        <span class="active-label">{{ profile.active ? t('badge.active') : t('badge.inactive') }}</span>
        <USwitch
          :model-value="profile.active"
          :disabled="togglingActive"
          :aria-label="profile.active ? t('badge.deactivate') : t('badge.activate')"
          @update:model-value="(v: boolean) => toggleActive(v)"
        />
      </div>
    </div>

    <footer class="foot">
      <div
        class="barcode"
        :aria-label="`barcode ${serial}`"
      >
        <span
          v-for="(w, i) in bars"
          :key="i"
          :style="{ width: w + 'px' }"
        />
      </div>
      <div class="foot-row">
        <span class="issued">{{ issuedLabel }}</span>
        <div
          v-if="editable"
          class="foot-actions"
        >
          <button
            type="button"
            class="action"
            @click="emit('retrain', profile)"
          >
            <UIcon
              name="i-lucide-graduation-cap"
              class="action-glyph"
            />
            {{ t('retrain.action') }}
          </button>
          <button
            type="button"
            class="action"
            :disabled="rerolling"
            @click="rerollAvatar"
          >
            <UIcon
              name="i-lucide-shuffle"
              class="action-glyph"
            />
            {{ rerolling ? t('badge.rolling') : t('badge.reroll') }}
          </button>
        </div>
      </div>
    </footer>
  </article>
</template>

<style scoped>
.badge {
  --paper: #f4eedf;
  --paper-edge: #e3dac1;
  --ink: #1c1a14;
  --ink-soft: #57513f;
  --ink-faint: #8a8367;
  --hot: #c8421f;

  position: relative;
  background: var(--paper);
  color: var(--ink);
  border: 1px solid var(--paper-edge);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.55),
    0 1px 2px rgba(20, 16, 8, 0.06),
    0 14px 28px -16px rgba(20, 16, 8, 0.32);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}

.badge::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.07 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  mix-blend-mode: multiply;
  opacity: 0.6;
}

.lanyard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 0 7px;
  background: var(--paper);
  border-bottom: 1px dashed rgba(28, 26, 20, 0.18);
}
.lanyard-caption {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 8.5px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--ink-faint);
  padding-left: 0.34em;
}
.hole {
  width: 40px;
  height: 7px;
  border-radius: 999px;
  background: rgba(28, 26, 20, 0.18);
  box-shadow:
    inset 0 1px 1.5px rgba(0, 0, 0, 0.4),
    0 1px 0 rgba(255, 255, 255, 0.55);
}

.band {
  --accent: #ddd;
  position: relative;
  background: var(--ink);
  color: var(--paper);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px 9px 18px;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  letter-spacing: 0.18em;
  font-size: 12px;
  text-transform: uppercase;
}
.band::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 8px;
  background: var(--accent);
}
.band-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.band-glyph {
  width: 14px;
  height: 14px;
  color: var(--accent);
}
.dot {
  opacity: 0.55;
}
.band-serial {
  font-family: 'IBM Plex Mono', monospace;
  font-weight: 500;
  letter-spacing: 0.09em;
  font-size: 10.5px;
  opacity: 0.85;
  white-space: nowrap;
  flex-shrink: 0;
  padding-left: 8px;
}

.portrait {
  position: relative;
  aspect-ratio: 1 / 1;
  width: 100%;
  overflow: hidden;
  border-bottom: 1px solid var(--paper-edge);
}
.portrait > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cmark {
  position: absolute;
  width: 12px;
  height: 12px;
  border-color: rgba(28, 26, 20, 0.42);
  border-style: solid;
  z-index: 2;
}
.cmark-tl { top: 7px; left: 7px; border-width: 1px 0 0 1px; }
.cmark-tr { top: 7px; right: 7px; border-width: 1px 1px 0 0; }
.cmark-bl { bottom: 7px; left: 7px; border-width: 0 0 1px 1px; }
.cmark-br { bottom: 7px; right: 7px; border-width: 0 1px 1px 0; }

.stamp {
  position: absolute;
  top: 18px;
  right: -32px;
  transform: rotate(13deg);
  background: var(--hot);
  color: var(--paper);
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  letter-spacing: 0.22em;
  font-size: 10.5px;
  padding: 3px 40px;
  text-transform: uppercase;
  box-shadow: 0 0 0 2px rgba(244, 238, 223, 0.3) inset, 0 4px 10px -2px rgba(200, 66, 31, 0.45);
  z-index: 3;
}
.stamp-off {
  top: 56px;
  background: #4a4636;
  box-shadow: 0 0 0 2px rgba(244, 238, 223, 0.3) inset, 0 4px 10px -2px rgba(74, 70, 54, 0.55);
}

.badge.inactive {
  filter: grayscale(0.7);
  opacity: 0.7;
}
.badge.inactive .portrait {
  opacity: 0.55;
}

.active-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
  border-top: 1px dashed rgba(28, 26, 20, 0.18);
}
.active-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.fields {
  padding: 14px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
  z-index: 1;
}
.field label {
  display: block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9.5px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-bottom: 3px;
}
.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: end;
}

.callsign-display {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 28px;
  line-height: 1.05;
  color: var(--ink);
  min-height: 32px;
}
.callsign-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.callsign-display.unset .callsign-text {
  color: var(--ink-faint);
  font-size: 18px;
}
.callsign-display.clickable {
  cursor: text;
}
.edit-glyph {
  width: 14px;
  height: 14px;
  color: var(--ink-faint);
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}
.callsign-display.clickable:hover .edit-glyph {
  opacity: 1;
}
.callsign-edit input {
  width: 100%;
  background: transparent;
  border: 0;
  border-bottom: 1.5px solid var(--ink);
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 28px;
  line-height: 1.05;
  color: var(--ink);
  padding: 2px 0;
  outline: none;
  caret-color: var(--hot);
}
.callsign-edit input::placeholder {
  color: var(--ink-faint);
  font-size: 18px;
}
.callsign-edit input:disabled {
  opacity: 0.55;
}

.value-mono {
  display: inline-block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--ink);
  word-break: break-all;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--hot);
  box-shadow: 0 0 0 2px rgba(200, 66, 31, 0.18);
}

.foot {
  margin-top: auto;
  padding: 12px 16px 14px;
  border-top: 1px dashed rgba(28, 26, 20, 0.18);
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: relative;
  z-index: 1;
}
.barcode {
  display: flex;
  align-items: stretch;
  gap: 1px;
  height: 28px;
}
.barcode span {
  display: block;
  height: 100%;
  background: var(--ink);
}
.barcode span:nth-child(2n) {
  background: transparent;
}
.foot-row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
  text-transform: uppercase;
}
.issued {
  align-self: flex-start;
}
.foot-actions {
  display: flex;
  align-items: stretch;
  gap: 6px;
  width: 100%;
}
.action {
  flex: 1 1 0;
  min-width: 0;
  background: transparent;
  border: 1px solid rgba(28, 26, 20, 0.32);
  color: var(--ink);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 6px 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.action:hover:not(:disabled) {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.action:disabled {
  opacity: 0.55;
  cursor: progress;
}
.action-glyph {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}
</style>
