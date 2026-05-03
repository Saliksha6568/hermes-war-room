/**
 * Per-mission async serialiser. ACP sessions can only handle one prompt
 * in flight at a time; user turns and auto-nudge turns must NOT overlap or
 * the second one will trip over the first's emitter wiring.
 *
 * Usage: wrap any function that drives a turn in `withMissionLock`. Calls
 * for the same mission queue up; calls for different missions run in
 * parallel.
 *
 *   await withMissionLock(missionId, async () => {
 *     await runMissionTurn(...)
 *   })
 */

const queues = new Map<string, Promise<unknown>>()

export function withMissionLock<T>(missionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(missionId) ?? Promise.resolve()
  const next = prev.then(() => fn(), () => fn())
  queues.set(missionId, next.catch(() => undefined))
  return next
}
