import { createGameHost, isMain, startGameHost } from '../../framework/server.ts'

export function createStarterServer({ testing }: { testing?: boolean } = {}) {
  const root = new URL('.', import.meta.url)
  return createGameHost({
    root,
    files: ['index.html', 'style.css', 'main.js', 'game.js'],
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
