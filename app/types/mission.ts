export interface Mission {
  id: string
  orchestratorSlug: string
  acpSessionId: string | null
  title: string | null
  status: 'open' | 'archived'
  createdAt: string
  lastMessageAt: string
}

export interface MissionMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** True while the assistant content is still streaming. */
  pending?: boolean
}

export interface CurrentTask {
  id: string
  title: string
  body: string | null
  assignee: string | null
  status: string
  priority: number
  workerPid: number | null
  startedAt: number | null
  claimExpires: number | null
  lastHeartbeatAt: number | null
  createdAt: number
  /** IDs of parent tasks (delegators). Empty for top-level tasks. */
  parentIds: string[]
}

export type MissionEvent
  = | { type: 'chunk', delta: string, thought?: boolean }
    | { type: 'tool', title?: string, status?: string, raw: unknown }
    | { type: 'user', messageId: number, content: string }
    | { type: 'done', messageId: number, content: string, stopReason: string }
    | { type: 'error', message: string }
    | { type: 'state', streaming: boolean, messageId: number | null, content: string }
