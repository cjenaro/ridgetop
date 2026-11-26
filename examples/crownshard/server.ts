import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

const files = [
  'index.html', 'game-ui.css',
  'crownshard/main.js', 'crownshard/types.js', 'crownshard/data.js',
  'crownshard/simulation.js', 'crownshard/art.js', 'crownshard/animations.js', 'crownshard/characters.js',
  'crownshard/parts/bodies-hair.js', 'crownshard/parts/headgear.js',
  'crownshard/parts/armor.js', 'crownshard/parts/weapons.js',
  'crownshard/scene.js', 'crownshard/vfx.js', 'crownshard/audio.js', 'crownshard/ui-art.js'
]

export function createCrownshardServer({ testing }: { testing?: boolean } = {}) {
  const source = import.meta.url.endsWith('.ts')
  return createGameHost({
    root: new URL(source ? '.' : '../', import.meta.url),
    moduleRoot: new URL(source ? 'dist/' : '.', import.meta.url),
    files,
    aliases: { '/': 'index.html' },
    testing
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const app = createCrownshardServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Crownshard testing' } : { name: 'Crownshard' })
}
