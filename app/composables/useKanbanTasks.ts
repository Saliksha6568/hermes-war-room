import type { CurrentTask } from '~/types/mission'

const POLL_MS = 3000

export function useKanbanTasks() {
  const tasks = ref<CurrentTask[]>([])
  const dispatcherStale = ref(false)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function tick() {
    try {
      const res = await $fetch<{ tasks: CurrentTask[], dispatcherStale: boolean }>('/api/kanban/tasks')
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
