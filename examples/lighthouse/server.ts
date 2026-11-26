import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

const files = ['index.html', 'game-ui.css']

export function createLighthouseServer({ testing }: { testing?: boolean } = {}) {
  const source = import.meta.url.endsWith('.ts')
  const root = new URL(source ? '.' : '../', import.meta.url)
  const moduleRoot = new URL(source ? 'dist/' : '.', import.meta.url)
  return createGameHost({
    root,
    moduleRoot,
    files,
    mounts: {
      '/lighthouse/': { dir: new URL('lighthouse/', moduleRoot), extensions: ['js'] }
    },
    aliases: { '/': 'index.html' },
    testing
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const app = createLighthouseServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Tidewatch testing' } : { name: 'Tidewatch' })
}
