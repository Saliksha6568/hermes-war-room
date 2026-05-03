/**
 * Per-instance registry that tracks the screen position of every Workstation
 * on the current floor. The DelegationOverlay reads from `positions` to draw
 * SVG arrows between stations whose tasks are linked.
 *
 * Coordinates are relative to the floor element (NOT the viewport), so the
 * overlay can be inset:0 inside the same parent and use the values directly.
 *
 * Pattern: provide() in `index.vue`, inject() in `Workstation.vue` and the
 * overlay. Avoids module-scoped globals so HMR and SSR don't fight.
 */

export interface StationPosition {
  x: number // center x, relative to floor
  y: number // center y, relative to floor
  w: number
  h: number
}

export interface StationRegistry {
  /** Reactive map of slug → position. Re-rendered whenever stations resize. */
  positions: Ref<Map<string, StationPosition>>
  /** The floor element that owns the SVG overlay. */
  setFloor: (el: HTMLElement | null) => void
  /** Called by Workstation on mount. */
  register: (slug: string, el: HTMLElement) => void
  /** Called by Workstation on unmount. */
  unregister: (slug: string) => void
  /** Force a recomputation (e.g. after a sidebar collapses). */
  recompute: () => void
}

const KEY = Symbol('stationRegistry') as InjectionKey<StationRegistry>

export function provideStationRegistry(): StationRegistry {
  const positions = ref<Map<string, StationPosition>>(new Map())
  const stations = new Map<string, HTMLElement>()
  const floorRef = ref<HTMLElement | null>(null)
  let floorObserver: ResizeObserver | null = null
  let stationObserver: ResizeObserver | null = null
  let scheduled = false

  function recompute() {
    const floor = floorRef.value
    if (!floor) return
    const floorRect = floor.getBoundingClientRect()
    const next = new Map<string, StationPosition>()
    for (const [slug, el] of stations) {
      const r = el.getBoundingClientRect()
      next.set(slug, {
        x: r.left - floorRect.left + r.width / 2,
        y: r.top - floorRect.top + r.height / 2,
        w: r.width,
        h: r.height
      })
    }
    positions.value = next
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      recompute()
    })
  }

  function setFloor(el: HTMLElement | null) {
    floorRef.value = el
    if (floorObserver) floorObserver.disconnect()
    if (el && typeof ResizeObserver !== 'undefined') {
      floorObserver = new ResizeObserver(schedule)
      floorObserver.observe(el)
    }
    schedule()
  }

  function register(slug: string, el: HTMLElement) {
    stations.set(slug, el)
    if (!stationObserver && typeof ResizeObserver !== 'undefined') {
      stationObserver = new ResizeObserver(schedule)
    }
    stationObserver?.observe(el)
    schedule()
  }

  function unregister(slug: string) {
    const el = stations.get(slug)
    if (el) stationObserver?.unobserve(el)
    stations.delete(slug)
    positions.value.delete(slug)
    schedule()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true) // capture for nested scrollers
  }

  onBeforeUnmount(() => {
    floorObserver?.disconnect()
    stationObserver?.disconnect()
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  })

  const registry: StationRegistry = { positions, setFloor, register, unregister, recompute }
  provide(KEY, registry)
  return registry
}

export function useStationRegistry(): StationRegistry | null {
  return inject(KEY, null)
}
