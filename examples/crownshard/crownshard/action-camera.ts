import type { Vec3 } from 'ridgetop'
import type { ActionCameraCueKind, BattleSpeedMultiplier, CampaignState, GameState } from './types.ts'

export type { ActionCameraCueKind } from './types.ts'

export interface ActionCameraCueConfig {
  readonly kind: ActionCameraCueKind
  /** Target zoom multiplier (< 1.0 zooms in smoothly; 1.0 is neutral). */
  readonly zoomMul: number
  /** Total envelope duration in seconds at 1x battle speed. */
  readonly duration: number
  /** Fraction of duration spent easing in to peak focus/zoom. */
  readonly attackRatio: number
  /** Fraction of duration where peak hold ends and ease-out begins. */
  readonly holdEndRatio: number
  /** Fraction (0..1) of the focal point's world offset pulled into camera target. */
  readonly focusPull: number
  /** Peak subtle yaw flourish magnitude in radians (0 for none). */
  readonly yawNudge: number
  /** Higher priority cues preempt lower priority cues. */
  readonly priority: number
}

export interface ActionCameraState {
  cue: ActionCameraCueKind | null
  priority: number
  elapsed: number
  duration: number
  speedAtTrigger: BattleSpeedMultiplier
  targetFocus: [number, number, number]
  currentFocus: [number, number, number]
  targetZoom: number
  currentZoom: number
  targetYaw: number
  currentYaw: number
}

export const ACTION_CAMERA_2X_RATE = 1.6
export const ACTION_CAMERA_EPS = 1e-4
export const ACTION_CAMERA_MAX_FOCUS_X = 4.5
export const ACTION_CAMERA_MAX_FOCUS_Y = 1.4
export const ACTION_CAMERA_MAX_FOCUS_Z = 3.8

export const ACTION_CAMERA_CUES: Record<ActionCameraCueKind, ActionCameraCueConfig> = {
  crit: {
    kind: 'crit',
    zoomMul: 0.88,
    duration: 0.45,
    attackRatio: 0.20,
    holdEndRatio: 0.56,
    focusPull: 0.25,
    yawNudge: 0,
    priority: 1
  },
  ultimate: {
    kind: 'ultimate',
    zoomMul: 0.80,
    duration: 0.80,
    attackRatio: 0.22,
    holdEndRatio: 0.62,
    focusPull: 0.42,
    yawNudge: 0.08,
    priority: 2
  },
  boss_special: {
    kind: 'boss_special',
    zoomMul: 0.82,
    duration: 0.75,
    attackRatio: 0.22,
    holdEndRatio: 0.60,
    focusPull: 0.40,
    yawNudge: 0.05,
    priority: 2
  }
}

function clampVal(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function smoothstep01(t: number): number {
  const c = clampVal(t, 0, 1)
  return c * c * (3 - 2 * c)
}

function envelopeWeight(u: number, attackRatio: number, holdEndRatio: number): number {
  if (u <= 0 || u >= 1) return 0
  if (u < attackRatio) {
    return smoothstep01(u / Math.max(1e-4, attackRatio))
  }
  if (u <= holdEndRatio) {
    return 1
  }
  return 1 - smoothstep01((u - holdEndRatio) / Math.max(1e-4, 1 - holdEndRatio))
}

export function createActionCameraState(): ActionCameraState {
  return {
    cue: null,
    priority: 0,
    elapsed: 0,
    duration: 0,
    speedAtTrigger: 1,
    targetFocus: [0, 0, 0],
    currentFocus: [0, 0, 0],
    targetZoom: 1,
    currentZoom: 1,
    targetYaw: 0,
    currentYaw: 0
  }
}

export function isActionCameraEnabled(
  campaign: Pick<CampaignState, 'actionCameraEnabled'> | null | undefined
): boolean {
  if (!campaign) return true
  return campaign.actionCameraEnabled !== false
}

export function setActionCameraEnabled(
  state: Pick<GameState, 'campaign'>,
  enabled: boolean
): boolean {
  const next = Boolean(enabled)
  state.campaign.actionCameraEnabled = next
  return next
}

export function isActionCameraActive(cam: ActionCameraState): boolean {
  if (cam.cue !== null) return true
  if (Math.abs(cam.currentZoom - 1) > ACTION_CAMERA_EPS) return true
  if (Math.abs(cam.currentYaw) > ACTION_CAMERA_EPS) return true
  if (
    Math.abs(cam.currentFocus[0]) > ACTION_CAMERA_EPS ||
    Math.abs(cam.currentFocus[1]) > ACTION_CAMERA_EPS ||
    Math.abs(cam.currentFocus[2]) > ACTION_CAMERA_EPS
  ) {
    return true
  }
  return false
}

export function triggerActionCameraCue(
  cam: ActionCameraState,
  cue: ActionCameraCueKind,
  at: Vec3,
  battleSpeed: BattleSpeedMultiplier = 1,
  enabled = true
): boolean {
  if (!enabled) return false
  const cfg = ACTION_CAMERA_CUES[cue]
  if (!cfg) return false

  // Lower-priority cues (e.g. crit) never cut short an active higher-priority cue (ultimate / boss_special).
  if (cam.cue !== null && cam.elapsed < cam.duration && cfg.priority < cam.priority) {
    return false
  }

  const speed: BattleSpeedMultiplier = battleSpeed === 2 ? 2 : 1
  const fx = clampVal(at[0] * cfg.focusPull, -ACTION_CAMERA_MAX_FOCUS_X, ACTION_CAMERA_MAX_FOCUS_X)
  const fy = clampVal(at[1] * cfg.focusPull * 0.5, -ACTION_CAMERA_MAX_FOCUS_Y, ACTION_CAMERA_MAX_FOCUS_Y)
  const fz = clampVal(at[2] * cfg.focusPull, -ACTION_CAMERA_MAX_FOCUS_Z, ACTION_CAMERA_MAX_FOCUS_Z)
  const yawDir = at[0] >= 0 ? -1 : 1

  cam.cue = cue
  cam.priority = cfg.priority
  cam.elapsed = 0
  cam.duration = speed === 2 ? cfg.duration / ACTION_CAMERA_2X_RATE : cfg.duration
  cam.speedAtTrigger = speed
  cam.targetFocus[0] = fx
  cam.targetFocus[1] = fy
  cam.targetFocus[2] = fz
  cam.targetZoom = cfg.zoomMul
  cam.targetYaw = cfg.yawNudge * yawDir
  return true
}

export function cancelActionCamera(cam: ActionCameraState, immediate = false): void {
  cam.cue = null
  cam.priority = 0
  cam.elapsed = 0
  cam.duration = 0
  cam.speedAtTrigger = 1
  cam.targetFocus[0] = 0
  cam.targetFocus[1] = 0
  cam.targetFocus[2] = 0
  cam.targetZoom = 1
  cam.targetYaw = 0
  if (immediate) {
    cam.currentFocus[0] = 0
    cam.currentFocus[1] = 0
    cam.currentFocus[2] = 0
    cam.currentZoom = 1
    cam.currentYaw = 0
  }
}

export function stepActionCamera(
  cam: ActionCameraState,
  dt: number,
  battleSpeed: BattleSpeedMultiplier = 1
): boolean {
  if (!Number.isFinite(dt) || dt <= 0) return isActionCameraActive(cam)

  const speed: BattleSpeedMultiplier = battleSpeed === 2 ? 2 : 1
  let desiredX = 0
  let desiredY = 0
  let desiredZ = 0
  let desiredZoom = 1
  let desiredYaw = 0

  if (cam.cue !== null && cam.duration > 0) {
    const cfg = ACTION_CAMERA_CUES[cam.cue]
    const extraRate = speed === 2 && cam.speedAtTrigger === 1 ? ACTION_CAMERA_2X_RATE : 1
    cam.elapsed += dt * extraRate

    if (cam.elapsed >= cam.duration) {
      cam.cue = null
      cam.priority = 0
      cam.elapsed = 0
      cam.duration = 0
      cam.speedAtTrigger = 1
      cam.targetFocus[0] = 0
      cam.targetFocus[1] = 0
      cam.targetFocus[2] = 0
      cam.targetZoom = 1
      cam.targetYaw = 0
    } else {
      const u = cam.elapsed / cam.duration
      const w = envelopeWeight(u, cfg.attackRatio, cfg.holdEndRatio)
      desiredX = cam.targetFocus[0] * w
      desiredY = cam.targetFocus[1] * w
      desiredZ = cam.targetFocus[2] * w
      desiredZoom = 1 + (cam.targetZoom - 1) * w
      desiredYaw = cam.targetYaw * w
    }
  }

  // Critically-damped exponential tracking: zero overshoot, frame-rate independent, smooth preemption/cancel recovery.
  const lambda = cam.cue !== null
    ? (speed === 2 ? 28 : 20)
    : (speed === 2 ? 32 : 22)
  const alpha = 1 - Math.exp(-lambda * dt)

  cam.currentFocus[0] += (desiredX - cam.currentFocus[0]) * alpha
  cam.currentFocus[1] += (desiredY - cam.currentFocus[1]) * alpha
  cam.currentFocus[2] += (desiredZ - cam.currentFocus[2]) * alpha
  cam.currentZoom += (desiredZoom - cam.currentZoom) * alpha
  cam.currentYaw += (desiredYaw - cam.currentYaw) * alpha

  if (
    cam.cue === null &&
    Math.abs(cam.currentZoom - 1) <= ACTION_CAMERA_EPS &&
    Math.abs(cam.currentYaw) <= ACTION_CAMERA_EPS &&
    Math.abs(cam.currentFocus[0]) <= ACTION_CAMERA_EPS &&
    Math.abs(cam.currentFocus[1]) <= ACTION_CAMERA_EPS &&
    Math.abs(cam.currentFocus[2]) <= ACTION_CAMERA_EPS
  ) {
    cam.currentFocus[0] = 0
    cam.currentFocus[1] = 0
    cam.currentFocus[2] = 0
    cam.currentZoom = 1
    cam.currentYaw = 0
    return false
  }

  return isActionCameraActive(cam)
}
