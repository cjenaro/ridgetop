import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { createPlatform } from '../packages/ridgetop/framework/index.ts'
import {
  compareSemverCore,
  crc32,
  createZipBuffer,
  generateOtaSigningKeyPair,
  isNativeVersionCompatible,
  packageGame,
  parsePackageArgs,
  sanitizeOtaVersion,
  signOtaManifest,
  startOtaDevServer,
  verifyOtaManifestSignature
} from '../packages/ridgetop/framework/server.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function unzipAll(zip: Buffer): Map<string, Buffer> {
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  assert.ok(eocd >= 0, 'ZIP must contain EOCD signature')
  const count = zip.readUInt16LE(eocd + 10)
  let cd = zip.readUInt32LE(eocd + 16)
  const files = new Map<string, Buffer>()

  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(cd), 0x02014b50, 'Central directory signature')
    const method = zip.readUInt16LE(cd + 10)
    const expectedCrc = zip.readUInt32LE(cd + 16)
    const compSize = zip.readUInt32LE(cd + 20)
    const uncompSize = zip.readUInt32LE(cd + 24)
    const nameLen = zip.readUInt16LE(cd + 28)
    const extraLen = zip.readUInt16LE(cd + 30)
    const commentLen = zip.readUInt16LE(cd + 32)
    const localOffset = zip.readUInt32LE(cd + 42)
    const name = zip.subarray(cd + 46, cd + 46 + nameLen).toString('utf8')
    cd += 46 + nameLen + extraLen + commentLen

    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, 'Local header signature')
    const localNameLen = zip.readUInt16LE(localOffset + 26)
    const localExtraLen = zip.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLen + localExtraLen
    const slice = zip.subarray(start, start + compSize)
    const raw = method === 0 ? Buffer.from(slice) : inflateRawSync(slice)
    assert.equal(raw.length, uncompSize)
    assert.equal(crc32(raw), expectedCrc)
    files.set(name, raw)
  }
  return files
}

test('createZipBuffer produces standard PKZIP archives and rejects traversal paths', () => {
  const html = Buffer.from('<!doctype html><html><body>' + 'hello crownshard '.repeat(40) + '</body></html>')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  const zip = createZipBuffer([
    { path: 'index.html', data: html },
    { path: 'assets/icon.png', data: png },
    { path: 'empty.txt', data: Buffer.alloc(0) }
  ])

  const extracted = unzipAll(zip)
  assert.equal(extracted.size, 3)
  assert.deepEqual(extracted.get('index.html'), html)
  assert.deepEqual(extracted.get('assets/icon.png'), png)
  assert.deepEqual(extracted.get('empty.txt'), Buffer.alloc(0))

  assert.throws(() => createZipBuffer([{ path: '../evil.js', data: Buffer.from('x') }]), /Unsafe ZIP entry/)
  assert.throws(() => createZipBuffer([{ path: '\\..\\evil.js', data: Buffer.from('x') }]), /Unsafe ZIP entry/)
  assert.throws(() => createZipBuffer([{ path: 'foo\0bar.js', data: Buffer.from('x') }]), /Unsafe ZIP entry/)
  assert.throws(() => createZipBuffer([
    { path: 'dup.js', data: Buffer.from('a') },
    { path: '/dup.js', data: Buffer.from('b') }
  ]), /Duplicate ZIP entry/)
})

test('sanitizeOtaVersion blocks dot traversal and caps length', () => {
  assert.equal(sanitizeOtaVersion('..'), '0.0.0')
  assert.equal(sanitizeOtaVersion('.'), '0.0.0')
  assert.equal(sanitizeOtaVersion('.tmp-123'), 'tmp-123')
  assert.equal(sanitizeOtaVersion('../../etc/passwd'), 'etc-passwd')
  assert.equal(sanitizeOtaVersion('a'.repeat(200)).length, 128)
  assert.ok(!sanitizeOtaVersion('a'.repeat(127) + '.b').endsWith('.'))
})

test('Ed25519 manifest signing and verification detects tampering', () => {
  const { publicKeyBase64, privateKeyPem } = generateOtaSigningKeyPair()
  const manifest = {
    appId: 'com.ridgetop.crownshard',
    channel: 'prod' as const,
    version: '1.0.0+prod.1',
    minNativeVersion: '1.0.0',
    sha256: 'a'.repeat(64)
  }
  const sig = signOtaManifest(manifest, privateKeyPem)
  assert.equal(verifyOtaManifestSignature(manifest, sig, publicKeyBase64), true)
  assert.equal(verifyOtaManifestSignature({ ...manifest, sha256: 'b'.repeat(64) }, sig, publicKeyBase64), false)
  assert.equal(verifyOtaManifestSignature({ ...manifest, channel: 'dev' }, sig, publicKeyBase64), false)
  assert.equal(verifyOtaManifestSignature(manifest, 'invalid', publicKeyBase64), false)
})

test('compareSemverCore and isNativeVersionCompatible handle build metadata', () => {
  assert.equal(compareSemverCore('1.0.0', '1.0.0+dev.20261126.abc1234'), 0)
  assert.equal(compareSemverCore('v1.2.0', '1.2.0'), 0)
  assert.equal(compareSemverCore('1.2.0', '1.1.9'), 1)
  assert.equal(compareSemverCore('1.0.0', '1.0.1'), -1)
  assert.equal(isNativeVersionCompatible('1.2.0', '1.0.0'), true)
  assert.equal(isNativeVersionCompatible('1.0.0', '1.1.0'), false)
})

test('parsePackageArgs parses OTA target and options (including pnpm -- separator)', () => {
  const parsed = parsePackageArgs([
    '--',
    '--target', 'ota',
    '--game', 'crownshard',
    '--ota-channel', 'dev',
    '--ota-url', 'https://cjenaro.github.io/ridgetop/ota/crownshard',
    '--min-native-version', '1.0.0',
    '--version', '1.0.0+dev.1'
  ])
  assert.equal(parsed.help, false)
  if (!parsed.help) {
    assert.equal(parsed.target, 'ota')
    assert.equal(parsed.game, 'crownshard')
    assert.equal(parsed.otaChannel, 'dev')
    assert.equal(parsed.otaUrl, 'https://cjenaro.github.io/ridgetop/ota/crownshard')
    assert.equal(parsed.minNativeVersion, '1.0.0')
    assert.equal(parsed.version, '1.0.0+dev.1')
  }
})

test('packageGame rejects path traversal in --game', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-ota-trav-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  await assert.rejects(
    packageGame({ target: 'web', game: '../packages', repoRoot, outDir: work }),
    /Invalid --game name/
  )
})

test('packageGame(mobile + ota) pins Ed25519 key, allowedHost, and signs Crownshard OTA bundle', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-ota-test-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  const { publicKeyBase64, privateKeyPem } = generateOtaSigningKeyPair()

  const mobileDir = join(work, 'crownshard-mobile')
  const mobileRes = await packageGame({
    target: 'mobile',
    game: 'crownshard',
    repoRoot,
    outDir: mobileDir,
    otaChannel: 'dev',
    otaPublicKey: publicKeyBase64
  })
  assert.equal(mobileRes.appId, 'com.ridgetop.crownshard')

  const pkg = JSON.parse(await readFile(join(mobileDir, 'package.json'), 'utf8'))
  assert.equal(pkg.dependencies['ridgetop-ota'], 'file:./ridgetop-ota')

  const swiftSrc = await readFile(join(mobileDir, 'ridgetop-ota/ios/Sources/RidgetopOtaPlugin/RidgetopOtaPlugin.swift'), 'utf8')
  const javaSrc = await readFile(join(mobileDir, 'ridgetop-ota/android/src/main/java/com/ridgetop/ota/RidgetopOtaPlugin.java'), 'utf8')
  const spmSrc = await readFile(join(mobileDir, 'ridgetop-ota/Package.swift'), 'utf8')
  const bridgeJs = await readFile(join(mobileDir, 'www/ridgetop-mobile-bridge.js'), 'utf8')

  assert.match(swiftSrc, /setServerBasePath/)
  assert.match(swiftSrc, /compression_stream_init/)
  assert.match(swiftSrc, /allowLocalChannel = true/)
  assert.ok(swiftSrc.includes(publicKeyBase64), 'Swift plugin must pin Ed25519 public key')
  assert.ok(swiftSrc.includes('cjenaro.github.io'), 'Swift plugin must pin allowedHost')
  assert.match(javaSrc, /setServerBasePath/)
  assert.match(javaSrc, /ALLOW_LOCAL_CHANNEL = true/)
  assert.ok(javaSrc.includes(publicKeyBase64), 'Java plugin must pin Ed25519 public key')
  assert.ok(javaSrc.includes('cjenaro.github.io'), 'Java plugin must pin allowedHost')
  assert.match(spmSrc, /RidgetopOtaPlugin/)
  assert.match(bridgeJs, /https:\/\/cjenaro\.github\.io\/ridgetop\/ota\/crownshard/)
  assert.match(bridgeJs, /"dev"/)

  const otaDir = join(work, 'ota-out')
  const otaRes = await packageGame({
    target: 'ota',
    game: 'crownshard',
    repoRoot,
    outDir: otaDir,
    otaChannel: 'dev',
    version: '1.0.0+dev.20261126.abcdef1',
    minNativeVersion: '1.0.0',
    otaSigningKeyPem: privateKeyPem
  })
  const out = otaRes.outputs[0]
  assert.equal(out.target, 'ota')
  assert.ok(out.manifestPath)
  assert.ok(out.bundlePath)

  const manifest = JSON.parse(await readFile(out.manifestPath, 'utf8'))
  const zipBytes = await readFile(out.bundlePath)
  const actualSha = createHash('sha256').update(zipBytes).digest('hex')

  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.appId, 'com.ridgetop.crownshard')
  assert.equal(manifest.channel, 'dev')
  assert.equal(manifest.version, '1.0.0+dev.20261126.abcdef1')
  assert.equal(manifest.minNativeVersion, '1.0.0')
  assert.equal(manifest.sha256, actualSha)
  assert.equal(manifest.bytes, zipBytes.length)
  assert.ok(typeof manifest.signature === 'string' && manifest.signature.length > 0)
  assert.equal(verifyOtaManifestSignature(manifest, manifest.signature, publicKeyBase64), true)
  assert.match(manifest.bundleUrl, /^https:\/\/cjenaro\.github\.io\/ridgetop\/ota\/crownshard\/dev\/bundle-/)

  const unzipped = unzipAll(zipBytes)
  assert.ok(unzipped.has('index.html'), 'OTA zip must include index.html')
  assert.ok(unzipped.has('ridgetop-mobile-bridge.js'), 'OTA zip must include ridgetop-mobile-bridge.js')
})

test('startOtaDevServer enforces bearer auth on POST /rebuild and serves Layer-1 bundles', async t => {
  const handle = await startOtaDevServer({
    port: 0,
    host: '127.0.0.1',
    channel: 'local',
    baseVersion: '1.0.0',
    buildBundle: async version => {
      const zipData = createZipBuffer([
        { path: 'index.html', data: Buffer.from(`<!doctype html><title>${version}</title>`) }
      ])
      const sha256 = createHash('sha256').update(zipData).digest('hex')
      return {
        zipData,
        manifest: {
          schemaVersion: 1,
          appId: 'com.ridgetop.crownshard',
          channel: 'local',
          version,
          minNativeVersion: '1.0.0',
          bundleUrl: './bundle.zip',
          sha256,
          bytes: zipData.length,
          createdAt: new Date().toISOString()
        }
      }
    }
  })
  t.after(() => handle.close())

  const base = `http://127.0.0.1:${handle.port}`
  const manifestRes = await fetch(`${base}/local/manifest.json`)
  assert.equal(manifestRes.status, 200)
  assert.equal(manifestRes.headers.get('cache-control'), 'no-store')
  const m1 = await manifestRes.json()
  assert.equal(m1.channel, 'local')
  assert.ok(m1.bundleUrl.startsWith(`${base}/local/bundle-`))

  const zipRes = await fetch(m1.bundleUrl)
  assert.equal(zipRes.status, 200)
  const zipBuf = Buffer.from(await zipRes.arrayBuffer())
  assert.equal(createHash('sha256').update(zipBuf).digest('hex'), m1.sha256)

  const unauthRes = await fetch(`${base}/rebuild`, { method: 'POST' })
  assert.equal(unauthRes.status, 401)

  const rebuildRes = await fetch(`${base}/rebuild`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${handle.rebuildToken}` }
  })
  assert.equal(rebuildRes.status, 200)
  const m2 = await rebuildRes.json()
  assert.notEqual(m2.version, m1.version)
})

test('createPlatform().ota exposes safe web fallbacks', async () => {
  const platform = createPlatform()
  assert.equal(platform.ota.available, false)
  assert.equal(platform.ota.channel, 'prod')
  const check = await platform.ota.checkForUpdate()
  assert.equal(check.available, false)
  assert.equal(check.reason, 'unsupported')
  assert.equal(await platform.ota.applyUpdate(), false)
  assert.equal(await platform.ota.confirmReady(), false)
})
