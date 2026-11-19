import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GameHost } from './server-types.ts'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const browserModules = [
  'index.js', 'verification.js', 'loop.js', 'renderer.js', 'room-client.js',
  'geometry.js', 'instances.js', 'low-poly.js', 'mesh-gpu.js', 'mesh-gl.js', 'mesh-canvas.js',
  'input.js', 'vehicle.js', 'page.js', 'audio.js', 'hud.js', 'sprites.js', 'platformer.js'
]
const mime = { html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png' }

export function sendText(res: ServerResponse, status: number, message = '') {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message)
}

export function sendJson(res: ServerResponse, value: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(value))
}

export function createGameHost({ root, moduleRoot = root, files, aliases = {}, handle, stop, save }: {
  root: URL; moduleRoot?: URL; files: readonly string[]; aliases?: Record<string, string>
  handle?(request: IncomingMessage, response: ServerResponse, pathname: string): boolean | Promise<boolean>
  stop?(): void; save?(): void | Promise<void>
}): GameHost {
  const frameworkRoot = new URL(import.meta.url.endsWith('.ts') ? '../dist/framework/' : '.', import.meta.url)
  const assets = new Map(browserModules.map(file => ['/framework/' + file, new URL(file, frameworkRoot)]))
  for (const file of files) assets.set('/' + file, new URL(file, file.endsWith('.js') ? moduleRoot : root))
  for (const [path, file] of Object.entries(aliases)) assets.set(path, new URL(file, root))

  const server = createServer({ requestTimeout: 10_000, headersTimeout: 8_000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    try {
      const { pathname } = new URL(req.url, 'http://localhost')
      if (await handle?.(req, res, pathname)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405)
      if (pathname === '/healthz') return sendText(res, 200, 'ok')
      const asset = assets.get(pathname)
      if (!asset && pathname === '/favicon.ico') return sendText(res, 204)
      if (!asset) return sendText(res, 404, 'Not found')
      const extension = asset.pathname.split('.').at(-1)
      const type = mime[extension]
      const body = await readFile(asset)
      res.writeHead(200, {
        'Content-Type': extension === 'png' ? type : type ? type + '; charset=utf-8' : 'application/octet-stream',
        'Cache-Control': 'no-cache'
      }).end(req.method === 'HEAD' ? undefined : body)
    } catch (error) {
      if (!res.headersSent) sendText(res, 500, 'Server error')
      else res.destroy()
      if (error.code !== 'ECONNRESET') console.error(error)
    }
  })
  server.maxConnections = 1536
  let stopped = false
  function stopServices() {
    if (stopped) return
    stopped = true
    stop?.()
  }
  server.on('close', stopServices)

  let closing
  return {
    server,
    close() {
      closing ??= (async () => {
        stopServices()
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve())
            server.closeAllConnections()
          })
        }
        await save?.()
      })()
      return closing
    }
  }
}

export function isMain(url: string) {
  return Boolean(process.argv[1] && url === pathToFileURL(process.argv[1]).href)
}

export function startGameHost(app: GameHost, { name = 'Ridgetop', port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST ?? '0.0.0.0' } = {}) {
  app.server.listen(port, host, () => {
    const address = app.server.address()
    console.log(name + ' listening on port ' + (typeof address === 'object' && address ? address.port : port))
  })
  function close() {
    app.close().catch(error => {
      console.error('Game server shutdown failed', error.message)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
