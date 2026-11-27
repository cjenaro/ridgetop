import { Buffer } from 'node:buffer'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join } from 'node:path'
import { join as posixJoin } from 'node:path/posix'
import { deflateRawSync } from 'node:zlib'

export type OtaChannel = 'local' | 'dev' | 'prod'

export interface OtaManifest {
  readonly schemaVersion: 1
  readonly appId: string
  readonly channel: OtaChannel
  readonly version: string
  readonly minNativeVersion: string
  readonly bundleUrl: string
  readonly sha256: string
  readonly bytes: number
  readonly createdAt: string
  /** Optional base64 Ed25519 signature over `canonicalOtaSigningPayload(manifest)`. */
  readonly signature?: string
}

export interface OtaSigningKeyPair {
  /** Base64-encoded raw 32-byte Ed25519 public key (embeddable in native iOS/Android binaries). */
  readonly publicKeyBase64: string
  /** PKCS#8 PEM-encoded Ed25519 private key (keep secret in CI). */
  readonly privateKeyPem: string
}

export interface ZipFileEntry {
  readonly path: string
  readonly data: Buffer
}

export interface BuildOtaReleaseOptions {
  readonly wwwDir: string
  readonly outDir: string
  readonly appId: string
  readonly channel: OtaChannel
  readonly version: string
  readonly minNativeVersion?: string
  /** Optional base URL (e.g. `https://cjenaro.github.io/ridgetop/ota/crownshard`). When set, `bundleUrl` is absolute. */
  readonly baseUrl?: string
  readonly createdAt?: string
  /** Optional PKCS#8 PEM Ed25519 private key used to sign the manifest. */
  readonly signingKeyPem?: string
}

export interface OtaReleaseResult {
  readonly channelDir: string
  readonly manifestPath: string
  readonly bundlePath: string
  readonly manifest: OtaManifest
  readonly files: number
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const VALID_HOST_HEADER_RE = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/

const ALREADY_COMPRESSED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif',
  '.mp3', '.ogg', '.m4a', '.aac', '.woff2', '.zip', '.gz', '.br'
])

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Generate a fresh Ed25519 keypair for signing OTA manifests. */
export function generateOtaSigningKeyPair(): OtaSigningKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const rawPub = spki.subarray(spki.length - 32)
  const privateKeyPem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }))
  return {
    publicKeyBase64: rawPub.toString('base64'),
    privateKeyPem
  }
}

/** Canonical byte payload signed by Ed25519 and verified identically in JS, Swift, and Java. */
export function canonicalOtaSigningPayload(manifest: Pick<OtaManifest, 'appId' | 'channel' | 'version' | 'minNativeVersion' | 'sha256'>): Buffer {
  return Buffer.from(
    [
      'ridgetop-ota-v1',
      manifest.appId,
      manifest.channel,
      manifest.version,
      manifest.minNativeVersion,
      manifest.sha256.toLowerCase()
    ].join('\n'),
    'utf8'
  )
}

function parseOtaPrivateKey(privateKeyInput: string) {
  const normalized = privateKeyInput.trim().replace(/\\n/g, '\n').replace(/\r\n/g, '\n')
  const pemMatch = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(normalized)
  const b64Body = (pemMatch ? pemMatch[1] : normalized).replace(/\s+/g, '')
  if (!b64Body) {
    throw new Error('Invalid OTA signing key: empty key. Generate one with "pnpm run ota:keygen" and paste the full PRIVATE KEY block.')
  }
  try {
    return createPrivateKey({ key: Buffer.from(b64Body, 'base64'), format: 'der', type: 'pkcs8' })
  } catch {
    throw new Error('Invalid OTA signing key: expected an Ed25519 PKCS#8 private key (from "pnpm run ota:keygen", including the -----BEGIN PRIVATE KEY----- block).')
  }
}

/** Sign an OTA manifest with a PKCS#8 PEM (or base64 DER) Ed25519 private key. */
export function signOtaManifest(
  manifest: Pick<OtaManifest, 'appId' | 'channel' | 'version' | 'minNativeVersion' | 'sha256'>,
  privateKeyPem: string
): string {
  const key = parseOtaPrivateKey(privateKeyPem)
  const payload = canonicalOtaSigningPayload(manifest)
  return sign(null, payload, key).toString('base64')
}

/** Verify a base64 Ed25519 signature against a base64 raw 32-byte public key. */
export function verifyOtaManifestSignature(
  manifest: Pick<OtaManifest, 'appId' | 'channel' | 'version' | 'minNativeVersion' | 'sha256'>,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const rawPub = Buffer.from(publicKeyBase64, 'base64')
    if (rawPub.length !== 32) return false
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, rawPub])
    const pubKey = createPublicKey({ key: spki, format: 'der', type: 'spki' })
    const sig = Buffer.from(signatureBase64, 'base64')
    if (sig.length !== 64) return false
    return verify(null, canonicalOtaSigningPayload(manifest), pubKey, sig)
  } catch {
    return false
  }
}

/** Encode files into a standard PKZIP archive (Store for already-compressed assets, raw Deflate for text/code). */
export function createZipBuffer(entries: readonly ZipFileEntry[]): Buffer {
  if (entries.length > 65535) {
    throw new Error(`ZIP archive exceeds maximum 65535 entries (got ${entries.length})`)
  }
  const normalized: { readonly name: string; readonly data: Buffer }[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const cleanName = entry.path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (
      !cleanName ||
      cleanName.endsWith('/') ||
      cleanName.includes('\0') ||
      cleanName.split('/').some(seg => !seg || seg === '..' || seg === '.')
    ) {
      throw new Error(`Unsafe ZIP entry path rejected: ${entry.path}`)
    }
    if (seen.has(cleanName)) {
      throw new Error(`Duplicate ZIP entry path rejected: ${cleanName}`)
    }
    seen.add(cleanName)
    normalized.push({ name: cleanName, data: entry.data })
  }
  normalized.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of normalized) {
    const cleanName = entry.name
    const nameBytes = Buffer.from(cleanName, 'utf8')
    const raw = entry.data
    const checksum = crc32(raw)
    const ext = extname(cleanName).toLowerCase()

    let method = 0
    let payload = raw
    if (raw.length > 0 && !ALREADY_COMPRESSED_EXTS.has(ext)) {
      const deflated = deflateRawSync(raw, { level: 6 })
      if (deflated.length < raw.length) {
        method = 8
        payload = deflated
      }
    }

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(0, 10) // mod time
    localHeader.writeUInt16LE(0x5421, 12) // deterministic mod date (2022-01-01)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(payload.length, 18)
    localHeader.writeUInt32LE(raw.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra length

    localParts.push(localHeader, nameBytes, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0x0800, 8) // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0x5421, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(payload.length, 20)
    centralHeader.writeUInt32LE(raw.length, 24)
    centralHeader.writeUInt16LE(nameBytes.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk start
    centralHeader.writeUInt16LE(0, 36) // internal attrs
    centralHeader.writeUInt32LE(0, 38) // external attrs
    centralHeader.writeUInt32LE(offset, 42)

    centralParts.push(centralHeader, nameBytes)
    offset += localHeader.length + nameBytes.length + payload.length
  }

  const centralDir = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(normalized.length, 8)
  eocd.writeUInt16LE(normalized.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

async function collectDirectoryEntries(dir: string, relBase = '', out: ZipFileEntry[] = []): Promise<ZipFileEntry[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relBase ? posixJoin(relBase, entry.name) : entry.name
    if (entry.isDirectory()) {
      await collectDirectoryEntries(full, rel, out)
    } else if (entry.isFile()) {
      out.push({ path: rel, data: await readFile(full) })
    }
  }
  return out
}

/** Sanitize a version string for safe single-segment directory/file names (blocks `.`, `..`, leading dots, and long names). */
export function sanitizeOtaVersion(version: string): string {
  const cleaned = version
    .trim()
    .replace(/[^a-zA-Z0-9._+-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 128)
    .replace(/[.-]+$/g, '')
  return cleaned || '0.0.0'
}

export function normalizeOtaBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function parseOtaChannel(value: string): OtaChannel | null {
  switch (value) {
    case 'local':
    case 'dev':
    case 'prod':
      return value
    default:
      return null
  }
}

/** Compare dotted numeric versions (ignoring optional leading `v` and build metadata after `+` or `-`). Returns -1, 0, or 1. */
export function compareSemverCore(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/i, '').split(/[+-]/, 1)[0].split('.').map(part => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) ? n : 0
  })
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av < bv) return -1
    if (av > bv) return 1
  }
  return 0
}

export function isNativeVersionCompatible(nativeVersion: string, minNativeVersion: string): boolean {
  return compareSemverCore(nativeVersion, minNativeVersion) >= 0
}

/** Package a built mobile `www/` directory into a versioned OTA zip + `manifest.json` under `<outDir>/<channel>/`. */
export async function buildOtaRelease(options: BuildOtaReleaseOptions): Promise<OtaReleaseResult> {
  const entries = await collectDirectoryEntries(options.wwwDir)
  const zipData = createZipBuffer(entries)
  const sha256 = createHash('sha256').update(zipData).digest('hex')
  const safeVersion = sanitizeOtaVersion(options.version)
  const bundleFileName = `bundle-${safeVersion}.zip`
  const channelDir = join(options.outDir, options.channel)

  await rm(channelDir, { recursive: true, force: true })
  await mkdir(channelDir, { recursive: true })

  const bundlePath = join(channelDir, bundleFileName)
  const manifestPath = join(channelDir, 'manifest.json')
  const normalizedBase = options.baseUrl ? normalizeOtaBaseUrl(options.baseUrl) : ''
  const bundleUrl = normalizedBase
    ? `${normalizedBase}/${options.channel}/${bundleFileName}`
    : `./${bundleFileName}`

  const unsignedManifest: OtaManifest = {
    schemaVersion: 1,
    appId: options.appId,
    channel: options.channel,
    version: options.version,
    minNativeVersion: options.minNativeVersion ?? options.version.split(/[+-]/, 1)[0],
    bundleUrl,
    sha256,
    bytes: zipData.length,
    createdAt: options.createdAt ?? new Date().toISOString()
  }

  const manifest: OtaManifest = options.signingKeyPem
    ? { ...unsignedManifest, signature: signOtaManifest(unsignedManifest, options.signingKeyPem) }
    : unsignedManifest

  await writeFile(bundlePath, zipData)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  return {
    channelDir,
    manifestPath,
    bundlePath,
    manifest,
    files: entries.length
  }
}

export function listLanIpv4Addresses(): string[] {
  const out: string[] = []
  const nets = networkInterfaces()
  for (const entries of Object.values(nets)) {
    if (!entries) continue
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        out.push(info.address)
      }
    }
  }
  return out
}

export interface OtaDevServerOptions {
  readonly port?: number
  readonly host?: string
  readonly channel?: OtaChannel
  /** Producer called on startup and on authenticated `POST /rebuild` to generate the latest OTA zip + manifest. */
  readonly buildBundle: (version: string) => Promise<{ manifest: OtaManifest; zipData: Buffer }>
  readonly baseVersion?: string
  /** Optional explicit bearer token for `POST /rebuild` (defaults to a random 48-hex-char token). */
  readonly rebuildToken?: string
}

export interface OtaDevServerHandle {
  readonly server: Server
  readonly port: number
  readonly channel: OtaChannel
  readonly urls: readonly string[]
  readonly rebuildToken: string
  rebuild(): Promise<OtaManifest>
  close(): Promise<void>
}

function isAuthorizedBearer(authHeader: string | undefined, expectedToken: string): boolean {
  if (!expectedToken || !authHeader || !authHeader.startsWith('Bearer ')) return false
  const provided = Buffer.from(authHeader.slice(7), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

/** Layer-1 local OTA HTTP server so an installed iOS/Android build can pull fresh bundles over LAN Wi-Fi. */
export async function startOtaDevServer(options: OtaDevServerOptions): Promise<OtaDevServerHandle> {
  const channel: OtaChannel = options.channel ?? 'local'
  const host = options.host ?? '0.0.0.0'
  const baseVersion = options.baseVersion ?? '0.0.0'
  const rebuildToken = options.rebuildToken ?? randomBytes(24).toString('hex')
  let buildCounter = 0
  let current: { manifest: OtaManifest; zipData: Buffer; bundleFileName: string } | null = null
  let rebuildInFlight: Promise<OtaManifest> | null = null

  function rebuild(): Promise<OtaManifest> {
    if (rebuildInFlight) return rebuildInFlight
    rebuildInFlight = (async () => {
      buildCounter++
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const version = `${baseVersion}+local.${stamp}.${buildCounter}`
      const built = await options.buildBundle(version)
      const bundleFileName = `bundle-${sanitizeOtaVersion(built.manifest.version)}.zip`
      current = {
        manifest: {
          ...built.manifest,
          channel,
          bundleUrl: `./${bundleFileName}`
        },
        zipData: built.zipData,
        bundleFileName
      }
      return current.manifest
    })().finally(() => {
      rebuildInFlight = null
    })
    return rebuildInFlight
  }

  await rebuild()

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Bad request\n')
      return
    }
    res.setHeader('Cache-Control', 'no-store')

    if (req.method === 'POST' && pathname === '/rebuild') {
      if (!isAuthorizedBearer(req.headers.authorization, rebuildToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"error":"Unauthorized"}\n')
        return
      }
      rebuild().then(manifest => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(manifest, null, 2) + '\n')
      }).catch(error => {
        console.error('[ridgetop/ota-serve] Rebuild failed:', error instanceof Error ? error.message : String(error))
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"error":"Rebuild failed"}\n')
      })
      return
    }

    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && (pathname === `/${channel}/manifest.json` || pathname === '/manifest.json')) {
      if (!current) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"error":"OTA bundle not ready"}\n')
        return
      }
      const reqHost = req.headers.host
      const safeHost = reqHost && VALID_HOST_HEADER_RE.test(reqHost) ? reqHost : null
      const fallbackRel = pathname === '/manifest.json'
        ? `./${channel}/${current.bundleFileName}`
        : `./${current.bundleFileName}`
      const manifestToSend: OtaManifest = safeHost
        ? { ...current.manifest, bundleUrl: `http://${safeHost}/${channel}/${current.bundleFileName}` }
        : { ...current.manifest, bundleUrl: fallbackRel }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(manifestToSend, null, 2) + '\n')
      return
    }

    if (req.method === 'GET' && current && pathname === `/${channel}/${current.bundleFileName}`) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': String(current.zipData.length)
      })
      res.end(current.zipData)
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found\n')
  })

  await new Promise<void>((resolveReady, rejectReady) => {
    server.once('error', rejectReady)
    server.listen(options.port ?? 4321, host, () => {
      server.off('error', rejectReady)
      resolveReady()
    })
  })

  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : (options.port ?? 4321)
  const lanIps = listLanIpv4Addresses()
  const urls = [
    ...lanIps.map(ip => `http://${ip}:${port}`),
    `http://127.0.0.1:${port}`
  ]

  return {
    server,
    port,
    channel,
    urls,
    rebuildToken,
    rebuild,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close(err => (err ? rejectClose(err) : resolveClose()))
      server.closeIdleConnections?.()
    })
  }
}
