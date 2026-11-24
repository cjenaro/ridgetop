import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageGame } from '../../../../packages/ridgetop/framework/packager.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

async function findGodot() {
  if (process.env.GODOT_BIN) return process.env.GODOT_BIN
  const which = spawnSync('which', ['godot4', 'godot'], { encoding: 'utf8' })
  const found = which.stdout?.trim().split('\n')[0]
  if (found) return found
  const appsDir = join(process.env.HOME ?? '', 'Applications')
  try {
    const entries = await readdir(appsDir)
    const match = entries.filter(name => /^Godot_v4\..*linux/i.test(name)).sort().at(-1)
    if (match) return join(appsDir, match)
  } catch {}
  return null
}

function assertGlbFloat32Bounds(buffer, label) {
  const jsonLen = buffer.readUInt32LE(12)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLen).toString('utf8'))
  const binStart = 20 + jsonLen + 8
  let mismatches = 0
  for (const acc of json.accessors) {
    if (!acc.min) continue
    const bv = json.bufferViews[acc.bufferView]
    const f32 = new Float32Array(
      buffer.buffer,
      buffer.byteOffset + binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0),
      acc.count * 3
    )
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < 3; k++) {
        const v = f32[i * 3 + k]
        if (v < lo[k]) lo[k] = v
        if (v > hi[k]) hi[k] = v
      }
    }
    for (let k = 0; k < 3; k++) {
      if (lo[k] !== acc.min[k] || hi[k] !== acc.max[k]) mismatches++
    }
  }
  assert.equal(mismatches, 0, `${label}: expected 0 Float32 accessor min/max mismatches, got ${mismatches}`)
}

const godot = await findGodot()
const games = [
  { game: 'signal-drift', checkFile: ['scripts', 'compiled', 'racing', 'race.gd'], glb: 'circuit-copper.glb' },
  { game: 'beacon-run', checkFile: ['scripts', 'compiled', 'game', 'simulation.gd'], glb: 'lantern.glb' },
  { game: 'starter', checkFile: ['scripts', 'compiled', 'game.gd'], glb: 'ranger.glb' },
  { game: 'lighthouse', checkFile: ['scripts', 'compiled', 'lighthouse', 'simulation.gd'], glb: 'island.glb' }
]
for (const entry of games) {
  const outDir = await mkdtemp(join(tmpdir(), `ridgetop-godot-smoke-${entry.game}-`))
  try {
    await packageGame({ target: 'godot', game: entry.game, repoRoot, outDir })
    await access(join(outDir, 'scripts', 'compiled', 'rt.gd'))
    await access(join(outDir, ...entry.checkFile))

    const glb = await readFile(join(outDir, 'assets', 'models', entry.glb))
    assertGlbFloat32Bounds(glb, `${entry.game}/${entry.glb}`)

    if (godot) {
      const res = spawnSync(godot, ['--headless', '--path', outDir, '--quit-after', '5'], { encoding: 'utf8' })
      assert.equal(res.status, 0, `${entry.game}: Godot exited with status ${res.status}:\n${res.stderr}`)
      assert.equal(res.stderr.trim(), '', `${entry.game}: Godot emitted stderr warnings/errors:\n${res.stderr}`)
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}
if (!godot) {
  console.log(`Godot 4 binary not found; verified export structure, compiled GDScript, and GLB Float32 bounds for all ${games.length} games.`)
} else {
  console.log(`Godot 4 smoke passed cleanly (${godot}): all ${games.length} games status=0, stderr=CLEAN, GLB bounds=0 mismatches.`)
}
