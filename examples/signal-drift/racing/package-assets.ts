import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArtKit } from 'ridgetop'
import type { InstanceBatch } from 'ridgetop'
import type { ResolvedGameAssets } from 'ridgetop/server'
import { createCarModels } from './car-art.ts'
import { buildCircuitBatches } from './scene.ts'
import { circuits } from './track.ts'

export async function resolvePackageAssets(ctx?: { projectDir?: string }): Promise<ResolvedGameAssets> {
  const models: Record<string, readonly InstanceBatch[]> = {}
  let iconBatches: readonly InstanceBatch[] | undefined
  const exportedCircuits: Record<string, unknown>[] = []

  for (let slot = 0; slot < 4; slot++) {
    const cars = createCarModels()
    cars.add({ x: 0, z: 0, yaw: 0, slot }, 0, 0, false, slot === 0 ? { motor: 1, tires: 1, armor: 1, capacitor: 1 } : undefined)
    models[`car-${slot}`] = cars.full
    if (slot === 0) {
      models['rally-car'] = cars.full
      iconBatches = cars.full
    }
  }

  for (const c of circuits) {
    const built = buildCircuitBatches(c)
    models[`circuit-${c.id}`] = built.staticBatches
    const samples: number[][] = []
    const count = 96
    for (let i = 0; i < count; i++) {
      const p = c.route.sample(i / count)
      samples.push([Number(p.x.toFixed(3)), Number(p.z.toFixed(3)), Number(p.yaw.toFixed(4))])
    }
    exportedCircuits.push({
      id: c.id,
      name: c.name,
      description: c.description,
      width: c.width,
      laps: c.laps,
      qualify: c.qualify,
      purse: c.purse,
      pace: c.pace,
      grip: c.grip,
      clear: built.clear,
      samples
    })
  }

  if (!iconBatches) {
    const kit = createArtKit({ palette: { accent: '#f8aa4e', glow: '#8df5d5', leaf: '#56bfae' } })
    const g = kit.group()
    g.add('crystal', [0, 0, 0])
    models.crystal = g.batches
    iconBatches = g.batches
  }

  const rootDir = ctx?.projectDir ?? fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '..' : '../..', import.meta.url))
  const mainScript = await readFile(join(rootDir, 'racing', 'godot-main.gd'), 'utf8')

  return {
    title: 'Signal Drift',
    icon: { batches: iconBatches, span: 3.6, centerY: 0.55, background: '#191b24', accent: '#623a2c' },
    models,
    audio: {
      pulse: { notes: [[610, .12, 0, 240]], waveform: 'triangle' },
      snare: { notes: [[300, .18, 0, 105]], waveform: 'sine' },
      hit: { notes: [[175, .2, 0, 68]], waveform: 'triangle' },
      go: { notes: [[660, .15, 0], [880, .20, .10]], waveform: 'sine' },
      podium: { notes: [[392, .18, 0], [523, .17, .12], [660, .24, .26], [784, .38, .42]], waveform: 'sine' }
    },
    gameData: {
      game: 'signal-drift',
      theme: {
        surface: '#221a19ee', surfaceAlt: '#382924f4', top: '#6b473b88', border: '#e2a77399',
        accent: '#f8aa4e', accentText: '#1e1410', text: '#fff2e2', muted: '#d8beaa', glow: '#8df5d5'
      },
      circuits: exportedCircuits
    },
    mainScript
  }
}
