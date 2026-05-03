import { listActiveTasks, dispatcherLikelyStale } from '../../utils/kanban'
import { useDb } from '../../utils/db'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const assignee = typeof q.assignee === 'string' ? q.assignee : undefined
  const mission = typeof q.mission === 'string' ? q.mission : undefined

  let tasks = listActiveTasks(assignee)

  /* When a mission id is supplied, only return tasks tied to that mission via
     `mission_watched_tasks` (auto-populated whenever the orchestrator creates
     a kanban task during a turn of that mission). This lets the floor scope
     itself to the active mission. */
  if (mission) {
    const rows = useDb()
      .prepare('SELECT task_id FROM mission_watched_tasks WHERE mission_id = ?')
      .all(mission) as { task_id: string }[]
    const allowed = new Set(rows.map(r => r.task_id))
    tasks = tasks.filter(t => allowed.has(t.id))
  }

  return {
    tasks,
    dispatcherStale: dispatcherLikelyStale()
  }
})
