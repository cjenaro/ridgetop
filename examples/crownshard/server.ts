import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

const files = ['index.html', 'game-ui.css']

export function createCrownshardServer({ testing }: { testing?: boolean } = {}) {
  const source = import.meta.url.endsWith('.ts')
  const root = new URL(source ? '.' : '../', import.meta.url)
  const moduleRoot = new URL(source ? 'dist/' : '.', import.meta.url)
  return createGameHost({
    root,
    moduleRoot,
    files,
    mounts: {
      '/crownshard/': { dir: new URL('crownshard/', moduleRoot), extensions: ['js'] }
    },
    aliases: { '/': 'index.html' },
    testing
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const app = createCrownshardServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Crownshard testing' } : { name: 'Crownshard' })
}
