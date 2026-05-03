export interface TokenUsage {
  totalIn: number
  totalOut: number
  totalCache: number
  sessionIn: number
  sessionOut: number
  recentIn: number
  recentOut: number
  totalCostUsd: number
  lastActivityAt: number | null
  present: boolean
}

const POLL_MS = 5000

export function useTokenUsage() {
  const usage = useState<Record<string, TokenUsage>>('tokenUsage.map', () => ({}))
  const generatedAt = useState<number>('tokenUsage.generatedAt', () => 0)
  const error = useState<string | null>('tokenUsage.error', () => null)

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function tick() {
    try {
      const res = await $fetch<{ usage: Record<string, TokenUsage>, generatedAt: number }>(
        '/api/usage'
      )
      usage.value = res.usage
      generatedAt.value = res.generatedAt
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
  }

  onMounted(() => {
    if (typeof window !== 'undefined') tick()
  })
  onBeforeUnmount(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })

  return { usage, generatedAt, error }
}

const UNITS = ['', 'K', 'M', 'B', 'T']

/** Compact number formatter — `12345 → "12.3K"`, `7000000 → "7.0M"`. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(Math.round(n))
  let value = n
  let unitIdx = 0
  while (value >= 1000 && unitIdx < UNITS.length - 1) {
    value /= 1000
    unitIdx++
  }
  return value >= 100
    ? `${Math.round(value)}${UNITS[unitIdx]}`
    : `${value.toFixed(1)}${UNITS[unitIdx]}`
}
