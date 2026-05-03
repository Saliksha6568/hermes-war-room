<script setup lang="ts">
interface Skill {
  name: string
  category: string | null
  description: string | null
  source: 'builtin' | 'global' | 'profile'
  enabled: boolean
}

const props = defineProps<{
  skills: Skill[]
  modelValue: string[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [enabled: string[]]
}>()

const { t } = useI18n()
const search = ref('')

const enabledSet = computed(() => new Set(props.modelValue))

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.skills
  return props.skills.filter(s =>
    s.name.toLowerCase().includes(q)
    || (s.description?.toLowerCase().includes(q) ?? false)
    || (s.category?.toLowerCase().includes(q) ?? false)
  )
})

const grouped = computed(() => {
  const map = new Map<string, Skill[]>()
  for (const s of filtered.value) {
    const key = s.category ?? '__none__'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === '__none__') return 1
      if (b === '__none__') return -1
      return a.localeCompare(b)
    })
    .map(([category, items]) => ({
      category: category === '__none__' ? null : category,
      items
    }))
})

function toggle(name: string, on: boolean) {
  const next = new Set(props.modelValue)
  if (on) next.add(name)
  else next.delete(name)
  emit('update:modelValue', [...next])
}

function selectAll() {
  emit('update:modelValue', props.skills.map(s => s.name))
}

function selectNone() {
  emit('update:modelValue', [])
}

function sourceLabel(src: Skill['source']): string {
  if (src === 'builtin') return t('skills.sourceBuiltin')
  if (src === 'global') return t('skills.sourceGlobal')
  return t('skills.sourceProfile')
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <UInput
        v-model="search"
        :placeholder="t('skills.search')"
        icon="i-lucide-search"
        size="sm"
        class="flex-1"
      />
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        @click="selectAll"
      >
        {{ t('skills.selectAll') }}
      </UButton>
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        @click="selectNone"
      >
        {{ t('skills.selectNone') }}
      </UButton>
    </div>

    <p class="text-xs text-muted">
      {{ t('skills.selected', { count: modelValue.length, total: skills.length }) }}
    </p>

    <div
      v-if="loading"
      class="text-sm text-muted py-6 text-center"
    >
      {{ t('skills.loading') }}
    </div>

    <div
      v-else-if="!skills.length"
      class="text-sm text-muted py-6 text-center"
    >
      {{ t('skills.empty') }}
    </div>

    <div
      v-else
      class="max-h-96 overflow-y-auto rounded-md border border-default divide-y divide-default"
    >
      <div
        v-for="group in grouped"
        :key="group.category ?? '__none__'"
      >
        <div class="px-3 py-1.5 bg-elevated text-xs font-mono uppercase tracking-wider text-muted sticky top-0 z-10">
          {{ group.category ?? t('skills.uncategorized') }}
        </div>
        <label
          v-for="s in group.items"
          :key="s.name"
          class="flex items-start gap-3 px-3 py-2 hover:bg-elevated/50 cursor-pointer"
        >
          <UCheckbox
            :model-value="enabledSet.has(s.name)"
            class="mt-0.5"
            @update:model-value="(v: boolean | 'indeterminate') => toggle(s.name, v === true)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium truncate">{{ s.name }}</span>
              <UBadge
                size="sm"
                variant="subtle"
                color="neutral"
              >
                {{ sourceLabel(s.source) }}
              </UBadge>
            </div>
            <p
              v-if="s.description"
              class="text-xs text-muted line-clamp-2 mt-0.5"
            >
              {{ s.description }}
            </p>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>
