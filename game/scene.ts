import type { Course } from './level.ts'
import type { PlayerSnapshot } from './simulation.ts'
import type { createSprites } from './sprites.ts'
import type { Color, LowPolyRenderer, Matrix } from '../framework/index.ts'
import { box, chamferedPrism, color, cylinder, instances, mesh, multiply, octahedron, orthographic, projectPoint, view } from '../framework/index.ts'
import { WIDTH } from './level.ts'

const crag = chamferedPrism(.19, 1.85, 1.45)
const stone = chamferedPrism(.12, .94)
const cone = cylinder(5, 0, 1)
const ring = cylinder(6)
const disk = mesh([0, 0, 0, ...Array.from({ length: 24 }, (_, i) => {
  const angle = i * Math.PI / 12
  return [Math.cos(angle), Math.sin(angle), 0]
}).flat()], Array.from({ length: 24 }, (_, i) => [0, i + 1, (i + 1) % 24 + 1]).flat())
const plane = mesh([-.5,-.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0], [0,1,2, 0,2,3])
const cloud = mesh([-1,0,0, -.8,.15,0, -.47,.13,0, -.16,.33,0, .18,.22,0, .58,.22,0, 1,0,0],
  [0,2,1, 0,6,2, 2,4,3, 2,6,4, 4,6,5])
const fullWidth = 20.6
const viewHeight = fullWidth * 9 / 16
const worldY = (y: number) => (450 - y) / 50
const worldX = (x: number) => x / 50
const shades = (list: string) => list.split(' ').map(color)
const palettes = {
  jade: shades('223854 527388 e1ab89 8ea9a6 5c817f 315b62 d8c6ab 48666b 57776e 62aa74 bde69b ffdfaa 92ffdd 294753'),
  amber: shades('483247 966477 f5c28a ca9380 9c6864 654652 f1c391 794e5a b88762 be9c66 f1ce88 ffe1ac a7fbdc 513e4d'),
  ice: shades('263958 667fa7 e7b5c8 b3b9ce 798eb1 4b668b e0dcee 4b648c 7d97af 98bfcb daf7eb ffe2c0 bdffff 374868'),
  storm: shades('22243c 525779 b597aa 888ba9 646884 424960 c1bed3 53536e 7a7d95 9aa4b0 ced7ef e4d1e2 dce4ff 333848'),
  ember: shades('442837 975866 f8b581 cc8b73 965262 633d55 f4c19b 724653 a96e59 c48755 f6bb80 ffdea6 9affed 502f42'),
  dawn: shades('3b466b 7d8bb3 f0c3ac c2adb8 8789ab 555f83 ebdbcf 555e7a 818f91 a8bc99 e1e9b9 ffecb5 b2ffde 434765')
}
const [hazard, padTop, padBase, dim, stoneDark, metal] = shades('ff7569 8fefff 3a80a2 6da9a5 343f4b c9a978')

function blend(a: Color, b: Color, t: number): Color {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1]
}

function ridge(heights: readonly number[], z: number, bottom: number, color: Color) {
  const positions: number[] = []
  const indices: number[] = []
  const facets: number[] = []
  const step = 74 / (heights.length - 1)
  for (const [i, y] of heights.entries()) {
    const x = -27 + i * step
    positions.push(x, bottom, z, x, y, z)
    if (i > 0) {
      const at = i * 2
      indices.push(at - 2, at, at + 1, at - 2, at + 1, at - 1)
      const last = heights[i - 1]
      const point = z + .015
      facets.push(x - step, last, point, x - step * .16, Math.min(last, y) - 2.65, point, x, y, point)
    }
  }
  const batch = instances(mesh(positions, indices))
  batch.add([0, 0, 0], [1, 1, 1], 0, color, 1)
  const shade = instances(mesh(facets))
  shade.add([0, 0, 0], [1, 1, 1], 0, blend(color, stoneDark, .16), 1)
  return [batch, shade]
}

export function createCourseScene(renderer: LowPolyRenderer, course: Course, reducedMotion: MediaQueryList, sprites: Awaited<ReturnType<typeof createSprites>>) {
  const [sky, skyMiddle, horizon, far, middle, near, vapor, rock, tile, moss, edge, sun, glow, shadow] = palettes[course.theme]
  const skyBands = instances(plane)
  const discs = instances(disk)
  const clouds = instances(cloud)
  const solids = instances(box)
  const cliffs = instances(crag)
  const blocks = instances(stone)
  const trees = instances(cone)
  const pillars = instances(ring)
  const ornaments = instances(octahedron)
  const shards = instances(octahedron)
  const backdrop = [
    ridge([-1.2, .6, 1.9, .6, 1.6, 2.5, .4, .55, 1.52, -.32, 1.2, .2, 1.7, 2.4, .3, 1.3, 0], -20, -15, far),
    ridge([-1.2, -.5, .6, 1.5, -.8, .1, .7, -1.2, -.5, .7, -.3, -.8, .8, -.6, .8, 2.1, .2], -15, -15, middle),
    ridge([-4, -1.3, -2.2, -.3, -2.1, -1.3, -2.9, -1.6, -3.1, -2.3, -2.7, -.9, -2.1, -4, -2.8], -10, -15, near)
  ].flat()
  const all = [skyBands, discs, ...backdrop, clouds, cliffs, blocks, solids, trees, pillars, ornaments, shards]

  const bands = 48
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1)
    const tint = t < .65 ? blend(horizon, skyMiddle, t / .65) : blend(skyMiddle, sky, (t - .65) / .35)
    skyBands.add([10, -9.3 + i * .25, -25], [110, .251, 1], 0, tint, 1)
  }
  for (let i = 0; i < 6; i++) {
    const radius = 1.47 - i * .075
    discs.add([15.2, .8, -24.15 + i * .037], [radius, radius, 1], 0, blend(skyMiddle, sun, .16 + i * .083), 1)
  }
  discs.add([15.2, .8, -23.9], [1.03, 1.03, 1], 0, sun, 1)
  for (let i = 0; i < 23; i++) {
    const x = -23 + i * 3.4
    const y = i % 3 === 0 ? -.75 : -4.9 - (i % 5) * .48
    const tint = blend(i % 3 === 0 ? near : middle, vapor, .18 + (i % 3) * .13)
    clouds.add([x, y, -8 - (i % 3) * 3.2], [1.8 + i % 6 * .66, .35 + i % 4 * .22, 1], 0, tint, 1)
  }

  const rockTints = [shadow, rock, blend(rock, tile, .38), tile]
  const brickTints = [rock, tile, blend(tile, moss, .33), blend(tile, edge, .19)]
  const turfTints = [moss, blend(moss, edge, .24), blend(moss, shadow, .20)]
  for (const [index, platform] of course.platforms.entries()) {
    const x = worldX(platform.x + platform.w / 2)
    const y = worldY(platform.y)
    const width = worldX(platform.w)
    const deep = .85 + (index * 7 % 4) * .22
    cliffs.add([x, y - deep * .51 - .12, -.05], [width * .52, deep, 1.43], 0, rock)
    cliffs.add([x - width * .16, y - deep * .86 - .15, -.18], [width * .29, deep * .64, .92], -.14, shadow)
    cliffs.add([x + width * .20, y - deep * .92 - .10, -.10], [width * .24, deep * .79, .83], .17, rockTints[2])
    const tiles = Math.round(width / .38)
    const span = width / tiles
    solids.add([x, y - .088, 0], [width, .176, 1.62], 0, moss)
    for (let i = 0; i < tiles; i++) {
      const at = x - width / 2 + (i + .5) * span
      const n = i * 17 + index * 13
      blocks.add([at, y - .175, .767], [span * .97, .255, .19], 0, brickTints[n % 4])
      solids.add([at, y - .045, .795], [span * .988, .09, .155], 0, turfTints[n % 3], .26)
      solids.add([at, y - .001, .35 + (n % 3) * .15], [span * .97, .006, .30], 0, turfTints[n % 3], .28)
      if (n % 3 !== 1) {
        blocks.add([at - span * .12, y - .337 - (n % 2) * .036, .673],
          [span * .82, .16, .16], 0, rockTints[n % 4])
      }
      if (n % 4 === 1) {
        pillars.add([at, y + .025, -.60], [.095, .12, .068], n, tile)
        trees.add([at + .12, y + .08, -.61], [.045, .20, .042], n, turfTints[1], .28)
      }
      if (n % 5 === 2) {
        trees.add([at, y - .31, .757], [.07, .42 + (n % 3) * .15, .043],
          n, turfTints[2], .15)
        trees.add([at + .043, y - .23, .8], [.049, .28, .031], -n, moss)
      }
    }
    for (let i = 0; i < 3; i++) {
      blocks.add([x + width * (-.28 + i * .26), y - deep * (.34 + (i % 2) * .17), .87 - (i % 2) * .055],
        [width * (.15 + i * .032), .067, .115], 0, rockTints[i], .13)
    }

    const west = x - width * .33
    if (course.theme === 'ice') {
      for (let i = 0; i < 4; i++) {
        const size = .28 + (i % 3) * .22
        ornaments.add([west + i * .16, y + size * .42, -.74], [.10, size, .13], i * .53,
          blend(moss, edge, i / 4), .45)
      }
    } else if (index % 3 !== 1 && index !== 5 && course.theme !== 'storm') {
      const size = .78 + (index % 3) * .28
      pillars.add([west, y + size * .31, -.67], [.067, size * .62, .061], .10, shadow)
      for (let i = 0; i < 3; i++) {
        trees.add([west + (i - 1) * .05, y + size * (.44 + i * .21), -.69],
          [size * (.33 - i * .065), size * .62, size * (.23 - i * .042)], .2 + i * .27,
          i === 2 ? turfTints[1] : turfTints[2 - i], .13)
      }
    } else if (index !== 5) {
      for (let i = 0; i < 3; i++) {
        const height = .19 + (i % 2) * .27
        blocks.add([west + i * .26, y + height / 2, -.68], [.24, height, .27], i * .10, rockTints[i + 1])
        if (i === 1) ornaments.add([west + .26, y + height, -.68], [.085, .12, .08], .3, edge, .74)
      }
    }
  }

  for (const spikes of course.spikes) {
    const count = Math.max(2, Math.round(spikes.w / 8))
    const width = worldX(spikes.w)
    solids.add([worldX(spikes.x + spikes.w / 2), worldY(spikes.y + spikes.h), .21],
      [width + .055, .045, .31], 0, shadow)
    for (let i = 0; i < count; i++) {
      trees.add([worldX(spikes.x + (i + .5) * spikes.w / count), worldY(spikes.y + spikes.h / 2), .21],
        [width / count * .67, worldX(spikes.h), .14], .35, hazard, .74)
    }
  }
  for (const pad of course.pads) {
    const x = worldX(pad.x + pad.w / 2)
    const y = worldY(pad.y)
    blocks.add([x, y + .035, 0], [worldX(pad.w), .07, .96], 0, padBase)
    for (const z of [-.32, 0, .32]) {
      solids.add([x, y + .08, z], [worldX(pad.w) * .83, .036, .06], 0, padTop, .9)
    }
  }
  const gate = course.beacon
  const gateX = worldX(gate.x + gate.w / 2)
  const gateY = worldY(gate.y + gate.h)
  for (const side of [-1, 1]) {
    const x = gateX + side * .33
    blocks.add([x, gateY + .12, -.19], [.28, .24, .46], 0, stoneDark)
    blocks.add([x, gateY + .57, -.19], [.18, .95, .33], 0, rock)
    blocks.add([x, gateY + .95, -.19], [.23, .18, .40], 0, metal, .25)
    solids.add([x, gateY + .61, -.008], [.07, .55, .055], 0, edge, .74)
    ornaments.add([x, gateY + 1.06, -.19], [.09, .13, .09], 0, sun, .8)
  }
  blocks.add([gateX, gateY + 1.03, -.19], [.83, .158, .36], 0, stoneDark)
  solids.add([gateX, gateY + 1.08, -.003], [.58, .061, .036], 0, metal, .44)

  let camera: Matrix
  let previousWidth = 0
  let previousCenter = 0

  function drawScout(player: PlayerSnapshot, now: number, local: boolean) {
    const x = worldX(player.x + 12)
    const y = worldY(player.y + 32)
    const z = local ? .20 : -.06 - player.slot * .045
    sprites.scout(player, projectPoint(camera, x, y, z), .096, now, local)
  }

  return {
    render(players: readonly PlayerSnapshot[], local: PlayerSnapshot | undefined, now: number) {
      const canvas = renderer.canvas
      const width = viewHeight * Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight)
      const courseWidth = worldX(WIDTH)
      const lead = worldX((local?.x ?? course.spawn.x) + 12) + width * .13
      const margin = (fullWidth - courseWidth) / 2
      const center = width >= fullWidth ? courseWidth / 2 :
        Math.max(width / 2 - margin, Math.min(courseWidth + margin - width / 2, lead))
      if (width !== previousWidth || center !== previousCenter) {
        camera = multiply(orthographic(width, viewHeight, .1, 84), view([center, 6.3, 18], [center, 2.25, 0]))
        previousWidth = width
        previousCenter = center
      }
      const time = reducedMotion?.matches ? 0 : now / 1000
      shards.clear()
      for (const [i, crystal] of course.crystals.entries()) {
        if (local?.crystals & (1 << i)) continue
        const y = worldY(crystal.y) + Math.sin(time * 3 + i) * .075
        const x = worldX(crystal.x)
        shards.add([x, y, .12], [.145, .25, .145], time * 1.7 + i, glow, .67)
        shards.add([x, y + .31 + Math.sin(time * 4 + i) * .045, .15], [.029, .044, .029],
          time + i, blend(glow, sun, .56), 1)
      }
      const charged = local?.crystals === (1 << course.crystals.length) - 1
      shards.add([gateX, gateY + 1.38, -.06], [.165, .26, .165], time * 1.3, charged ? glow : sun, .75)
      if (charged) shards.add([gateX, gateY + .55, -.16], [.23, .41, .06], 0, dim, .68)
      const stats = renderer.render(camera, all, sky)
      sprites.begin(renderer.canvas)
      if (!local?.signal) {
        const y = worldY(course.signal.y) + Math.sin(time * 3) * .07
        sprites.signal(projectPoint(camera, worldX(course.signal.x), y - .16, .08), now)
      }
      for (const player of players) {
        if (player.id !== local?.id) drawScout(player, now, false)
      }
      if (local) drawScout(local, now, true)
      return stats
    },
    dispose() {
      for (const batch of all) renderer.release(batch)
      for (const batch of backdrop) renderer.releaseMesh(batch.mesh)
    }
  }
}
