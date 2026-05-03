/**
 * In-memory tracker of the mid-turn state for each open mission. Lets the
 * SSE endpoint send a snapshot to clients that reconnect WHILE a turn is
 * already in flight — without this they'd see "idle" forever for a turn
 * whose chunks already streamed past.
 *
 * Lost on Nitro restart, which is fine: a restart kills the ACP children
 * and there's nothing meaningful to resume to.
 */

export interface InFlightState {
  assistantMsgId: number
  buffer: string
  /** Wall-clock when the turn started, for diagnostics. */
  startedAt: number
}

const inFlight = new Map<string, InFlightState>()

export function startFlight(missionId: string, assistantMsgId: number): InFlightState {
  const state: InFlightState = { assistantMsgId, buffer: '', startedAt: Date.now() }
  inFlight.set(missionId, state)
  return state
}

export function endFlight(missionId: string): void {
  inFlight.delete(missionId)
}

export function getFlight(missionId: string): InFlightState | null {
  return inFlight.get(missionId) ?? null
}

export function isInFlight(missionId: string): boolean {
  return inFlight.has(missionId)
}
