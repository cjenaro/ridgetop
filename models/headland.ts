import { box, color, createArtKit, cylinder, instances, mesh, octahedron } from '../framework/index.ts'
import type { InstanceBatch, Mesh, Vec3 } from '../framework/index.ts'

// One peaked roof with its ridge running along X. Each triangle gets its own flat normal.
const roof = mesh([
  -.5, 0, -.5,  .5, 0, -.5,  -.5, 0, .5,  .5, 0, .5,  -.5, 1, 0,  .5, 1, 0
], [2, 3, 5, 2, 5, 4, 0, 4, 5, 0, 5, 1, 0, 2, 4, 1, 5, 3, 0, 1, 3, 0, 3, 2])
const drum = cylinder(10), cone = cylinder(10, 0)

// Follow the shoreline clockwise on a map with +Z pointing down.
const shore = [
  [2.15, .16], [1.82, .95], [.87, 1.35], [-.30, 1.48], [-1.42, 1.15], [-2.10, .48],
  [-2.02, -.48], [-1.30, -1.22], [-.12, -1.43], [1.12, -1.24], [1.92, -.66]
]

function coast() {
  const faces = new Map<string, number[]>()
  function face(tint: string, a: Vec3, b: Vec3, c: Vec3) {
    if (!faces.has(tint)) faces.set(tint, [])
    faces.get(tint).push(...a, ...b, ...c)
  }
  const top: Vec3[] = shore.map(([x, z], i) => [x, .055 + .05 * Math.sin(i * 3), z])
  const ledge: Vec3[] = shore.map(([x, z], i) => [x * (1.02 + .07 * Math.sin(i * 4)), -.19 + .09 * Math.cos(i * 2), z * 1.07])
  const foot: Vec3[] = shore.map(([x, z], i) => [x * (1.05 + .06 * Math.cos(i * 3)), -.53, z * 1.14])
  const foam: Vec3[] = foot.map(([x, y, z]) => [x * 1.055, y, z * 1.07])
  const grass = ['abc48b', 'aac185', 'a4be82', 'b4c993']
  const stone = ['768d92', '93a6a1', '667e89', 'a0aba2', '839998']
  for (let i = 0; i < shore.length; i++) {
    const j = (i + 1) % shore.length
    face(grass[i % grass.length], [0, .12, 0], top[j], top[i])
    face(stone[i % 5], top[i], top[j], ledge[j])
    face(stone[(i + 1) % 5], top[i], ledge[j], ledge[i])
    face(stone[(i + 2) % 5], ledge[i], ledge[j], foot[i])
    face(stone[(i + 3) % 5], foot[i], ledge[j], foot[j])
    face('b4e1d4', foot[i], foot[j], foam[j])
    face('b4e1d4', foot[i], foam[j], foam[i])
  }
  return [...faces].map(([tint, triangles]) => {
    const batch = instances(mesh(triangles))
    batch.add([0, 0, 0], [1, 1, 1], 0, color(tint))
    return batch
  })
}

/** Game-scale environment assembled once. Orbiting only changes the camera. */
export function createHeadland(): readonly InstanceBatch[] {
  const byMesh = new Map<Mesh, InstanceBatch>()
  function put(shape: Mesh, position: Vec3, scale: Vec3, tint: string, yaw = 0, unlit = 0) {
    if (!byMesh.has(shape)) byMesh.set(shape, instances(shape))
    byMesh.get(shape).add(position, scale, yaw, color(tint), unlit)
  }
  put(drum, [0, -.62, 0], [2.94, .16, 2.12], '63b5b9', .13)
  for (const [x, z, width] of [[1.24, 1.54, .40], [1.44, 1.43, .16], [-1.65, 1.34, .32], [-1.47, 1.44, .15], [2.48, -.12, .26], [-.35, -1.80, .5]]) {
    put(box, [x, -.535, z], [width, .008, .025], 'b3dfd6', .13, .30)
  }
  for (const [x, z, size] of [[1.97, .90, .30], [2.12, .77, .17], [-1.72, 1.06, .24], [-1.93, .94, .15]]) {
    put(octahedron, [x, -.47, z], [size, size * .85, size * .75], '829598', x)
  }

  const tx = .66, tz = -.28
  const cream = 'fff0ca', red = 'e87655', iron = '334e58'
  put(drum, [tx, .15, tz], [.49, .13, .49], 'a1a49a')
  // Keep the taper continuous through the painted bands.
  const courses = [[.20, .435], [.55, .400], [.85, .370], [1.16, .339], [1.46, .309], [1.82, .273]]
  for (let i = 1; i < courses.length; i++) {
    const [low, base] = courses[i - 1], [high, end] = courses[i]
    put(cylinder(10, end / base), [tx, (low + high) / 2, tz], [base, high - low, base], i % 2 ? cream : red)
  }
  put(box, [tx, .33, tz + .415], [.15, .26, .055], iron)
  put(box, [tx, 1.04, tz + .34], [.13, .18, .05], iron)
  put(box, [tx + .30, 1.47, tz], [.05, .13, .11], iron)
  put(drum, [tx, 1.84, tz], [.42, .09, .42], iron)
  const posts = 8
  for (let i = 0; i < posts; i++) {
    const a = 2 * Math.PI * i / posts, b = 2 * Math.PI * (i + 1) / posts
    const ax = .377 * Math.cos(a), az = .377 * Math.sin(a)
    const bx = .377 * Math.cos(b), bz = .377 * Math.sin(b)
    put(box, [tx + ax, 1.98, tz + az], [.024, .20, .024], iron)
    put(box, [tx + (ax + bx) / 2, 2.075, tz + (az + bz) / 2], [.025, .025, Math.hypot(bx - ax, bz - az)], iron, Math.atan2(bx - ax, bz - az))
    put(box, [tx + .26 * Math.cos(a), 2.08, tz + .26 * Math.sin(a)], [.035, .43, .035], iron)
  }
  put(drum, [tx, 2.09, tz], [.16, .32, .16], 'ffe09a', 0, .7)
  put(drum, [tx, 2.30, tz], [.324, .055, .324], iron)
  put(cone, [tx, 2.47, tz], [.37, .31, .37], red)
  put(drum, [tx, 2.65, tz], [.027, .12, .027], iron)

  // Keeper's cottage, stone path and a timber landing.
  const hx = -.64, hz = .32
  put(box, [hx, .32, hz], [.80, .45, .59], cream)
  put(roof, [hx, .54, hz], [.94, .33, .78], 'b85f4b')
  put(box, [hx - .23, .79, hz - .06], [.12, .32, .14], '7d7872')
  put(box, [hx + .18, .27, hz + .3], [.17, .32, .025], '48797d')
  put(box, [hx - .19, .36, hz + .3], [.16, .14, .026], iron)
  put(box, [hx + .407, .36, hz], [.022, .13, .14], iron)
  for (const [x, z, yaw] of [[-.37, .83, .24], [-.15, .72, .60], [.09, .57, .60], [.36, .40, .50], [.58, .23, .10]]) {
    put(drum, [x, .117, z], [.16, .025, .095], 'd7caaa', yaw)
  }
  for (let i = 0; i < 6; i++) put(box, [-.64, .07, 1.27 + i * .115], [.41, .065, .10], 'af855c')
  for (const x of [-.82, -.46]) for (const z of [1.42, 1.85]) {
    put(box, [x, -.14, z], [.065, .70, .065], '785d4b')
  }

  const grove = createArtKit({ palette: { leaf: '#387769', ground: '#61977a', wood: '#896e53' } }).group()
  for (const [x, z, scale] of [[-1.46, -.22, .60], [-1.02, -.68, .77], [-.53, -.91, .60], [1.48, -.60, .42]]) {
    grove.add('pine', [x, .07, z], { scale, yaw: x })
  }
  return [...coast(), ...byMesh.values(), ...grove.batches]
}
