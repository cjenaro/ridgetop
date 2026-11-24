import type { IncomingMessage, ServerResponse } from 'node:http'
import type { GameHost } from './server-types.ts'
import { createServer } from 'node:http'
import { lstat, readFile, stat } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const browserModules = [
  'index.js', 'verification.js', 'loop.js', 'renderer.js', 'room-client.js',
  'geometry.js', 'instances.js', 'low-poly.js', 'mesh-gpu.js', 'mesh-gl.js', 'mesh-canvas.js',
  'input.js', 'vehicle.js', 'page.js', 'platform.js', 'audio.js', 'audio-assets.js', 'import-mesh.js',
  'hud.js', 'sprites.js', 'sprite-sheet.js',
  'art.js', 'art-recipe.js', 'art-review.js', 'art-builder.js', 'platformer.js', 'animation.js', 'physics3d.js',
  'testing-runtime.js', 'testing-boot.js', 'testing-studio.js',
  'ui.js', 'ui-machine.js', 'ui-layout.js', 'ui-button.js', 'ui-toggle.js', 'ui-select.js', 'ui-slider.js', 'ui-menu.js', 'ui-canvas.js'
]
const testingBootTag = '\n<script type="module" src="/framework/testing-boot.js"></script>\n'
const mime = {
  html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png', json: 'application/json',
  glb: 'model/gltf-binary', obj: 'text/plain', wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg'
}
const binaryExtensions = new Set(['png', 'glb', 'wav', 'ogg', 'mp3'])

function injectTestingBoot(html: Buffer): Buffer {
  const text = html.toString('utf8')
  if (text.includes('/framework/testing-boot.js')) return html
  const closeBody = text.lastIndexOf('</body>')
  const next = closeBody >= 0
    ? text.slice(0, closeBody) + testingBootTag + text.slice(closeBody)
    : text + testingBootTag
  return Buffer.from(next, 'utf8')
}

async function artFile(pathname: string, folders: Map<string, URL>) {
  const start = pathname.lastIndexOf('/') + 1
  const folder = folders.get(pathname.slice(0, start))
  if (!folder) return
  let name: string
  try { name = decodeURIComponent(pathname.slice(start)) } catch { return }
  if (!/\.(png|json|glb|obj|wav|ogg|mp3)$/i.test(name) || /[/\\\0]/.test(name)) return
  const file = new URL(encodeURIComponent(name), folder)
  try { if ((await lstat(file)).isFile()) return file }
  catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
  }
}

export function sendText(res: ServerResponse, status: number, message = '') {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message)
}

export function sendJson(res: ServerResponse, value: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(value))
}

export function createGameHost({ root, moduleRoot = root, files, artDirectories = [], aliases = {}, testing, handle, stop, save }: {
  root: URL; moduleRoot?: URL; files: readonly string[]; artDirectories?: readonly string[]; aliases?: Record<string, string>
  testing?: boolean
  handle?(request: IncomingMessage, response: ServerResponse, pathname: string): boolean | Promise<boolean>
  stop?(): void; save?(): void | Promise<void>
}): GameHost {
  const testingEnabled = testing ?? process.argv.includes('--testing')
  const frameworkRoot = new URL(import.meta.url.endsWith('.ts') ? '../dist/framework/' : '.', import.meta.url)
  const frameworkSourceRoot = new URL(import.meta.url.endsWith('.ts') ? '.' : '../../framework/', import.meta.url)
  const assets = new Map(browserModules.map(file => ['/framework/' + file, new URL(file, frameworkRoot)]))
  assets.set('/framework/testing-overlay.css', new URL('testing-overlay.css', frameworkSourceRoot))
  for (const file of files) assets.set('/' + file, new URL(file, file.endsWith('.js') ? moduleRoot : root))
  const artFolders = new Map<string, URL>()
  for (const directory of artDirectories) {
    const prefix = directory.replace(/\/$/, '') + '/'
    artFolders.set('/' + prefix, new URL(prefix, root))
  }
  for (const [path, file] of Object.entries(aliases)) assets.set(path, new URL(file, root))

  let reviewHandlerPromise: Promise<(req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>> | undefined
  async function handleTesting(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (!testingEnabled || !pathname.startsWith('/__testing/')) return false
    reviewHandlerPromise ??= import('./review-store.ts').then(mod => mod.createArtReviewHandler(root))
    const reviewHandler = await reviewHandlerPromise
    return reviewHandler(req, res, pathname)
  }

  const server = createServer({ requestTimeout: 10_000, headersTimeout: 8_000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    try {
      let pathname: string
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      } catch {
        return sendText(res, 400, 'Bad request')
      }
      if (await handle?.(req, res, pathname)) return
      if (await handleTesting(req, res, pathname)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405)
      if (pathname === '/healthz') return sendText(res, 200, 'ok')
      const asset = assets.get(pathname) ?? await artFile(pathname, artFolders)
      if (!asset && pathname === '/favicon.ico') return sendText(res, 204)
      if (!asset) return sendText(res, 404, 'Not found')
      const extension = asset.pathname.split('.').at(-1).toLowerCase()
      const type = mime[extension]
      const contentType = binaryExtensions.has(extension) ? type : type ? type + '; charset=utf-8' : 'application/octet-stream'
      if (testingEnabled && extension === 'html') {
        const body = injectTestingBoot(await readFile(asset))
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': String(body.byteLength),
          'Cache-Control': 'no-cache'
        }).end(req.method === 'HEAD' ? undefined : body)
        return
      }
      if (req.method === 'HEAD') {
        const info = await stat(asset)
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': String(info.size),
          'Cache-Control': 'no-cache'
        }).end()
        return
      }
      const body = await readFile(asset)
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'no-cache'
      }).end(body)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (!res.headersSent && code === 'ENOENT') return sendText(res, 404, 'Not found')
      if (!res.headersSent) sendText(res, 500, 'Server error')
      else res.destroy()
      if (code !== 'ECONNRESET') console.error(error)
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
