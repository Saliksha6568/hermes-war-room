import { getMission } from '../../../utils/mission'
import { getMissionBus, type MissionEvent } from '../../../utils/mission-bus'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing mission id' })

  const mission = getMission(id)
  if (!mission) throw createError({ statusCode: 404, statusMessage: 'Mission not found' })

  const stream = createEventStream(event)
  const bus = getMissionBus(id)

  const onEvent = (e: MissionEvent) => {
    stream.push({
      event: e.type,
      data: JSON.stringify(e)
    })
  }
  bus.on('event', onEvent)

  // Heartbeat keeps proxies/load balancers from killing the connection.
  const heartbeat = setInterval(() => {
    stream.push({ event: 'ping', data: JSON.stringify({ ts: Date.now() }) })
  }, 25_000)
  ;(heartbeat as { unref?: () => void }).unref?.()

  stream.onClosed(() => {
    clearInterval(heartbeat)
    bus.off('event', onEvent)
  })

  return stream.send()
})
