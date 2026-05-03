export interface TaskFeedMessage {
  id: number
  role: string
  content: string | null
  toolName: string | null
  toolCalls: unknown
  reasoning: string | null
  timestamp: number | null
  tokenCount: number | null
  finishReason: string | null
}

export interface TaskFeed {
  taskId: string
  profile: string | null
  sessionId: string | null
  started: boolean
  lastActivityAt: number | null
  startedAt: number | null
  messages: TaskFeedMessage[]
  logTail: string | null
  logBytes: number | null
  totals: {
    messageCount: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    estimatedCostUsd: number
  } | null
}

const POLL_MS = 3000

/**
 * Live feed for a single kanban task. Polls while `live` is truthy (typically
 * task.status === 'running' or 'blocked'); when the task is done we fetch
 * once and stop. Pass a reactive ref so the composable handles task
 * switching automatically.
 */
export function useTaskFeed(
  taskIdRef: Ref<string | null>,
  liveRef: Ref<boolean> = ref(false)
) {
  const feed = ref<TaskFeed | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let aborted = false

  async function fetchOnce(id: string) {
    loading.value = true
    try {
      feed.value = await $fetch<TaskFeed>(`/api/kanban/tasks/${id}/feed`)
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      loading.value = false
    }
  }

  function schedule(id: string) {
    if (aborted) return
    if (!liveRef.value) return
    timer = setTimeout(async () => {
      await fetchOnce(id)
      schedule(id)
    }, POLL_MS)
  }

  watch(
    [taskIdRef, liveRef],
    async ([id, live], [prevId]) => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (id === null) {
        feed.value = null
        return
      }
      if (id !== prevId) await fetchOnce(id)
      if (live) schedule(id)
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    aborted = true
    if (timer) clearTimeout(timer)
  })

  return { feed, loading, error, refresh: () => taskIdRef.value && fetchOnce(taskIdRef.value) }
}
