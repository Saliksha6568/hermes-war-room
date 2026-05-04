<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <header class="page-head">
    <div class="page-head-left">
      <div class="page-head-text">
        <h1 class="page-head-title">
          {{ title }}
        </h1>
        <p
          v-if="subtitle"
          class="page-head-subtitle"
        >
          {{ subtitle }}
        </p>
      </div>
      <div
        v-if="$slots.leadingActions"
        class="page-head-actions page-head-actions--leading"
      >
        <slot name="leadingActions" />
      </div>
    </div>
    <div class="page-head-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px;
  background: rgba(255, 252, 240, 0.6);
  border-bottom: 1px solid rgba(28, 26, 20, 0.18);
  /* Same engineered tick rule the topbar uses, mirrored on top so the page
     header reads as a continuation of the console aesthetic. */
  position: relative;
}

.page-head-left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.page-head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.page-head-title {
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #1c1a14;
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-head-subtitle {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: #6b6555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
