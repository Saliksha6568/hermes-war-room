<script setup lang="ts">
import type { CurrentTask } from '~/types/mission'
import type { Profile } from '~/types/profile'

const props = defineProps<{
  /** All currently active kanban tasks (with parentIds populated). */
  tasks: CurrentTask[]
  /** Operatives shown on the floor — used to look up accent colors. */
  profiles: Profile[]
}>()

const registry = useStationRegistry()
const positions = computed(() => registry?.positions.value ?? new Map())

const profileBySlug = computed(() => {
  const m = new Map<string, Profile>()
  for (const p of props.profiles) m.set(p.slug, p)
  return m
})

const taskById = computed(() => {
  const m = new Map<string, CurrentTask>()
  for (const t of props.tasks) m.set(t.id, t)
  return m
})

interface DelegationEdge {
  parentSlug: string
  childSlug: string
  childTaskId: string
  status: string
  parentColor: string
}

/**
 * Compute parent→child station pairs from the task graph. We only draw an
 * edge when:
 *   - the child task has a parentIds entry,
 *   - the parent task is also in the active list,
 *   - both parent and child have an assignee,
 *   - both assignees are mounted on the floor (have a position),
 *   - parent and child assignees are different (self-delegation isn't useful
 *     to render as an arrow).
 */
const edges = computed<DelegationEdge[]>(() => {
  const out: DelegationEdge[] = []
  const seen = new Set<string>()
  for (const child of props.tasks) {
    if (!child.assignee || !child.parentIds.length) continue
    if (!positions.value.has(child.assignee)) continue
    for (const parentId of child.parentIds) {
      const parent = taskById.value.get(parentId)
      if (!parent?.assignee) continue
      if (parent.assignee === child.assignee) continue
      if (!positions.value.has(parent.assignee)) continue
      const key = `${parent.assignee}→${child.assignee}:${child.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const profile = profileBySlug.value.get(parent.assignee)
      out.push({
        parentSlug: parent.assignee,
        childSlug: child.assignee,
        childTaskId: child.id,
        status: child.status,
        parentColor: profile ? '#' + profile.backgroundColor : '#888'
      })
    }
  }
  return out
})

/**
 * Build an SVG path between two station centers. The control point is offset
 * perpendicular to the line so the arc lifts off the straight axis — gives a
 * cleaner read when multiple stations are arranged in a grid.
 */
function pathFor(edge: DelegationEdge): string {
  const a = positions.value.get(edge.parentSlug)!
  const b = positions.value.get(edge.childSlug)!
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy) || 1
  // Perpendicular vector, length = distance / 4 (gentle arc).
  const lift = Math.min(dist / 4, 80)
  const px = -dy / dist * lift
  const py = dx / dist * lift
  const cx = (a.x + b.x) / 2 + px
  const cy = (a.y + b.y) / 2 + py
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}
</script>

<template>
  <svg
    class="overlay"
    :class="{ empty: !edges.length }"
    aria-hidden="true"
  >
    <!-- Arrow-head marker, recoloured per-edge via stroke inheritance. -->
    <defs>
      <marker
        id="delegation-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
        markerUnits="userSpaceOnUse"
      >
        <path
          d="M 0 0 L 10 5 L 0 10 z"
          fill="context-stroke"
        />
      </marker>
    </defs>

    <g class="edges">
      <path
        v-for="(edge, i) in edges"
        :key="`${edge.parentSlug}-${edge.childSlug}-${edge.childTaskId}-${i}`"
        :d="pathFor(edge)"
        :stroke="edge.parentColor"
        :class="`edge edge-${edge.status}`"
        marker-end="url(#delegation-arrow)"
      />
    </g>
  </svg>
</template>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 4;        /* above stations' shadow but below the bubbles */
  overflow: visible;
}
.overlay.empty {
  display: none;
}

.edges {
  fill: none;
}

.edge {
  stroke-width: 1.6;
  stroke-linecap: round;
  fill: none;
  opacity: 0.8;
  filter: drop-shadow(0 1px 0 rgba(255, 252, 240, 0.4));
}

/* Active delegation: marching-ants animation toward the child. */
.edge-running {
  stroke-dasharray: 6 5;
  stroke-width: 2;
  animation: edge-march 1.6s linear infinite;
}
.edge-blocked {
  stroke-dasharray: 2 5;
  opacity: 0.55;
}
.edge-ready,
.edge-todo {
  stroke-dasharray: 1 4;
  opacity: 0.5;
}

@keyframes edge-march {
  to { stroke-dashoffset: -22; }
}
</style>
