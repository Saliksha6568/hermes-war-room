import { listActiveTasks, dispatcherLikelyStale } from '../../utils/kanban'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const assignee = typeof q.assignee === 'string' ? q.assignee : undefined

  const tasks = listActiveTasks(assignee)
  return {
    tasks,
    dispatcherStale: dispatcherLikelyStale()
  }
})
