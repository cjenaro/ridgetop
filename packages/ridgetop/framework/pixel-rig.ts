import { createSpriteSheet } from './sprite-sheet.ts'
import type { SpriteFrame } from './sprite-sheet.ts'

const FORBIDDEN_JOINT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export type Vec2 = readonly [number, number]

export interface PixelStampSpec {
  /** Top-left offset relative to the joint's world pivot (in integer pixels). */
  readonly offset?: Vec2
  readonly rows: readonly string[]
}

export interface PixelJointPose {
  readonly offset?: Vec2
  /** Local rotation in radians around this joint's pivot. */
  readonly rotation?: number
  /** Optional alternate stamp variant name (from `joint.variants`) for this pose (e.g. waving cape or glowing rune). */
  readonly variant?: string
  readonly hidden?: boolean
}

export interface PixelJoint {
  readonly id: string
  readonly parent?: string
  /** Rest-pose pivot relative to parent pivot (or root if no parent). */
  readonly pivot?: Vec2
  /** Draw order (smaller draws behind larger). Default `0`. */
  readonly z?: number
  /** Default pixel-cluster stamp attached to this joint. */
  readonly stamp?: PixelStampSpec
  /** Named alternate stamp variants selectable per frame via `pose.variant`. */
  readonly variants?: Readonly<Record<string, PixelStampSpec>>
  /** Optional custom draw callback invoked at the joint's resolved world pivot `(wx, wy)`. */
  readonly draw?: (frame: SpriteFrame, wx: number, wy: number, angle: number) => void
}

export interface PixelRig {
  readonly joints: readonly PixelJoint[]
  readonly order: readonly number[]
  readonly drawOrder: readonly number[]
  readonly parentIndex: readonly number[]
}

export interface WorldPixelJoint {
  readonly x: number
  readonly y: number
  readonly rotation: number
}

/** Compile a hierarchical 2D pixel-art animation skeleton in topological parent-first order. */
export function createPixelRig(joints: readonly PixelJoint[]): PixelRig {
  const indexById = new Map<string, number>()
  for (let i = 0; i < joints.length; i++) {
    const id = joints[i].id
    if (!id || FORBIDDEN_JOINT_KEYS.has(id) || indexById.has(id)) throw new Error('Duplicate or invalid pixel rig joint id: ' + id)
    indexById.set(id, i)
  }
  const parentIndex = joints.map(j => {
    if (!j.parent) return -1
    const idx = indexById.get(j.parent)
    if (idx === undefined) throw new Error(`Unknown parent pixel joint "${j.parent}" for "${j.id}"`)
    return idx
  })
  const visited = new Uint8Array(joints.length)
  const order: number[] = []
  function visit(i: number) {
    if (visited[i] === 2) return
    if (visited[i] === 1) throw new Error('Cyclic pixel joint hierarchy detected at ' + joints[i].id)
    visited[i] = 1
    if (parentIndex[i] >= 0) visit(parentIndex[i])
    visited[i] = 2
    order.push(i)
  }
  for (let i = 0; i < joints.length; i++) visit(i)
  const drawOrder = Array.from({ length: joints.length }, (_, i) => i)
    .sort((a, b) => (joints[a].z ?? 0) - (joints[b].z ?? 0) || a - b)
  return { joints, order, drawOrder, parentIndex }
}

function drawRotatedStamp(
  frame: SpriteFrame,
  wx: number,
  wy: number,
  angle: number,
  spec: PixelStampSpec,
  palette: Readonly<Record<string, string | null>>
) {
  if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(angle)) return
  const ox = spec.offset?.[0] ?? 0
  const oy = spec.offset?.[1] ?? 0
  if (Math.abs(angle) < 1e-4) {
    frame.stamp(Math.round(wx + ox), Math.round(wy + oy), spec.rows, palette)
    return
  }
  // Inverse-mapped nearest-neighbor rotation keeps crisp pixel clusters with zero holes or anti-aliasing blur.
  const h = spec.rows.length
  let w = 0
  for (let r = 0; r < h; r++) if (spec.rows[r].length > w) w = spec.rows[r].length
  if (!w || !h) return
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const corners: [number, number][] = [
    [ox, oy], [ox + w, oy], [ox, oy + h], [ox + w, oy + h]
  ]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [cx, cy] of corners) {
    const rx = wx + cx * cos - cy * sin
    const ry = wy + cx * sin + cy * cos
    if (rx < minX) minX = rx; if (rx > maxX) maxX = rx
    if (ry < minY) minY = ry; if (ry > maxY) maxY = ry
  }
  const x0 = Math.floor(minX) - 1, x1 = Math.ceil(maxX) + 1
  const y0 = Math.floor(minY) - 1, y1 = Math.ceil(maxY) + 1
  for (let py = y0; py <= y1; py++) {
    const dy = py + 0.5 - wy
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - wx
      const lx = dx * cos + dy * sin - ox
      const ly = -dx * sin + dy * cos - oy
      const sx = Math.floor(lx), sy = Math.floor(ly)
      if (sy < 0 || sy >= h) continue
      const row = spec.rows[sy]
      if (sx < 0 || sx >= row.length) continue
      const ch = row[sx]
      if (ch === '.' || ch === ' ') continue
      if (!Object.hasOwn(palette, ch)) throw new RangeError(`Unknown stamp palette key "${ch}"`)
      frame.pixel(px, py, palette[ch])
    }
  }
}

/**
 * Evaluate 2D forward kinematics for a PixelRig, render every joint in z-order into `frame`,
 * optionally apply a unified exterior outline (`'selout'` or hex color), and return resolved joint pivots.
 */
export function renderPixelRig(
  frame: SpriteFrame,
  rig: PixelRig,
  root: Vec2,
  poses: Readonly<Record<string, PixelJointPose | undefined>>,
  palette: Readonly<Record<string, string | null>>,
  options: {
    outline?: string | false
    outlineMode?: '4-way' | '8-way' | 'selout'
    postDraw?: (frame: SpriteFrame, joints: Record<string, WorldPixelJoint>) => void
  } = {}
): Record<string, WorldPixelJoint> {
  const wx = new Float64Array(rig.joints.length)
  const wy = new Float64Array(rig.joints.length)
  const wr = new Float64Array(rig.joints.length)
  const out: Record<string, WorldPixelJoint> = {}

  for (const idx of rig.order) {
    const joint = rig.joints[idx]
    const pose = Object.hasOwn(poses, joint.id) ? poses[joint.id] : undefined
    const pIdx = rig.parentIndex[idx]
    const px = pIdx >= 0 ? wx[pIdx] : root[0]
    const py = pIdx >= 0 ? wy[pIdx] : root[1]
    const pr = pIdx >= 0 ? wr[pIdx] : 0
    const lx = (joint.pivot?.[0] ?? 0) + (pose?.offset?.[0] ?? 0)
    const ly = (joint.pivot?.[1] ?? 0) + (pose?.offset?.[1] ?? 0)
    const c = Math.cos(pr), s = Math.sin(pr)
    const x = px + lx * c - ly * s
    const y = py + lx * s + ly * c
    const r = pr + (pose?.rotation ?? 0)
    wx[idx] = x; wy[idx] = y; wr[idx] = r
    out[joint.id] = { x, y, rotation: r }
  }

  // Isolate outline pass onto a scratch frame when outlining so pre-existing scene pixels/rigs are never double-outlined.
  const useScratch = Boolean(options.outline) && Number.isSafeInteger(frame.width) && frame.width > 0 &&
    Number.isSafeInteger(frame.height) && frame.height > 0
  const scratchSheet = useScratch ? createSpriteSheet(frame.width, frame.height, 1, 1) : null
  const target = scratchSheet ? scratchSheet.frame(0, 0) : frame

  for (const idx of rig.drawOrder) {
    const joint = rig.joints[idx]
    const pose = Object.hasOwn(poses, joint.id) ? poses[joint.id] : undefined
    if (pose?.hidden) continue
    const spec = (pose?.variant && joint.variants && Object.hasOwn(joint.variants, pose.variant))
      ? joint.variants[pose.variant]
      : joint.stamp
    if (spec) drawRotatedStamp(target, wx[idx], wy[idx], wr[idx], spec, palette)
    if (joint.draw) joint.draw(target, wx[idx], wy[idx], wr[idx])
  }

  if (options.outline) {
    if (options.outline === 'selout' || options.outlineMode === 'selout') {
      target.outline(options.outline, { mode: 'selout', palette })
    } else {
      target.outline(options.outline, options.outlineMode ?? '4-way')
    }
  }
  if (scratchSheet) {
    const pxData = scratchSheet.pixels
    const sw = scratchSheet.width
    const sh = scratchSheet.height
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        const i = (py * sw + px) * 4
        const a = pxData[i + 3]
        if (a === 0) continue
        const hex = '#' + pxData[i].toString(16).padStart(2, '0') +
          pxData[i + 1].toString(16).padStart(2, '0') +
          pxData[i + 2].toString(16).padStart(2, '0') +
          (a < 255 ? a.toString(16).padStart(2, '0') : '')
        frame.pixel(px, py, hex)
      }
    }
  }
  if (options.postDraw) options.postDraw(frame, out)
  return out
}

/** Reusable indie 2D pixel-skeleton motion clip presets (contact/down/passing/up run, idle, heavy grounded breathe). */
export const pixelClips = {
  /** Generate a grounded 4-frame or 6-frame side-view biped run cycle with torso bounce, stride, shield swing, crest drag, and cape wave. */
  bipedRun(frames: 4 | 6 = 4, { stride = 3, bob = 1 }: { stride?: number; bob?: number } = {}): Record<string, PixelJointPose>[] {
    if (frames === 6) {
      const phases = [
        { by: 0, fl: [stride, 0], bl: [-stride, -1], arm: [-1, 0], sh: [1, 0], cr: [-1, 0], cape: 'f0' },
        { by: bob, fl: [1, 0], bl: [-1, 0], arm: [0, 0], sh: [0, 1], cr: [0, 0], cape: 'f1' },
        { by: -bob, fl: [-1, -1], bl: [2, -1], arm: [1, -1], sh: [-1, -1], cr: [1, -1], cape: 'f2' },
        { by: 0, fl: [-stride, -1], bl: [stride, 0], arm: [1, 0], sh: [-1, 0], cr: [-1, 0], cape: 'f3' },
        { by: bob, fl: [-1, 0], bl: [1, 0], arm: [0, 0], sh: [0, 1], cr: [0, 0], cape: 'f1' },
        { by: -bob, fl: [2, -1], bl: [-1, -1], arm: [-1, -1], sh: [1, -1], cr: [1, -1], cape: 'f2' }
      ] as const
      return phases.map((p, idx) => ({
        torso: { offset: [0, p.by] },
        head: { offset: [0, 0] },
        crest: { offset: [p.cr[0], p.cr[1]], variant: `f${idx % 4}` },
        cape: { offset: [0, 0], variant: p.cape },
        frontLeg: { offset: [p.fl[0], p.fl[1]], variant: `f${idx % 4}` },
        backLeg: { offset: [p.bl[0], p.bl[1]], variant: `f${(idx + 2) % 4}` },
        frontArm: { offset: [p.arm[0], p.arm[1]], variant: `f${idx % 4}` },
        shield: { offset: [p.sh[0], p.sh[1]] }
      }))
    }
    return [
      { // 0: Contact (wide stride — front leg extended forward, back leg kicked behind)
        torso: { offset: [0, 0] }, head: { offset: [0, 0] }, crest: { offset: [-1, 0], variant: 'f0' },
        cape: { offset: [0, 0], variant: 'f0' },
        frontLeg: { offset: [stride, 0], variant: 'f0' }, backLeg: { offset: [-stride, -1], variant: 'f2' },
        frontArm: { offset: [-1, 0], variant: 'f0' }, shield: { offset: [1, 0] }
      },
      { // 1: Down / Squash (knees bent under body)
        torso: { offset: [0, bob] }, head: { offset: [0, 0] }, crest: { offset: [-1, 1], variant: 'f1' },
        cape: { offset: [0, 0], variant: 'f1' },
        frontLeg: { offset: [1, 0], variant: 'f1' }, backLeg: { offset: [-1, 0], variant: 'f3' },
        frontArm: { offset: [0, 0], variant: 'f1' }, shield: { offset: [0, 1] }
      },
      { // 2: Passing (opposite stride — front leg back, back leg driving forward)
        torso: { offset: [0, 0] }, head: { offset: [0, 0] }, crest: { offset: [0, 0], variant: 'f2' },
        cape: { offset: [0, 0], variant: 'f2' },
        frontLeg: { offset: [-stride, -1], variant: 'f2' }, backLeg: { offset: [stride, 0], variant: 'f0' },
        frontArm: { offset: [1, 0], variant: 'f2' }, shield: { offset: [-1, 0] }
      },
      { // 3: Up / Stretch (push-off toe extension)
        torso: { offset: [0, -bob] }, head: { offset: [0, 0] }, crest: { offset: [1, -1], variant: 'f3' },
        cape: { offset: [0, 0], variant: 'f3' },
        frontLeg: { offset: [2, -1], variant: 'f3' }, backLeg: { offset: [-2, -1], variant: 'f1' },
        frontArm: { offset: [-1, -1], variant: 'f3' }, shield: { offset: [1, -1] }
      }
    ]
  },

  /** Heavy creature breathing idle: arms/fists & feet stay 100% planted while torso, shoulders, head, moss, and glowing runes heave. */
  heavyBreathe(frames: 2 | 4 = 2, { heave = 2 }: { heave?: number } = {}): Record<string, PixelJointPose>[] {
    if (frames === 4) {
      const midHeave = Math.round(heave / 2)
      return [
        { torso: { offset: [0, 0] }, head: { offset: [0, 0], variant: 'dim' }, moss: { offset: [0, 0], variant: 'f0' }, rune: { variant: 'dim' }, leftArm: { offset: [0, 0] }, rightArm: { offset: [0, 0] } },
        { torso: { offset: [0, -midHeave] }, head: { offset: [0, 0], variant: 'mid' }, moss: { offset: [0, 0], variant: 'f1' }, rune: { variant: 'mid' }, leftArm: { offset: [0, 0] }, rightArm: { offset: [0, 0] } },
        { torso: { offset: [0, -heave] }, head: { offset: [0, 0], variant: 'bright' }, moss: { offset: [0, 0], variant: 'f2' }, rune: { variant: 'bright' }, leftArm: { offset: [0, 0] }, rightArm: { offset: [0, 0] } },
        { torso: { offset: [0, -midHeave] }, head: { offset: [0, 0], variant: 'mid' }, moss: { offset: [0, 0], variant: 'f1' }, rune: { variant: 'mid' }, leftArm: { offset: [0, 0] }, rightArm: { offset: [0, 0] } }
      ]
    }
    return [
      { torso: { offset: [0, 0] }, head: { offset: [0, 0], variant: 'dim' }, moss: { offset: [0, 0], variant: 'f0' }, rune: { variant: 'dim' }, leftArm: { offset: [0, 0] }, rightArm: { offset: [0, 0] } },
      { torso: { offset: [0, -heave] }, head: { offset: [0, 0], variant: 'bright' }, moss: { offset: [0, 0], variant: 'f1' }, rune: { variant: 'bright' }, leftArm: { offset: [0, 0] }, rightArm: { offset: [0, 0] } }
    ]
  }
}
