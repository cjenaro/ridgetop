import { quaternionFromEuler, rotateVec3 } from './geometry.ts'
import { instances } from './instances.ts'
import type { BlendMode, Color, InstanceBatch, LowPolyRenderer, Mesh, Quaternion, Vec3 } from './types.ts'

export type Easing = 'linear' | 'smooth' | 'easeOut' | 'easeInOut'

export interface JointPose {
  readonly position?: Vec3
  readonly rotation?: readonly [pitch: number, yaw: number, roll: number]
  readonly scale?: Vec3
}

export interface RigPart {
  readonly name?: string
  readonly mesh: Mesh
  readonly position?: Vec3
  readonly scale?: Vec3
  readonly rotation?: readonly [pitch: number, yaw: number, roll: number]
  readonly color: Color
  readonly unlit?: number
}

export interface RigJoint {
  readonly id: string
  readonly parent?: string
  readonly pivot?: Vec3
  readonly parts?: readonly RigPart[]
}

export interface Rig {
  readonly joints: readonly RigJoint[]
  readonly order: readonly number[]
  readonly parentIndex: readonly number[]
}

export interface Keyframe {
  readonly t: number
  readonly position?: Vec3
  readonly rotation?: readonly [pitch: number, yaw: number, roll: number]
  readonly scale?: Vec3
  readonly ease?: Easing
}

export interface AnimationClip {
  readonly duration: number
  readonly loop?: boolean
  readonly tracks: Readonly<Record<string, readonly Keyframe[]>>
}

export interface MeshPool {
  readonly batches: readonly InstanceBatch[]
  clear(): void
  add(mesh: Mesh, position: Vec3, scale: Vec3, rotation: number | Quaternion, color: Color, unlit?: number, blend?: BlendMode): void
  release(renderer: LowPolyRenderer): void
}

const ZERO3: Vec3 = [0, 0, 0]
const ONE3: Vec3 = [1, 1, 1]
const IDENTITY_Q: Quaternion = [0, 0, 0, 1]

/** Multiply two XYZW quaternions (apply b first, then a). */
export function multiplyQuat(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]
}

function applyEase(t: number, ease: Easing = 'smooth'): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t
  if (ease === 'linear') return c
  if (ease === 'easeOut') return 1 - (1 - c) * (1 - c)
  if (ease === 'easeInOut') return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2
  return c * c * (3 - 2 * c)
}

function lerpVec3(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Reusable (Mesh, BlendMode) -> InstanceBatch pool for animated rigs and particles. */
export function createMeshPool(initialCapacity = 32): MeshPool {
  const batches: InstanceBatch[] = []
  const byMesh: Record<BlendMode, Map<Mesh, InstanceBatch>> = {
    opaque: new Map(),
    alpha: new Map(),
    additive: new Map()
  }
  return {
    batches,
    clear() {
      for (const batch of batches) batch.clear()
    },
    add(mesh, position, scale, rotation, color, unlit = 0, blend: BlendMode = 'opaque') {
      const bucket = byMesh[blend]
      let batch = bucket.get(mesh)
      if (!batch) {
        batch = instances(mesh, { capacity: initialCapacity, blend })
        bucket.set(mesh, batch)
        batches.push(batch)
      }
      batch.add(position, scale, rotation, color, unlit)
    },
    release(renderer) {
      for (const batch of batches) renderer.release(batch)
    }
  }
}

/** Compile a hierarchical skeleton of named joints in topological parent-first order. */
export function createRig(joints: readonly RigJoint[]): Rig {
  const indexById = new Map<string, number>()
  for (let i = 0; i < joints.length; i++) {
    const id = joints[i].id
    if (!id || indexById.has(id)) throw new Error('Duplicate or empty rig joint id: ' + id)
    indexById.set(id, i)
  }
  const parentIndex = joints.map(j => {
    if (!j.parent) return -1
    const idx = indexById.get(j.parent)
    if (idx === undefined) throw new Error(`Unknown parent joint "${j.parent}" for "${j.id}"`)
    return idx
  })
  const visited = new Uint8Array(joints.length)
  const order: number[] = []
  function visit(i: number) {
    if (visited[i] === 2) return
    if (visited[i] === 1) throw new Error('Cyclic joint hierarchy detected at ' + joints[i].id)
    visited[i] = 1
    if (parentIndex[i] >= 0) visit(parentIndex[i])
    visited[i] = 2
    order.push(i)
  }
  for (let i = 0; i < joints.length; i++) visit(i)
  return { joints, order, parentIndex }
}

export interface WorldJoint {
  readonly position: Vec3
  readonly rotation: Quaternion
  readonly scale: Vec3
}

/**
 * Evaluate forward kinematics for a Rig and emit all joint parts into a MeshPool.
 * Returns world transforms per joint id so callers can attach props or spawn particles at exact bones.
 */
export function renderRig(
  rig: Rig,
  root: { position: Vec3; yaw?: number; rotation?: Quaternion; scale?: number | Vec3 },
  poses: Readonly<Record<string, JointPose | undefined>>,
  pool: MeshPool,
  partColor?: (jointId: string, part: RigPart) => Color
): Record<string, WorldJoint> {
  const rootRot: Quaternion = root.rotation ?? quaternionFromEuler(0, root.yaw ?? 0, 0)
  const rootScale: Vec3 = typeof root.scale === 'number'
    ? [root.scale, root.scale, root.scale]
    : (root.scale ?? ONE3)

  const worldPos: Vec3[] = new Array(rig.joints.length)
  const worldRot: Quaternion[] = new Array(rig.joints.length)
  const worldScale: Vec3[] = new Array(rig.joints.length)
  const out: Record<string, WorldJoint> = {}

  for (const idx of rig.order) {
    const joint = rig.joints[idx]
    const pose = poses[joint.id]
    const pIdx = rig.parentIndex[idx]
    const pPos = pIdx >= 0 ? worldPos[pIdx] : root.position
    const pRot = pIdx >= 0 ? worldRot[pIdx] : rootRot
    const pScl = pIdx >= 0 ? worldScale[pIdx] : rootScale

    const piv = joint.pivot ?? ZERO3
    const off = pose?.position ?? ZERO3
    const localPos: Vec3 = [
      (piv[0] + off[0]) * pScl[0],
      (piv[1] + off[1]) * pScl[1],
      (piv[2] + off[2]) * pScl[2]
    ]
    const rOff = rotateVec3(pRot, localPos)
    const jPos: Vec3 = [pPos[0] + rOff[0], pPos[1] + rOff[1], pPos[2] + rOff[2]]

    const rotEuler = pose?.rotation
    const jLocalQ = rotEuler ? quaternionFromEuler(rotEuler[0], rotEuler[1], rotEuler[2]) : IDENTITY_Q
    const jRot = rotEuler ? multiplyQuat(pRot, jLocalQ) : pRot

    const ls = pose?.scale ?? ONE3
    const jScl: Vec3 = [pScl[0] * ls[0], pScl[1] * ls[1], pScl[2] * ls[2]]

    worldPos[idx] = jPos
    worldRot[idx] = jRot
    worldScale[idx] = jScl
    out[joint.id] = { position: jPos, rotation: jRot, scale: jScl }

    if (joint.parts) {
      for (const part of joint.parts) {
        const lp = part.position ?? ZERO3
        const ps = part.scale ?? ONE3
        const scaledOff: Vec3 = [lp[0] * jScl[0], lp[1] * jScl[1], lp[2] * jScl[2]]
        const rotPartOff = rotateVec3(jRot, scaledOff)
        const finalPos: Vec3 = [jPos[0] + rotPartOff[0], jPos[1] + rotPartOff[1], jPos[2] + rotPartOff[2]]
        const finalScale: Vec3 = [
          Math.max(1e-4, ps[0] * jScl[0]),
          Math.max(1e-4, ps[1] * jScl[1]),
          Math.max(1e-4, ps[2] * jScl[2])
        ]
        const finalRot = part.rotation
          ? multiplyQuat(jRot, quaternionFromEuler(part.rotation[0], part.rotation[1], part.rotation[2]))
          : jRot
        const tint = partColor ? partColor(joint.id, part) : part.color
        pool.add(part.mesh, finalPos, finalScale, finalRot, tint, part.unlit ?? 0)
      }
    }
  }
  return out
}

/** Sample a keyframe AnimationClip at time `seconds`. */
export function sampleClip(clip: AnimationClip, seconds: number): Record<string, JointPose> {
  const dur = Math.max(1e-4, clip.duration)
  const t = clip.loop === false
    ? Math.max(0, Math.min(dur, seconds))
    : ((seconds % dur) + dur) % dur

  const result: Record<string, JointPose> = {}
  for (const [jointId, frames] of Object.entries(clip.tracks)) {
    if (!frames.length) continue
    if (frames.length === 1) {
      const f = frames[0]
      result[jointId] = { position: f.position, rotation: f.rotation, scale: f.scale }
      continue
    }
    let a = frames[0], b = frames[frames.length - 1]
    for (let i = 0; i < frames.length - 1; i++) {
      if (t >= frames[i].t && t <= frames[i + 1].t) {
        a = frames[i]
        b = frames[i + 1]
        break
      }
    }
    if (t <= frames[0].t) { a = frames[0]; b = frames[0] }
    else if (t >= frames[frames.length - 1].t) { a = frames[frames.length - 1]; b = a }
    const span = b.t - a.t
    const alpha = span > 1e-6 ? applyEase((t - a.t) / span, b.ease ?? a.ease ?? 'smooth') : 0
    const pos = a.position || b.position ? lerpVec3(a.position ?? ZERO3, b.position ?? ZERO3, alpha) : undefined
    const rot = a.rotation || b.rotation ? lerpVec3(a.rotation ?? ZERO3, b.rotation ?? ZERO3, alpha) : undefined
    const scl = a.scale || b.scale ? lerpVec3(a.scale ?? ONE3, b.scale ?? ONE3, alpha) : undefined
    result[jointId] = { position: pos, rotation: rot, scale: scl }
  }
  return result
}

/** Blend two pose maps (0 = a, 1 = b) and optionally add procedural overrides. */
export function blendPoses(
  a: Readonly<Record<string, JointPose | undefined>>,
  b: Readonly<Record<string, JointPose | undefined>>,
  weight: number,
  additive?: Readonly<Record<string, JointPose | undefined>>
): Record<string, JointPose> {
  const t = Math.max(0, Math.min(1, weight))
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b), ...(additive ? Object.keys(additive) : [])])
  const out: Record<string, JointPose> = {}
  for (const key of keys) {
    const pa = a[key], pb = b[key], add = additive?.[key]
    const posA = pa?.position ?? ZERO3, posB = pb?.position ?? ZERO3
    const rotA = pa?.rotation ?? ZERO3, rotB = pb?.rotation ?? ZERO3
    const sclA = pa?.scale ?? ONE3, sclB = pb?.scale ?? ONE3
    const hasPos = Boolean(pa?.position || pb?.position || add?.position)
    const hasRot = Boolean(pa?.rotation || pb?.rotation || add?.rotation)
    const hasScl = Boolean(pa?.scale || pb?.scale || add?.scale)
    const pos = hasPos ? lerpVec3(posA, posB, t) : undefined
    const rot = hasRot ? lerpVec3(rotA, rotB, t) : undefined
    const scl = hasScl ? lerpVec3(sclA, sclB, t) : undefined
    if (pos && add?.position) { pos[0] += add.position[0]; pos[1] += add.position[1]; pos[2] += add.position[2] }
    if (rot && add?.rotation) { rot[0] += add.rotation[0]; rot[1] += add.rotation[1]; rot[2] += add.rotation[2] }
    if (scl && add?.scale) { scl[0] *= add.scale[0]; scl[1] *= add.scale[1]; scl[2] *= add.scale[2] }
    out[key] = { position: pos, rotation: rot, scale: scl }
  }
  return out
}

/** Stateful clip player with smooth cross-fades between clips. */
export function createAnimator<Name extends string>(
  clips: Readonly<Record<Name, AnimationClip>>,
  initial: NoInfer<Name>
) {
  let current: Name = initial
  let previous: Name | null = null
  let time = 0
  let prevTime = 0
  let fadeTime = 0
  let fadeDuration = 0
  let speed = 1

  return {
    get clip(): Name { return current },
    get time(): number { return time },
    play(next: Name, fade = 0.14, rate = 1) {
      speed = rate
      if (next === current) return
      previous = current
      prevTime = time
      current = next
      time = 0
      fadeTime = 0
      fadeDuration = Math.max(0, fade)
    },
    trigger(next: Name, fade = 0.08, rate = 1) {
      previous = current
      prevTime = time
      current = next
      time = 0
      fadeTime = 0
      fadeDuration = Math.max(0, fade)
      speed = rate
    },
    step(dt: number) {
      time += dt * speed
      if (previous !== null) {
        prevTime += dt
        fadeTime += dt
        if (fadeDuration <= 0 || fadeTime >= fadeDuration) previous = null
      }
    },
    evaluate(additive?: Readonly<Record<string, JointPose | undefined>>): Record<string, JointPose> {
      const curPose = sampleClip(clips[current], time)
      if (previous !== null && fadeDuration > 0) {
        const prevPose = sampleClip(clips[previous], prevTime)
        const alpha = applyEase(fadeTime / fadeDuration, 'smooth')
        return blendPoses(prevPose, curPose, alpha, additive)
      }
      return additive ? blendPoses(curPose, curPose, 1, additive) : curPose
    }
  }
}

interface Particle {
  mode: 'vel' | 'arc'
  mesh: Mesh
  blend: BlendMode
  alphaFade: boolean
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  tx: number; ty: number; tz: number
  peak: number
  gravity: number
  drag: number
  sx: number; sy: number; sz: number
  endScale: number
  yaw: number; spin: number
  color: Color
  unlit: number
  age: number
  life: number
}

/** Lightweight low-poly 3D particle & parabolic item-arc system. */
export function createParticles(maxParticles = 240) {
  const list: Particle[] = []

  function push(p: Particle) {
    if (list.length >= maxParticles) list.shift()
    list.push(p)
  }

  return {
    get count() { return list.length },
    clear() { list.length = 0 },
    spawn(opts: {
      mesh: Mesh
      blend?: BlendMode
      alphaFade?: boolean
      position: Vec3
      velocity?: Vec3
      gravity?: number
      drag?: number
      scale: Vec3
      endScale?: number
      yaw?: number
      spin?: number
      color: Color
      unlit?: number
      life: number
    }) {
      const v = opts.velocity ?? ZERO3
      push({
        mode: 'vel',
        mesh: opts.mesh,
        blend: opts.blend ?? 'opaque',
        alphaFade: opts.alphaFade ?? false,
        x: opts.position[0], y: opts.position[1], z: opts.position[2],
        vx: v[0], vy: v[1], vz: v[2],
        tx: 0, ty: 0, tz: 0, peak: 0,
        gravity: opts.gravity ?? 0,
        drag: opts.drag ?? 0,
        sx: opts.scale[0], sy: opts.scale[1], sz: opts.scale[2],
        endScale: opts.endScale ?? 0.05,
        yaw: opts.yaw ?? 0,
        spin: opts.spin ?? 0,
        color: opts.color,
        unlit: opts.unlit ?? 0,
        age: 0,
        life: Math.max(0.05, opts.life)
      })
    },
    arc(opts: {
      mesh: Mesh
      blend?: BlendMode
      from: Vec3
      to: Vec3
      peak?: number
      scale: Vec3
      endScale?: number
      spin?: number
      color: Color
      unlit?: number
      duration: number
    }) {
      push({
        mode: 'arc',
        mesh: opts.mesh,
        blend: opts.blend ?? 'opaque',
        alphaFade: false,
        x: opts.from[0], y: opts.from[1], z: opts.from[2],
        vx: opts.from[0], vy: opts.from[1], vz: opts.from[2],
        tx: opts.to[0], ty: opts.to[1], tz: opts.to[2],
        peak: opts.peak ?? 1.6,
        gravity: 0, drag: 0,
        sx: opts.scale[0], sy: opts.scale[1], sz: opts.scale[2],
        endScale: opts.endScale ?? 0.65,
        yaw: 0,
        spin: opts.spin ?? 6,
        color: opts.color,
        unlit: opts.unlit ?? 0.25,
        age: 0,
        life: Math.max(0.08, opts.duration)
      })
    },
    step(dt: number) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]
        p.age += dt
        if (p.age >= p.life) { list.splice(i, 1); continue }
        p.yaw += p.spin * dt
        if (p.mode === 'vel') {
          p.vy -= p.gravity * dt
          if (p.drag > 0) {
            const damp = Math.max(0, 1 - p.drag * dt)
            p.vx *= damp; p.vy *= damp; p.vz *= damp
          }
          p.x += p.vx * dt
          p.y += p.vy * dt
          p.z += p.vz * dt
        } else {
          const u = p.age / p.life
          p.x = p.vx + (p.tx - p.vx) * u
          p.z = p.vz + (p.tz - p.vz) * u
          p.y = p.vy + (p.ty - p.vy) * u + Math.sin(u * Math.PI) * p.peak
        }
      }
    },
    emit(pool: MeshPool) {
      for (const p of list) {
        const u = p.age / p.life
        const factor = p.mode === 'arc'
          ? 1 + Math.sin(u * Math.PI) * 0.22 - (1 - p.endScale) * u * 0.5
          : Math.max(0.02, 1 + (p.endScale - 1) * u)
        const tint: Color = p.alphaFade
          ? [p.color[0], p.color[1], p.color[2], p.color[3] * (1 - u)]
          : p.color
        pool.add(
          p.mesh,
          [p.x, p.y, p.z],
          [Math.max(0.01, p.sx * factor), Math.max(0.01, p.sy * factor), Math.max(0.01, p.sz * factor)],
          p.yaw,
          tint,
          p.unlit,
          p.blend
        )
      }
    }
  }
}
