import { getMission } from '../../../utils/mission'
import { runMissionTurn } from '../../../utils/mission-turn'

interface PostBody {
  message?: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing mission id' })

  const body = await readBody<PostBody>(event) || {}
  const message = (body.message ?? '').trim()
  if (!message) throw createError({ statusCode: 400, statusMessage: 'message required' })

  const mission = getMission(id)
  if (!mission) throw createError({ statusCode: 404, statusMessage: 'Mission not found' })
  if (mission.status !== 'open') throw createError({ statusCode: 400, statusMessage: 'Mission is not open' })

  runMissionTurn(id, message).catch((e: Error) => {
    console.error(`[mission ${id}] turn failed:`, e.message)
  })

  return { ok: true }
})
