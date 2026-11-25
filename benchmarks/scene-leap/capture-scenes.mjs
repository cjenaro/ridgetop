import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const label = process.argv[2]
if (!label) {
  console.error('Usage: node benchmarks/scene-leap/capture-scenes.mjs <before|after>')
  process.exit(1)
}
const outDir = resolve('benchmarks/scene-leap', label)
await mkdir(outDir, { recursive: true })

const PORT = 3456
const DEBUG_PORT = 9333
const userData = await mkdtemp(join(tmpdir(), 'ridgetop-cap-'))

const server = spawn(process.execPath, ['dist/server.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: 'ignore'
})
const chrome = spawn('google-chrome', [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${userData}`,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1120,660',
  '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=vulkan', '--use-vulkan=swiftshader',
  '--enable-features=Vulkan',
  'about:blank'
], { stdio: 'ignore' })

async function waitReady(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch { /* server not listening yet */ }
    await wait(250)
  }
  throw new Error('Timed out waiting for ' + url)
}

async function capture(pathUrl, outName, postAction) {
  const target = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json())
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let mid = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(String(data))
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id)
      if (msg.error) p.rej(new Error(msg.error.message))
      else p.res(msg.result)
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.text ?? 'exception')
  }
  const call = (method, params) => new Promise((res, rej) => {
    const id = ++mid
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Emulation.setDeviceMetricsOverride', { width: 1120, height: 660, deviceScaleFactor: 1, mobile: false })
  await call('Page.navigate', { url: `http://127.0.0.1:${PORT}${pathUrl}` })
  await wait(1400)
  if (postAction) {
    await call('Runtime.evaluate', { expression: postAction, awaitPromise: true })
    await wait(900)
  }
  const shot = await call('Page.captureScreenshot', { format: 'png' })
  await writeFile(join(outDir, outName), Buffer.from(shot.data, 'base64'))
  ws.close()
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${target.id}`)
  console.log('Captured', outName, errors.length ? `ERRORS: ${errors.join('; ')}` : 'OK')
  return errors
}

try {
  await waitReady(`http://127.0.0.1:${PORT}/healthz`)
  await waitReady(`http://127.0.0.1:${DEBUG_PORT}/json/version`)

  // 1. Lighthouse (WebGL2 active gameplay + WebGPU title + Canvas 2D)
  await capture('/lighthouse?renderer=webgl2', 'lighthouse-webgl2-play.png', `
    (async () => {
      if (globalThis.__ridgetopUi) {
        const snap = globalThis.__ridgetopUi.snapshot();
        const btn = snap.find(n => /begin|start|play|continue|watch/i.test(n.label || n.id || ''));
        if (btn) globalThis.__ridgetopUi.act(btn.id, 'press');
      }
      await new Promise(r => setTimeout(r, 400));
    })()
  `)
  await capture('/lighthouse?renderer=webgpu', 'lighthouse-webgpu-play.png', `
    (async () => {
      if (globalThis.__ridgetopUi) {
        const snap = globalThis.__ridgetopUi.snapshot();
        const btn = snap.find(n => /begin|start|play|continue|watch/i.test(n.label || n.id || ''));
        if (btn) globalThis.__ridgetopUi.act(btn.id, 'press');
      }
      await new Promise(r => setTimeout(r, 400));
    })()
  `)
  await capture('/lighthouse?canvas=1', 'lighthouse-canvas-play.png', `
    (async () => {
      if (globalThis.__ridgetopUi) {
        const snap = globalThis.__ridgetopUi.snapshot();
        const btn = snap.find(n => /begin|start|play|continue|watch/i.test(n.label || n.id || ''));
        if (btn) globalThis.__ridgetopUi.act(btn.id, 'press');
      }
      await new Promise(r => setTimeout(r, 400));
    })()
  `)

  // 2. Signal Drift (WebGL2, WebGPU, and Canvas 2D live race view!)
  const startRaceAction = `
    (async () => {
      if (globalThis.__ridgetopUi) {
        globalThis.__ridgetopUi.act('race-start', 'press');
      }
      await new Promise(r => setTimeout(r, 700));
    })()
  `
  await capture('/racing?renderer=webgl2', 'signal-drift-webgl2.png', startRaceAction)
  await capture('/racing?renderer=webgpu', 'signal-drift-webgpu.png', startRaceAction)
  await capture('/racing?canvas=1', 'signal-drift-canvas.png', startRaceAction)
} finally {
  chrome.kill('SIGTERM')
  server.kill('SIGTERM')
  await rm(userData, { recursive: true, force: true }).catch(() => {})
}
