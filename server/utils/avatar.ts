// Curated palette of muted-but-distinct backgrounds that read well behind the
// pen-and-ink Notionists style in both light and dark mode. Hex without '#'.
const PALETTE = [
  'b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf',
  'a7f3d0', 'fde68a', 'fbcfe8', 'bae6fd', 'fecaca',
  'ddd6fe', 'fed7aa', 'bbf7d0', 'e9d5ff'
]

// Notionists v9 valid gesture values (from
// https://api.dicebear.com/9.x/notionists/schema.json). Default 'hand' is a
// calm idle. Note the inconsistent singular/plural ("LongArm" vs "LongArms").
export const GESTURES = [
  'hand',
  'handPhone',
  'ok',
  'point',
  'okLongArm',
  'pointLongArm',
  'waveLongArm',
  'waveLongArms',
  'waveOkLongArms',
  'wavePointLongArms'
] as const

export type Gesture = typeof GESTURES[number]

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickColor(slug: string): string {
  return PALETTE[hashStr(slug) % PALETTE.length]!
}

// The slug doubles as a stable Dicebear seed by default. Stored separately
// so it can be re-rolled later without renaming the profile.
export function defaultSeed(slug: string): string {
  return slug
}

export function avatarUrl(opts: {
  seed: string
  backgroundColor?: string
  gesture?: Gesture
  size?: number
  transparent?: boolean
}): string {
  const params = new URLSearchParams({
    seed: opts.seed,
    gesture: opts.gesture ?? 'hand'
  })
  if (!opts.transparent && opts.backgroundColor) {
    params.set('backgroundColor', opts.backgroundColor)
  }
  if (opts.size) params.set('size', String(opts.size))
  return `https://api.dicebear.com/9.x/notionists/svg?${params.toString()}`
}
