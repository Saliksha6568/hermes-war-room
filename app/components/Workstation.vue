<script setup lang="ts">
import type { Profile } from '~/types/profile'
import type { CurrentTask } from '~/types/mission'
import type { ThoughtStep } from '~/composables/useMissionStream'
import type { TokenUsage } from '~/composables/useTokenUsage'
import { compactNumber } from '~/composables/useTokenUsage'
import { buildAvatarUrl, pickActiveGesture, randomActiveGesture, type Gesture } from '~/utils/avatar'

const { t, te } = useI18n()

const props = defineProps<{
  profile: Profile
  index?: number
  currentTask?: CurrentTask | null
  /**
   * The agent is doing work that isn't (yet) reflected in a kanban task —
   * e.g. the orchestrator is processing a mission turn. Drives the same
   * "active gesture + Working label" treatment as a running kanban task.
   */
  busy?: boolean
  /**
   * Latest thinking step (tool call or thought fragment) for this operative.
   * Parent only passes it to the active orchestrator — others are null.
   */
  lastStep?: ThoughtStep | null
  /**
   * Token consumption snapshot for this profile (sums per session.db).
   * Polled every few seconds by the floor — null while loading or absent.
   */
  tokenUsage?: TokenUsage | null
}>()

const emit = defineEmits<{
  select: [profile: Profile]
}>()

// Register the station root with the registry so DelegationOverlay can
// compute arrows between this and other stations.
const stationEl = ref<HTMLElement | null>(null)
const registry = useStationRegistry()
onMounted(() => {
  if (stationEl.value) registry?.register(props.profile.slug, stationEl.value)
})
onBeforeUnmount(() => {
  registry?.unregister(props.profile.slug)
})
watch(() => props.profile.slug, (next, prev) => {
  if (prev && prev !== next) registry?.unregister(prev)
  if (stationEl.value && next) registry?.register(next, stationEl.value)
})

const callsign = computed(() => {
  const raw = props.profile.givenName || props.profile.displayName
  return raw.toUpperCase()
})

const isActive = computed(() => {
  if (props.busy) return true
  const status = props.currentTask?.status
  return status === 'running' || status === 'blocked'
})

// Pose rotation: while active we re-roll a fresh "micro-pose" (gesture +
// small tilt + horizontal flip) on every ticker step (`lastStep.ts` change).
// Seed is unchanged so the character is the same across frames, but pose,
// rotation and mirroring vary so the operative reads as "alive" while
// working. Idle = profile's stored gesture, no rotation, no flip.
interface ActivePose {
  gesture: Gesture
  /** Degrees, 0-360. Realised from a [-12, 12] tilt range. */
  rotate: number
  flip: boolean
}
const activePose = ref<ActivePose | null>(null)

function rollActivePose(): ActivePose {
  const tiltDeg = Math.floor(Math.random() * 25) - 12 // [-12, 12]
  return {
    gesture: randomActiveGesture(),
    rotate: ((tiltDeg % 360) + 360) % 360,
    flip: Math.random() < 0.5
  }
}

watch(
  () => props.lastStep?.ts ?? null,
  (ts) => {
    if (ts === null) {
      activePose.value = null
      return
    }
    activePose.value = rollActivePose()
  },
  { immediate: true }
)

const effectiveGesture = computed<Gesture>(() => {
  if (!isActive.value) return props.profile.gesture as Gesture
  if (activePose.value) return activePose.value.gesture
  const key = props.currentTask?.id ?? `${props.profile.slug}:busy`
  return pickActiveGesture(key)
})

const effectiveAvatarUrl = computed(() => {
  if (!isActive.value) {
    // Re-derive from seed so we can apply radius=50 to match the disc shape,
    // matching the active variant. The server-provided portrait URL doesn't
    // round its SVG container.
    return buildAvatarUrl({
      seed: props.profile.avatarSeed,
      gesture: props.profile.gesture as Gesture,
      radius: 50,
      size: 320,
      transparent: true
    })
  }
  return buildAvatarUrl({
    seed: props.profile.avatarSeed,
    gesture: effectiveGesture.value,
    gestureProbability: 100,
    radius: 50,
    rotate: activePose.value?.rotate ?? 0,
    flip: activePose.value?.flip ?? false,
    size: 320,
    transparent: true
  })
})

const gestureLabel = computed(() => {
  const key = `badge.gesture.${props.profile.gesture}`
  return te(key) ? t(key) : props.profile.gesture
})

const statusLine = computed(() => {
  const task = props.currentTask
  if (task) {
    const prefix = task.status === 'running'
      ? t('mission.task.running')
      : task.status === 'blocked'
        ? t('mission.task.blocked')
        : t('mission.task.queued')
    // Avoid an orphan colon when the task has no title (yet) — render only
    // the prefix in that case (e.g. "TRABAJANDO" instead of "TRABAJANDO EN:").
    const title = task.title?.trim()
    return title ? `${prefix}: ${title}` : prefix
  }
  if (props.busy) return t('mission.task.running')
  return gestureLabel.value
})

// Bubble shows a glanceable line above the head when the operative is
// doing anything more interesting than idling. Content priority:
//  1. live thought / tool step (most fine-grained)
//  2. kanban task title (coarser)
//  3. "Thinking…" placeholder when busy without anything else to say
//  4. nothing
const bubbleText = computed<string | null>(() => {
  if (props.lastStep) return props.lastStep.label
  const task = props.currentTask
  if (task) return task.title
  if (props.busy) return t('mission.task.thinking')
  return null
})

const bubbleVariant = computed<'thought' | 'tool' | 'running' | 'blocked' | 'queued' | null>(() => {
  if (props.lastStep) return props.lastStep.kind === 'tool' ? 'tool' : 'thought'
  const task = props.currentTask
  if (task?.status === 'blocked') return 'blocked'
  if (task?.status === 'running' || props.busy) return 'running'
  if (task) return 'queued'
  return null
})

const bubbleGlyph = computed(() => {
  switch (bubbleVariant.value) {
    case 'tool': return 'i-lucide-arrow-right'
    case 'thought': return 'i-lucide-brain'
    case 'blocked': return 'i-lucide-octagon-pause'
    case 'running': return 'i-lucide-loader'
    default: return null
  }
})

const taskTooltip = computed(() => {
  const task = props.currentTask
  if (!task) return null
  const parts: string[] = [task.title]
  parts.push(`status: ${task.status}`)
  if (task.startedAt) {
    parts.push(`started: ${new Date(task.startedAt * 1000).toLocaleTimeString()}`)
  }
  if (task.lastHeartbeatAt) {
    const ageS = Math.max(0, Math.floor(Date.now() / 1000) - task.lastHeartbeatAt)
    parts.push(`heartbeat: ${ageS}s ago`)
  }
  return parts.join(' · ')
})

const stationClass = computed(() => {
  const task = props.currentTask
  if (task) return `station-${task.status}`
  if (props.busy) return 'station-running'
  return ''
})

// Token chip shown under the placard. Hidden if no usage data captured yet
// (the ACP adapter doesn't fill session token columns currently — workers
// invoked via `hermes chat -q` do).
const tokenChip = computed(() => {
  const u = props.tokenUsage
  if (!u || !u.present) return null
  const total = u.totalIn + u.totalOut
  if (total === 0) return null
  const recent = u.recentIn + u.recentOut
  return {
    total: compactNumber(total),
    delta: recent > 0 ? `+${compactNumber(recent)}/min` : null,
    title: [
      `Input: ${u.totalIn.toLocaleString()} · Output: ${u.totalOut.toLocaleString()}`,
      u.totalCache > 0 ? `Cache: ${u.totalCache.toLocaleString()}` : null,
      u.totalCostUsd > 0 ? `Est. cost: $${u.totalCostUsd.toFixed(4)}` : null,
      u.sessionIn + u.sessionOut > 0
        ? `Last session: ${u.sessionIn.toLocaleString()} in / ${u.sessionOut.toLocaleString()} out`
        : null
    ].filter(Boolean).join(' · ')
  }
})
</script>

<template>
  <article
    ref="stationEl"
    class="station"
    :class="stationClass"
    :style="{ '--accent': '#' + profile.backgroundColor }"
    role="button"
    :aria-label="`Open detail for ${callsign}`"
    tabindex="0"
    @click="emit('select', profile)"
    @keydown.enter.prevent="emit('select', profile)"
    @keydown.space.prevent="emit('select', profile)"
  >
<!-- Comic-style thought bubble above the head. Surfaces (in order of
         priority): live tool/thought step → kanban task title → "thinking"
         placeholder. Hidden when truly idle. Token chip (when there's
         usage data) sits inside the bubble as a second line. -->
    <Transition name="bubble">
      <div
        v-if="bubbleText"
        class="bubble"
        :class="`bubble--${bubbleVariant}`"
        :title="taskTooltip ?? bubbleText"
      >
        <div class="bubble-row">
          <UIcon
            v-if="bubbleGlyph"
            :name="bubbleGlyph"
            class="bubble-glyph"
            :class="{ 'bubble-glyph--spin': bubbleVariant === 'running' }"
          />
          <span class="bubble-text">{{ bubbleText }}</span>
        </div>
        <div
          v-if="tokenChip"
          class="bubble-tokens"
          :title="tokenChip.title"
        >
          <UIcon
            name="i-lucide-circle-gauge"
            class="bubble-tokens-glyph"
            :class="{ 'bubble-tokens-glyph--spin': !!tokenChip.delta }"
          />
          <span class="bubble-tokens-total">{{ tokenChip.total }}</span>
          <span
            v-if="tokenChip.delta"
            class="bubble-tokens-delta"
          >{{ tokenChip.delta }}</span>
        </div>
      </div>
    </Transition>

    <!-- Square wrapper holding the perfect-circle disc + the masked character.
         The character img is 140% of this wrapper, bottom-anchored, so the head
         pokes above the disc; a composite mask clips the body to the circle. -->
    <div class="figure">
      <div class="disc" />
      <img
        class="character"
        :src="effectiveAvatarUrl"
        :alt="callsign"
        loading="lazy"
      >
    </div>

    <div class="placard">
      <span class="placard-callsign">
        <span
          class="lamp"
          :title="taskTooltip ?? gestureLabel"
        />
        {{ callsign }}
      </span>
      <span class="placard-slug">{{ profile.displayName }}</span>
    </div>
    <span
      class="status-line"
      :title="taskTooltip ?? undefined"
    >
      <UIcon
        v-if="isActive"
        name="i-lucide-circle-dot"
        class="status-glyph"
      />
      {{ statusLine }}
    </span>
  </article>
</template>

<style scoped>
/* The station is now a flex column. Children stack naturally — only the
   bubble overlay and the disc/character pair stay absolute (the latter is
   what lets the head pop above the disc). Top padding reserves space for
   the floating bubble so the figure doesn't jump when one appears. */
.station {
  --accent: #d4d4d4;
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding-top: 36px;
  isolation: isolate;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  color: #2a261c;
  cursor: pointer;
  transition: transform 180ms ease;
}
.station:hover,
.station:focus-visible {
  transform: translateY(-2px);
}
.station:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 4px;
}

/* Comic-style thought bubble over the operative's head — the only true
   overlay left. Lives in the padding-top zone of the station so it doesn't
   shift the rest of the layout when it appears or grows multi-line. */
.bubble {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  max-width: 130%;
  padding: 5px 11px 6px;
  background: #1c1a14;
  color: #f4efe2;
  border-radius: 14px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.04em;
  line-height: 1.25;
  box-shadow:
    0 6px 14px -4px rgba(28, 26, 20, 0.45),
    0 1px 0 rgba(255, 255, 255, 0.08) inset;
  pointer-events: auto;
}
.bubble-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bubble::after {
  /* Tail triangle pointing down toward the head. */
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5px;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #1c1a14;
  filter: drop-shadow(0 1px 0 rgba(28, 26, 20, 0.4));
}
.bubble-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.bubble-glyph {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  color: var(--accent);
}
.bubble-glyph--spin {
  animation: bubble-spin 1.6s linear infinite;
}
/* Status-driven bubble colours — match the status-line pill so the same
   semantic state reads the same way regardless of whether you're scanning
   the head bubble or the floor caption. */
.bubble--running {
  background: #2f5a2f;
  color: #f4efe2;
  border: 1px solid #1f3f1f;
}
.bubble--running::after {
  border-top-color: #2f5a2f;
}
.bubble--running .bubble-glyph {
  color: #a4d8a4;
}

.bubble--blocked {
  background: #5a1f12;
  color: #ffe6dc;
  border: 1px solid #3a140b;
}
.bubble--blocked::after {
  border-top-color: #5a1f12;
}
.bubble--blocked .bubble-glyph {
  color: #ffb3a0;
}

/* Queued covers todo / ready / and any other not-yet-running active state.
   Mustard amber communicates "waiting in line" without competing with the
   running green. */
.bubble--queued {
  background: #8a5a14;
  color: #fff7e0;
  border: 1px solid #5e3d08;
}
.bubble--queued::after {
  border-top-color: #8a5a14;
}
.bubble--queued .bubble-glyph {
  color: #ffd47a;
}

/* Live ticker variants (no kanban task yet — orchestrator is mid-thought).
   These stay dark/neutral since they don't represent a task status, just
   ongoing activity. The glyph picks up either the operative's accent
   (for thoughts) or amber (for tool calls). */
.bubble--tool .bubble-glyph {
  color: #f3a93b;
}
.bubble--thought .bubble-glyph {
  color: var(--accent);
}

@keyframes bubble-spin {
  to { transform: rotate(360deg); }
}

.bubble-enter-active,
.bubble-leave-active {
  transition: opacity 220ms ease, transform 220ms cubic-bezier(0.4, 1.4, 0.5, 1);
}
.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px) scale(0.9);
}
.bubble-enter-to,
.bubble-leave-from {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}

/* Square wrapper for the disc + character. In normal flow now — the disc
   and character inside it stay absolute because the 140%-scale + bottom-
   anchor trick is what lets the head pop above the disc top. */
.figure {
  position: relative;
  width: 68%;
  aspect-ratio: 1 / 1;
  z-index: 1;
}

/* Perfect-circle disc — the operative's tile on the tactical map. */
.disc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 35%,
      color-mix(in srgb, var(--accent) 94%, white) 0%,
      var(--accent) 55%,
      color-mix(in srgb, var(--accent) 75%, #1c1a14) 100%);
  border: 1px solid color-mix(in srgb, var(--accent) 50%, #1c1a14);
  box-shadow:
    0 6px 14px -4px rgba(28, 26, 20, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  z-index: 0;
}

/* Character — Notionists bust at 140% of the figure size so the head
   extends above the disc. */
.character {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 140%;
  aspect-ratio: 1 / 1;
  height: auto;
  object-fit: contain;
  object-position: bottom center;
  z-index: 2;
  pointer-events: none;
  filter: drop-shadow(0 4px 6px rgba(28, 26, 20, 0.28));
}

/* Black pill — sits naturally below the figure thanks to the parent's flex
   column + gap. */
.placard {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 5px 12px 6px;
  background: #1c1a14;
  color: #f4efe2;
  border-radius: 999px;
  max-width: 86%;
  pointer-events: none;
  z-index: 4;
}
.placard-callsign {
  display: inline-flex;
  align-items: center;
  font-family: 'Antonio', sans-serif;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.1em;
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.placard-slug {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 7.5px;
  letter-spacing: 0.14em;
  opacity: 0.55;
  text-transform: lowercase;
}

/* Token usage second line inside the thought bubble. Lives only when the
   bubble is shown (active state). Compact: total + optional per-minute
   delta when there's recent burn. */
.bubble-tokens {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding-top: 3px;
  margin-top: 3px;
  border-top: 1px dashed rgba(244, 239, 226, 0.18);
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.06em;
  cursor: help;
  opacity: 0.85;
}
.bubble-tokens-glyph {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  opacity: 0.7;
  transform-origin: 50% 50%;
}
.bubble-tokens-glyph--spin {
  /* Slow continuous rotation while there's active token burn — visual
     heartbeat that the operative is consuming context right now. */
  animation: bubble-tokens-spin 2.4s linear infinite;
  opacity: 1;
  color: #f3a93b;
}
@keyframes bubble-tokens-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.bubble-tokens-total {
  font-weight: 600;
}
.bubble-tokens-delta {
  color: #f3a93b;
  font-weight: 600;
  letter-spacing: 0.04em;
}

/* Pulsing status LED — sits inline before the callsign in the placard,
   reads like "● DAVID". Color shifts via .station-{running,blocked} below. */
.lamp {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #f3a93b;
  box-shadow:
    0 0 4px rgba(243, 169, 59, 0.85),
    0 0 10px rgba(243, 169, 59, 0.35);
  margin-right: 7px;
  flex-shrink: 0;
  animation: blink 2.6s ease-in-out infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  55%      { opacity: 0.32; }
}

/* Status caption — last item in the station's flex column. Always readable:
   solid ink with a paper-pill backdrop. Active/blocked states tint the pill.
   Wraps to multiple lines for long task titles. */
.status-line {
  display: inline-flex;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
  padding: 4px 10px 5px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.16em;
  line-height: 1.35;
  text-transform: uppercase;
  text-align: center;
  color: #1c1a14;
  background: rgba(255, 252, 240, 0.92);
  border: 1px solid rgba(28, 26, 20, 0.18);
  border-radius: 2px;
  white-space: normal;
  word-break: break-word;
  hyphens: auto;
  max-width: 96%;
  z-index: 6;
}
.status-glyph {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  color: var(--accent);
}

/* Lamp tinting based on task status — reuse the amber default for idle. */
.station-running .lamp {
  background: #6ad06a;
  box-shadow: 0 0 5px rgba(106, 208, 106, 0.85), 0 0 12px rgba(106, 208, 106, 0.35);
}
.station-blocked .lamp {
  background: #c8421f;
  box-shadow: 0 0 5px rgba(200, 66, 31, 0.85), 0 0 12px rgba(200, 66, 31, 0.35);
}
.station-running .status-line {
  color: #f4efe2;
  background: #2f5a2f;
  border-color: #1f3f1f;
  /* Subtle cycle to signal liveness. */
  animation: station-active 2.4s ease-in-out infinite;
}
.station-running .status-glyph {
  color: #a4d8a4;
}
.station-blocked .status-line {
  color: #f4efe2;
  background: #5a1f12;
  border-color: #3a140b;
}
.station-blocked .status-glyph {
  color: #ffb3a0;
}
@keyframes station-active {
  0%, 100% { background: #2f5a2f; }
  50%      { background: #3f7a3f; }
}
</style>
