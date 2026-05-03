import { useDb } from '../utils/db'

/**
 * On boot: enforce the "one open mission per orchestrator" invariant.
 *
 * Earlier versions of `createMission()` didn't archive the previous mission
 * when a new one started, so some installs accumulated multiple `status='open'`
 * rows for the same orchestrator. Only the newest was visible to the UI, the
 * rest were orphans whose `mission_watched_tasks` rows still scoped the old
 * mission's tasks (invisible to the new mission's view, never cleaned up).
 *
 * This plugin keeps the most recent open mission per orchestrator and archives
 * the rest. Idempotent — on healthy installs it's a no-op.
 */
export default defineNitroPlugin(() => {
  const db = useDb()

  const orphans = db.prepare(`
    SELECT id, orchestrator_slug, last_message_at
      FROM missions
     WHERE status = 'open'
       AND id NOT IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (
                    PARTITION BY orchestrator_slug
                    ORDER BY last_message_at DESC
                  ) AS rn
             FROM missions
            WHERE status = 'open'
         ) WHERE rn = 1
       )
  `).all() as { id: string, orchestrator_slug: string, last_message_at: string }[]

  if (orphans.length === 0) return

  const ids = orphans.map(o => o.id)
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE missions SET status = 'archived' WHERE id IN (${placeholders})`).run(...ids)
  db.prepare(`DELETE FROM mission_watched_tasks WHERE mission_id IN (${placeholders})`).run(...ids)

  console.log(`[mission-cleanup] archived ${orphans.length} orphan open mission(s):`,
    orphans.map(o => `${o.orchestrator_slug}/${o.id.slice(0, 8)}`).join(', '))
})
