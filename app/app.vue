<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const { t, locale, locales, setLocale } = useI18n()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: locale
  }
})

useSeoMeta({
  title: () => t('app.title'),
  description: () => t('app.description'),
  ogTitle: () => t('app.title'),
  ogDescription: () => t('app.description'),
  twitterCard: 'summary_large_image'
})

interface TopTab {
  to: string
  icon: string
  label: string
}

const tabs = computed<TopTab[]>(() => [
  { to: '/',         icon: 'i-lucide-radar',        label: t('nav.warRoom') },
  { to: '/team',     icon: 'i-lucide-users-round',  label: t('nav.team') },
  { to: '/missions', icon: 'i-lucide-folder-clock', label: t('nav.missions') }
])

const localeOptions = computed(() =>
  (locales.value as { code: string, name: string }[]).map(l => ({
    label: l.name,
    value: l.code
  }))
)

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path === to || route.path.startsWith(to + '/')
}
</script>

<template>
  <UApp>
    <div class="hwr-shell">
      <header class="hwr-topbar">
        <NuxtLink to="/" class="hwr-brand">
          <span class="hwr-brand-mark">
            <UIcon name="i-lucide-radio-tower" class="size-4" />
            <span class="hwr-brand-pulse" />
          </span>
          <span class="hwr-brand-name">
            <span class="hwr-brand-eyebrow">Hermes</span>
            <span class="hwr-brand-title">Orchestration War Room</span>
          </span>
        </NuxtLink>

        <nav class="hwr-tabs" aria-label="Primary">
          <NuxtLink
            v-for="tab in tabs"
            :key="tab.to"
            :to="tab.to"
            class="hwr-tab"
            :class="{ 'is-active': isActive(tab.to) }"
          >
            <UIcon :name="tab.icon" class="hwr-tab-icon" />
            <span>{{ tab.label }}</span>
          </NuxtLink>
        </nav>

        <div class="hwr-actions">
          <UColorModeButton class="hwr-mode" />
          <USelect
            :model-value="locale"
            :items="localeOptions"
            size="sm"
            variant="ghost"
            icon="i-lucide-languages"
            :aria-label="t('common.language')"
            class="hwr-lang"
            @update:model-value="(v: string) => setLocale(v as 'en' | 'es')"
          />
        </div>
      </header>

      <main class="hwr-main">
        <NuxtPage />
      </main>
    </div>
  </UApp>
</template>

<style>
.hwr-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: #f4efe2;
  color: #1c1a14;
}

/* === Top bar — paper console rule, ties visually to the floor === */
.hwr-topbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 28px;
  padding: 10px 22px;
  background:
    repeating-linear-gradient(
      135deg,
      rgba(28, 26, 20, 0.025) 0,
      rgba(28, 26, 20, 0.025) 1px,
      transparent 1px,
      transparent 7px
    ),
    rgba(255, 252, 240, 0.94);
  border-bottom: 1.5px solid #1c1a14;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.hwr-topbar::after {
  /* engineered tick rule below the divider — same vocabulary as the band on the badges */
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -5px;
  height: 3px;
  background-image:
    repeating-linear-gradient(
      to right,
      #1c1a14 0,
      #1c1a14 6px,
      transparent 6px,
      transparent 14px
    );
  opacity: 0.45;
  pointer-events: none;
}

/* === Brand === */
.hwr-brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: inherit;
  padding: 2px 4px;
}
.hwr-brand-mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: #1c1a14;
  color: #f4efe2;
  box-shadow: 0 2px 0 rgba(28, 26, 20, 0.25);
}
.hwr-brand-pulse {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c8421f;
  box-shadow:
    0 0 0 2px #f4efe2,
    0 0 8px rgba(200, 66, 31, 0.85);
  animation: hwr-pulse 1.6s ease-in-out infinite;
}
@keyframes hwr-pulse {
  0%, 100% { opacity: 1; }
  55%      { opacity: 0.4; }
}
.hwr-brand-name {
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
}
.hwr-brand-eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #6b6555;
}
.hwr-brand-title {
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #1c1a14;
}

/* === Tabs === */
.hwr-tabs {
  justify-self: center;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  background: rgba(28, 26, 20, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(28, 26, 20, 0.12);
}
.hwr-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px 8px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #4a4536;
  text-decoration: none;
  border-radius: 4px;
  transition: color 0.15s ease, background 0.15s ease;
}
.hwr-tab:hover {
  color: #1c1a14;
  background: rgba(28, 26, 20, 0.06);
}
.hwr-tab-icon {
  width: 13px;
  height: 13px;
}
.hwr-tab.is-active {
  color: #f4efe2;
  background: #1c1a14;
  box-shadow: 0 2px 0 rgba(28, 26, 20, 0.3);
}
.hwr-tab.is-active::after {
  /* vermilion underline accent on the active tab */
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 3px;
  height: 1.5px;
  background: #c8421f;
  border-radius: 1px;
}

/* === Right actions === */
.hwr-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hwr-mode {
  color: #4a4536 !important;
  background: transparent !important;
  border-radius: 4px !important;
}
.hwr-mode:hover {
  color: #1c1a14 !important;
  background: rgba(28, 26, 20, 0.06) !important;
}
.hwr-lang {
  font-family: 'IBM Plex Mono', monospace !important;
  font-size: 11px !important;
  letter-spacing: 0.1em !important;
}
.hwr-lang :deep(button),
.hwr-lang :deep([role="combobox"]) {
  background: transparent !important;
  color: #4a4536 !important;
}
.hwr-lang :deep(button):hover,
.hwr-lang :deep([role="combobox"]):hover {
  color: #1c1a14 !important;
  background: rgba(28, 26, 20, 0.06) !important;
}

/* === Main content === */
.hwr-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hwr-main > * {
  flex: 1 1 auto;
  min-height: 0;
}

/* === Mobile === */
@media (max-width: 640px) {
  .hwr-topbar {
    grid-template-columns: auto 1fr;
    gap: 10px;
  }
  .hwr-tabs {
    grid-column: 1 / -1;
    justify-self: stretch;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hwr-tabs::-webkit-scrollbar {
    display: none;
  }
  .hwr-actions {
    justify-self: end;
  }
  .hwr-brand-eyebrow {
    display: none;
  }
}
</style>
