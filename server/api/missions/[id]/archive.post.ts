import { archiveMission, getMission } from '../../../utils/mission'
import { removeMission as stopWatchingMission } from '../../../utils/auto-nudge'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing mission id' })

  const mission = getMission(id)
  if (!mission) throw createError({ statusCode: 404, statusMessage: 'Mission not found' })

  archiveMission(id)
  stopWatchingMission(id)
  return { ok: true }
})
