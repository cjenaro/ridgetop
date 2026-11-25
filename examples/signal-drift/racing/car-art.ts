import { box, chamferedPrism, color, cylinder, instances, quaternionFromEuler, rotateVec3 } from 'ridgetop'
import type { Color, InstanceBatch, Vec3 } from 'ridgetop'
import type { Build } from './progression.ts'

const wheel = cylinder(8)
const wheelHub = cylinder(6)
const chassis = chamferedPrism(.17, .89, .93)
const canopy = chamferedPrism(.15, .55, .73)
const tire = color('20232d')
const glass = color('335872')
const roofGlass = color('739bb0')
export const carTrim = color('2f3548')
const lamps = color('ffeccc')
const tail = color('ff464b')
const shadow = color('271e29')
export const liveryColors = [
  ['f8aa4e', 'ffd895', '952d43'],
  ['56bfae', 'b8f3d5', '245c69'],
  ['db78a6', 'ffc8d2', '753b67'],
  ['75a0e9', 'd3e6ff', '453d80']
]
export const carLivery = liveryColors.map(colors => colors.map(color))
const alloy = color('94aaa6')
const highlight = color('8df5d5')
const tread = color('282c36')

export function createCarModels(livery?: readonly Color[]) {
  const cars = instances(box)
  const bodies = instances(chassis)
  const windows = instances(canopy)
  const wheels = instances(wheel)
  const hubs = instances(wheelHub)
  const common = [cars, bodies, windows, wheels]
  const full = [...common, hubs]
  function add(driver: { x: number; z: number; yaw: number; slot: number }, pitch: number, roll: number,
    simple: boolean, fitted?: Readonly<Build>, builtInShadow = true) {
    const rotation = quaternionFromEuler(pitch, driver.yaw, roll)
    const wheelRotation = quaternionFromEuler(pitch, driver.yaw, roll + Math.PI / 2)
    const [paint, stripe, accent] = livery ?? carLivery[driver.slot]
    const hatch = driver.slot % 2 === 0
    function place(batch: InstanceBatch, offset: Vec3, scale: Vec3, tint: Color, emission = 0) {
      const [x, y, z] = rotateVec3(rotation, offset)
      const orient = batch === wheels || batch === hubs ? wheelRotation : rotation
      batch.add([driver.x + x, .44 + y, driver.z + z], scale, orient, tint, emission)
    }
    if (builtInShadow) bodies.add([driver.x, .074, driver.z], [2.12, .018, 3.4], driver.yaw, shadow, 1)
    place(bodies, [0, .04, 0], [1.76, .55, 2.92], paint, .08)
    place(windows, [0, .50, -.23], [1.36, hatch ? .53 : .43, hatch ? 1.58 : 1.32], glass, .18)
    place(bodies, [0, hatch ? .755 : .70, -.29], [.81, .07, hatch ? .99 : .88], paint, .14)
    place(cars, [0, hatch ? .794 : .739, -.29], [.23, .021, .82], stripe, .39)
    place(cars, [0, .324, .90], [.25, .021, .88], stripe, .48)
    if (!simple) {
      place(bodies, [0, -.12, -.02], [1.82, .18, 2.86], accent, .12)
      place(cars, [0, .322, 1.39], [.60, .08, .074], carTrim)
      place(bodies, [0, -.014, 1.40], [1.65, .16, .22], carTrim)
      place(bodies, [0, -.012, -1.42], [1.69, .16, .22], carTrim)
    }
    for (const side of [-1, 1]) {
      place(cars, [side * .59, .195, 1.422], [.29, .125, .106], lamps, 1)
      place(cars, [side * .62, .163, -1.439], [.29, .10, .102], tail, .9)
      if (!simple) {
        place(cars, [side * .88, .048, -.19], [.043, .17, .61], stripe, .32)
        place(bodies, [side * .77, .403, .23], [.26, .15, .22], paint, .15)
      }
      for (const z of [-.88, .88]) {
        place(wheels, [side * .83, -.108, z], [.345, .425, .345], tire)
        if (!simple) place(hubs, [side * 1.054, -.108, z], [.217, .034, .217], roofGlass, .48)
      }
    }
    if (!hatch) {
      for (const side of [-1, 1]) place(cars, [side * .54, .35, -1.21], [.18, .27, .15], accent)
      place(bodies, [0, .50, -1.24], [1.68, .092, .34], paint, .23)
    }
    if (fitted?.motor) {
      place(bodies, [0, .39, .84], [.51 + fitted.motor * .10, .16, .43], carTrim)
      for (let i = 0; i < fitted.motor; i++) {
        place(cars, [(i - (fitted.motor - 1) / 2) * .19, .446, .894], [.12, .12, .26], alloy, .23)
      }
    }
    if (fitted?.tires) {
      for (const side of [-1, 1]) for (const z of [-.88, .88]) {
        place(bodies, [side * .80, .18, z], [.33 + fitted.tires * .045, .14, .74], tread, .14)
      }
    }
    if (fitted?.armor) {
      for (const z of [-1.49, 1.49]) {
        place(bodies, [0, .06, z], [1.76 + fitted.armor * .045, .145 + fitted.armor * .025, .17], alloy, .19)
      }
      place(cars, [0, .17, 1.54], [.64, .045, .07], highlight, .62)
    }
    if (fitted?.capacitor) {
      place(bodies, [0, .33, -1.09], [.89, .20, .39], carTrim)
      for (let i = 0; i < fitted.capacitor; i++) {
        place(cars, [(i - (fitted.capacitor - 1) / 2) * .19, .425, -1.11],
          [.10, .052, .32], highlight, .93)
      }
    }
  }
  return { common, full, add, clear() { for (const batch of full) batch.clear() } }
}
