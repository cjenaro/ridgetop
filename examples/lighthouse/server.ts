import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

const files = [
  'index.html', 'game-ui.css',
  'lighthouse/main.js', 'lighthouse/types.js', 'lighthouse/simulation.js',
  'lighthouse/art.js', 'lighthouse/scene.js', 'lighthouse/audio.js'
]

export function createLighthouseServer({ testing }: { testing?: boolean } = {}) {
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
  const app = createLighthouseServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Tidewatch testing' } : { name: 'Tidewatch' })
}
