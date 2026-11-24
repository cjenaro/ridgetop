export interface DriveInput { throttle: number; steer: number; drift: boolean }
export interface VehicleBody { x: number; z: number; yaw: number; vx: number; vz: number }
export type TrackPoint = readonly [x: number, z: number]

export function angleDelta(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

export function createArcadeDriver({ acceleration, maxSpeed, turnRate, grip }: {
  acceleration: number; maxSpeed: number; turnRate: number; grip: number
}) {
  return function drive(body: VehicleBody, input: DriveInput, dt: number, traction = 1) {
    const speed = Math.hypot(body.vx, body.vz)
    const previousForward = body.vx * Math.sin(body.yaw) + body.vz * Math.cos(body.yaw)
    const steering = Math.min(1, speed / 7)
    body.yaw = angleDelta(body.yaw + input.steer * turnRate * steering * (previousForward < -.5 ? -1 : 1) * dt)
    const fx = Math.sin(body.yaw), fz = Math.cos(body.yaw)
    let forward = body.vx * fx + body.vz * fz
    const sliding = input.drift && speed > 4
    const lateral = (body.vx * fz - body.vz * fx) * Math.exp(-grip * traction * (sliding ? .24 : 1) * dt)
    const power = input.throttle < 0 && forward > .4 ? acceleration * 1.6 : acceleration
    forward += input.throttle * power * traction * dt
    forward *= Math.exp(-(input.throttle === 0 ? 1.8 : .38) * dt)
    const limit = maxSpeed * (.25 + .75 * traction) * (sliding ? .86 : 1)
    // Ease into the surface's speed limit, including when leaving the road.
    if (forward > limit) forward -= (forward - limit) * Math.min(1, dt * 8)
    forward = Math.max(-maxSpeed * .32, forward)
    body.vx = fx * forward + fz * lateral
    body.vz = fz * forward - fx * lateral
    body.x += body.vx * dt
    body.z += body.vz * dt
  }
}

function curve(t: number, a: number, b: number, c: number, d: number) {
  return b + .5 * t * (c - a + t * (2*a - 5*b + 4*c - d + t * (3*(b-c) + d - a)))
}

export function createCircuit(points: readonly TrackPoint[], subdivisions = 8) {
  if (points.length < 4 || !Number.isInteger(subdivisions) || subdivisions < 1) {
    throw new RangeError('A circuit requires four or more points and positive subdivisions')
  }
  const nodes: TrackPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[(i + points.length - 1) % points.length], b = points[i]
    const c = points[(i + 1) % points.length], d = points[(i + 2) % points.length]
    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions
      nodes.push([curve(t, a[0], b[0], c[0], d[0]), curve(t, a[1], b[1], c[1], d[1])])
    }
  }
  const segments = nodes.map(([x, z], i) => {
    const [nextX, nextZ] = nodes[(i + 1) % nodes.length]
    const dx = nextX - x, dz = nextZ - z
    const lengthSquared = dx*dx + dz*dz
    if (!Number.isFinite(lengthSquared) || lengthSquared === 0) throw new RangeError('Circuit has a degenerate segment')
    return { x, z, dx, dz, lengthSquared, yaw: Math.atan2(dx, dz) }
  })
  const readonlyNodes: readonly TrackPoint[] = nodes
  return {
    nodes: readonlyNodes,
    sample(progress: number) {
      const slot = ((progress % 1 + 1) % 1) * segments.length
      const i = Math.floor(slot)
      const segment = segments[i % segments.length]
      const t = slot - i
      return { x: segment.x + segment.dx * t, z: segment.z + segment.dz * t, yaw: segment.yaw }
    },
    nearest(x: number, z: number) {
      let best = Infinity
      let progress = 0
      const count = segments.length
      for (let index = 0; index < count; index++) {
        const segment = segments[index]
        const px = x - segment.x, pz = z - segment.z
        const rawT = (px * segment.dx + pz * segment.dz) / segment.lengthSquared
        const t = rawT <= 0 ? 0 : rawT >= 1 ? 1 : rawT
        const ex = px - t * segment.dx
        const ez = pz - t * segment.dz
        const distance = ex * ex + ez * ez
        if (distance < best) {
          best = distance
          progress = ((index + t) / count) % 1
        }
      }
      return { distance: Math.sqrt(best), progress }
    }
  }
}
