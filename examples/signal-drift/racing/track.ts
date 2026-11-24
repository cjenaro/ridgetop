import { createCircuit, mesh } from 'ridgetop'
import type { TrackPoint } from 'ridgetop'

function circuit<Id extends string>(id: Id, name: string, description: string, points: readonly TrackPoint[],
  width: number, laps: number, qualify: number, purse: number, pace: number, grip = 1) {
  return { id, name, description, route: createCircuit(points, 6), width, laps, qualify, purse, pace, grip }
}

export const circuits = [
  circuit('copper', 'Copper Basin', 'Fast sweepers through the sandstone basin.', [
    [-19, 13], [-31, 3], [-28, -15], [-14, -21], [1, -17], [12, -7], [24, -12],
    [33, -4], [30, 12], [16, 20], [2, 15], [-9, 8]
  ], 9, 2, 3, 215, 16.3),
  circuit('brine', 'Brineworks', 'Wide salt flats lead into a tight return around the settling pools.', [
    [-21, 16], [-35, 9], [-33, -9], [-22, -19], [-2, -19], [24, -16],
    [35, -7], [29, 7], [13, 10], [10, 24], [-5, 26], [-10, 16]
  ], 9.6, 2, 3, 270, 17.1, .91),
  circuit('foundry', 'Cinder Switchback', 'Three reversals through the foundry. Brake early and save a snare for the exits.', [
    [-27, 16], [-35, 3], [-31, -18], [-12, -25], [9, -24], [34, -19],
    [38, -7], [29, 1], [5, -4], [-8, -4], [-13, 5], [0, 10], [24, 11],
    [32, 20], [22, 27], [-5, 24]
  ], 8.5, 3, 2, 350, 18, .96),
  circuit('night', 'Midnight Relay', 'A night sprint through long straights and narrow, floodlit gates.', [
    [-33, -2], [-36, -15], [-16, -25], [9, -26], [38, -17], [42, 1],
    [28, 18], [5, 23], [-10, 12], [-27, 17], [-39, 9]
  ], 8.8, 3, 1, 480, 18.8)
] as const

export type Circuit = (typeof circuits)[number]
export const route = circuits[0].route
export const trackWidth = circuits[0].width

export function offset(point: { x: number; z: number; yaw: number }, lateral: number): TrackPoint {
  return [point.x + Math.cos(point.yaw) * lateral, point.z - Math.sin(point.yaw) * lateral]
}

export function roadMesh(width: number, y: number, lateral = 0, layout = route) {
  const positions: number[] = []
  const triangles: number[] = []
  const length = layout.nodes.length
  for (let i = 0; i < length; i++) {
    const [x, z] = layout.nodes[i]
    const [lastX, lastZ] = layout.nodes[(i - 1 + length) % length]
    const [nextX, nextZ] = layout.nodes[(i + 1) % length]
    const edge = { x, z, yaw: Math.atan2(nextX - lastX, nextZ - lastZ) }
    for (const side of [-1, 1]) {
      const [px, pz] = offset(edge, lateral + width * .5 * side)
      positions.push(px, y, pz)
    }
    const a = i * 2
    const b = (i + 1) % length * 2
    triangles.push(a, b + 1, a + 1, a, b, b + 1)
  }
  return mesh(positions, triangles)
}
