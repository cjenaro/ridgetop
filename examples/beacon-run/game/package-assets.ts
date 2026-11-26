import { createArtKit } from 'ridgetop'
import type { InstanceBatch } from 'ridgetop'
import type { ResolvedGameAssets } from 'ridgetop/server'

export function resolvePackageAssets(): ResolvedGameAssets {
  const kit = createArtKit({ palette: { accent: '#efac62', glow: '#83f0d6', leaf: '#387a65' } })
  const models: Record<string, readonly InstanceBatch[]> = {}
  for (const role of ['lantern', 'crystal', 'pine', 'rock'] as const) {
    const g = kit.group()
    g.add(role, [0, 0, 0])
    models[role] = g.batches
  }
  const lantern = kit.model('lantern')
  return {
    title: 'Beacon Run',
    icon: { batches: models.lantern, span: lantern.span, centerY: lantern.centerY, background: '#142431', accent: '#2a5652' },
    models,
    audio: {
      jump: { notes: [[310, .10, 0, 495]], waveform: 'sine' },
      crystal: { notes: [[660, .12, 0], [990, .13, .07]], waveform: 'sine' },
      signal: { notes: [[420, .12, 0], [630, .14, .09], [840, .16, .18]], waveform: 'sine' },
      hit: { notes: [[195, .23, 0, 70]], waveform: 'triangle' },
      finish: { notes: [[392, .16, 0], [493.9, .17, .13], [587.3, .18, .26], [784, .38, .39]], waveform: 'sine' }
    },
    gameData: { game: 'beacon-run', courses: ['ridge', 'ruins', 'summit', 'storm', 'foundry', 'lastlight'] }
  }
}
