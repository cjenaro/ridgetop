import { box, color, cylinder, instances, multiply, orthographic, view } from 'ridgetop'
import type { LowPolyRenderer } from 'ridgetop'
import { createCarModels } from './car-art.ts'
import type { Build, Upgrade } from './progression.ts'

const turntable = cylinder(12)
const angle = { motor: -.32, tires: -.87, armor: .21, capacitor: 2.79 }
const clear = color('0b1a21')
const floorInk = color('182b34')
const floorGrid = color('23434b')
const deck = color('30464c')
const steel = color('497475')
const amber = color('f5ae62')
const mint = color('6af1ce')

export function createGarageBay(renderer: LowPolyRenderer) {
  const model = createCarModels()
  const architecture = instances(box)
  const podium = instances(turntable)
  architecture.add([0, -.43, 0], [29, .18, 26], 0, floorInk, .54)
  for (let i = -6; i <= 6; i++) {
    architecture.add([i * 1.4, -.335, 0], [.016, .012, 18], 0, floorGrid, .79)
    architecture.add([0, -.334, i * 1.4], [18, .012, .016], 0, floorGrid, .79)
  }
  podium.add([0, -.213, 0], [2.56, .235, 2.56], Math.PI / 12, deck)
  podium.add([0, -.111, 0], [2.49, .075, 2.49], Math.PI / 12, steel, .28)
  podium.add([0, -.072, 0], [2.35, .048, 2.35], Math.PI / 12, deck)
  for (let i = 0; i < 12; i++) {
    const radians = i * Math.PI / 6
    architecture.add([Math.cos(radians) * 2.48, -.111, Math.sin(radians) * 2.48],
      [.07, .035, .39], -radians, i % 3 ? mint : amber, .98)
  }
  for (const side of [-1, 1]) {
    architecture.add([side * 3.8, -.24, -.54], [.6, .19, 5.4], 0, deck)
    architecture.add([side * 3.8, -.131, -.54], [.047, .025, 5.08], 0, mint, .87)
    for (let i = 0; i < 5; i++) {
      architecture.add([side * 3.8, -.13, .51 + i * .33], [.31, .016, .097], side * -.46, amber, .85)
    }
  }
  const batches = [architecture, podium, ...model.full]
  const camera = view([5.5, 3.7, 7.2], [0, .38, 0])
  let lastCanvas: HTMLCanvasElement
  let lastKey: string
  let lastModel: string

  return {
    invalidate() { lastKey = '' },
    render(part: Upgrade, build: Readonly<Build>) {
      const { canvas } = renderer
      const width = Math.max(1, canvas.clientWidth)
      const height = Math.max(1, canvas.clientHeight)
      const modelKey = [part, build.motor, build.tires, build.armor, build.capacitor].join('|')
      const key = [width, height, globalThis.devicePixelRatio, modelKey].join('|')
      if (lastCanvas === canvas && lastKey === key) return
      if (lastModel !== modelKey) {
        model.clear()
        model.add({ x: 0, z: 0, yaw: angle[part], slot: 0 }, 0, 0, false, build)
        lastModel = modelKey
      }
      const aspect = width / height
      const span = Math.max(3.62, 4.48 / aspect)
      renderer.render(multiply(orthographic(span * aspect, span, .1, 28), camera), batches, clear)
      lastCanvas = canvas
      lastKey = key
    },
    dispose() {
      for (const batch of batches) renderer.release(batch)
      renderer.releaseMesh(turntable)
    }
  }
}
