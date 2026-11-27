import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { GameHost } from './server-types.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { appendFile, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { HOSTED_BROWSER_MODULES, RIDGETOP_BROWSER_IMPORT_MAP, lookupAssetMime } from './manifest.ts'
import { defaultHttpReason, rejectUpgrade } from './ws.ts'

export type UpgradeResult = boolean | void | { readonly reject: number; readonly reason?: string }

export interface GameHostMount {
  dir: URL
  extensions?: readonly string[]
  exclude?: readonly string[]
}

const defaultMountExtensions: ReadonlySet<string> = new Set(['js', 'css', 'html'])

interface ResolvedMount {
  prefix: string
  rootPath: string
  extensions: ReadonlySet<string>
  exclude: ReadonlySet<string>
}

const browserModules = HOSTED_BROWSER_MODULES

export const ridgetopBrowserSpecifiers: Readonly<Record<string, string>> = RIDGETOP_BROWSER_IMPORT_MAP

const importMapJson = JSON.stringify({ imports: ridgetopBrowserSpecifiers })
const importMapHash = createHash('sha256').update(importMapJson).digest('base64')
const importMapTag = `\n  <script type="importmap">${importMapJson}</script>\n`
const contentSecurityPolicy =
  `default-src 'self'; script-src 'self' 'sha256-${importMapHash}'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`

const testingStudioTag = '\n<script type="module" src="/framework/testing-studio.js"></script>\n'

function injectImportMap(text: string): string {
  if (/<script\b[^>]*\btype\s*=\s*["']importmap["']/i.test(text)) return text
  const headMatch = /<head\b[^>]*>/i.exec(text)
  if (headMatch) {
    const pos = headMatch.index + headMatch[0].length
    return text.slice(0, pos) + importMapTag + text.slice(pos)
  }
  const htmlMatch = /<html\b[^>]*>/i.exec(text)
  if (htmlMatch) {
    const pos = htmlMatch.index + htmlMatch[0].length
    return text.slice(0, pos) + importMapTag + text.slice(pos)
  }
  return importMapTag + text
}

function prepareHtml(html: Buffer, testingEnabled: boolean, hosted: boolean): Buffer {
  let text = html.toString('utf8')
  if (!hosted) {
    text = text.replace(/\s+data-hosted="1"/g, '')
  }
  const hasModuleScript = /<script\b[^>]*\btype\s*=\s*["']module["']/i.test(text)
  if (hasModuleScript || testingEnabled) {
    text = injectImportMap(text)
  }
  if (testingEnabled && !text.includes('/framework/testing-studio.js')) {
    const closeBody = text.lastIndexOf('</body>')
    text = closeBody >= 0
      ? text.slice(0, closeBody) + testingStudioTag + text.slice(closeBody)
      : text + testingStudioTag
  }
  return Buffer.from(text, 'utf8')
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return undefined
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
    const code = errorCode(error)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
  }
}

async function mountFile(pathname: string, mountedDirs: readonly ResolvedMount[]): Promise<URL | undefined> {
  for (const mount of mountedDirs) {
    if (!pathname.startsWith(mount.prefix)) continue
    const rawRel = pathname.slice(mount.prefix.length)
    if (!rawRel || rawRel.endsWith('/')) continue
    const rawSegments = rawRel.split('/')
    const segments: string[] = []
    let valid = true
    for (const raw of rawSegments) {
      let decoded: string
      try { decoded = decodeURIComponent(raw) } catch { valid = false; break }
      if (!decoded || decoded === '.' || decoded === '..' || /[/\\\0]/.test(decoded)) {
        valid = false
        break
      }
      segments.push(decoded)
    }
    if (!valid || !segments.length) continue
    const relPath = segments.join('/')
    if (mount.exclude.has(relPath)) continue
    const last = segments[segments.length - 1]
    const dot = last.lastIndexOf('.')
    if (dot <= 0) continue
    const ext = last.slice(dot + 1).toLowerCase()
    if (!mount.extensions.has(ext)) continue
    const candidate = resolve(mount.rootPath, ...segments)
    if (!candidate.startsWith(mount.rootPath + sep)) continue
    try {
      let current = mount.rootPath
      let blocked = false
      for (let i = 0; i < segments.length - 1; i++) {
        current = resolve(current, segments[i])
        const dirInfo = await lstat(current)
        if (!dirInfo.isDirectory()) { blocked = true; break }
      }
      if (blocked) continue
      const fileInfo = await lstat(candidate)
      if (fileInfo.isFile()) return pathToFileURL(candidate)
    } catch (error) {
      const code = errorCode(error)
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    }
  }
}

function socketTouched(socket: Duplex): boolean {
  if (socket.destroyed || socket.writableLength > 0) return true
  return 'bytesWritten' in socket && typeof socket.bytesWritten === 'number' && socket.bytesWritten > 0
}

export function sendText(res: ServerResponse, status: number, message = '') {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message)
}

export function sendJson(res: ServerResponse, value: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    .end(JSON.stringify(value))
}

export function createGameHost({
  root, moduleRoot = root, files = [], routes = {}, mounts = {}, artDirectories = [], artMounts = {}, aliases = {}, testing, testingOptions, hosted = true, handle, upgrade, stop, save
}: {
  root: URL; moduleRoot?: URL; files?: readonly string[]
  routes?: Readonly<Record<string, URL>>
  mounts?: Readonly<Record<string, URL | GameHostMount>>
  artDirectories?: readonly string[]
  artMounts?: Readonly<Record<string, URL>>
  aliases?: Record<string, string>
  testing?: boolean
  testingOptions?: { artDir?: string; reviewsDir?: string }
  hosted?: boolean
  handle?(request: IncomingMessage, response: ServerResponse, pathname: string): boolean | Promise<boolean>
  upgrade?(request: IncomingMessage, socket: Duplex, head: Buffer, pathname: string): UpgradeResult | Promise<UpgradeResult>
  stop?(): void; save?(): void | Promise<void>
}): GameHost {
  const testingEnabled = testing ?? process.argv.includes('--testing')
  const frameworkRoot = new URL(import.meta.url.endsWith('.ts') ? '../dist/framework/' : '.', import.meta.url)
  const frameworkSourceRoot = new URL(import.meta.url.endsWith('.ts') ? '.' : '../../framework/', import.meta.url)
  const assets = new Map(browserModules.map(file => ['/framework/' + file, new URL(file, frameworkRoot)]))
  const testingCssFromRoot = new URL('testing-overlay.css', frameworkRoot)
  const testingCssAsset = existsSync(fileURLToPath(testingCssFromRoot))
    ? testingCssFromRoot
    : new URL('testing-overlay.css', frameworkSourceRoot)
  assets.set('/framework/testing-overlay.css', testingCssAsset)
  for (const file of files) assets.set('/' + file, new URL(file, file.endsWith('.js') ? moduleRoot : root))
  for (const [routePath, url] of Object.entries(routes)) assets.set(routePath, url)
  const mountedDirs: ResolvedMount[] = Object.entries(mounts).map(([mountPath, entry]) => {
    const prefix = (mountPath.startsWith('/') ? mountPath : '/' + mountPath).replace(/\/$/, '') + '/'
    const dir = entry instanceof URL ? entry : entry.dir
    const extensions = entry instanceof URL || !entry.extensions
      ? defaultMountExtensions
      : new Set(entry.extensions.map(ext => ext.replace(/^\./, '').toLowerCase()))
    const exclude = entry instanceof URL || !entry.exclude
      ? new Set<string>()
      : new Set(entry.exclude.map(rel => rel.replace(/^\/+/, '')))
    return { prefix, rootPath: resolve(fileURLToPath(dir)), extensions, exclude }
  }).sort((a, b) => b.prefix.length - a.prefix.length)
  const artFolders = new Map<string, URL>()
  for (const directory of artDirectories) {
    const prefix = directory.replace(/\/$/, '') + '/'
    artFolders.set('/' + prefix, new URL(prefix, root))
  }
  for (const [mountPath, url] of Object.entries(artMounts)) {
    const prefix = (mountPath.startsWith('/') ? mountPath : '/' + mountPath).replace(/\/$/, '') + '/'
    artFolders.set(prefix, url)
  }
  for (const [path, file] of Object.entries(aliases)) assets.set(path, new URL(file, root))

  let reviewHandlerPromise: Promise<(req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>> | undefined
  let decisionHandlerPromise: Promise<(req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean>> | undefined
  async function handleTesting(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (!testingEnabled || !pathname.startsWith('/__testing/')) return false
    if (pathname.startsWith('/__testing/decision/') || pathname === '/__testing/agent') {
      decisionHandlerPromise ??= import('./decision-server.ts').then(mod => mod.createDecisionAgentHandler(root))
      const decisionHandler = await decisionHandlerPromise
      return decisionHandler(req, res, pathname)
    }
    reviewHandlerPromise ??= import('./review-store.ts').then(mod => mod.createArtReviewHandler(root, testingOptions))
    const reviewHandler = await reviewHandlerPromise
    return reviewHandler(req, res, pathname)
  }

  const perfLogPath = fileURLToPath(new URL('data/perf.ndjson', root))
  const MAX_PERF_LOG_LINES = 2000
  let perfWriteCount = 0

  function isLoopbackRequest(req: IncomingMessage): boolean {
    const addr = req.socket?.remoteAddress ?? ''
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  }

  async function handlePerfLog(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname !== '/__perf/log') return false
    if (!isLoopbackRequest(req)) {
      sendText(res, 403, 'Performance telemetry logging is restricted to loopback connections')
      return true
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      let total = 0
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += buf.byteLength
        if (total > 16_384) {
          sendText(res, 413, 'Telemetry payload too large')
          return true
        }
        chunks.push(buf)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        sendText(res, 400, 'Invalid JSON')
        return true
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        sendText(res, 400, 'Expected JSON object')
        return true
      }
      await mkdir(dirname(perfLogPath), { recursive: true })
      const line = JSON.stringify({ ...parsed, serverTs: new Date().toISOString() }) + '\n'
      await appendFile(perfLogPath, line, 'utf8')
      perfWriteCount++
      if (perfWriteCount % 100 === 0) {
        try {
          const all = (await readFile(perfLogPath, 'utf8')).trim().split('\n')
          if (all.length > MAX_PERF_LOG_LINES) {
            await writeFile(perfLogPath, all.slice(all.length - MAX_PERF_LOG_LINES).join('\n') + '\n', 'utf8')
          }
        } catch {
          // Best-effort trim
        }
      }
      sendJson(res, { ok: true, path: 'data/perf.ndjson' })
      return true
    }
    if (req.method === 'GET') {
      let entries: Record<string, unknown>[] = []
      try {
        const raw = await readFile(perfLogPath, 'utf8')
        for (const line of raw.trim().split('\n')) {
          if (!line) continue
          try {
            const obj: unknown = JSON.parse(line)
            if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
              const rec: Record<string, unknown> = {}
              for (const [k, v] of Object.entries(obj)) rec[k] = v
              entries.push(rec)
            }
          } catch {
            // Skip malformed line
          }
        }
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') throw err
      }
      let fpsSum = 0, fpsCount = 0, minFps = Infinity, worstFrameMs = 0
      for (const e of entries) {
        const f = e.fps
        if (typeof f === 'number' && Number.isFinite(f) && f > 0) {
          fpsSum += f; fpsCount++
          if (f < minFps) minFps = f
        }
        const w = e.worstMs
        if (typeof w === 'number' && Number.isFinite(w) && w > worstFrameMs) worstFrameMs = w
      }
      sendJson(res, {
        path: 'data/perf.ndjson',
        count: entries.length,
        summary: {
          avgFps: fpsCount > 0 ? Math.round((fpsSum / fpsCount) * 10) / 10 : 0,
          minFps: Number.isFinite(minFps) ? Math.round(minFps * 10) / 10 : 0,
          worstFrameMs: Math.round(worstFrameMs * 10) / 10
        },
        recent: entries.slice(-40)
      })
      return true
    }
    if (req.method === 'DELETE') {
      await mkdir(dirname(perfLogPath), { recursive: true })
      await writeFile(perfLogPath, '', 'utf8')
      sendJson(res, { ok: true, cleared: true })
      return true
    }
    sendText(res, 405)
    return true
  }

  const server = createServer({ requestTimeout: 10_000, headersTimeout: 8_000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('Content-Security-Policy', contentSecurityPolicy)
    try {
      let pathname: string
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      } catch {
        return sendText(res, 400, 'Bad request')
      }
      if (await handle?.(req, res, pathname)) return
      if (await handlePerfLog(req, res, pathname)) return
      if (await handleTesting(req, res, pathname)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405)
      if (pathname === '/healthz') return sendText(res, 200, 'ok')
      const asset = assets.get(pathname) ?? await mountFile(pathname, mountedDirs) ?? await artFile(pathname, artFolders)
      if (!asset && pathname === '/favicon.ico') return sendText(res, 204)
      if (!asset) return sendText(res, 404, 'Not found')
      const extension = extname(asset.pathname).toLowerCase()
      const contentType = lookupAssetMime(extension)
      if (extension === '.html') {
        const body = prepareHtml(await readFile(asset), testingEnabled, hosted)
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
      const code = errorCode(error)
      if (!res.headersSent && code === 'ENOENT') return sendText(res, 404, 'Not found')
      if (!res.headersSent) sendText(res, 500, 'Server error')
      else res.destroy()
      if (code !== 'ECONNRESET') console.error(error)
    }
  })
  server.maxConnections = 1536
  server.on('upgrade', async (req, socket, head) => {
    if (socket.listenerCount('error') === 0) socket.on('error', () => { /* ignore socket error during upgrade */ })
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request')
      return
    }
    if (!upgrade) {
      rejectUpgrade(socket, 404, 'Not Found')
      return
    }
    try {
      const handled = await upgrade(req, socket, head, pathname)
      if (typeof handled === 'object' && handled !== null && 'reject' in handled) {
        if (!socketTouched(socket)) {
          rejectUpgrade(socket, handled.reject, handled.reason ?? defaultHttpReason(handled.reject))
        }
      } else if (handled === false || (handled === undefined && !socketTouched(socket))) {
        rejectUpgrade(socket, 404, 'Not Found')
      }
    } catch (error) {
      if (!socketTouched(socket)) rejectUpgrade(socket, 500, 'Internal Server Error')
      else socket.destroy()
      if (errorCode(error) !== 'ECONNRESET') console.error(error)
    }
  })
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
