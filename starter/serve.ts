import { createGameHost, startGameHost } from '../framework/server.ts'

const source = import.meta.url.endsWith('.ts')
const root = new URL('.', import.meta.url)
const testing = process.argv.includes('--testing')
const reviews = testing ? (await import('../framework/review-store.ts')).createArtReviewHandler(root) : undefined
const app = createGameHost({
  root, moduleRoot: source ? new URL('../dist/starter/', root) : root,
  files: ['index.html', 'style.css', 'main.js', 'game.js', ...(testing ? ['testing.js', 'testing-scene.js', 'testing.html'] : [])],
  artDirectories: ['art'],
  aliases: { '/': 'index.html' },
  async handle(req, res, path) {
    if (testing && path === '/' && !new URL(req.url, 'http://localhost').searchParams.has('testing')) {
      const url = new URL(req.url, 'http://localhost')
      url.searchParams.set('testing', '1')
      res.writeHead(302, { Location: '/' + url.search }).end()
      return true
    }
    return reviews ? reviews(req, res, path) : false
  }
})
startGameHost(app, testing ? { host: '127.0.0.1', name: 'Ridgetop testing' } : {})
if (testing) app.server.once('listening', () => {
  const address = app.server.address()
  if (typeof address === 'object' && address) console.log('Open http://127.0.0.1:' + address.port + '/?testing=1')
})
