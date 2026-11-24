import type { Vec3 } from './types.ts'

export interface Aabb {
  readonly min: Vec3
  readonly max: Vec3
}

export interface Sphere {
  readonly center: Vec3
  readonly radius: number
}

export interface Capsule {
  readonly a: Vec3
  readonly b: Vec3
  readonly radius: number
}

export interface Ray {
  readonly origin: Vec3
  readonly direction: Vec3
}

export interface SphereAabbHit {
  readonly hit: boolean
  readonly normal: Vec3
  readonly depth: number
  readonly push: Vec3
}

export interface SlideOptions {
  readonly maxIterations?: number
  readonly skinWidth?: number
  readonly groundNormalY?: number
}

export interface SlideResult {
  readonly position: Vec3
  readonly velocity: Vec3
  readonly hit: boolean
  readonly grounded: boolean
  readonly normals: Vec3[]
  readonly iterations: number
}

export interface CircleGridHit {
  readonly x: number
  readonly z: number
  readonly vx: number
  readonly vz: number
  readonly hit: boolean
  readonly normalX: number
  readonly normalZ: number
}

export interface RaycastHit {
  readonly hit: true
  readonly distance: number
  readonly point: Vec3
  readonly normal: Vec3
}

export type SpatialHashKey = string | number

export type SpatialRaycastHit<T, R extends { readonly distance: number } = RaycastHit> = R & {
  readonly id: SpatialHashKey
  readonly item: T
}

export interface SpatialHash<T> {
  readonly cellSize: number
  readonly size: number
  insert(id: SpatialHashKey, bounds: Aabb, item: T): boolean
  update(id: SpatialHashKey, bounds: Aabb, item?: T): boolean
  remove(id: SpatialHashKey): boolean
  has(id: SpatialHashKey): boolean
  clear(): void
  queryAabb(bounds: Aabb, out?: T[]): T[]
  queryRadius(center: Vec3, radius: number, out?: T[]): T[]
  raycast<R extends { readonly distance: number } = RaycastHit>(
    origin: Vec3,
    direction: Vec3,
    maxDist?: number,
    test?: (item: T, id: SpatialHashKey, bounds: Aabb, bestDist: number) => R | null | undefined
  ): SpatialRaycastHit<T, R> | null
}

const EPS = 1e-9
const SKIN_EPS = 1e-6
const DIR_EPS = 1e-12
const MAX_SUBSTEPS = 16
const MAX_SLIDE_ITERATIONS = 6
const STAMP_RESET_THRESHOLD = 1_000_000_000

function isFiniteVec3(v: Vec3): boolean {
  return Boolean(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])
}

function isValidAabb(aabb: Aabb): boolean {
  if (!aabb || !isFiniteVec3(aabb.min) || !isFiniteVec3(aabb.max)) return false
  return aabb.min[0] <= aabb.max[0] && aabb.min[1] <= aabb.max[1] && aabb.min[2] <= aabb.max[2]
}

function isValidSphere(sphere: Sphere): boolean {
  return Boolean(sphere) && isFiniteVec3(sphere.center) && Number.isFinite(sphere.radius) && sphere.radius >= 0
}

function isValidCapsule(capsule: Capsule): boolean {
  return Boolean(capsule) && isFiniteVec3(capsule.a) && isFiniteVec3(capsule.b) &&
    Number.isFinite(capsule.radius) && capsule.radius >= 0
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function pointAabbDistSq(px: number, py: number, pz: number, aabb: Aabb): number {
  const qx = clamp(px, aabb.min[0], aabb.max[0])
  const qy = clamp(py, aabb.min[1], aabb.max[1])
  const qz = clamp(pz, aabb.min[2], aabb.max[2])
  const dx = px - qx
  const dy = py - qy
  const dz = pz - qz
  return dx * dx + dy * dy + dz * dz
}

function closestPointOnSegmentDistSq(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  px: number, py: number, pz: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const lenSq = abx * abx + aby * aby + abz * abz
  let t = 0
  if (lenSq > 1e-24) {
    t = clamp(((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / lenSq, 0, 1)
  }
  const dx = px - (ax + abx * t)
  const dy = py - (ay + aby * t)
  const dz = pz - (az + abz * t)
  return dx * dx + dy * dy + dz * dz
}

function normalizeDirection(direction: Vec3): [number, number, number] | null {
  if (!isFiniteVec3(direction)) return null
  const len = Math.hypot(direction[0], direction[1], direction[2])
  if (!(len > DIR_EPS) || !Number.isFinite(len)) return null
  return [direction[0] / len, direction[1] / len, direction[2] / len]
}

/** Construct an axis-aligned bounding box from a center point and non-negative half-extents. */
export function aabbFromCenter(center: Vec3, halfSize: Vec3): Aabb {
  if (!isFiniteVec3(center) || !isFiniteVec3(halfSize) ||
      halfSize[0] < 0 || halfSize[1] < 0 || halfSize[2] < 0) {
    throw new RangeError('Expected finite center and non-negative finite halfSize')
  }
  return {
    min: [center[0] - halfSize[0], center[1] - halfSize[1], center[2] - halfSize[2]],
    max: [center[0] + halfSize[0], center[1] + halfSize[1], center[2] + halfSize[2]]
  }
}

/** Test whether a point lies inside or on the boundary of an AABB. */
export function aabbContainsPoint(aabb: Aabb, point: Vec3): boolean {
  if (!isValidAabb(aabb) || !isFiniteVec3(point)) return false
  return point[0] >= aabb.min[0] && point[0] <= aabb.max[0] &&
    point[1] >= aabb.min[1] && point[1] <= aabb.max[1] &&
    point[2] >= aabb.min[2] && point[2] <= aabb.max[2]
}

/** Test whether two AABBs overlap (inclusive of touching faces/edges). */
export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  if (!isValidAabb(a) || !isValidAabb(b)) return false
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
    a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
    a.min[2] <= b.max[2] && a.max[2] >= b.min[2]
}

/** Test whether a sphere overlaps or touches an AABB. */
export function sphereIntersectsAabb(sphere: Sphere, aabb: Aabb): boolean {
  if (!isValidSphere(sphere) || !isValidAabb(aabb)) return false
  const distSq = pointAabbDistSq(sphere.center[0], sphere.center[1], sphere.center[2], aabb)
  return distSq <= sphere.radius * sphere.radius
}

/** Test whether two spheres overlap or touch. */
export function sphereIntersectsSphere(a: Sphere, b: Sphere): boolean {
  if (!isValidSphere(a) || !isValidSphere(b)) return false
  const dx = a.center[0] - b.center[0]
  const dy = a.center[1] - b.center[1]
  const dz = a.center[2] - b.center[2]
  const r = a.radius + b.radius
  return dx * dx + dy * dy + dz * dz <= r * r
}

/** Test whether a capsule overlaps or touches a sphere. */
export function capsuleIntersectsSphere(capsule: Capsule, sphere: Sphere): boolean {
  if (!isValidCapsule(capsule) || !isValidSphere(sphere)) return false
  const distSq = closestPointOnSegmentDistSq(
    capsule.a[0], capsule.a[1], capsule.a[2],
    capsule.b[0], capsule.b[1], capsule.b[2],
    sphere.center[0], sphere.center[1], sphere.center[2]
  )
  const r = capsule.radius + sphere.radius
  return distSq <= r * r
}

/**
 * Exact capsule-vs-AABB intersection.
 * Squared distance from segment A + t*(B - A) to an AABB is a convex piecewise-quadratic
 * function of t on [0, 1] with at most 6 axis-plane breakpoints, so the global minimum is
 * solved analytically across each interval without iterative approximation error.
 */
export function capsuleIntersectsAabb(capsule: Capsule, aabb: Aabb): boolean {
  if (!isValidCapsule(capsule) || !isValidAabb(aabb)) return false
  const ax = capsule.a[0], ay = capsule.a[1], az = capsule.a[2]
  const dx = capsule.b[0] - ax
  const dy = capsule.b[1] - ay
  const dz = capsule.b[2] - az
  const rSq = capsule.radius * capsule.radius

  let minDistSq = pointAabbDistSq(ax, ay, az, aabb)
  if (minDistSq <= rSq) return true
  const endDistSq = pointAabbDistSq(capsule.b[0], capsule.b[1], capsule.b[2], aabb)
  if (endDistSq <= rSq) return true
  if (endDistSq < minDistSq) minDistSq = endDistSq

  if (dx * dx + dy * dy + dz * dz <= 1e-24) return false

  // Collect sorted breakpoints in [0, 1] where the segment crosses any AABB face plane.
  const breaks: number[] = [0, 1]
  if (Math.abs(dx) > DIR_EPS) {
    const t0 = (aabb.min[0] - ax) / dx
    if (t0 > 0 && t0 < 1) breaks.push(t0)
    const t1 = (aabb.max[0] - ax) / dx
    if (t1 > 0 && t1 < 1) breaks.push(t1)
  }
  if (Math.abs(dy) > DIR_EPS) {
    const t0 = (aabb.min[1] - ay) / dy
    if (t0 > 0 && t0 < 1) breaks.push(t0)
    const t1 = (aabb.max[1] - ay) / dy
    if (t1 > 0 && t1 < 1) breaks.push(t1)
  }
  if (Math.abs(dz) > DIR_EPS) {
    const t0 = (aabb.min[2] - az) / dz
    if (t0 > 0 && t0 < 1) breaks.push(t0)
    const t1 = (aabb.max[2] - az) / dz
    if (t1 > 0 && t1 < 1) breaks.push(t1)
  }

  // Insertion sort (at most 8 numbers).
  for (let i = 1; i < breaks.length; i++) {
    const value = breaks[i]
    let j = i - 1
    while (j >= 0 && breaks[j] > value) {
      breaks[j + 1] = breaks[j]
      j--
    }
    breaks[j + 1] = value
  }

  for (let i = 0; i < breaks.length - 1; i++) {
    const tLo = breaks[i]
    const tHi = breaks[i + 1]
    if (tHi - tLo <= 1e-12) continue
    const tm = 0.5 * (tLo + tHi)
    const mx = ax + dx * tm
    const my = ay + dy * tm
    const mz = az + dz * tm

    let num = 0
    let denom = 0
    if (mx < aabb.min[0]) {
      num += (aabb.min[0] - ax) * dx
      denom += dx * dx
    } else if (mx > aabb.max[0]) {
      num += (aabb.max[0] - ax) * dx
      denom += dx * dx
    }
    if (my < aabb.min[1]) {
      num += (aabb.min[1] - ay) * dy
      denom += dy * dy
    } else if (my > aabb.max[1]) {
      num += (aabb.max[1] - ay) * dy
      denom += dy * dy
    }
    if (mz < aabb.min[2]) {
      num += (aabb.min[2] - az) * dz
      denom += dz * dz
    } else if (mz > aabb.max[2]) {
      num += (aabb.max[2] - az) * dz
      denom += dz * dz
    }

    const tStar = denom > 1e-24 ? clamp(num / denom, tLo, tHi) : tm
    const dSq = pointAabbDistSq(ax + dx * tStar, ay + dy * tStar, az + dz * tStar, aabb)
    if (dSq <= rSq) return true
    if (dSq < minDistSq) minDistSq = dSq
  }

  return minDistSq <= rSq
}

/**
 * Compute minimum translation vector (MTV) pushing a sphere out of an AABB.
 * When the sphere center lies inside the box, pushes along the nearest exit face.
 */
export function resolveSphereAabb(sphere: Sphere, aabb: Aabb): SphereAabbHit {
  if (!isValidSphere(sphere) || !isValidAabb(aabb)) {
    return { hit: false, normal: [0, 0, 0], depth: 0, push: [0, 0, 0] }
  }
  const cx = sphere.center[0]
  const cy = sphere.center[1]
  const cz = sphere.center[2]
  const r = sphere.radius

  const qx = clamp(cx, aabb.min[0], aabb.max[0])
  const qy = clamp(cy, aabb.min[1], aabb.max[1])
  const qz = clamp(cz, aabb.min[2], aabb.max[2])

  const dx = cx - qx
  const dy = cy - qy
  const dz = cz - qz
  const distSq = dx * dx + dy * dy + dz * dz

  if (distSq > 0) {
    if (distSq >= r * r) {
      return { hit: false, normal: [0, 0, 0], depth: 0, push: [0, 0, 0] }
    }
    const dist = Math.sqrt(distSq)
    const inv = 1 / dist
    const nx = dx * inv
    const ny = dy * inv
    const nz = dz * inv
    const depth = r - dist
    return {
      hit: true,
      normal: [nx, ny, nz],
      depth,
      push: [nx * depth, ny * depth, nz * depth]
    }
  }

  // Sphere center is inside or on the surface of the AABB: exit through the nearest face.
  const dNegX = cx - aabb.min[0]
  const dPosX = aabb.max[0] - cx
  const dNegY = cy - aabb.min[1]
  const dPosY = aabb.max[1] - cy
  const dNegZ = cz - aabb.min[2]
  const dPosZ = aabb.max[2] - cz

  let minFace = dPosY
  let nx = 0, ny = 1, nz = 0

  if (dNegY < minFace) { minFace = dNegY; nx = 0; ny = -1; nz = 0 }
  if (dNegX < minFace) { minFace = dNegX; nx = -1; ny = 0; nz = 0 }
  if (dPosX < minFace) { minFace = dPosX; nx = 1; ny = 0; nz = 0 }
  if (dNegZ < minFace) { minFace = dNegZ; nx = 0; ny = 0; nz = -1 }
  if (dPosZ < minFace) { minFace = dPosZ; nx = 0; ny = 0; nz = 1 }

  const depth = minFace + r
  if (!(depth > 0)) {
    return { hit: false, normal: [0, 0, 0], depth: 0, push: [0, 0, 0] }
  }
  return {
    hit: true,
    normal: [nx, ny, nz],
    depth,
    push: [nx * depth, ny * depth, nz * depth]
  }
}

/**
 * Move and slide a sphere against AABB colliders using deepest-first iterative depenetration
 * and multi-plane velocity clipping so entities slide smoothly across tiled seams and into corners.
 */
export function slideSphere(
  position: Vec3,
  velocity: Vec3,
  radius: number,
  colliders: readonly Aabb[],
  dt = 1,
  options: SlideOptions = {}
): SlideResult {
  if (!isFiniteVec3(position) || !isFiniteVec3(velocity) || !Number.isFinite(radius) || radius < 0 || !Number.isFinite(dt) || dt < 0) {
    return {
      position: isFiniteVec3(position) ? [position[0], position[1], position[2]] : [0, 0, 0],
      velocity: isFiniteVec3(velocity) ? [velocity[0], velocity[1], velocity[2]] : [0, 0, 0],
      hit: false,
      grounded: false,
      normals: [],
      iterations: 0
    }
  }

  const maxIterations = Math.max(1, Math.floor(options.maxIterations ?? MAX_SLIDE_ITERATIONS))
  const skinWidth = Math.max(0, options.skinWidth ?? SKIN_EPS)
  const groundNormalY = options.groundNormalY ?? 0.7

  let px = position[0], py = position[1], pz = position[2]
  let vx = velocity[0], vy = velocity[1], vz = velocity[2]
  let hit = false
  let grounded = false
  let totalIterations = 0
  const normals: Vec3[] = []

  const moveDist = Math.hypot(vx * dt, vy * dt, vz * dt)
  const substeps = (dt > 0 && radius > 1e-6 && moveDist > radius * 0.5)
    ? Math.min(MAX_SUBSTEPS, Math.ceil(moveDist / (radius * 0.5)))
    : 1
  const stepDt = dt / substeps

  for (let s = 0; s < substeps; s++) {
    px += vx * stepDt
    py += vy * stepDt
    pz += vz * stepDt

    const stepNormals: Vec3[] = []

    for (let iter = 0; iter < maxIterations; iter++) {
      let bestDepth = 0
      let bestNx = 0, bestNy = 0, bestNz = 0

      const rSq = radius * radius
      for (let i = 0; i < colliders.length; i++) {
        const box = colliders[i]
        if (!isValidAabb(box)) continue
        const qx = clamp(px, box.min[0], box.max[0])
        const qy = clamp(py, box.min[1], box.max[1])
        const qz = clamp(pz, box.min[2], box.max[2])
        const dx = px - qx
        const dy = py - qy
        const dz = pz - qz
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq > 0) {
          if (distSq >= rSq) continue
          const dist = Math.sqrt(distSq)
          const depth = radius - dist
          if (depth > bestDepth) {
            const inv = 1 / dist
            bestDepth = depth
            bestNx = dx * inv
            bestNy = dy * inv
            bestNz = dz * inv
          }
        } else {
          const dNegX = px - box.min[0]
          const dPosX = box.max[0] - px
          const dNegY = py - box.min[1]
          const dPosY = box.max[1] - py
          const dNegZ = pz - box.min[2]
          const dPosZ = box.max[2] - pz
          let minFace = dPosY
          let nx = 0, ny = 1, nz = 0
          if (dNegY < minFace) { minFace = dNegY; nx = 0; ny = -1; nz = 0 }
          if (dNegX < minFace) { minFace = dNegX; nx = -1; ny = 0; nz = 0 }
          if (dPosX < minFace) { minFace = dPosX; nx = 1; ny = 0; nz = 0 }
          if (dNegZ < minFace) { minFace = dNegZ; nx = 0; ny = 0; nz = -1 }
          if (dPosZ < minFace) { minFace = dPosZ; nx = 0; ny = 0; nz = 1 }
          const depth = minFace + radius
          if (depth > bestDepth) {
            bestDepth = depth
            bestNx = nx
            bestNy = ny
            bestNz = nz
          }
        }
      }

      if (!(bestDepth > 0)) break

      totalIterations++
      hit = true
      const pushDist = bestDepth + skinWidth
      px += bestNx * pushDist
      py += bestNy * pushDist
      pz += bestNz * pushDist

      if (bestNy >= groundNormalY) grounded = true

      // Track unique normals for this substep and for the overall result.
      let seenInStep = false
      for (let i = 0; i < stepNormals.length; i++) {
        const n = stepNormals[i]
        if (n[0] * bestNx + n[1] * bestNy + n[2] * bestNz > 0.9999) {
          seenInStep = true
          break
        }
      }
      if (!seenInStep) stepNormals.push([bestNx, bestNy, bestNz])

      let seenGlobal = false
      for (let i = 0; i < normals.length; i++) {
        const n = normals[i]
        if (n[0] * bestNx + n[1] * bestNy + n[2] * bestNz > 0.9999) {
          seenGlobal = true
          break
        }
      }
      if (!seenGlobal) normals.push([bestNx, bestNy, bestNz])

      // Clip velocity against the contact plane(s) without bouncing.
      const vn = vx * bestNx + vy * bestNy + vz * bestNz
      if (vn < 0) {
        vx -= bestNx * vn
        vy -= bestNy * vn
        vz -= bestNz * vn
      }

      // If wedged against multiple distinct planes, constrain velocity to the crease or zero it.
      if (stepNormals.length === 2) {
        const n0 = stepNormals[0]
        const n1 = stepNormals[1]
        const into0 = vx * n0[0] + vy * n0[1] + vz * n0[2]
        const into1 = vx * n1[0] + vy * n1[1] + vz * n1[2]
        if (into0 < -1e-7 || into1 < -1e-7) {
          const cx = n0[1] * n1[2] - n0[2] * n1[1]
          const cy = n0[2] * n1[0] - n0[0] * n1[2]
          const cz = n0[0] * n1[1] - n0[1] * n1[0]
          const cLen = Math.hypot(cx, cy, cz)
          if (cLen > 1e-6) {
            const invC = 1 / cLen
            const dirX = cx * invC, dirY = cy * invC, dirZ = cz * invC
            const along = vx * dirX + vy * dirY + vz * dirZ
            vx = dirX * along
            vy = dirY * along
            vz = dirZ * along
          } else {
            vx = 0; vy = 0; vz = 0
          }
        }
      } else if (stepNormals.length >= 3) {
        let blocked = false
        for (let i = 0; i < stepNormals.length; i++) {
          const n = stepNormals[i]
          if (vx * n[0] + vy * n[1] + vz * n[2] < -1e-7) {
            blocked = true
            break
          }
        }
        if (blocked) {
          vx = 0; vy = 0; vz = 0
        }
      }
    }
  }

  return {
    position: [px, py, pz],
    velocity: [vx, vy, vz],
    hit,
    grounded,
    normals,
    iterations: totalIterations
  }
}

/**
 * Resolve a circle in the XZ plane against a uniform 2D tile grid (handling negative cells,
 * deepest-first depenetration, and slide-along-wall velocity projection).
 */
export function resolveCircleGrid(
  x: number,
  z: number,
  radius: number,
  cellSize: number,
  isSolid: (cx: number, cz: number) => boolean,
  vx = 0,
  vz = 0,
  dt = 0
): CircleGridHit {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('Grid cellSize must be a positive finite number')
  }
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0 ||
      !Number.isFinite(vx) || !Number.isFinite(vz) || !Number.isFinite(dt) || dt < 0) {
    return {
      x: Number.isFinite(x) ? x : 0,
      z: Number.isFinite(z) ? z : 0,
      vx: Number.isFinite(vx) ? vx : 0,
      vz: Number.isFinite(vz) ? vz : 0,
      hit: false,
      normalX: 0,
      normalZ: 0
    }
  }

  let px = x, pz = z
  let nvx = vx, nvz = vz
  let hit = false
  let lastNx = 0, lastNz = 0

  const moveDist = Math.hypot(nvx * dt, nvz * dt)
  const substeps = (dt > 0 && radius > 1e-6 && moveDist > radius * 0.5)
    ? Math.min(MAX_SUBSTEPS, Math.ceil(moveDist / (radius * 0.5)))
    : 1
  const stepDt = dt / substeps
  const invCell = 1 / cellSize

  for (let s = 0; s < substeps; s++) {
    px += nvx * stepDt
    pz += nvz * stepDt

    for (let iter = 0; iter < MAX_SLIDE_ITERATIONS; iter++) {
      const minCx = Math.floor((px - radius) * invCell)
      const maxCx = Math.floor((px + radius) * invCell)
      const minCz = Math.floor((pz - radius) * invCell)
      const maxCz = Math.floor((pz + radius) * invCell)

      let bestDepth = 0
      let bestNx = 0, bestNz = 0

      for (let cz = minCz; cz <= maxCz; cz++) {
        const boxMinZ = cz * cellSize
        const boxMaxZ = boxMinZ + cellSize
        for (let cx = minCx; cx <= maxCx; cx++) {
          if (!isSolid(cx, cz)) continue
          const boxMinX = cx * cellSize
          const boxMaxX = boxMinX + cellSize
          const qx = clamp(px, boxMinX, boxMaxX)
          const qz = clamp(pz, boxMinZ, boxMaxZ)
          const dx = px - qx
          const dz = pz - qz
          const distSq = dx * dx + dz * dz

          let depth = 0
          let nx = 0, nz = 0
          if (distSq > 0) {
            if (distSq >= radius * radius) continue
            const dist = Math.sqrt(distSq)
            depth = radius - dist
            nx = dx / dist
            nz = dz / dist
          } else {
            const dNegX = px - boxMinX
            const dPosX = boxMaxX - px
            const dNegZ = pz - boxMinZ
            const dPosZ = boxMaxZ - pz
            let minFace = dNegX
            nx = -1; nz = 0
            if (dPosX < minFace) { minFace = dPosX; nx = 1; nz = 0 }
            if (dNegZ < minFace) { minFace = dNegZ; nx = 0; nz = -1 }
            if (dPosZ < minFace) { minFace = dPosZ; nx = 0; nz = 1 }
            depth = minFace + radius
          }

          if (depth > bestDepth) {
            bestDepth = depth
            bestNx = nx
            bestNz = nz
          }
        }
      }

      if (!(bestDepth > 0)) break

      hit = true
      const pushDist = bestDepth + SKIN_EPS
      px += bestNx * pushDist
      pz += bestNz * pushDist
      lastNx = bestNx
      lastNz = bestNz

      const vn = nvx * bestNx + nvz * bestNz
      if (vn < 0) {
        nvx -= bestNx * vn
        nvz -= bestNz * vn
      }
    }
  }

  return { x: px, z: pz, vx: nvx, vz: nvz, hit, normalX: lastNx, normalZ: lastNz }
}

/** Ray-vs-AABB intersection (slab method). Handles parallel rays, grazing edges, and inside-box starts. */
export function raycastAabb(
  origin: Vec3,
  direction: Vec3,
  aabb: Aabb,
  maxDist = Infinity
): RaycastHit | null {
  if (!isFiniteVec3(origin) || !isValidAabb(aabb) || !(maxDist >= 0) || Number.isNaN(maxDist)) return null
  const dir = normalizeDirection(direction)
  if (!dir) return null

  const ox = origin[0], oy = origin[1], oz = origin[2]
  const dx = dir[0], dy = dir[1], dz = dir[2]

  let tMin = -Infinity
  let tMax = maxDist
  let nx = 0, ny = 0, nz = 0

  // X slab
  if (Math.abs(dx) <= DIR_EPS) {
    if (ox < aabb.min[0] || ox > aabb.max[0]) return null
  } else {
    const inv = 1 / dx
    let t1 = (aabb.min[0] - ox) * inv
    let t2 = (aabb.max[0] - ox) * inv
    let sign = -1
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp
      sign = 1
    }
    if (t1 > tMin) {
      tMin = t1
      nx = sign; ny = 0; nz = 0
    }
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }

  // Y slab
  if (Math.abs(dy) <= DIR_EPS) {
    if (oy < aabb.min[1] || oy > aabb.max[1]) return null
  } else {
    const inv = 1 / dy
    let t1 = (aabb.min[1] - oy) * inv
    let t2 = (aabb.max[1] - oy) * inv
    let sign = -1
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp
      sign = 1
    }
    if (t1 > tMin) {
      tMin = t1
      nx = 0; ny = sign; nz = 0
    }
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }

  // Z slab
  if (Math.abs(dz) <= DIR_EPS) {
    if (oz < aabb.min[2] || oz > aabb.max[2]) return null
  } else {
    const inv = 1 / dz
    let t1 = (aabb.min[2] - oz) * inv
    let t2 = (aabb.max[2] - oz) * inv
    let sign = -1
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp
      sign = 1
    }
    if (t1 > tMin) {
      tMin = t1
      nx = 0; ny = 0; nz = sign
    }
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }

  if (tMax < 0 || tMin > maxDist) return null

  // Ray starts strictly inside the AABB.
  if (tMin < 0) {
    return {
      hit: true,
      distance: 0,
      point: [ox, oy, oz],
      normal: [-dx, -dy, -dz]
    }
  }

  return {
    hit: true,
    distance: tMin,
    point: [ox + dx * tMin, oy + dy * tMin, oz + dz * tMin],
    normal: [nx, ny, nz]
  }
}

/** Ray-vs-Sphere intersection. Handles inside-sphere starts and tangent rays. */
export function raycastSphere(
  origin: Vec3,
  direction: Vec3,
  sphere: Sphere,
  maxDist = Infinity
): RaycastHit | null {
  if (!isFiniteVec3(origin) || !isValidSphere(sphere) || !(maxDist >= 0) || Number.isNaN(maxDist)) return null
  const dir = normalizeDirection(direction)
  if (!dir) return null

  const ox = origin[0], oy = origin[1], oz = origin[2]
  const dx = dir[0], dy = dir[1], dz = dir[2]
  const mx = ox - sphere.center[0]
  const my = oy - sphere.center[1]
  const mz = oz - sphere.center[2]
  const r = sphere.radius

  const mSq = mx * mx + my * my + mz * mz
  const c = mSq - r * r

  if (c <= 0) {
    if (mSq > 1e-12 && c >= -1e-9) {
      const inv = 1 / Math.sqrt(mSq)
      return {
        hit: true,
        distance: 0,
        point: [ox, oy, oz],
        normal: [mx * inv, my * inv, mz * inv]
      }
    }
    return {
      hit: true,
      distance: 0,
      point: [ox, oy, oz],
      normal: [-dx, -dy, -dz]
    }
  }

  const b = mx * dx + my * dy + mz * dz
  if (b > 0) return null

  const disc = b * b - c
  if (disc < 0) return null

  const t = -b - Math.sqrt(disc)
  if (t < 0 || t > maxDist) return null

  const px = ox + dx * t
  const py = oy + dy * t
  const pz = oz + dz * t

  let nx = -dx, ny = -dy, nz = -dz
  if (r > DIR_EPS) {
    const rx = px - sphere.center[0]
    const ry = py - sphere.center[1]
    const rz = pz - sphere.center[2]
    const len = Math.hypot(rx, ry, rz)
    if (len > DIR_EPS) {
      nx = rx / len
      ny = ry / len
      nz = rz / len
    }
  }

  return {
    hit: true,
    distance: t,
    point: [px, py, pz],
    normal: [nx, ny, nz]
  }
}

/**
 * Ray-vs-Triangle intersection (Möller–Trumbore).
 * Uses CCW front-face winding (`cross(b - a, c - a)`). Set `cullBackface = true` to ignore CW back faces.
 */
export function raycastTriangle(
  origin: Vec3,
  direction: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  maxDist = Infinity,
  cullBackface = false
): RaycastHit | null {
  if (!isFiniteVec3(origin) || !isFiniteVec3(a) || !isFiniteVec3(b) || !isFiniteVec3(c) ||
      !(maxDist >= 0) || Number.isNaN(maxDist)) return null
  const dir = normalizeDirection(direction)
  if (!dir) return null

  const dx = dir[0], dy = dir[1], dz = dir[2]
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2]
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2]

  // pvec = dir x e2
  const px = dy * e2z - dz * e2y
  const py = dz * e2x - dx * e2z
  const pz = dx * e2y - dy * e2x

  const det = e1x * px + e1y * py + e1z * pz
  if (cullBackface) {
    if (det <= EPS) return null
  } else {
    if (Math.abs(det) <= EPS) return null
  }

  const invDet = 1 / det
  const tx = origin[0] - a[0]
  const ty = origin[1] - a[1]
  const tz = origin[2] - a[2]

  const u = (tx * px + ty * py + tz * pz) * invDet
  if (u < -EPS || u > 1 + EPS) return null

  // qvec = tvec x e1
  const qx = ty * e1z - tz * e1y
  const qy = tz * e1x - tx * e1z
  const qz = tx * e1y - ty * e1x

  const v = (dx * qx + dy * qy + dz * qz) * invDet
  if (v < -EPS || u + v > 1 + EPS) return null

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet
  if (t < 0 || t > maxDist) return null

  // Geometric CCW normal = normalize(e1 x e2); flip to face the ray when double-sided.
  let nx = e1y * e2z - e1z * e2y
  let ny = e1z * e2x - e1x * e2z
  let nz = e1x * e2y - e1y * e2x
  const nLen = Math.hypot(nx, ny, nz)
  if (!(nLen > DIR_EPS)) return null
  const invN = (det < 0 ? -1 : 1) / nLen
  nx *= invN
  ny *= invN
  nz *= invN

  return {
    hit: true,
    distance: t,
    point: [origin[0] + dx * t, origin[1] + dy * t, origin[2] + dz * t],
    normal: [nx, ny, nz]
  }
}

interface HashEntry<T> {
  id: SpatialHashKey
  item: T
  bounds: Aabb
  minCx: number
  minCy: number
  minCz: number
  maxCx: number
  maxCy: number
  maxCz: number
  stamp: number
}

function cellKey(cx: number, cy: number, cz: number): string {
  return cx + ',' + cy + ',' + cz
}

function clearArray<T>(arr: T[]): void {
  while (arr.length > 0) arr.pop()
}

/**
 * Create a 3D broadphase spatial hash grid for fast AABB, radius, and 3D-DDA raycast queries.
 * Handles negative coordinates, deduplicates multi-cell entries without per-query Set allocations,
 * and guards against invalid/non-finite inputs.
 */
export function createSpatialHash<T>(cellSize: number): SpatialHash<T> {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('SpatialHash cellSize must be a positive finite number')
  }

  const invCell = 1 / cellSize
  const entries = new Map<SpatialHashKey, HashEntry<T>>()
  const cells = new Map<string, HashEntry<T>[]>()
  let queryStamp = 0
  let boundsDirty = false
  let worldMinX = Infinity, worldMinY = Infinity, worldMinZ = Infinity
  let worldMaxX = -Infinity, worldMaxY = -Infinity, worldMaxZ = -Infinity

  function nextStamp(): number {
    queryStamp++
    if (queryStamp >= STAMP_RESET_THRESHOLD) {
      for (const entry of entries.values()) entry.stamp = 0
      queryStamp = 1
    }
    return queryStamp
  }

  function addToCells(entry: HashEntry<T>): void {
    for (let cx = entry.minCx; cx <= entry.maxCx; cx++) {
      for (let cy = entry.minCy; cy <= entry.maxCy; cy++) {
        for (let cz = entry.minCz; cz <= entry.maxCz; cz++) {
          const key = cellKey(cx, cy, cz)
          let bucket = cells.get(key)
          if (!bucket) {
            bucket = []
            cells.set(key, bucket)
          }
          bucket.push(entry)
        }
      }
    }
  }

  function removeFromCells(entry: HashEntry<T>): void {
    for (let cx = entry.minCx; cx <= entry.maxCx; cx++) {
      for (let cy = entry.minCy; cy <= entry.maxCy; cy++) {
        for (let cz = entry.minCz; cz <= entry.maxCz; cz++) {
          const key = cellKey(cx, cy, cz)
          const bucket = cells.get(key)
          if (!bucket) continue
          const idx = bucket.indexOf(entry)
          if (idx >= 0) {
            const last = bucket.length - 1
            if (idx !== last) bucket[idx] = bucket[last]
            bucket.pop()
            if (bucket.length === 0) cells.delete(key)
          }
        }
      }
    }
  }

  function expandWorldBounds(b: Aabb): void {
    if (b.min[0] < worldMinX) worldMinX = b.min[0]
    if (b.min[1] < worldMinY) worldMinY = b.min[1]
    if (b.min[2] < worldMinZ) worldMinZ = b.min[2]
    if (b.max[0] > worldMaxX) worldMaxX = b.max[0]
    if (b.max[1] > worldMaxY) worldMaxY = b.max[1]
    if (b.max[2] > worldMaxZ) worldMaxZ = b.max[2]
  }

  function recomputeWorldBounds(): void {
    worldMinX = Infinity; worldMinY = Infinity; worldMinZ = Infinity
    worldMaxX = -Infinity; worldMaxY = -Infinity; worldMaxZ = -Infinity
    for (const entry of entries.values()) {
      expandWorldBounds(entry.bounds)
    }
    boundsDirty = false
  }

  function insertNewEntry(id: SpatialHashKey, bounds: Aabb, item: T): boolean {
    const copy: Aabb = {
      min: [bounds.min[0], bounds.min[1], bounds.min[2]],
      max: [bounds.max[0], bounds.max[1], bounds.max[2]]
    }
    const entry: HashEntry<T> = {
      id,
      item,
      bounds: copy,
      minCx: Math.floor(copy.min[0] * invCell),
      minCy: Math.floor(copy.min[1] * invCell),
      minCz: Math.floor(copy.min[2] * invCell),
      maxCx: Math.floor(copy.max[0] * invCell),
      maxCy: Math.floor(copy.max[1] * invCell),
      maxCz: Math.floor(copy.max[2] * invCell),
      stamp: 0
    }
    entries.set(id, entry)
    addToCells(entry)
    if (!boundsDirty) expandWorldBounds(copy)
    return true
  }

  function updateExistingEntry(entry: HashEntry<T>, bounds: Aabb, item?: T): boolean {
    const oldBounds = entry.bounds
    if (!boundsDirty && (
      oldBounds.min[0] <= worldMinX || oldBounds.min[1] <= worldMinY || oldBounds.min[2] <= worldMinZ ||
      oldBounds.max[0] >= worldMaxX || oldBounds.max[1] >= worldMaxY || oldBounds.max[2] >= worldMaxZ
    )) {
      boundsDirty = true
    }

    const minCx = Math.floor(bounds.min[0] * invCell)
    const minCy = Math.floor(bounds.min[1] * invCell)
    const minCz = Math.floor(bounds.min[2] * invCell)
    const maxCx = Math.floor(bounds.max[0] * invCell)
    const maxCy = Math.floor(bounds.max[1] * invCell)
    const maxCz = Math.floor(bounds.max[2] * invCell)

    const copy: Aabb = {
      min: [bounds.min[0], bounds.min[1], bounds.min[2]],
      max: [bounds.max[0], bounds.max[1], bounds.max[2]]
    }
    if (item !== undefined) entry.item = item

    if (minCx !== entry.minCx || minCy !== entry.minCy || minCz !== entry.minCz ||
        maxCx !== entry.maxCx || maxCy !== entry.maxCy || maxCz !== entry.maxCz) {
      removeFromCells(entry)
      entry.minCx = minCx
      entry.minCy = minCy
      entry.minCz = minCz
      entry.maxCx = maxCx
      entry.maxCy = maxCy
      entry.maxCz = maxCz
      entry.bounds = copy
      addToCells(entry)
    } else {
      entry.bounds = copy
    }

    if (!boundsDirty) expandWorldBounds(copy)
    return true
  }

  function insert(id: SpatialHashKey, bounds: Aabb, item: T): boolean {
    if (!isValidAabb(bounds)) return false
    const existing = entries.get(id)
    if (existing) return updateExistingEntry(existing, bounds, item)
    return insertNewEntry(id, bounds, item)
  }

  function update(id: SpatialHashKey, bounds: Aabb, item?: T): boolean {
    if (!isValidAabb(bounds)) return false
    const existing = entries.get(id)
    if (!existing) {
      if (item === undefined) return false
      return insertNewEntry(id, bounds, item)
    }
    return updateExistingEntry(existing, bounds, item)
  }

  function remove(id: SpatialHashKey): boolean {
    const entry = entries.get(id)
    if (!entry) return false
    removeFromCells(entry)
    entries.delete(id)
    boundsDirty = true
    return true
  }

  function has(id: SpatialHashKey): boolean {
    return entries.has(id)
  }

  function clear(): void {
    entries.clear()
    cells.clear()
    queryStamp = 0
    boundsDirty = false
    worldMinX = Infinity; worldMinY = Infinity; worldMinZ = Infinity
    worldMaxX = -Infinity; worldMaxY = -Infinity; worldMaxZ = -Infinity
  }

  function queryAabb(bounds: Aabb, out?: T[]): T[] {
    const result = out ?? []
    if (out) clearArray(result)
    if (!isValidAabb(bounds) || entries.size === 0) return result

    const stamp = nextStamp()
    const minCx = Math.floor(bounds.min[0] * invCell)
    const minCy = Math.floor(bounds.min[1] * invCell)
    const minCz = Math.floor(bounds.min[2] * invCell)
    const maxCx = Math.floor(bounds.max[0] * invCell)
    const maxCy = Math.floor(bounds.max[1] * invCell)
    const maxCz = Math.floor(bounds.max[2] * invCell)

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const bucket = cells.get(cellKey(cx, cy, cz))
          if (!bucket) continue
          for (let i = 0; i < bucket.length; i++) {
            const entry = bucket[i]
            if (entry.stamp === stamp) continue
            entry.stamp = stamp
            if (aabbIntersects(entry.bounds, bounds)) {
              result.push(entry.item)
            }
          }
        }
      }
    }
    return result
  }

  function queryRadius(center: Vec3, radius: number, out?: T[]): T[] {
    const result = out ?? []
    if (out) clearArray(result)
    if (!isFiniteVec3(center) || !Number.isFinite(radius) || radius < 0 || entries.size === 0) return result

    const stamp = nextStamp()
    const minCx = Math.floor((center[0] - radius) * invCell)
    const minCy = Math.floor((center[1] - radius) * invCell)
    const minCz = Math.floor((center[2] - radius) * invCell)
    const maxCx = Math.floor((center[0] + radius) * invCell)
    const maxCy = Math.floor((center[1] + radius) * invCell)
    const maxCz = Math.floor((center[2] + radius) * invCell)
    const rSq = radius * radius

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const bucket = cells.get(cellKey(cx, cy, cz))
          if (!bucket) continue
          for (let i = 0; i < bucket.length; i++) {
            const entry = bucket[i]
            if (entry.stamp === stamp) continue
            entry.stamp = stamp
            if (pointAabbDistSq(center[0], center[1], center[2], entry.bounds) <= rSq) {
              result.push(entry.item)
            }
          }
        }
      }
    }
    return result
  }

  function raycast<R extends { readonly distance: number } = RaycastHit>(
    origin: Vec3,
    direction: Vec3,
    maxDist = Infinity,
    test?: (item: T, id: SpatialHashKey, bounds: Aabb, bestDist: number) => R | null | undefined
  ): SpatialRaycastHit<T, R> | null {
    if (!isFiniteVec3(origin) || !(maxDist >= 0) || Number.isNaN(maxDist) || entries.size === 0) return null
    const dir = normalizeDirection(direction)
    if (!dir) return null

    if (boundsDirty) recomputeWorldBounds()

    const ox = origin[0], oy = origin[1], oz = origin[2]
    const dx = dir[0], dy = dir[1], dz = dir[2]

    // Clip ray segment [0, maxDist] to the occupied world bounding box so 3D DDA always has finite range.
    let tStart = 0
    let tEnd = maxDist

    if (Math.abs(dx) <= DIR_EPS) {
      if (ox < worldMinX || ox > worldMaxX) return null
    } else {
      const inv = 1 / dx
      let t1 = (worldMinX - ox) * inv
      let t2 = (worldMaxX - ox) * inv
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tStart) tStart = t1
      if (t2 < tEnd) tEnd = t2
      if (tStart > tEnd) return null
    }

    if (Math.abs(dy) <= DIR_EPS) {
      if (oy < worldMinY || oy > worldMaxY) return null
    } else {
      const inv = 1 / dy
      let t1 = (worldMinY - oy) * inv
      let t2 = (worldMaxY - oy) * inv
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tStart) tStart = t1
      if (t2 < tEnd) tEnd = t2
      if (tStart > tEnd) return null
    }

    if (Math.abs(dz) <= DIR_EPS) {
      if (oz < worldMinZ || oz > worldMaxZ) return null
    } else {
      const inv = 1 / dz
      let t1 = (worldMinZ - oz) * inv
      let t2 = (worldMaxZ - oz) * inv
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tStart) tStart = t1
      if (t2 < tEnd) tEnd = t2
      if (tStart > tEnd) return null
    }

    if (!Number.isFinite(tStart) || !Number.isFinite(tEnd) || tEnd < 0) return null

    const sx = ox + dx * tStart
    const sy = oy + dy * tStart
    const sz = oz + dz * tStart

    let cx = Math.floor(sx * invCell)
    let cy = Math.floor(sy * invCell)
    let cz = Math.floor(sz * invCell)

    const stepX = dx > DIR_EPS ? 1 : dx < -DIR_EPS ? -1 : 0
    const stepY = dy > DIR_EPS ? 1 : dy < -DIR_EPS ? -1 : 0
    const stepZ = dz > DIR_EPS ? 1 : dz < -DIR_EPS ? -1 : 0

    const tDeltaX = stepX !== 0 ? Math.abs(cellSize / dx) : Infinity
    const tDeltaY = stepY !== 0 ? Math.abs(cellSize / dy) : Infinity
    const tDeltaZ = stepZ !== 0 ? Math.abs(cellSize / dz) : Infinity

    let tMaxX = stepX > 0
      ? tStart + ((cx + 1) * cellSize - sx) / dx
      : stepX < 0
        ? tStart + (cx * cellSize - sx) / dx
        : Infinity
    let tMaxY = stepY > 0
      ? tStart + ((cy + 1) * cellSize - sy) / dy
      : stepY < 0
        ? tStart + (cy * cellSize - sy) / dy
        : Infinity
    let tMaxZ = stepZ > 0
      ? tStart + ((cz + 1) * cellSize - sz) / dz
      : stepZ < 0
        ? tStart + (cz * cellSize - sz) / dz
        : Infinity

    const maxSteps = Math.max(
      1,
      (Math.floor(worldMaxX * invCell) - Math.floor(worldMinX * invCell) + 4) +
      (Math.floor(worldMaxY * invCell) - Math.floor(worldMinY * invCell) + 4) +
      (Math.floor(worldMaxZ * invCell) - Math.floor(worldMinZ * invCell) + 4)
    )

    const stamp = nextStamp()
    let bestDist = maxDist
    let bestHit: R | null = null
    let bestEntry: HashEntry<T> | null = null

    for (let step = 0; step <= maxSteps; step++) {
      const bucket = cells.get(cellKey(cx, cy, cz))
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          const entry = bucket[i]
          if (entry.stamp === stamp) continue
          entry.stamp = stamp
          const res = test
            ? test(entry.item, entry.id, entry.bounds, bestDist)
            : (raycastAabb(origin, dir, entry.bounds, bestDist) as unknown as R | null)
          if (res && Number.isFinite(res.distance) && res.distance >= 0 && res.distance <= bestDist) {
            if (!bestHit || res.distance < bestDist) {
              bestDist = res.distance
              bestHit = res
              bestEntry = entry
            }
          }
        }
      }

      const tNext = tMaxX <= tMaxY
        ? (tMaxX <= tMaxZ ? tMaxX : tMaxZ)
        : (tMaxY <= tMaxZ ? tMaxY : tMaxZ)

      // Safe early exit: every remaining unvisited cell starts at t >= tNext.
      const limit = bestDist < tEnd ? bestDist : tEnd
      if (!Number.isFinite(tNext) || tNext > limit + EPS) break

      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        cx += stepX
        tMaxX += tDeltaX
      } else if (tMaxY <= tMaxZ) {
        cy += stepY
        tMaxY += tDeltaY
      } else {
        cz += stepZ
        tMaxZ += tDeltaZ
      }
    }

    if (!bestHit || !bestEntry) return null
    return { ...bestHit, id: bestEntry.id, item: bestEntry.item }
  }

  return {
    cellSize,
    get size() { return entries.size },
    insert,
    update,
    remove,
    has,
    clear,
    queryAabb,
    queryRadius,
    raycast
  }
}
