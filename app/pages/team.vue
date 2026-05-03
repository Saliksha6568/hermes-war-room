<script setup lang="ts">
import type { Profile } from '~/types/profile'

const { t } = useI18n()
const { data: profiles, status, error, refresh } = await useFetch<Profile[]>('/api/profiles')

const hireOpen = ref(false)
const retrainOpen = ref(false)
const retrainTarget = ref<Profile | null>(null)

function onRetrain(p: Profile) {
  retrainTarget.value = p
  retrainOpen.value = true
}

function onUpdate(updated: Profile) {
  if (!profiles.value) return
  // Reassign the whole array so reactivity fires whether the ref is deep or shallow.
  profiles.value = profiles.value.map(p => p.slug === updated.slug ? updated : p)
}

async function onHired() {
  hireOpen.value = false
  await refresh()
}

async function onFired(slug: string) {
  if (profiles.value) {
    profiles.value = profiles.value.filter(p => p.slug !== slug)
  }
  await refresh()
}

async function onRenamed({ oldSlug, profile }: { oldSlug: string, profile: Profile }) {
  if (profiles.value) {
    profiles.value = profiles.value.map(p => p.slug === oldSlug ? profile : p)
  }
  /* Keep the modal anchored to the renamed profile so subsequent saves use
     the new slug. The retrain modal stays open until the user closes it. */
  retrainTarget.value = profile
  await refresh()
}
</script>

<template>
  <div class="page page--team">
    <PageHeader :title="t('team.title')">
      <template #actions>
        <UButton
          icon="i-lucide-user-plus"
          color="primary"
          @click="hireOpen = true"
        >
          {{ t('team.hire') }}
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

    <div class="page-body">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :title="t('team.errorTitle')"
        :description="error.message"
        class="mb-6"
      />

      <div
        v-if="profiles?.length"
        class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"
      >
        <ProfileBadge
          v-for="p in profiles"
          :key="p.slug"
          :profile="p"
          editable
          @update="onUpdate"
          @retrain="onRetrain"
        />
      </div>

      <div
        v-else-if="status === 'success'"
        class="text-center py-16 text-muted"
      >
        <i18n-t keypath="team.empty">
          <template #dir>
            <code class="font-mono">~/.hermes</code>
          </template>
        </i18n-t>
      </div>
    </div>

    <HireProfileModal
      v-model:open="hireOpen"
      :profiles="profiles ?? []"
      @hired="onHired"
    />

    <RetrainProfileModal
      v-model:open="retrainOpen"
      :profile="retrainTarget"
      @fired="onFired"
      @renamed="onRenamed"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.page-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}
@media (min-width: 1024px) {
  .page-body {
    padding: 32px;
  }
}
</style>
