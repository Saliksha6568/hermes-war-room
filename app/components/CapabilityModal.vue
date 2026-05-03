<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  subtitle?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
</script>

<template>
  <UModal
    :open="open"
    :ui="{
      content: 'max-w-2xl',
      overlay: 'bg-[#1c1a14]/40 backdrop-blur-sm'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <div class="cap-modal">
        <header class="cap-modal-head">
          <div class="cap-modal-stencil">Capability</div>
          <h3 class="cap-modal-title">
            {{ title }}
          </h3>
          <p
            v-if="subtitle"
            class="cap-modal-subtitle"
          >
            {{ subtitle }}
          </p>
          <button
            type="button"
            class="cap-modal-close"
            :aria-label="t('common.cancel')"
            @click="emit('update:open', false)"
          >
            <UIcon
              name="i-lucide-x"
              class="size-4"
            />
          </button>
        </header>
        <div class="cap-modal-body">
          <slot />
        </div>
        <footer class="cap-modal-foot">
          <button
            type="button"
            class="cap-modal-done"
            @click="emit('update:open', false)"
          >
            <UIcon
              name="i-lucide-check"
              class="size-3.5"
            />
            <span>{{ t('common.done') }}</span>
          </button>
        </footer>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.cap-modal {
  --paper: #f4efe2;
  --paper-edge: #d8d0b8;
  --ink: #1c1a14;
  --ink-soft: #4a4536;
  --ink-faint: #6b6555;
  --amber: #f3a93b;

  position: relative;
  background: var(--paper);
  color: var(--ink);
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 6rem);
  box-shadow:
    0 0 0 1px var(--paper-edge),
    0 24px 60px -24px rgba(28, 26, 20, 0.55);
}
.cap-modal-head {
  position: relative;
  padding: 18px 22px 16px;
  background: var(--ink);
  color: var(--paper);
  border-bottom: 4px solid var(--amber);
  flex-shrink: 0;
}
.cap-modal-stencil {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--amber);
  margin-bottom: 4px;
}
.cap-modal-title {
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  line-height: 1;
  margin: 0;
}
.cap-modal-subtitle {
  font-family: 'Instrument Serif', serif;
  font-style: italic;
  font-size: 13px;
  color: rgba(244, 239, 226, 0.78);
  margin: 6px 0 0;
}
.cap-modal-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(244, 239, 226, 0.22);
  color: var(--paper);
  border-radius: 3px;
  cursor: pointer;
}
.cap-modal-close:hover {
  background: rgba(244, 239, 226, 0.08);
}
.cap-modal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 22px;
}
.cap-modal-foot {
  display: flex;
  justify-content: flex-end;
  padding: 12px 22px 14px;
  background: rgba(28, 26, 20, 0.04);
  border-top: 1px solid rgba(28, 26, 20, 0.18);
  flex-shrink: 0;
}
.cap-modal-done {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  background: var(--ink);
  color: var(--paper);
  border: 2px solid var(--ink);
  border-radius: 2px;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.1s ease;
}
.cap-modal-done:hover {
  transform: translateY(-1px);
}

/* Drop the inner scroll on Tools/Skills since the modal body owns scrolling. */
.cap-modal-body :deep(.max-h-80),
.cap-modal-body :deep(.max-h-96) {
  max-height: none;
}
</style>
