import type { CurrentTask } from '~/types/mission'

const POLL_MS = 3000

/**
 * @param missionIdRef When set, the composable scopes results to the given
 *   mission via `?mission=<id>` — the server filters by `mission_watched_tasks`.
 *   Pass `null` (or omit) to show all active tasks globally.
 */
export function useKanbanTasks(missionIdRef?: Ref<string | null>) {
  const tasks = ref<CurrentTask[]>([])
  const dispatcherStale = ref(false)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function tick() {
    try {
      const missionId = missionIdRef?.value
      const url = missionId
        ? `/api/kanban/tasks?mission=${encodeURIComponent(missionId)}`
        : '/api/kanban/tasks'
      const res = await $fetch<{ tasks: CurrentTask[], dispatcherStale: boolean }>(url)
      tasks.value = res.tasks
      dispatcherStale.value = res.dispatcherStale
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, POLL_MS)
      }
    }
  }

  /* Refetch immediately when the mission scope changes, so the floor flips
     the moment the user creates / archives a mission. */
  if (missionIdRef) {
    watch(missionIdRef, () => {
      if (timer) clearTimeout(timer)
      tick()
    })
  }

  const taskByAssignee = computed(() => {
    const map = new Map<string, CurrentTask>()
    for (const t of tasks.value) {
      if (!t.assignee) continue
      // Keep the first one (already ordered: running > blocked > ready > todo).
      if (!map.has(t.assignee)) map.set(t.assignee, t)
    }
    return map
  })

  onMounted(() => {
    tick()
  })
  onBeforeUnmount(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })

  return { tasks, taskByAssignee, dispatcherStale, error }
}
