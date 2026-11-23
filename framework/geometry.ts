import type { Matrix, Mesh, Quaternion, Vec3 } from './types.ts'

// Matrices are column-major and use a right-handed view with clip depth in [0, 1].
export function multiply(a: Matrix, b: Matrix): Matrix {
  const result = new Float32Array(16)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      const i = column * 4
      result[i + row] = a[row] * b[i] + a[4 + row] * b[i + 1] +
        a[8 + row] * b[i + 2] + a[12 + row] * b[i + 3]
    }
  }
  return result
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]
]
function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v)
  if (!length || !Number.isFinite(length)) throw new RangeError('Expected a finite, nonzero vector')
  return [v[0] / length, v[1] / length, v[2] / length]
}

export function view(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Matrix {
  const z = unit(sub(eye, target))
  const x = unit(cross(up, z))
  const y = cross(z, x)
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ])
}

export function orthographic(width: number, height: number, near: number, far: number): Matrix {
  if (!(width > 0 && height > 0 && near >= 0 && far > near) ||
      ![width, height, near, far].every(Number.isFinite)) throw new RangeError('Invalid orthographic volume')
  return new Float32Array([
    2 / width, 0, 0, 0, 0, 2 / height, 0, 0,
    0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1
  ])
}

export function perspective(fieldOfView: number, aspect: number, near: number, far: number): Matrix {
  if (!(fieldOfView > 0 && fieldOfView < Math.PI && aspect > 0 && near > 0 && far > near) ||
      ![aspect, near, far].every(Number.isFinite)) throw new RangeError('Invalid perspective volume')
  const zoom = 1 / Math.tan(fieldOfView / 2)
  return new Float32Array([
    zoom / aspect, 0, 0, 0, 0, zoom, 0, 0,
    0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0
  ])
}

export function mesh(positions: ArrayLike<number>, indices?: ArrayLike<number>): Mesh {
  if (!positions.length || positions.length % 3 || !Array.from(positions).every(Number.isFinite)) {
    throw new RangeError('Mesh positions must contain finite XYZ triples')
  }
  const count = indices?.length ?? positions.length / 3
  if (!count || count % 3) throw new RangeError('Mesh must contain complete triangles')
  const data = new Float32Array(count * 6)
  let radius = 0
  for (let i = 0; i < count; i += 3) {
    const points: Vec3[] = []
    for (let corner = 0; corner < 3; corner++) {
      const index = indices ? indices[i + corner] : i + corner
      if (!Number.isInteger(index) || index < 0 || index >= positions.length / 3) {
        throw new RangeError('Mesh index is outside the position array')
      }
      const at = index * 3
      const point: Vec3 = [positions[at], positions[at + 1], positions[at + 2]]
      radius = Math.max(radius, Math.hypot(...point))
      points.push(point)
    }
    const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])))
    for (let corner = 0; corner < 3; corner++) {
      const offset = (i + corner) * 6
      data.set(points[corner], offset)
      data.set(normal, offset + 3)
    }
  }
  return { data, vertexCount: count, radius }
}

export const box = mesh([
  -.5,-.5,-.5, .5,-.5,-.5, .5,.5,-.5, -.5,.5,-.5,
  -.5,-.5,.5, .5,-.5,.5, .5,.5,.5, -.5,.5,.5
], [
  0,3,2, 0,2,1, 4,5,6, 4,6,7, 0,4,7, 0,7,3,
  1,2,6, 1,6,5, 0,1,5, 0,5,4, 3,7,6, 3,6,2
])

export const octahedron = mesh([
  0,1,0, 1,0,0, 0,0,1, -1,0,0, 0,0,-1, 0,-1,0
], [0,2,1, 0,3,2, 0,4,3, 0,1,4, 5,1,2, 5,2,3, 5,3,4, 5,4,1])

/** A 1×1×1 prism with clipped corners and a scaled upper face. */
export function chamferedPrism(corner = .14, topWidth = .82, topDepth = topWidth): Mesh {
  if (!(corner > 0 && corner < .5 && topWidth > 0 && topDepth > 0) ||
      !Number.isFinite(topWidth + topDepth)) throw new RangeError('Invalid chamfered prism dimensions')
  const inner = .5 - corner
  const ring = [[.5, -inner], [.5, inner], [inner, .5], [-inner, .5],
    [-.5, inner], [-.5, -inner], [-inner, -.5], [inner, -.5]]
  const vertices = ring.flatMap(([x, z]) => [x, -.5, z, x * topWidth, .5, z * topDepth])
  const indices: number[] = []
  for (let i = 0; i < 8; i++) {
    const a = 2 * i
    const b = 2 * ((i + 1) % 8)
    indices.push(a, a + 1, b, b, a + 1, b + 1)
    if (i > 0 && i < 7) indices.push(0, a, b, 1, b + 1, a + 1)
  }
  return mesh(vertices, indices)
}

export function cylinder(sides = 6, topRadius = 1, bottomRadius = 1) {
  if (!Number.isInteger(sides) || sides < 3 || sides > 256 ||
      ![topRadius, bottomRadius].every(r => Number.isFinite(r) && r >= 0) ||
      topRadius + bottomRadius === 0) throw new RangeError('Invalid cylinder dimensions')
  const positions = [0, -.5, 0, 0, .5, 0]
  const indices = []
  for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides
    const x = Math.cos(angle)
    const z = Math.sin(angle)
    positions.push(x * bottomRadius, -.5, z * bottomRadius, x * topRadius, .5, z * topRadius)
    const a = 2 + i * 2
    const b = 2 + (i + 1) % sides * 2
    if (bottomRadius) indices.push(0, a, b, a, a + 1, b)
    if (topRadius) indices.push(1, b + 1, a + 1, b, a + 1, b + 1)
  }
  return mesh(positions, indices)
}

/** Revolve a section from its underside round to its inside. A zero radius closes a cap. */
export function revolvedMesh(section: readonly (readonly [radius: number, height: number])[], sides = 10) {
  if (section.length < 2 || !Number.isSafeInteger(sides) || sides < 3 || sides > 256) throw new RangeError('Invalid revolved section')
  const positions: number[] = [], indices: number[] = []
  for (const [ring, [radius, height]] of section.entries()) {
    if (radius < 0 || !Number.isFinite(radius + height)) throw new RangeError('Invalid section radius or height')
    for (let i = 0; i < sides; i++) {
      const angle = 2 * Math.PI * i / sides
      positions.push(radius * Math.cos(angle), height, radius * Math.sin(angle))
      if (!ring) continue
      const a = (ring - 1) * sides + i, b = (ring - 1) * sides + (i + 1) % sides
      if (section[ring - 1][0] > 0) indices.push(a, a + sides, b)
      if (radius > 0) indices.push(b, a + sides, b + sides)
    }
  }
  return mesh(positions, indices)
}

/** A continuous inverted U in the XY plane, with flat feet on its lower face. */
export function archMesh() {
  const section: number[][] = [[-.5,-.5,-.32,-.5], [-.5,.04,-.32,.04]]
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI - Math.PI * i / 6
    section.push([.5*Math.cos(a), .04+.46*Math.sin(a), .32*Math.cos(a), .04+.29*Math.sin(a)])
  }
  section.push([.5,-.5,.32,-.5])
  const positions: number[] = [], indices: number[] = []
  for (const [i,[ox,oy,ix,iy]] of section.entries()) {
    positions.push(ox,oy,-.5, ix,iy,-.5, ix,iy,.5, ox,oy,.5)
    if (!i) continue
    for (let k = 0; k < 4; k++) {
      const a = 4*(i-1)+k, b = 4*(i-1)+(k+1)%4
      indices.push(a,a+4,b, b,a+4,b+4)
    }
  }
  const end = positions.length / 3 - 4
  indices.push(0,1,3, 1,2,3, end,end+3,end+1, end+1,end+3,end+2)
  return mesh(positions, indices)
}

export function projectPoint(matrix: Matrix, x: number, y: number, z: number): [number, number] {
  const w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]
  return [
    (x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]) / w,
    (x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]) / w
  ]
}

/** Pitch about X, yaw about Y, and roll about Z, applied roll first. */
export function quaternionFromEuler(pitch = 0, yaw = 0, roll = 0): Quaternion {
  const sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2)
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2)
  const sz = Math.sin(roll / 2), cz = Math.cos(roll / 2)
  return [
    cy * sx * cz + sy * cx * sz, sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz, cy * cx * cz + sy * sx * sz
  ]
}

export function rotationMatrix(q: ArrayLike<number>, offset = 0) {
  const x = q[offset], y = q[offset + 1], z = q[offset + 2], w = q[offset + 3]
  return [
    1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w),
    2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w),
    2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)
  ]
}

export function rotateVec3(rotation: Quaternion, [x, y, z]: Vec3): Vec3 {
  const [a, b, c, d, e, f, g, h, i] = rotationMatrix(rotation)
  return [a*x + b*y + c*z, d*x + e*y + f*z, g*x + h*y + i*z]
}
