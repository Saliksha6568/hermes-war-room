import { listTools } from '../utils/tools'

export default defineEventHandler(async () => {
  return listTools()
})
