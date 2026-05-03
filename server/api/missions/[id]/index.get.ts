import { getMission, listMessages } from '../../../utils/mission'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing mission id' })

  const m = getMission(id)
  if (!m) throw createError({ statusCode: 404, statusMessage: 'Mission not found' })

  const messages = listMessages(id)
  return {
    mission: {
      id: m.id,
      orchestratorSlug: m.orchestrator_slug,
      acpSessionId: m.acp_session_id,
      title: m.title,
      status: m.status,
      createdAt: m.created_at,
      lastMessageAt: m.last_message_at
    },
    messages: messages.map(msg => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.created_at
    }))
  }
})
