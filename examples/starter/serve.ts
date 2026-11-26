import { createGameHost, isMain, startGameHost } from 'ridgetop/server'

export function createStarterServer({ testing }: { testing?: boolean } = {}) {
  const source = import.meta.url.endsWith('.ts')
  const root = new URL(source ? '.' : '../', import.meta.url)
  const moduleRoot = new URL(source ? 'dist/' : '.', import.meta.url)
  return createGameHost({
    root,
    moduleRoot,
    files: ['index.html', 'style.css'],
    mounts: {
      '/': { dir: moduleRoot, extensions: ['js'], exclude: ['serve.js', 'preview-art.js', 'art-library.js', 'package.js'] }
    },
    artDirectories: ['art'],
    aliases: { '/': 'index.html' },
    testing
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const app = createStarterServer({ testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Ridgetop testing' } : { name: 'Lantern Grove' })
  if (testing) app.server.once('listening', () => {
    const address = app.server.address()
    if (typeof address === 'object' && address) console.log('Open http://127.0.0.1:' + address.port + '/?testing=1')
  })
}
