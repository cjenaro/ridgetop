import type { GameHostMount } from 'ridgetop/server'
import { createGameHost, isMain, startGameHost } from 'ridgetop/server'
import { createBeaconRunBackend } from './examples/beacon-run/server.ts'
import { createCharacterStore, openCharacterStore } from './examples/beacon-run/game/character-store.ts'

const rootStudioFiles = [
  'game-ui.css', 'benchmark.html', 'benchmark.js',
  'models/index.html', 'models/style.css', 'models/main.js', 'models/headland.js',
  'sprite-workshop.html', 'sprite-workshop.css', 'sprite-workshop.js', 'sprite-model-editor.js'
]

function buildExampleRoutes(root: URL): Record<string, URL> {
  return {
    '/': new URL('examples/beacon-run/index.html', root),
    '/index.html': new URL('examples/beacon-run/index.html', root),
    '/style.css': new URL('examples/beacon-run/style.css', root),
    '/main.js': new URL('examples/beacon-run/dist/main.js', root),
    '/racing': new URL('examples/signal-drift/index.html', root),
    '/racing.html': new URL('examples/signal-drift/index.html', root),
    '/racing/style.css': new URL('examples/signal-drift/racing/style.css', root),
    '/lighthouse': new URL('examples/lighthouse/index.html', root),
    '/lighthouse.html': new URL('examples/lighthouse/index.html', root),
    '/crownshard': new URL('examples/crownshard/index.html', root),
    '/crownshard.html': new URL('examples/crownshard/index.html', root),
    '/starter/': new URL('examples/starter/index.html', root),
    '/starter/index.html': new URL('examples/starter/index.html', root),
    '/starter/style.css': new URL('examples/starter/style.css', root)
  }
}

function buildExampleMounts(root: URL): Record<string, GameHostMount> {
  return {
    '/game/': { dir: new URL('examples/beacon-run/dist/game/', root), extensions: ['js'], exclude: ['character-store.js'] },
    '/racing/': { dir: new URL('examples/signal-drift/dist/racing/', root), extensions: ['js'] },
    '/lighthouse/': { dir: new URL('examples/lighthouse/dist/lighthouse/', root), extensions: ['js'] },
    '/crownshard/': { dir: new URL('examples/crownshard/dist/crownshard/', root), extensions: ['js'] },
    '/starter/': { dir: new URL('examples/starter/dist/', root), extensions: ['js'], exclude: ['serve.js'] }
  }
}

export function createGameServer({ characters = createCharacterStore(), testing }: {
  characters?: ReturnType<typeof createCharacterStore>
  testing?: boolean
} = {}) {
  const backend = createBeaconRunBackend({ characters })
  const source = import.meta.url.endsWith('.ts')
  const root = new URL(source ? '.' : '../', import.meta.url)
  return createGameHost({
    root,
    moduleRoot: new URL(source ? 'dist/' : '.', import.meta.url),
    files: rootStudioFiles,
    routes: buildExampleRoutes(root),
    mounts: buildExampleMounts(root),
    artMounts: {
      '/game/assets/': new URL('examples/beacon-run/game/assets/', root),
      '/starter/art/': new URL('examples/starter/art/', root)
    },
    aliases: { '/benchmark': 'benchmark.html', '/sprites': 'sprite-workshop.html', '/models': 'models/index.html' },
    testing,
    testingOptions: { artDir: 'examples/starter/art' },
    stop: backend.stop,
    save: backend.save,
    upgrade: backend.upgrade,
    async handle(req, res, pathname) {
      if (pathname === '/starter') {
        res.writeHead(308, { Location: '/starter/' + new URL(req.url ?? '/', 'http://localhost').search }).end()
        return true
      }
      return backend.handle(req, res, pathname)
    }
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const characters = await openCharacterStore(process.env.RIDGETOP_CHARACTER_SAVE ?? 'data/characters.json')
  const app = createGameServer({ characters, testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Ridgetop testing' } : {})
  if (testing) app.server.once('listening', () => {
    const address = app.server.address()
    if (typeof address === 'object' && address) {
      const origin = 'http://127.0.0.1:' + address.port
      console.log(`Testing Mode enabled on ${origin}/ (Beacon Run), ${origin}/racing (Signal Drift), ${origin}/lighthouse (Tidewatch), ${origin}/crownshard (Crownshard), ${origin}/starter/ (Starter)`)
    }
  })
}
