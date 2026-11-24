import { box, color, createMeshPool, cylinder, instances, octahedron, renderRig } from 'ridgetop'
import type { InstanceBatch, Rig } from 'ridgetop'
import { defaultMenuLayout } from 'ridgetop/server'
import type { ResolvedGameAssets } from 'ridgetop/server'
import {
  amberRig, arch, buildStaticIslandBatches, buoyRig, cone, domeMesh, drum, drum12,
  keeperRig, salvageRig, shipRig
} from './art.ts'

export function resolvePackageAssets(): ResolvedGameAssets {
  const models: Record<string, readonly InstanceBatch[]> = {}
  models.island = buildStaticIslandBatches()

  const bakeRig = (rig: Rig) => {
    const pool = createMeshPool(32)
    renderRig(rig, { position: [0, 0, 0], yaw: 0, scale: 1 }, {}, pool)
    return pool.batches.filter(b => b.count > 0)
  }

  models.keeper = bakeRig(keeperRig)
  models.ship = bakeRig(shipRig)
  models.buoy = bakeRig(buoyRig)
  models.salvage = bakeRig(salvageRig)
  models.amber = bakeRig(amberRig)

  // Standalone centered Lighthouse Tower mesh built directly from Tidewatch art primitives
  const lhPool = createMeshPool(32)
  const cream = color('f6ebd0')
  const red = color('da583e')
  const iron = color('273a45')
  const stone = color('8f9a97')
  const copper = color('4b857b')
  const lampGlow = color('ffe79c')
  lhPool.add(drum12, [0, 0.28, 0], [1.74, 0.56, 1.74], 0, color('7d8c8b'))
  lhPool.add(drum12, [0, 0.62, 0], [1.54, 0.24, 1.54], 0, stone)
  const courses = [
    [0.68, 1.60, 1.36, 1.22, cream],
    [1.60, 2.52, 1.22, 1.09, red],
    [2.52, 3.44, 1.09, 0.96, cream],
    [3.44, 4.36, 0.96, 0.85, red],
    [4.36, 5.26, 0.85, 0.76, cream]
  ] as const
  for (const [low, high, rBot, rTop, tint] of courses) {
    lhPool.add(cylinder(12, rTop / rBot), [0, (low + high) / 2, 0], [rBot, high - low, rBot], 0, tint)
  }
  lhPool.add(arch, [0, 1.26, 1.28], [0.64, 0.94, 0.16], 0, iron)
  lhPool.add(box, [0, 1.18, 1.26], [0.46, 0.78, 0.10], 0, color('5c3e2b'))
  lhPool.add(cylinder(12, 1.32), [0, 5.20, 0], [0.84, 0.22, 0.84], 0, stone)
  lhPool.add(drum12, [0, 5.38, 0], [1.14, 0.20, 1.14], 0, iron)
  lhPool.add(octahedron, [0, 6.02, 0], [0.44, 0.58, 0.44], 0, lampGlow, 0.98)
  lhPool.add(drum12, [0, 6.58, 0], [0.84, 0.14, 0.84], 0, copper)
  lhPool.add(domeMesh, [0, 6.96, 0], [1.72, 0.72, 1.72], 0, red)
  lhPool.add(cone, [0, 7.40, 0], [0.44, 0.42, 0.44], 0, copper)
  lhPool.add(drum, [0, 7.72, 0], [0.06, 0.44, 0.06], 0, iron)
  lhPool.add(octahedron, [0, 7.98, 0], [0.12, 0.12, 0.12], 0, color('f0c056'), 0.5)
  models.lighthouse = lhPool.batches.filter(b => b.count > 0)

  let iconBatches = models.keeper
  if (!iconBatches?.length) {
    const fallback = instances(box, 1)
    fallback.add([0, 0.5, 0], [1, 1, 1], 0, color('ebb336'))
    models.keeper = [fallback]
    iconBatches = [fallback]
  }

  return {
    title: 'Tidewatch',
    icon: { batches: iconBatches, span: 1.9, centerY: 0.85, background: '#142431', accent: '#2c5a66' },
    models,
    audio: {
      pickup: { notes: [[460, 0.11, 0, 690]], waveform: 'triangle' },
      sell: { notes: [[740, 0.09, 0], [1080, 0.14, 0.055]], waveform: 'triangle' },
      fuel: { notes: [[220, 0.16, 0, 440]], waveform: 'triangle' },
      upgrade: { notes: [[392, 0.16, 0], [493.88, 0.16, 0.09], [587.33, 0.22, 0.18], [783.99, 0.36, 0.28]], waveform: 'sine' },
      foghorn: { notes: [[116.54, 0.85, 0, 110], [174.61, 0.82, 0.02, 168]], waveform: 'sawtooth' },
      tideLow: { notes: [[523.25, 0.18, 0], [392.0, 0.26, 0.14]], waveform: 'sine' },
      tideHigh: { notes: [[329.63, 0.18, 0], [440.0, 0.26, 0.14]], waveform: 'sine' },
      victory: { notes: [[293.66, 0.2, 0], [392.0, 0.2, 0.14], [493.88, 0.24, 0.28], [587.33, 0.52, 0.42]], waveform: 'sine' }
    },
    gameData: {
      game: 'lighthouse',
      theme: {
        surface: '#13252ee8',
        surfaceAlt: '#1e3945f4',
        top: '#3a627088',
        border: '#6ea3a699',
        accent: '#f0b154',
        accentText: '#142026',
        text: '#f5f2e1',
        muted: '#b5d0d1',
        glow: '#84f2d8'
      }
    },
    uiTree: defaultMenuLayout('Tidewatch', ['Begin Watch', 'Workshop Gear', 'Quit'])
  }
}
