import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

const files = [
  'index.html', 'game-ui.css',
  'racing/style.css', 'racing/main.js', 'racing/race.js', 'racing/scene.js', 'racing/track.js',
  'racing/progression.js', 'racing/car-art.js', 'racing/garage.js', 'racing/garage-art.js', 'racing/save-menu.js'
]

export function createSignalDriftServer({ testing }: { testing?: boolean } = {}) {
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
  const app = createSignalDriftServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Signal Drift testing' } : { name: 'Signal Drift' })
}
