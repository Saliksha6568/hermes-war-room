import { getTaskFeed } from '../../../../utils/task-feed'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing task id' })
  return getTaskFeed(id)
})
