import { EventEmitter } from 'node:events'

export interface ChunkEvent {
  type: 'chunk'
  delta: string
  thought?: boolean
}

export interface ToolEvent {
  type: 'tool'
  name?: string
  status?: string
  title?: string
  raw: unknown
}

export interface UserMessageEvent {
  type: 'user'
  messageId: number
  content: string
}

export interface AssistantMessageDoneEvent {
  type: 'done'
  messageId: number
  content: string
  stopReason: string
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

/**
 * Snapshot of the mission's current mid-turn state, sent on SSE connect so
 * clients reconnecting in the middle of a turn don't sit idle waiting for
 * chunks that already streamed past.
 */
export interface StateEvent {
  type: 'state'
  streaming: boolean
  /** id of the assistant message currently being filled, if any */
  messageId: number | null
  /** Buffered content so far (visible chunks only — thoughts excluded). */
  content: string
}

export type MissionEvent
  = | ChunkEvent
    | ToolEvent
    | UserMessageEvent
    | AssistantMessageDoneEvent
    | ErrorEvent
    | StateEvent

const buses = new Map<string, EventEmitter>()

export function getMissionBus(missionId: string): EventEmitter {
  let bus = buses.get(missionId)
  if (!bus) {
    bus = new EventEmitter()
    bus.setMaxListeners(0)
    buses.set(missionId, bus)
  }
  return bus
}

export function dropMissionBus(missionId: string): void {
  buses.delete(missionId)
}

export function emit(missionId: string, event: MissionEvent): void {
  const bus = buses.get(missionId)
  if (bus) bus.emit('event', event)
}
