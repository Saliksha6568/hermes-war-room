<script setup lang="ts">
interface Tool {
  name: string
  label: string
  enabled: boolean
}

const props = defineProps<{
  tools: Tool[]
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
  if (!q) return props.tools
  return props.tools.filter(tool =>
    tool.name.toLowerCase().includes(q) || tool.label.toLowerCase().includes(q)
  )
})

function toggle(name: string, on: boolean) {
  const next = new Set(props.modelValue)
  if (on) next.add(name)
  else next.delete(name)
  emit('update:modelValue', [...next])
}

function selectAll() {
  emit('update:modelValue', props.tools.map(tool => tool.name))
}

function selectNone() {
  emit('update:modelValue', [])
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2">
      <UInput
        v-model="search"
        :placeholder="t('tools.search')"
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
        {{ t('tools.selectAll') }}
      </UButton>
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        @click="selectNone"
      >
        {{ t('tools.selectNone') }}
      </UButton>
    </div>

    <p class="text-xs text-muted">
      {{ t('tools.selected', { count: modelValue.length, total: tools.length }) }}
    </p>

    <div
      v-if="loading"
      class="text-sm text-muted py-6 text-center"
    >
      {{ t('tools.loading') }}
    </div>

    <div
      v-else-if="!tools.length"
      class="text-sm text-muted py-6 text-center"
    >
      {{ t('tools.empty') }}
    </div>

    <div
      v-else
      class="max-h-80 overflow-y-auto rounded-md border border-default divide-y divide-default"
    >
      <label
        v-for="tool in filtered"
        :key="tool.name"
        class="flex items-center gap-3 px-3 py-2 hover:bg-elevated/50 cursor-pointer"
      >
        <UCheckbox
          :model-value="enabledSet.has(tool.name)"
          @update:model-value="(v: boolean | 'indeterminate') => toggle(tool.name, v === true)"
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm">
            {{ tool.label }}
          </div>
          <div class="text-xs text-muted font-mono">
            {{ tool.name }}
          </div>
        </div>
      </label>
    </div>
  </div>
</template>
