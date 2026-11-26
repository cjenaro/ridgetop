import { INSTANCE_SIZE } from './instances.ts'
import { getKnownShapeName, getMeshMeta } from './testing-runtime.ts'
import type { Picked3DInstance, RecognizedAsset, RecognizedMember } from './testing-runtime.ts'
import type { Color, InstanceBatch, InstanceTag, Matrix, Quaternion, Vec3 } from './types.ts'

export interface WorldAabb {
  min: [number, number, number]
  max: [number, number, number]
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  const hex = (v: number) => clamp(v).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function readInstanceTransform(batch: InstanceBatch, index: number) {
  const d = batch.data
  const at = index * INSTANCE_SIZE
  const position: Vec3 = [d[at], d[at + 1], d[at + 2]]
  const alpha = d[at + 3]
  const scale: Vec3 = [d[at + 4], d[at + 5], d[at + 6]]
  const color: Color = [d[at + 8], d[at + 9], d[at + 10], alpha]
  const unlit = d[at + 11]
  const rotation: Quaternion = [d[at + 12], d[at + 13], d[at + 14], d[at + 15]]
  return { position, scale, rotation, color, unlit }
}

/** Compute the world-space axis-aligned bounding box of a single packed instance slot. */
export function instanceWorldAabb(batch: InstanceBatch, index: number): WorldAabb {
  const { position: [x, y, z], scale: [sx, sy, sz], rotation: [qx, qy, qz, qw] } = readInstanceTransform(batch, index)
  const a = 1 - 2 * (qy * qy + qz * qz), b = 2 * (qx * qy - qz * qw), c = 2 * (qx * qz + qy * qw)
  const d = 2 * (qx * qy + qz * qw), e = 1 - 2 * (qx * qx + qz * qz), f = 2 * (qy * qz - qx * qw)
  const g = 2 * (qx * qz - qy * qw), h = 2 * (qy * qz + qx * qw), k = 1 - 2 * (qx * qx + qy * qy)
  const verts = batch.mesh.data
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < verts.length; i += 6) {
    const vx = verts[i] * sx, vy = verts[i + 1] * sy, vz = verts[i + 2] * sz
    const wx = x + a * vx + b * vy + c * vz
    const wy = y + d * vx + e * vy + f * vz
    const wz = z + g * vx + h * vy + k * vz
    if (wx < minX) minX = wx
    if (wy < minY) minY = wy
    if (wz < minZ) minZ = wz
    if (wx > maxX) maxX = wx
    if (wy > maxY) maxY = wy
    if (wz > maxZ) maxZ = wz
  }
  if (!Number.isFinite(minX)) {
    const r = batch.mesh.radius * Math.max(sx, sy, sz)
    return { min: [x - r, y - r, z - r], max: [x + r, y + r, z + r] }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

function aabbIntersectsExpanded(
  a: { min: readonly number[]; max: readonly number[] },
  b: { min: readonly number[]; max: readonly number[] },
  margin: number
): boolean {
  return a.min[0] - margin <= b.max[0] && a.max[0] + margin >= b.min[0] &&
    a.min[1] - margin <= b.max[1] && a.max[1] + margin >= b.min[1] &&
    a.min[2] - margin <= b.max[2] && a.max[2] + margin >= b.min[2]
}

/** Project a world-space AABB through a view-projection matrix into clamped `[u0, v0, u1, v1]` screen bounds. */
export function projectAabbToNormalizedScreen(
  matrix: Matrix,
  min: Vec3,
  max: Vec3
): readonly [number, number, number, number] | null {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
  let anyVisible = false
  for (let ix = 0; ix < 2; ix++) {
    const x = ix ? max[0] : min[0]
    for (let iy = 0; iy < 2; iy++) {
      const y = iy ? max[1] : min[1]
      for (let iz = 0; iz < 2; iz++) {
        const z = iz ? max[2] : min[2]
        const w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]
        if (w <= 1e-5) continue
        const nx = (x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]) / w
        const ny = (x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]) / w
        const u = (nx + 1) * 0.5
        const v = (1 - ny) * 0.5
        if (u < minU) minU = u
        if (u > maxU) maxU = u
        if (v < minV) minV = v
        if (v > maxV) maxV = v
        anyVisible = true
      }
    }
  }
  if (!anyVisible) return null
  const c0 = Math.max(0, Math.min(1, minU))
  const c1 = Math.max(0, Math.min(1, minV))
  const c2 = Math.max(0, Math.min(1, maxU))
  const c3 = Math.max(0, Math.min(1, maxV))
  if (c2 <= c0 || c3 <= c1) return null
  return [c0, c1, c2, c3]
}

function sourceSiteFor(batch: InstanceBatch, tag?: InstanceTag): string {
  return tag?.sourceFile ?? batch.meta?.sourceFile ?? batch.meta?.sourceSite ?? getMeshMeta(batch.mesh)?.sourceSite ?? 'runtime'
}

function deriveUntaggedName(batch: InstanceBatch, sourceSite: string, shape?: string): string {
  if (batch.meta?.asset) return batch.meta.asset
  if (batch.meta?.label) return batch.meta.label
  const meshLabel = getMeshMeta(batch.mesh)?.label
  if (meshLabel) return meshLabel
  if (sourceSite && sourceSite !== 'runtime') {
    const base = sourceSite.split('/').at(-1)?.replace(/\.(ts|js|mjs)(?=:|$)/, '') ?? sourceSite
    return shape ? `${shape} (${base})` : base
  }
  const tris = Math.round(batch.mesh.vertexCount / 3)
  return shape ? `${shape}-mesh` : `mesh-${tris}tri`
}

/**
 * Automatically recognize and group a picked 3D instance (tagged ArtKit/Rig OR zero-tag plain mesh).
 * Returns inferred assembly bounds, screen rect, colors, triangle stats, and creation-site source attribution.
 */
export function recognizeAssetFromPick(
  batches: readonly InstanceBatch[],
  viewProjection: Matrix,
  picked: Picked3DInstance
): RecognizedAsset {
  const tag = picked.tag
  const kind: 'model' | 'rig' | 'mesh' = tag?.kind ?? picked.batch.meta?.kind ?? 'mesh'
  const groupId = tag?.groupId
  const selectedSlots: { batch: InstanceBatch; batchIndex: number; instanceIndex: number; aabb: WorldAabb }[] = []

  if (groupId) {
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      const tags = batch.meta?.tags
      if (!tags) continue
      for (let ii = 0; ii < batch.count; ii++) {
        if (tags[ii]?.groupId === groupId) {
          selectedSlots.push({ batch, batchIndex: bi, instanceIndex: ii, aabb: instanceWorldAabb(batch, ii) })
        }
      }
    }
  } else {
    // Zero-tag automatic grouping: start with the picked instance and merge touching/co-located parts
    // while avoiding swallowing giant background/ground slabs.
    const seedAabb = instanceWorldAabb(picked.batch, picked.instanceIndex)
    const seedSize = [
      seedAabb.max[0] - seedAabb.min[0],
      seedAabb.max[1] - seedAabb.min[1],
      seedAabb.max[2] - seedAabb.min[2]
    ]
    const seedMaxExtent = Math.max(seedSize[0], seedSize[1], seedSize[2], 0.1)
    const margin = Math.min(0.6, Math.max(0.12, seedMaxExtent * 0.25))
    const pickedSite = sourceSiteFor(picked.batch, tag)

    const visited = new Set<string>()
    const key = (bi: number, ii: number) => `${bi}:${ii}`
    const queue = [{ batch: picked.batch, batchIndex: picked.batchIndex, instanceIndex: picked.instanceIndex, aabb: seedAabb }]
    visited.add(key(picked.batchIndex, picked.instanceIndex))
    selectedSlots.push(queue[0])

    const MAX_GROUP = 64
    let head = 0
    while (head < queue.length && selectedSlots.length < MAX_GROUP) {
      const current = queue[head++]
      for (let bi = 0; bi < batches.length && selectedSlots.length < MAX_GROUP; bi++) {
        const batch = batches[bi]
        if (!batch.count) continue
        // Quick batch AABB reject
        if (!aabbIntersectsExpanded(current.aabb, batch, margin)) continue
        const batchSite = sourceSiteFor(batch)
        const sameSite = pickedSite !== 'runtime' && batchSite === pickedSite
        for (let ii = 0; ii < batch.count && selectedSlots.length < MAX_GROUP; ii++) {
          const slotKey = key(bi, ii)
          if (visited.has(slotKey)) continue
          // Do not merge tagged ArtKit/Rig instances into an untagged mesh group
          const otherTag = batch.meta?.tags?.[ii]
          if (otherTag?.groupId) continue
          const candAabb = instanceWorldAabb(batch, ii)
          const candExtent = Math.max(
            candAabb.max[0] - candAabb.min[0],
            candAabb.max[1] - candAabb.min[1],
            candAabb.max[2] - candAabb.min[2]
          )
          // Skip giant floor/terrain slabs relative to a small prop (unless same source site)
          if (!sameSite && candExtent > seedMaxExtent * 4) continue
          if (aabbIntersectsExpanded(current.aabb, candAabb, sameSite ? margin * 1.25 : margin)) {
            visited.add(slotKey)
            const entry = { batch, batchIndex: bi, instanceIndex: ii, aabb: candAabb }
            selectedSlots.push(entry)
            queue.push(entry)
          }
        }
      }
    }
  }

  if (!selectedSlots.length) {
    selectedSlots.push({
      batch: picked.batch,
      batchIndex: picked.batchIndex,
      instanceIndex: picked.instanceIndex,
      aabb: instanceWorldAabb(picked.batch, picked.instanceIndex)
    })
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let triangleCount = 0
  let vertexCount = 0
  const batchIndices = new Set<number>()
  const colorSet = new Set<string>()
  const members: RecognizedMember[] = []

  for (let i = 0; i < selectedSlots.length; i++) {
    const slot = selectedSlots[i]
    const { batch, batchIndex, instanceIndex, aabb } = slot
    if (aabb.min[0] < minX) minX = aabb.min[0]
    if (aabb.min[1] < minY) minY = aabb.min[1]
    if (aabb.min[2] < minZ) minZ = aabb.min[2]
    if (aabb.max[0] > maxX) maxX = aabb.max[0]
    if (aabb.max[1] > maxY) maxY = aabb.max[1]
    if (aabb.max[2] > maxZ) maxZ = aabb.max[2]
    batchIndices.add(batchIndex)
    const tris = Math.round(batch.mesh.vertexCount / 3)
    triangleCount += tris
    vertexCount += batch.mesh.vertexCount
    const tf = readInstanceTransform(batch, instanceIndex)
    const colorHex = rgbToHex(tf.color[0], tf.color[1], tf.color[2])
    colorSet.add(colorHex)
    const slotTag = batch.meta?.tags?.[instanceIndex]
    const shape = getKnownShapeName(batch.mesh)
    members.push({
      batchIndex,
      instanceIndex,
      part: slotTag?.part ?? (shape ? `${shape}-${i + 1}` : `part-${i + 1}`),
      joint: slotTag?.joint,
      shape,
      colorHex,
      position: tf.position,
      scale: tf.scale,
      triangles: tris,
      unlit: tf.unlit,
      sourceSite: sourceSiteFor(batch, slotTag)
    })
  }

  const min: Vec3 = [minX, minY, minZ]
  const max: Vec3 = [maxX, maxY, maxZ]
  const center: Vec3 = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5]
  const size: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ]
  const sourceSite = sourceSiteFor(picked.batch, tag)
  const pickedShape = getKnownShapeName(picked.batch.mesh)
  const asset = tag?.asset ?? deriveUntaggedName(picked.batch, sourceSite, pickedShape)
  const instanceId = tag?.instanceId ?? groupId ?? `batch-${picked.batchIndex}-inst-${picked.instanceIndex}`

  return {
    kind,
    asset,
    instanceId,
    part: tag?.part ?? (pickedShape ?? 'part-1'),
    joint: tag?.joint,
    groupId,
    sourceSite,
    bounds: { min, max, center, size },
    screenBounds: projectAabbToNormalizedScreen(viewProjection, min, max),
    stats: {
      instanceCount: selectedSlots.length,
      triangleCount,
      vertexCount,
      batchCount: batchIndices.size
    },
    colors: Array.from(colorSet),
    members,
    picked
  }
}
