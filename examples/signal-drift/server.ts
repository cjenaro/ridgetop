import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

const files = ['index.html', 'game-ui.css', 'racing/style.css']

export function createSignalDriftServer({ testing }: { testing?: boolean } = {}) {
  const source = import.meta.url.endsWith('.ts')
  const root = new URL(source ? '.' : '../', import.meta.url)
  const moduleRoot = new URL(source ? 'dist/' : '.', import.meta.url)
  return createGameHost({
    root,
    moduleRoot,
    files,
    mounts: {
      '/racing/': { dir: new URL('racing/', moduleRoot), extensions: ['js'] }
    },
    aliases: { '/': 'index.html' },
    hosted: false,
    testing
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const app = createSignalDriftServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Signal Drift testing' } : { name: 'Signal Drift' })
}
