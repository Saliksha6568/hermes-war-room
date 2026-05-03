// Client-side mirror of server/utils/avatar.ts so the war-room can swap the
// gesture on the fly (e.g. when an agent goes from idle to working) without
// round-tripping to the server.
//
// Notionists v9 valid gestures (from
// https://api.dicebear.com/9.x/notionists/schema.json):
//   hand · handPhone · ok · point
//   okLongArm · pointLongArm
//   waveLongArm · waveLongArms · waveOkLongArms · wavePointLongArms
// Note the inconsistent singular/plural ("LongArm" vs "LongArms").

export const ACTIVE_GESTURES = [
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

export type Gesture = 'hand' | typeof ACTIVE_GESTURES[number]

export interface AvatarOpts {
  seed: string
  gesture?: Gesture
  /**
   * Likelihood (0-100) the chosen gesture is actually rendered. Dicebear's
   * default is 10 — too low when we're explicitly trying to show "this agent
   * is working". Pass 100 for active states.
   */
  gestureProbability?: number
  backgroundColor?: string
  size?: number
  transparent?: boolean
  /**
   * SVG container corner rounding (0-50). 0 = square, 50 = full circle.
   * Useful when the avatar is rendered inside a circle and we
   * want the underlying SVG to match.
   */
  radius?: number
  /** SVG rotation in degrees (0-360). Used for micro-tilts while active. */
  rotate?: number
  /** Mirror the avatar horizontally. Cheap pseudo-animation for active states. */
  flip?: boolean
}

export function buildAvatarUrl(opts: AvatarOpts): string {
  const params = new URLSearchParams({
    seed: opts.seed,
    gesture: opts.gesture ?? 'hand'
  })
  if (typeof opts.gestureProbability === 'number') {
    params.set('gestureProbability', String(Math.max(0, Math.min(100, opts.gestureProbability))))
  }
  if (typeof opts.radius === 'number') {
    params.set('radius', String(Math.max(0, Math.min(50, opts.radius))))
  }
  if (typeof opts.rotate === 'number') {
    params.set('rotate', String(((Math.round(opts.rotate) % 360) + 360) % 360))
  }
  if (opts.flip) {
    params.set('flip', 'true')
  }
  if (!opts.transparent && opts.backgroundColor) {
    params.set('backgroundColor', opts.backgroundColor)
  }
  if (opts.size) params.set('size', String(opts.size))
  return `https://api.dicebear.com/9.x/notionists/svg?${params.toString()}`
}

function fnv1a(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Pick an "active" gesture deterministically from a key string. Same key →
 * same gesture, so an agent's avatar stays stable while it's working on the
 * same task and only flips when the task changes.
 */
export function pickActiveGesture(key: string): Gesture {
  const idx = fnv1a(key) % ACTIVE_GESTURES.length
  return ACTIVE_GESTURES[idx]!
}

/**
 * Pick a gesture at random — used to animate per-step (each ticker event
 * rotates the operative's pose). Avoids the deterministic seed so consecutive
 * picks differ visibly even on adjacent steps.
 */
export function randomActiveGesture(): Gesture {
  const idx = Math.floor(Math.random() * ACTIVE_GESTURES.length)
  return ACTIVE_GESTURES[idx]!
}
