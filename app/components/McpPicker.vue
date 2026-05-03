<script setup lang="ts">
interface McpServer {
  name: string
  transport: 'http' | 'stdio' | 'unknown'
  endpoint: string
  tools?: unknown
  headerCount: number
}

const props = defineProps<{
  profileSlug: string
  servers: McpServer[]
  loading?: boolean
}>()

const emit = defineEmits<{
  removed: [name: string]
}>()

const { t } = useI18n()
const toast = useToast()

const removing = ref<string | null>(null)

async function handleRemove(server: McpServer) {
  if (removing.value) return
  if (typeof window !== 'undefined' && !window.confirm(t('mcp.confirmRemove', { name: server.name }))) return

  removing.value = server.name
  try {
    await $fetch(
      `/api/profiles/${encodeURIComponent(props.profileSlug)}/mcp/${encodeURIComponent(server.name)}`,
      { method: 'DELETE' }
    )
    toast.add({ title: t('mcp.removed', { name: server.name }), color: 'primary', icon: 'i-lucide-check' })
    emit('removed', server.name)
  } catch (e) {
    const err = e as { data?: { message?: string }, message?: string }
    toast.add({
      title: t('mcp.removeFailed'),
      description: err.data?.message ?? err.message,
      color: 'error'
    })
  } finally {
    removing.value = null
  }
}

function transportIcon(t: McpServer['transport']): string {
  if (t === 'http') return 'i-lucide-globe'
  if (t === 'stdio') return 'i-lucide-terminal'
  return 'i-lucide-circle-help'
}

function transportLabel(transport: McpServer['transport']): string {
  if (transport === 'http') return t('mcp.transport.http')
  if (transport === 'stdio') return t('mcp.transport.stdio')
  return t('mcp.transport.unknown')
}
</script>

<template>
  <div class="space-y-3">
    <p class="text-xs text-muted">
      {{ t('mcp.hint') }}
    </p>

    <div
      v-if="loading"
      class="text-sm text-muted py-6 text-center"
    >
      {{ t('mcp.loading') }}
    </div>

    <div
      v-else-if="!servers.length"
      class="text-sm text-muted py-6 text-center"
    >
      {{ t('mcp.empty') }}
    </div>

    <div
      v-else
      class="rounded-md border border-default divide-y divide-default"
    >
      <div
        v-for="srv in servers"
        :key="srv.name"
        class="flex items-start gap-3 px-3 py-2.5"
      >
        <UIcon
          :name="transportIcon(srv.transport)"
          class="size-4 mt-0.5 text-muted shrink-0"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium font-mono">{{ srv.name }}</span>
            <UBadge
              size="sm"
              variant="subtle"
              color="neutral"
            >
              {{ transportLabel(srv.transport) }}
            </UBadge>
            <UBadge
              v-if="srv.headerCount > 0"
              size="sm"
              variant="subtle"
              color="neutral"
              :title="t('mcp.headersTooltip')"
            >
              {{ t('mcp.headers', { count: srv.headerCount }) }}
            </UBadge>
          </div>
          <p class="text-xs text-muted truncate font-mono mt-0.5">
            {{ srv.endpoint || '—' }}
          </p>
        </div>
        <UButton
          size="xs"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          :loading="removing === srv.name"
          :disabled="removing !== null && removing !== srv.name"
          @click="handleRemove(srv)"
        >
          {{ t('mcp.remove') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
