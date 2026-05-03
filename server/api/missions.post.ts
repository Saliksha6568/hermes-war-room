import { useDb } from '../utils/db'
import { createMission } from '../utils/mission'
import { runMissionTurn } from '../utils/mission-turn'

interface PostBody {
  orchestratorSlug?: string
  message?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<PostBody>(event) || {}
  const slug = (body.orchestratorSlug ?? '').trim()
  const message = (body.message ?? '').trim()

  if (!slug) throw createError({ statusCode: 400, statusMessage: 'orchestratorSlug required' })
  if (!message) throw createError({ statusCode: 400, statusMessage: 'message required' })

  const db = useDb()
  const profile = db.prepare(
    'SELECT slug, active FROM profiles WHERE slug = ? AND present = 1'
  ).get(slug) as { slug: string, active: number } | undefined
  if (!profile) throw createError({ statusCode: 404, statusMessage: `Profile "${slug}" not found` })
  if (!profile.active) throw createError({ statusCode: 400, statusMessage: `Profile "${slug}" is inactive` })

  const mission = createMission(slug, message)

  // Fire and forget: turn streams via SSE bus. Caller opens the stream
  // before this POST returns, but the bus is durable across the gap thanks
  // to the in-memory EventEmitter living per-mission-id.
  runMissionTurn(mission.id, message).catch((e: Error) => {
    console.error(`[mission ${mission.id}] turn failed:`, e.message)
  })

  setResponseStatus(event, 201)
  return {
    mission: {
      id: mission.id,
      orchestratorSlug: mission.orchestrator_slug,
      acpSessionId: mission.acp_session_id,
      title: mission.title,
      status: mission.status,
      createdAt: mission.created_at,
      lastMessageAt: mission.last_message_at
    }
  }
})
