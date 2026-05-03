<script setup lang="ts">
const props = defineProps<{
  /** Section title — e.g. "Tools", "Skills", "MCP servers". */
  label: string
  /** Optional iconify name for the leading glyph. */
  icon?: string
  /** Items to summarize as chips. Pass display names; mono if `mono`. */
  items: string[]
  /** Total count for "X of Y enabled" summaries. Omit for plain "N items". */
  total?: number
  /** Render chip text in monospace. */
  mono?: boolean
  /** Empty-state message when items is empty. */
  emptyText?: string
  /** Manage-button label. */
  manageLabel?: string
  /** Disable the manage button (e.g. while loading). */
  disabled?: boolean
  /** Hide the Manage button entirely — for read-only/placeholder cards
   *  (e.g. MCPs in the Hire flow, where you can't manage them yet). */
  noManage?: boolean
}>()

const emit = defineEmits<{
  manage: []
}>()

const MAX_VISIBLE = 6
const visible = computed(() => props.items.slice(0, MAX_VISIBLE))
const overflow = computed(() => Math.max(0, props.items.length - MAX_VISIBLE))
const summary = computed(() => {
  if (typeof props.total === 'number') return `${props.items.length}/${props.total}`
  return String(props.items.length)
})
</script>

<template>
  <div class="cap-card">
    <div class="cap-card-head">
      <div class="cap-card-label">
        <UIcon
          v-if="icon"
          :name="icon"
          class="size-3.5"
        />
        <span>{{ label }}</span>
        <span class="cap-card-count">{{ summary }}</span>
      </div>
      <button
        v-if="!noManage"
        type="button"
        class="cap-card-manage"
        :disabled="disabled"
        @click="emit('manage')"
      >
        <UIcon
          name="i-lucide-sliders-horizontal"
          class="size-3"
        />
        <span>{{ manageLabel ?? 'Manage' }}</span>
      </button>
    </div>

    <div
      v-if="!items.length"
      class="cap-card-empty"
    >
      {{ emptyText ?? '—' }}
    </div>
    <div
      v-else
      class="cap-card-chips"
    >
      <span
        v-for="item in visible"
        :key="item"
        class="cap-chip"
        :class="{ 'cap-chip--mono': mono }"
      >
        {{ item }}
      </span>
      <span
        v-if="overflow > 0"
        class="cap-chip cap-chip--more"
      >+{{ overflow }}</span>
    </div>
  </div>
</template>

<style scoped>
.cap-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  background: rgba(255, 252, 240, 0.55);
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 3px;
}
.cap-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cap-card-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-soft, #4a4536);
  flex: 1 1 auto;
  min-width: 0;
}
.cap-card-count {
  font-weight: 600;
  color: var(--ink, #1c1a14);
  letter-spacing: 0.1em;
}
.cap-card-manage {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  background: transparent;
  border: 1px solid rgba(28, 26, 20, 0.28);
  border-radius: 2px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink, #1c1a14);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
  flex-shrink: 0;
}
.cap-card-manage:hover:not(:disabled) {
  background: var(--ink, #1c1a14);
  border-color: var(--ink, #1c1a14);
  color: var(--paper, #f4efe2);
}
.cap-card-manage:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cap-card-empty {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 12px;
  color: var(--ink-faint, #6b6555);
}

.cap-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.cap-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  background: rgba(28, 26, 20, 0.06);
  border: 1px solid rgba(28, 26, 20, 0.14);
  border-radius: 2px;
  font-size: 11px;
  color: var(--ink, #1c1a14);
  line-height: 1.5;
}
.cap-chip--mono {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.02em;
}
.cap-chip--more {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  background: transparent;
  border-color: rgba(28, 26, 20, 0.22);
  color: var(--ink-faint, #6b6555);
}
</style>
