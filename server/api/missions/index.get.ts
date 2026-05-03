import { listMissions, countMissions } from '../../utils/mission'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const status = q.status === 'open' || q.status === 'archived' ? q.status : undefined
  const orchestratorSlug = typeof q.orchestrator === 'string' ? q.orchestrator : undefined

  const pageSize = Math.max(
    1,
    Math.min(typeof q.pageSize === 'string' ? parseInt(q.pageSize, 10) || DEFAULT_PAGE_SIZE : DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  )
  const page = Math.max(1, typeof q.page === 'string' ? parseInt(q.page, 10) || 1 : 1)
  const offset = (page - 1) * pageSize

  const missions = listMissions({ status, orchestratorSlug, limit: pageSize, offset })
  const filteredTotal = countMissions({ status, orchestratorSlug })
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize))

  return {
    missions: missions.map(m => ({
      id: m.id,
      orchestratorSlug: m.orchestrator_slug,
      acpSessionId: m.acp_session_id,
      title: m.title,
      status: m.status,
      createdAt: m.created_at,
      lastMessageAt: m.last_message_at
    })),
    page,
    pageSize,
    totalPages,
    filteredTotal,
    hasMore: page < totalPages,
    totals: {
      open: countMissions({ status: 'open' }),
      archived: countMissions({ status: 'archived' }),
      all: countMissions()
    }
  }
})
