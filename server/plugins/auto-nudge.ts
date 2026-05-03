import { loadWatchedFromDb, startAutoNudge } from '../utils/auto-nudge'

/**
 * Boot the auto-nudge watcher on Nitro startup. Two phases:
 *   1. Rehydrate the in-memory watch list from `mission_watched_tasks`
 *      (rows that were registered before the last shutdown and never
 *      had a successful nudge fired).
 *   2. Start the poll loop, which kicks off with an immediate `checkAll`
 *      so any of those resumed tasks that already finished get caught up.
 */
export default defineNitroPlugin(() => {
  loadWatchedFromDb()
  startAutoNudge()
})
