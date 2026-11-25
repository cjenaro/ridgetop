import {
  bakeVertexAO, box, chamferedPrism, color, createShadowBatch, instances, mesh, multiply, octahedron, orthographic,
  projectPoint, view
} from 'ridgetop'
import type { Color, LowPolyRenderer, Matrix, Vec3 } from 'ridgetop'
import type { Race } from './race.ts'
import { offset, roadMesh } from './track.ts'
import type { Circuit } from './track.ts'

import { carLivery, carTrim as bodyTrim, createCarModels } from './car-art.ts'

const rock = chamferedPrism(.19, .67, .82)
const ivory = color('fbe1ba')
const tire = color('20232d')
const lamps = color('ffeccc')
const palette = (values: string) => values.split(' ').map(color)
const themes = {
  copper: {
    ground: '875950 956253 a76d56 b57a5d c28865 d3976e',
    strata: '714553 9d6054 bf755b dc9570', caps: 'b96357 e48e68 f2ab7e',
    road: '35374b a55d43 ed8052 846d83'
  },
  brine: {
    ground: '517b81 638995 779da2 96b0ac adc2b6 cdd9bd',
    strata: '3c5e6c 68858d 92aeb0 c3d7cd', caps: '68adad 8ec3b9 cbd9c5',
    road: '303d53 749198 6ce4d3 7ba6ae'
  },
  foundry: {
    ground: '41404c 514452 604953 74555b 89605c 966c62',
    strata: '3b3744 614452 87555b b0786c', caps: '97585b e17752 e5a977',
    road: '292a38 6a484f ff9a5b 563c4e'
  },
  night: {
    ground: '202940 252e4c 2d3958 334360 3f5072 485b7d',
    strata: '29304c 354365 465877 596c93', caps: '8d74d5 548aaf 80c6d7',
    road: '202438 3f436f b29dfb 19243b'
  }
}
const signal = color('7bf9e8')
const snare = color('ffaf68')
const hitColor = color('ffdcaa')
const pond = mesh([0,0,0, 1.02,0,0, .68,0,.71, -.18,0,.91, -.80,0,.63,
  -1.01,0,.05, -.69,0,-.58, -.09,0,-.78, .83,0,-.65],
  [0,2,1, 0,3,2, 0,4,3, 0,5,4, 0,6,5, 0,7,6, 0,8,7, 0,1,8])

const themeLighting: Record<Circuit['id'], {
  direction: Vec3; ambient: number; color: Vec3
  skyColor: Vec3; groundColor: Vec3
  rimColor: Vec3; rimStrength: number
  shadowStrength: number; shadowColor: Vec3
}> = {
  copper: {
    direction: [-0.64, 0.62, 0.44], ambient: 0.50, color: [1.0, 0.94, 0.83],
    skyColor: [0.84, 0.86, 0.98], groundColor: [0.68, 0.44, 0.34],
    rimColor: [1.0, 0.92, 0.76], rimStrength: 0.26,
    shadowStrength: 0.58, shadowColor: [0.24, 0.18, 0.38]
  },
  brine: {
    direction: [-0.48, 0.78, 0.38], ambient: 0.48, color: [0.96, 0.98, 1.0],
    skyColor: [0.76, 0.92, 0.98], groundColor: [0.42, 0.56, 0.58],
    rimColor: [0.92, 1.0, 0.96], rimStrength: 0.22,
    shadowStrength: 0.42, shadowColor: [0.20, 0.34, 0.46]
  },
  foundry: {
    direction: [-0.60, 0.66, 0.44], ambient: 0.40, color: [1.0, 0.88, 0.76],
    skyColor: [0.64, 0.62, 0.74], groundColor: [0.54, 0.34, 0.32],
    rimColor: [1.0, 0.76, 0.54], rimStrength: 0.28,
    shadowStrength: 0.48, shadowColor: [0.22, 0.18, 0.30]
  },
  night: {
    direction: [-0.42, 0.74, 0.52], ambient: 0.34, color: [0.74, 0.84, 1.0],
    skyColor: [0.36, 0.48, 0.76], groundColor: [0.16, 0.22, 0.36],
    rimColor: [0.56, 0.94, 0.98], rimStrength: 0.32,
    shadowStrength: 0.44, shadowColor: [0.08, 0.12, 0.24]
  }
}

function terrainTiles(sand: Color[]) {
  const cols = 17
  const rows = 13
  const points: Vec3[] = []
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const x = (col - cols / 2) * 10 + Math.sin(row * 4.8 + col * 2.32) * 1.65
      const z = (row - rows / 2) * 10 + Math.cos(col * 5.3 - row * 2.7) * 1.65
      points.push([x, -.055, z])
    }
  }
  const indices: number[] = []
  const colors: number[] = []
  const pushTri = (a: number, b: number, c: number, col: Color) => {
    indices.push(a, b, c)
    for (let k = 0; k < 3; k++) colors.push(col[0], col[1], col[2])
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = row * (cols + 1) + col
      const b = a + cols + 1
      const band = 2 + Math.sin(col * 1.56 + row * .73) * 1.55 + Math.cos(row * .92) * .8
      const tone = Math.max(0, Math.min(sand.length - 2, Math.round(band)))
      pushTri(a, b, a + 1, sand[tone])
      pushTri(a + 1, b, b + 1, sand[tone + (col * 7 + row * 13) % 2])
    }
  }
  const terrainMesh = bakeVertexAO(mesh(points.flat(), indices, colors), { strength: 0.12, verticalGradient: 0 })
  const batch = instances(terrainMesh)
  batch.add([0, 0, 0], [1, 1, 1], 0, [1, 1, 1, 1], .08)
  return [batch]
}

export function buildCircuitBatches(circuit: Circuit) {
  const theme = themes[circuit.id]
  const [track, shoulderTint, orange, clear] = palette(theme.road)
  const sandstone = palette(theme.strata)
  const adobe = palette(theme.caps)
  const { route, width: trackWidth } = circuit
  const road = instances(roadMesh(trackWidth, .045, 0, route))
  const shoulder = instances(roadMesh(trackWidth + 1.15, .018, 0, route))
  const line = [-1, 1].map(side => instances(roadMesh(.108, .055, side * (trackWidth * .5 - .23), route)))
  const ground = terrainTiles(palette(theme.ground))
  const solid = instances(box)
  const trim = instances(box)
  const rocks = instances(rock)
  const scenery = instances(rock)
  const water = instances(pond)
  const lights = instances(octahedron)
  shoulder.add([0, 0, 0], [1, 1, 1], 0, shoulderTint)
  road.add([0, 0, 0], [1, 1, 1], 0, track)
  for (const edge of line) edge.add([0, 0, 0], [1, 1, 1], 0, ivory, .66)

  for (let i = 0; i < 72; i++) {
    const point = route.sample(i / 72)
    const curb = i % 3 === 0 ? solid : trim
    curb.add([point.x, .065, point.z], [.085, .015, .9], point.yaw, ivory, .37)
    for (const side of [-1, 1]) {
      const bend = route.sample((i + 1) / 72)
      const curved = Math.cos(point.yaw - bend.yaw) < .998
      const [x, z] = offset(point, side * (trackWidth * .5 + .30))
      if (curved || i % 9 === 0) {
        curb.add([x, .062, z], [.44, .091, 1.48], point.yaw, i % 2 ? ivory : orange, .38)
      }
      if (i % 6 === 1) {
        const [bx, bz] = offset(point, side * (trackWidth * .5 + 1.17))
        solid.add([bx, .21, bz], [.20, .43, .23], point.yaw, sandstone[0])
        solid.add([bx, .42, bz], [.19, .10, .23], point.yaw, ivory, .65)
      }
    }
  }

  const start = route.sample(0)
  const sx = Math.sin(start.yaw), sz = Math.cos(start.yaw)
  for (let row = 0; row < 2; row++) {
    for (let lane = 0; lane < 14; lane++) {
      const [x, z] = offset(start, (lane - 6.5) * .605)
      solid.add([x + .46 * row * sx, .073, z + .46 * row * sz],
        [.607, .022, .46], start.yaw, (row + lane) % 2 ? tire : ivory, .78)
    }
  }
  const gateWidth = trackWidth + 2.75
  solid.add([start.x, 3.24, start.z], [gateWidth, .39, .46], start.yaw, bodyTrim)
  solid.add([start.x, 3.41, start.z], [gateWidth * .83, .105, .49], start.yaw, orange, .75)
  for (const side of [-1, 1]) {
    const [x, z] = offset(start, side * (gateWidth * .5 - .25))
    rocks.add([x, .34, z], [.8, .68, .85], start.yaw, sandstone[0])
    solid.add([x, 1.64, z], [.26, 3.20, .34], start.yaw, bodyTrim)
    solid.add([x, 2.1, z], [.295, .18, .37], start.yaw, ivory, .67)
  }
  for (let i = -3; i <= 3; i++) {
    const [x, z] = offset(start, i * .50)
    solid.add([x - sx * .25, 3.24, z - sz * .25], [.24, .15, .065], start.yaw,
      i === 0 ? ivory : carLivery[1][1], 1)
  }

  for (const progress of [.25, .5, .75]) {
    const point = route.sample(progress)
    for (const side of [-1, 1]) {
      const [x, z] = offset(point, side * (trackWidth * .5 + .95))
      rocks.add([x, .44, z], [.36, .90, .46], point.yaw, bodyTrim)
      rocks.add([x, 1.03, z], [.50, .29, .56], point.yaw, orange)
      lights.add([x, 1.34, z], [.15, .19, .15], point.yaw, lamps, .95)
    }
  }

  if (circuit.id === 'copper') {
    const [salt, shallow, deep, reflection] = ['dac29b', '76a297', '477785', 'b9d2b3'].map(color)
    water.add([-15, -.048, -5.9], [7.2, 1, 5.1], .19, salt, .72)
    water.add([-15, -.045, -5.9], [6.35, 1, 4.42], .18, shallow, .84)
    water.add([-15.5, -.042, -6], [5.4, 1, 3.52], .15, deep, .93)
    for (let i = 0; i < 12; i++) {
      const x = -19.5 + i * .78
      const z = -6.1 + Math.sin(i * 2.16) * 2.21
      solid.add([x, -.038, z], [.42 + i % 4 * .31, .002, .032 + i % 2 * .021], .17, reflection, .91)
    }
    const pitPaint = color('689395')
    for (const x of [15.6, 19.05]) {
      solid.add([x, -.011, 5.1], [3.17, .09, 4.34], -.21, salt)
      solid.add([x, .70, 5.78], [2.57, 1.5, 2.62], -.21, sandstone[1])
      rocks.add([x, 1.53, 5.78], [3.16, .25, 3.14], -.21, pitPaint)
      solid.add([x - .29, .54, 4.52], [1.35, .96, .1], -.21, bodyTrim)
      solid.add([x + .69, 1.05, 4.46], [.26, .31, .09], -.21, ivory, .72)
    }
  } else if (circuit.id === 'brine') {
    const [salt, shallow, deep] = palette('d7e3c6 85c4b9 4f8697')
    for (const [x, z, size] of [[-17, -3, 7], [5, -6, 6], [14, -3.9, 4.5]]) {
      if (route.nearest(x, z).distance < trackWidth / 2 + size + 1) continue
      water.add([x, -.048, z], [size, 1, size * .73], .18, salt, .8)
      water.add([x, -.042, z], [size * .87, 1, size * .63], .19, shallow, .84)
      water.add([x, -.039, z], [size * .69, 1, size * .51], .24, deep, .91)
    }
  } else {
    for (const [x, z] of [[-20, -10], [4, -15], [18, -9], [18, 5], [-21, 8], [0, 3]]) {
      if (route.nearest(x, z).distance < trackWidth / 2 + 4) continue
      const height = circuit.id === 'night' ? 3.5 : 5.75
      rocks.add([x, .57, z], [3.4, 1.18, 3.4], .27, sandstone[0])
      solid.add([x, height * .51, z], [1.15, height, 1.15], .27, sandstone[2])
      solid.add([x, height, z], [1.93, .34, 1.93], .27, orange, .66)
      lights.add([x, height + .35, z], [.34, .48, .34], 0, orange, 1)
      if (circuit.id === 'night') {
        solid.add([x + .59, height * .73, z], [.08, height * .39, .24], .27, signal, 1)
      }
    }
  }

  for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI / 16
    const x = Math.cos(angle) * (49 + i % 5 * 2.8)
    const z = Math.sin(angle) * (34 + i % 4 * 4.8)
    const h = 2.0 + (i * 11 % 7) * .81
    const w = 5.4 + (i * 7 % 5) * 1.1
    const mesa = i % 4 === 0 ? rocks : scenery
    mesa.add([x, h * .28 - .09, z], [w, h * .58, w * .78], angle, sandstone[0])
    mesa.add([x + .25, h * .61, z - .15], [w * .8, h * .23, w * .63], angle, adobe[i % 3])
    mesa.add([x - .21, h * .83, z - .41], [w * .66, h * .32, w * .54], angle, sandstone[2 + (i % 2)])
  }
  for (let i = 0; i < 100; i++) {
    const x = (i * 13.17 % 86) - 43
    const z = (i * i * 8.91 + i * 2.6) % 62 - 31
    if (circuit.id === 'copper' && (Math.hypot((x + 15) * .65, z + 6) < 4.8 || Math.hypot(x - 17.2, z - 5.5) < 4.4)) continue
    const space = route.nearest(x, z).distance
    if (space < 5.9) continue
    const h = Math.min(space * .27, .48 + i % 7 * .56)
    const yaw = i * 1.5
    const landmark = i % 4 === 1 ? rocks : scenery
    landmark.add([x, h * .32, z], [1.3 + i % 4 * .60, h * .73, 1.1 + i % 3 * .42],
      yaw, sandstone[i % 4])
    if (i % 3 === 1) {
      landmark.add([x + .18, h * .76, z], [1.04 + i % 4 * .48, h * .23, .87 + i % 3 * .33],
        yaw, adobe[i % 3])
    }
    if (i % 3 === 0) {
      const shrub = circuit.id === 'copper' ? color('879576') : adobe[0]
      scenery.add([x + .68, .11, z + .45], [.70, .31, .62], i, shrub)
      scenery.add([x + .94, .09, z + .35], [.43, .26, .49], -i, shrub)
    }
  }

  const staticBatches = [...ground, shoulder, road, water, solid, rocks, lights, ...line, trim, scenery]
  return { clear, ground, shoulder, road, water, solid, rocks, lights, line, trim, scenery, staticBatches }
}

export function createRaceScene(renderer: LowPolyRenderer, circuit: Circuit) {
  const { route, width: trackWidth } = circuit
  const { clear, ground, shoulder, road, water, solid, rocks, lights, line, trim, scenery } = buildCircuitBatches(circuit)
  const models = createCarModels()
  const effects = instances(octahedron)
  const lighting = themeLighting[circuit.id]
  const carShadows = createShadowBatch({
    capacity: 24,
    groundY: 0.045,
    direction: lighting.direction,
    color: lighting.shadowColor,
    opacity: 0.30,
    penumbra: 0.28,
    offsetScale: 0.12,
    bias: 0.012
  })
  const trackBatches = [...ground, shoulder, road, water, solid, rocks, lights, carShadows.batch, effects]
  const simpleBatches = [...trackBatches, ...models.common]
  const all = [...trackBatches, ...models.full, ...line, trim, scenery]

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < route.nodes.length; i++) {
    const [x, z] = route.nodes[i]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const centerX = (maxX + minX) / 2
  const centerZ = (maxZ + minZ) / 2
  const shadowExtent = Math.max(maxX - minX, maxZ - minZ) * 0.62 + 16
  renderer.setLighting({
    direction: lighting.direction,
    ambient: lighting.ambient,
    color: lighting.color,
    skyColor: lighting.skyColor,
    groundColor: lighting.groundColor,
    rimColor: lighting.rimColor,
    rimStrength: lighting.rimStrength,
    shadows: {
      enabled: true,
      center: [centerX, 0, centerZ],
      extent: shadowExtent,
      bias: 0.0028,
      strength: lighting.shadowStrength,
      color: lighting.shadowColor
    }
  })
  const isometric = (x: number, z: number) => view([x + 70, 70, z + 70], [x, 0, z])
  const circuitView = isometric(centerX, centerZ)
  let maxAbsX = -Infinity, maxAbsY = -Infinity
  for (let i = 0; i < route.nodes.length; i++) {
    const [x, z] = route.nodes[i]
    const [px, py] = projectPoint(circuitView, x, 0, z)
    const ax = Math.abs(px), ay = Math.abs(py)
    if (ax > maxAbsX) maxAbsX = ax
    if (ay > maxAbsY) maxAbsY = ay
  }
  const fitWidth = maxAbsX * 2 + trackWidth + 8
  const fitHeight = maxAbsY * 2 + trackWidth + 8
  let wide: Matrix
  let close: Matrix
  let previousAspect = 0
  let last: { race: Race; canvas: HTMLCanvasElement; elapsed: number; width: number; height: number;
    density: number; reducedMotion: boolean; follow: boolean } | undefined
  return {
    invalidate() { last = undefined },
    render(race: Race, reducedMotion: boolean, follow: boolean) {
      const canvas = renderer.canvas
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      const density = globalThis.devicePixelRatio
      if (last?.race === race && last.elapsed === race.elapsed && last.canvas === canvas &&
          last.width === width && last.height === height && last.density === density &&
          last.reducedMotion === reducedMotion && last.follow === follow) return
      last = { race, canvas, elapsed: race.elapsed, width, height, density, reducedMotion, follow }
      const simple = renderer.name === 'Canvas 2D'
      const aspect = width / height
      if (aspect !== previousAspect) {
        const height = Math.max(fitHeight, fitWidth / aspect)
        wide = multiply(orthographic(height * aspect, height, .1, 240), circuitView)
        const closeHeight = Math.max(47, 25 / aspect)
        close = orthographic(closeHeight * aspect, closeHeight, .1, 240)
        previousAspect = aspect
      }
      models.clear()
      effects.clear()
      carShadows.clear()
      for (const driver of race.drivers) {
        const speed = Math.hypot(driver.vx, driver.vz)
        const roll = reducedMotion ? 0 : -driver.steer * Math.min(.19, speed * .011)
        const pitch = reducedMotion ? 0 : -.055 * driver.throttle
        models.add(driver, pitch, roll, simple, undefined, false)
        carShadows.add([driver.x, 0.45, driver.z], {
          radius: 1.05,
          radiusZ: 1.72,
          yaw: driver.yaw,
          opacity: simple ? 0.44 : 0.30,
          offsetScale: simple ? 0.65 : 0.12
        })
        if (driver.slot === 0) effects.add([driver.x, 1.87, driver.z], [.33, .27, .33], 0, ivory, 1)
        if (driver.disabled) effects.add([driver.x, 1.15, driver.z], [.96, .41, .96], 0, hitColor, 1)
      }
      for (const supply of race.supplies) {
        if (supply.cooldown) continue
        effects.add([supply.x, .38, supply.z], [.49, .31, .49], supply.yaw, signal, 1)
        effects.add([supply.x, .78, supply.z], [.13, .22, .13], supply.yaw, ivory, 1)
      }
      for (const weapon of race.weapons) {
        const pulse = weapon.kind === 'pulse'
        effects.add([weapon.x, pulse ? .65 : .19, weapon.z], pulse ? [.22, .20, 1.15] : [.64, .27, .64],
          weapon.yaw, pulse ? signal : snare, 1)
      }
      for (const hit of race.hits) {
        const glow = 1.21 - hit.age * 2.7
        effects.add([hit.x, .82 + hit.age, hit.z], [glow, glow * .6, glow], hit.age * 7, hitColor, 1)
      }
      const player = race.drivers[0]
      const camera = aspect < .85 && follow
        ? multiply(close, isometric(player.x + player.vx * .32, player.z + player.vz * .32))
        : wide
      return renderer.render(camera, simple ? simpleBatches : all, clear)
    },
    dispose() {
      for (const batch of all) renderer.release(batch)
      for (const batch of [...ground, shoulder, road, carShadows.batch, ...line]) renderer.releaseMesh(batch.mesh)
    }
  }
}
