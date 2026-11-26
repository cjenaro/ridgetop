import { createArtKit } from 'ridgetop'
import type { InstanceBatch } from 'ridgetop'
import type { ResolvedGameAssets } from 'ridgetop/server'
import { AUDIO_MOTIFS } from './audio.ts'

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
    audio: AUDIO_MOTIFS,
    gameData: { game: 'beacon-run', courses: ['ridge', 'ruins', 'summit', 'storm', 'foundry', 'lastlight'] }
  }
}
