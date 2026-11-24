import { readFile } from 'node:fs/promises'
import { createGameHost, startGameHost } from '../../framework/server.ts'

const source = import.meta.url.endsWith('.ts')
const root = new URL('.', import.meta.url)
const testing = process.argv.includes('--testing')
const overlayCss = new URL('../../framework/testing-overlay.css', root)
const app = createGameHost({
  root,
  moduleRoot: source ? new URL('../dist/starter/', root) : root,
  files: ['index.html', 'style.css', 'main.js', 'game.js'],
  artDirectories: ['art'],
  aliases: { '/': 'index.html' },
  testing,
  async handle(req, res, pathname) {
    if (testing && pathname === '/framework/testing-overlay.css' && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = await readFile(overlayCss)
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-cache'
      }).end(req.method === 'HEAD' ? undefined : body)
      return true
    }
    return false
  }
})
startGameHost(app, testing ? { host: '127.0.0.1', name: 'Ridgetop testing' } : {})
if (testing) app.server.once('listening', () => {
  const address = app.server.address()
  if (typeof address === 'object' && address) console.log('Open http://127.0.0.1:' + address.port + '/?testing=1')
})
