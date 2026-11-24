import { createGameHost, startGameHost } from '../../framework/server.ts'

const root = new URL('.', import.meta.url)
const testing = process.argv.includes('--testing')
const app = createGameHost({
  root,
  files: ['index.html', 'style.css', 'main.js', 'game.js'],
  artDirectories: ['art'],
  aliases: { '/': 'index.html' },
  testing
})
startGameHost(app, testing ? { host: '127.0.0.1', name: 'Ridgetop testing' } : {})
if (testing) app.server.once('listening', () => {
  const address = app.server.address()
  if (typeof address === 'object' && address) console.log('Open http://127.0.0.1:' + address.port + '/?testing=1')
})
