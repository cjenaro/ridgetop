import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as wait } from 'node:timers/promises'
import {
  applyBossPhaseShift,
  computeBossTelegraphCells,
  createBossTelegraphZone
} from '../examples/crownshard/crownshard/boss-telegraphs.ts'
import { EQUIPMENT_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import {
  SAVE_KEY,
  confirmDeployment,
  createInitialState,
  serializeSave,
  startStageBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import type { OwnedEquipCard, OwnedHeroCard, SaveData } from '../examples/crownshard/crownshard/types.ts'
import type { ChromiumPage } from './browser-driver.ts'
import {
  namespaceStorageScript,
  openTab,
  startHostedServer,
  uiState,
  uiStateRecord,
  until
} from './browser-driver.ts'
import type { MobileViewportSpec, UiWidgetSnapshot } from './mobile-audit.ts'
import {
  MOBILE_VIEWPORTS,
  assertMobileLayout,
  auditMobileLayout,
  readUiSnapshot,
  touchTapRect,
  touchTapWidget,
  waitAnimationFrames
} from './mobile-audit.ts'
import type { SmokeBackend } from './smoke-suites.ts'
import { RENDERER_NAMES, parseBackends } from './smoke-suites.ts'

export {
  MOBILE_VIEWPORTS,
  assertMobileLayout,
  auditMobileLayout,
  readUiSnapshot,
  touchTapRect,
  touchTapWidget
}

interface ManagedChrome {
  readonly debugOrigin: string
  stop(): Promise<void>
}

interface BossBattleSeed {
  readonly save: SaveData
  readonly casterCol: number
  readonly casterRow: number
}

interface RunSpec {
  readonly backend: SmokeBackend
  readonly viewport: MobileViewportSpec
  readonly captureScreenshots: boolean
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(err => (err ? reject(err) : resolve(port)))
    })
  })
}

function findChromeBinary(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  throw new Error('Could not find Chrome/Chromium binary. Set CHROME_PATH or start Chrome with --remote-debugging-port=9222.')
}

async function isCdpReady(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(700) })
    return res.ok
  } catch {
    return false
  }
}

async function waitProcessExit(child: ChildProcess, graceMs = 4_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const killer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, graceMs)
  try {
    await exited
  } finally {
    clearTimeout(killer)
  }
}

async function ensureChromeCdp(): Promise<ManagedChrome> {
  const existing = (process.env.CHROMIUM_DEBUG ?? 'http://127.0.0.1:9222').replace(/\/$/, '')
  if (await isCdpReady(existing)) {
    process.env.CHROMIUM_DEBUG = existing
    return {
      debugOrigin: existing,
      stop: async () => {}
    }
  }

  const chromeBin = findChromeBinary()
  const port = await getFreePort()
  const userDataDir = await mkdtemp(join(tmpdir(), 'ridgetop-mobile-chrome-'))
  const debugOrigin = `http://127.0.0.1:${port}`

  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
    'about:blank'
  ]

  const child = spawn(chromeBin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr?.on('data', chunk => {
    stderr += String(chunk)
  })

  const cleanup = async () => {
    await waitProcessExit(child)
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }).catch(() => {
      // Ignore transient Chrome profile lock files during temp directory cleanup.
    })
  }

  try {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Headless Chrome exited early (${child.exitCode}):\n${stderr}`)
      }
      if (await isCdpReady(debugOrigin)) {
        process.env.CHROMIUM_DEBUG = debugOrigin
        return { debugOrigin, stop: cleanup }
      }
      await wait(120)
    }
    throw new Error(`Timed out waiting for headless Chrome CDP at ${debugOrigin}\n${stderr}`)
  } catch (err) {
    await cleanup()
    throw err
  }
}

function makeEquipCard(uid: string, equipId: string, upgradeLevel = 0): OwnedEquipCard {
  const spec = EQUIPMENT_BY_ID[equipId]
  assert.ok(spec, `Unknown equipment id: ${equipId}`)
  return {
    uid,
    equipId,
    slot: spec.slot,
    ...(upgradeLevel > 0 ? { upgradeLevel } : {})
  }
}

function buildCampaignSeedSave(): SaveData {
  const state = createInitialState(1337)
  const camp = state.campaign
  camp.gold = 2400
  camp.dust = 320
  camp.shards = 12
  camp.battlesWon = 6
  camp.tipsDisabled = true
  camp.clearedStageIds = [
    'border_watch',
    'miller_ford',
    'sunken_bridge',
    'briar_hollow',
    'sunwell_glade',
    'lantern_crypt'
  ]
  camp.chaptersCleared = camp.clearedStageIds.length
  camp.selectedStageId = 'frostspire_pass'

  const knight: OwnedHeroCard = {
    uid: 'hero_knight_3s',
    heroId: 'knight',
    stars: 3,
    level: 8,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  const archer: OwnedHeroCard = {
    uid: 'hero_archer_2s',
    heroId: 'archer',
    stars: 2,
    level: 7,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  const cleric: OwnedHeroCard = {
    uid: 'hero_cleric_2s',
    heroId: 'cleric',
    stars: 2,
    level: 7,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  const mage: OwnedHeroCard = {
    uid: 'hero_mage_2s',
    heroId: 'mage',
    stars: 2,
    level: 7,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }

  camp.heroes = [knight, archer, cleric, mage]
  camp.squadUids = [knight.uid, archer.uid, cleric.uid, mage.uid]
  camp.selectedCampHeroUid = knight.uid
  camp.heroBonds = {
    'archer+knight': 3,
    'cleric+knight': 2,
    'archer+mage': 2
  }

  // Keep Armory inventory compact (4 items) so all key items appear on Page 1 on every mobile viewport.
  // Order: Sunsteel Blade (main), Aegis of Dawn (2pc Solis combo), Sunsteel Blade (dupe for Fuse +1),
  // plus Apprentice Staff (arcane-locked for Knight, exercising the Compatible filter toggle).
  camp.equipment = [
    makeEquipCard('eq_sunsteel_1', 'sunsteel_blade'),
    makeEquipCard('eq_aegis_1', 'aegis_of_dawn'),
    makeEquipCard('eq_sunsteel_dupe', 'sunsteel_blade'),
    makeEquipCard('eq_arcane_locked', 'apprentice_staff')
  ]
  camp.nextUid = 400

  return serializeSave(state)
}

function buildBossPhase2Seed(): BossBattleSeed {
  const state = createInitialState(2026)
  const camp = state.campaign
  camp.gold = 2400
  camp.dust = 320
  camp.tipsDisabled = true
  camp.clearedStageIds = [
    'border_watch',
    'miller_ford',
    'sunken_bridge',
    'briar_hollow',
    'sunwell_glade',
    'lantern_crypt',
    'frostspire_pass',
    'glacial_citadel',
    'ashfall_foundry'
  ]
  camp.chaptersCleared = camp.clearedStageIds.length
  camp.selectedStageId = 'eclipse_throne'

  const eqBlade = makeEquipCard('eq_boss_blade', 'sunsteel_blade', 2)
  const eqAegis = makeEquipCard('eq_boss_aegis', 'aegis_of_dawn', 1)
  camp.equipment = [eqBlade, eqAegis]

  const knight: OwnedHeroCard = {
    uid: 'hero_knight_boss',
    heroId: 'knight',
    stars: 3,
    subSpecId: 'knight_templar',
    level: 10,
    xp: 0,
    weaponUid: eqBlade.uid,
    armorUid: eqAegis.uid,
    relicUid: null
  }
  const archer: OwnedHeroCard = {
    uid: 'hero_archer_boss',
    heroId: 'archer',
    stars: 3,
    subSpecId: 'archer_sharpshooter',
    level: 9,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  const cleric: OwnedHeroCard = {
    uid: 'hero_cleric_boss',
    heroId: 'cleric',
    stars: 2,
    level: 9,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  const mage: OwnedHeroCard = {
    uid: 'hero_mage_boss',
    heroId: 'mage',
    stars: 2,
    level: 9,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  camp.heroes = [knight, archer, cleric, mage]
  camp.squadUids = [knight.uid, archer.uid, cleric.uid, mage.uid]
  camp.selectedCampHeroUid = knight.uid
  camp.heroBonds = {
    'archer+knight': 3,
    'cleric+knight': 3
  }
  camp.nextUid = 500

  const battle = startStageBattle(state, 'eclipse_throne')
  confirmDeployment(state)

  // Place Knight and Archer side-by-side so Knight's Bulwark Aura heals/shields Archer and triggers Bond Banter!
  const knightUnit = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')
  const archerUnit = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')
  const bossUnit = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'eclipse_archon')
  assert.ok(knightUnit, 'Expected Knight unit in eclipse_throne battle')
  assert.ok(archerUnit, 'Expected Archer unit in eclipse_throne battle')
  assert.ok(bossUnit, 'Expected Archon Malakor boss in eclipse_throne battle')

  // Ensure Knight and Archer are orthogonally adjacent on walkable tiles
  const isAdjacent = Math.abs(knightUnit.col - archerUnit.col) + Math.abs(knightUnit.row - archerUnit.row) === 1
  if (!isAdjacent) {
    const offsets: ReadonlyArray<readonly [number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]]
    for (const [dc, dr] of offsets) {
      const nc = knightUnit.col + dc
      const nr = knightUnit.row + dr
      const cell = battle.cells[nr]?.[nc]
      if (!cell || !cell.walkable) continue
      const occupied = battle.units.some(u => u.alive && u.uid !== archerUnit.uid && u.col === nc && u.row === nr)
      if (!occupied) {
        archerUnit.col = nc
        archerUnit.row = nr
        break
      }
    }
  }

  // Slightly damage Archer so healAmount applies cleanly
  archerUnit.hp = Math.max(1, archerUnit.maxHp - 12)
  knightUnit.hp = Math.max(1, knightUnit.maxHp - 8)
  knightUnit.cooldowns = [0, 0, 0]
  knightUnit.moved = false
  knightUnit.acted = false

  // Make Knight active on Player Phase and keep Archer next in turn order so boss telegraph stays active
  battle.phase = 'player'
  battle.activeUnitUid = knightUnit.uid
  battle.selectedUnitUid = knightUnit.uid
  knightUnit.ct = 100
  archerUnit.ct = 98
  bossUnit.ct = 10
  battle.banterCooldown = 0

  // Shift Archon Malakor into Phase II and lay down a 9-tile Phase II Eclipse Cataclysm telegraph
  bossUnit.hp = Math.max(1, Math.floor(bossUnit.maxHp * 0.42))
  const shiftRes = applyBossPhaseShift(bossUnit)
  assert.equal(shiftRes.triggered, true, 'Expected Archon Malakor Phase II shift to trigger')
  assert.equal(bossUnit.bossPhase, 2, 'Expected Archon Malakor bossPhase === 2')

  const centerCol = Math.min(battle.cols - 2, Math.max(1, knightUnit.col + 2))
  const centerRow = Math.min(battle.rows - 2, Math.max(1, knightUnit.row))
  const tgCells = computeBossTelegraphCells(battle, centerCol, centerRow, 'area3')
  assert.ok(tgCells.length >= 5, `Expected at least 5 telegraph cells, got ${tgCells.length}`)
  const tgZone = createBossTelegraphZone(
    battle,
    bossUnit,
    {
      moveId: 'eclipse_cataclysm',
      label: 'Eclipse Cataclysm',
      element: 'shadow',
      pattern: 'area3',
      damageMul: 1.45,
      flatDamage: 8,
      status: 'burn',
      cooldownSlot: 2,
      cooldownTurns: 2,
      phase: 2,
      vfxMove: 'eclipse_nova'
    },
    tgCells
  )
  battle.bossTelegraphs = [tgZone]

  return {
    save: serializeSave(state),
    casterCol: knightUnit.col,
    casterRow: knightUnit.row
  }
}

async function seedSaveAndReload(
  page: ChromiumPage,
  save: SaveData,
  expectedRenderer: string,
  tag: string
): Promise<void> {
  const payload = JSON.stringify(save)
  const token = 'reload_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2)
  await page.evaluate(`window.__ridgetopMobileReloadToken = ${JSON.stringify(token)}`)
  // Install a one-shot preload script so the seeded save is written AFTER any pagehide/beforeunload
  // autosave from the previous page and BEFORE Crownshard's loadSave() executes on the new document.
  const removeSeedScript = await page.addPreloadScript(`(() => {
    try {
      window.localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(payload)})
    } catch {
      // Ignore storage failures on about:blank or opaque origins.
    }
  })()`)
  try {
    await page.reload()
    await until(
      () => page.evaluate(`(() => {
        if (window.__ridgetopMobileReloadToken === ${JSON.stringify(token)}) return false
        const s = window.__ridgetopUi?.state?.()
        return Boolean(s && s.backend === ${JSON.stringify(expectedRenderer)} && s.screen === 'title')
      })()`),
      true,
      `${tag}: fresh reload initialized title with seeded save`
    )
  } finally {
    await removeSeedScript()
  }
}

async function maybeCaptureScreenshot(
  page: ChromiumPage,
  screenshotDir: string | undefined,
  run: RunSpec,
  screenName: string,
  capturedPaths: string[]
): Promise<void> {
  if (!screenshotDir || !run.captureScreenshots) return
  await waitAnimationFrames(page, 2)
  await mkdir(screenshotDir, { recursive: true })
  const filename = `${run.viewport.id}-${run.backend}-${screenName}.png`
  const fullPath = join(screenshotDir, filename)
  const b64 = await page.capturePngBase64()
  await writeFile(fullPath, Buffer.from(b64, 'base64'))
  capturedPaths.push(fullPath)
}

async function findWidgetByLabelFragment(
  page: ChromiumPage,
  idPrefix: string,
  labelFragment: string
): Promise<UiWidgetSnapshot> {
  const target = labelFragment.toLowerCase()
  const found = await until(
    async () => {
      const widgets = await readUiSnapshot(page)
      return widgets.find(w => w.id.startsWith(idPrefix) && w.label.toLowerCase().includes(target)) ?? null
    },
    Boolean,
    `widget matching idPrefix="${idPrefix}" and label containing "${labelFragment}"`
  )
  assert.ok(found, `Expected widget "${idPrefix}*" containing "${labelFragment}"`)
  return found
}

function stringArrayFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

async function runMobileVerification(
  page: ChromiumPage,
  origin: string,
  run: RunSpec,
  screenshotDir: string | undefined,
  capturedPaths: string[],
  storageSeed: string
): Promise<void> {
  const { backend, viewport } = run
  const expectedRenderer = RENDERER_NAMES[backend]
  const tag = `${viewport.id} (${viewport.name}) [${backend}]`
  const gameUrl = `${origin}/crownshard?renderer=${backend}`

  const audit = async (
    screenLabel: string,
    opts?: {
      ignoreOverlapPairs?: ReadonlyArray<readonly [string, string]>
      ignoreWorldProjectedPrefixes?: readonly string[]
    }
  ) => {
    return await assertMobileLayout(page, {
      stage: 'cs-stage',
      uiLayer: 'cs-ui',
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      label: `${tag} — ${screenLabel}`,
      ignoreOverlapPairs: opts?.ignoreOverlapPairs,
      ignoreWorldProjectedPrefixes: opts?.ignoreWorldProjectedPrefixes
    })
  }

  const removeNamespace = await page.addPreloadScript(namespaceStorageScript(`${storageSeed}.${backend}.${viewport.id}.`))
  try {
    await page.setViewport(viewport.width, viewport.height, true)
    await page.setTouchEnabled(true, 2)
    page.clearErrors()

    // Initial load to seed localStorage cleanly inside the namespaced origin
    await page.navigate(gameUrl)
    await until(() => uiState(page, 'backend'), expectedRenderer, `${tag}: renderer initialized`)
    await until(() => uiState(page, 'screen'), 'title', `${tag}: initial title`)

    // Seed late-game 3★ Knight + Bonds + Solis Gear + Duplicate Blade + Arcane Locked Staff
    const campSeed = buildCampaignSeedSave()
    await seedSaveAndReload(page, campSeed, expectedRenderer, `${tag} (campaign seed)`)

    // -----------------------------------------------------------------------
    // SCREEN 1: TITLE
    // -----------------------------------------------------------------------
    await audit('Screen 1: Title')
    await maybeCaptureScreenshot(page, screenshotDir, run, '01-title', capturedPaths)
    await touchTapWidget(page, 'cs-play', `${tag}: tap Play`)
    await until(() => uiState(page, 'screen'), 'world', `${tag}: entered World Map`)

    // -----------------------------------------------------------------------
    // SCREEN 2: WORLD MAP (3D Diorama + Stage Inspector + Weather Preview)
    // -----------------------------------------------------------------------
    assert.equal(await uiState(page, 'selectedStageId'), 'frostspire_pass', `${tag}: Frostspire Pass selected`)
    await audit('Screen 2: World Map', { ignoreWorldProjectedPrefixes: ['map-node-', 'world-event-'] })
    await maybeCaptureScreenshot(page, screenshotDir, run, '02-world-map', capturedPaths)
    await touchTapWidget(page, 'cs-world-camp', `${tag}: tap Camp on World Map`)
    await until(() => uiState(page, 'screen'), 'camp', `${tag}: entered Camp`)

    // -----------------------------------------------------------------------
    // SCREEN 3: CAMP SQUAD TAB (3★ Sub-Spec + Hero Bonds)
    // -----------------------------------------------------------------------
    await until(() => uiState(page, 'campTab'), 'squad', `${tag}: Camp Squad tab active`)
    const squadState = await uiStateRecord(page)
    assert.equal(squadState.selectedHeroNeedsSubSpec, true, `${tag}: 3★ Knight needs sub-spec choice`)
    assert.ok(
      typeof squadState.totalBondRanks === 'number' && squadState.totalBondRanks > 0,
      `${tag}: totalBondRanks > 0`
    )
    const squadReport = await audit('Screen 3: Camp Squad (Sub-Spec Pending)')
    assert.ok(squadReport.widgets.some(w => w.id === 'sq-subspec-0'), `${tag}: sq-subspec-0 rendered`)
    assert.ok(squadReport.widgets.some(w => w.id === 'sq-subspec-1'), `${tag}: sq-subspec-1 rendered`)
    await maybeCaptureScreenshot(page, screenshotDir, run, '03-camp-squad', capturedPaths)

    // Tap Templar -> verify switch -> tap Juggernaut -> verify switch
    await touchTapWidget(page, 'sq-subspec-0', `${tag}: tap sq-subspec-0 (Templar)`)
    await until(() => uiState(page, 'selectedHeroSubSpecId'), 'knight_templar', `${tag}: selected knight_templar`)
    await touchTapWidget(page, 'sq-subspec-1', `${tag}: tap sq-subspec-1 (Juggernaut)`)
    await until(() => uiState(page, 'selectedHeroSubSpecId'), 'knight_juggernaut', `${tag}: selected knight_juggernaut`)
    await audit('Screen 3: Camp Squad (Sub-Spec Chosen)')

    // -----------------------------------------------------------------------
    // SCREEN 4: CAMP ARMORY TAB (Class-Lock + 2pc Gear Sets + Upgrade +1–+5)
    // -----------------------------------------------------------------------
    await touchTapWidget(page, 'cs-tab-armory', `${tag}: tap Armory tab`)
    await until(() => uiState(page, 'campTab'), 'armory', `${tag}: Camp Armory tab active`)
    assert.equal(await uiState(page, 'selectedHeroEquipFamily'), 'vanguard', `${tag}: Knight equip family is vanguard`)
    await audit('Screen 4: Camp Armory (Initial)')

    // Toggle Class-Lock Compatible Filter -> Compatible -> All Gear
    await touchTapWidget(page, 'arm-compat-toggle', `${tag}: toggle arm-compat-toggle -> compatible`)
    await until(() => uiState(page, 'armoryCompatibleFilter'), 'compatible', `${tag}: armory filter compatible`)
    await audit('Screen 4: Camp Armory (Compatible Filter)')

    await touchTapWidget(page, 'arm-compat-toggle', `${tag}: toggle arm-compat-toggle -> all`)
    await until(() => uiState(page, 'armoryCompatibleFilter'), 'all', `${tag}: armory filter all`)
    await audit('Screen 4: Camp Armory (All Gear Filter)')

    // Equip Sunsteel Blade (touch tap #1 inspects -> tap arm-confirm-equip to equip)
    const bladeWidget = await findWidgetByLabelFragment(page, 'arm-equip-', 'Sunsteel Blade')
    await touchTapRect(page, bladeWidget.bounds)
    await until(() => uiState(page, 'inspectedArmoryEquipUid'), Boolean, `${tag}: inspected Sunsteel Blade`)
    await audit('Screen 4: Camp Armory (Inspect Blade + Confirm Dock)')
    await touchTapWidget(page, 'arm-confirm-equip', `${tag}: confirm equip Sunsteel Blade`)
    await until(
      async () => (await readUiSnapshot(page)).some(w => w.id === 'arm-confirm-equip'),
      false,
      `${tag}: Sunsteel Blade equipped (confirm button dismissed)`
    )

    // Equip Aegis of Dawn to activate 2-piece Solis Vanguard Gear Set!
    const aegisWidget = await findWidgetByLabelFragment(page, 'arm-equip-', 'Aegis of Dawn')
    await touchTapRect(page, aegisWidget.bounds)
    await until(() => uiState(page, 'inspectedArmoryEquipUid'), Boolean, `${tag}: inspected Aegis of Dawn`)
    await audit('Screen 4: Camp Armory (Inspect Aegis + 2pc Set Preview)')
    await touchTapWidget(page, 'arm-confirm-equip', `${tag}: confirm equip Aegis of Dawn`)
    await until(
      async () => stringArrayFrom(await uiState(page, 'selectedHeroActiveSets')).includes('solis'),
      true,
      `${tag}: 2pc Solis gear set activated`
    )

    // Dismiss Legendary Equip Fanfare overlay if triggered by Aegis of Dawn
    await waitAnimationFrames(page, 2)
    const fanfareWidget = (await readUiSnapshot(page)).find(w => w.id === 'cs-fanfare')
    if (fanfareWidget) {
      await touchTapRect(page, fanfareWidget.bounds)
      await until(
        async () => (await readUiSnapshot(page)).some(w => w.id === 'cs-fanfare'),
        false,
        `${tag}: Legendary Equip Fanfare dismissed`
      )
    }

    // Inspect equipped Sunsteel Blade -> verify Fuse +1 and Temper +1 buttons -> upgrade!
    const equippedBladeWidget = await findWidgetByLabelFragment(page, 'arm-equip-', 'Sunsteel Blade')
    await touchTapRect(page, equippedBladeWidget.bounds)
    await until(
      async () => (await readUiSnapshot(page)).some(w => w.id === 'arm-fuse-upgrade'),
      true,
      `${tag}: inspected equipped Sunsteel Blade with duplicate Fuse +1 option`
    )
    const upgradeReport = await audit('Screen 4: Camp Armory (Upgrade & Fuse Dock)')
    assert.ok(upgradeReport.widgets.some(w => w.id === 'arm-fuse-upgrade'), `${tag}: arm-fuse-upgrade visible`)
    assert.ok(upgradeReport.widgets.some(w => w.id === 'arm-gold-upgrade'), `${tag}: arm-gold-upgrade visible`)
    await maybeCaptureScreenshot(page, screenshotDir, run, '04-camp-armory', capturedPaths)

    const levelBefore = await uiState(page, 'selectedEquipUpgradeLevel')
    assert.equal(levelBefore, 0, `${tag}: Sunsteel Blade starts at +0`)
    await touchTapWidget(page, 'arm-gold-upgrade', `${tag}: tap Gold Temper +1`)
    await until(() => uiState(page, 'selectedEquipUpgradeLevel'), 1, `${tag}: Sunsteel Blade tempered to +1`)
    await touchTapWidget(page, 'arm-fuse-upgrade', `${tag}: tap Duplicate Fuse +1`)
    await until(() => uiState(page, 'selectedEquipUpgradeLevel'), 2, `${tag}: Sunsteel Blade fused to +2`)
    await audit('Screen 4: Camp Armory (Post-Upgrade +2)')

    // -----------------------------------------------------------------------
    // SCREEN 5: BATTLE — WEATHER + DESTRUCTIBLE COVER + HERO BOND BANTER
    // -----------------------------------------------------------------------
    await touchTapWidget(page, 'cs-camp-quick-fight', `${tag}: tap Quick Fight into Frostspire Pass`)
    await until(() => uiState(page, 'screen'), 'story', `${tag}: story briefing opened`)
    await audit('Screen 5: Story Briefing')
    await touchTapWidget(page, 'cs-story-go', `${tag}: tap Launch Battle`)
    await until(() => uiState(page, 'screen'), 'battle', `${tag}: battle screen active`)

    if ((await uiState(page, 'battlePhase')) === 'deploy') {
      await audit('Screen 5: Battle Deploy Phase')
      await touchTapWidget(page, 'cs-start-battle', `${tag}: tap Start Battle`)
      await until(() => uiState(page, 'battlePhase'), 'player', `${tag}: entered player phase`)
    }

    const weatherBattleState = await uiStateRecord(page)
    assert.ok(
      weatherBattleState.battleWeather === 'blizzard' || weatherBattleState.battleWeather === 'rain',
      `${tag}: expected rain or blizzard weather, got ${String(weatherBattleState.battleWeather)}`
    )
    assert.ok(
      typeof weatherBattleState.destructibleCoverCount === 'number' && weatherBattleState.destructibleCoverCount > 0,
      `${tag}: expected destructibleCoverCount > 0, got ${String(weatherBattleState.destructibleCoverCount)}`
    )
    assert.ok(
      typeof weatherBattleState.activeBondPairsCount === 'number' && weatherBattleState.activeBondPairsCount > 0,
      `${tag}: expected activeBondPairsCount > 0`
    )
    assert.ok(
      typeof weatherBattleState.activeBanterText === 'string' && weatherBattleState.activeBanterText.length > 0,
      `${tag}: expected battle-start Hero Bond banter text`
    )

    await audit('Screen 5: Battle (Blizzard + Destructible Cover + Banter)')
    await maybeCaptureScreenshot(page, screenshotDir, run, '05-battle-weather-cover', capturedPaths)

    // Open Weather Detail popover -> audit -> close
    await touchTapWidget(page, 'cs-weather-pill', `${tag}: tap weather pill`)
    await until(() => uiState(page, 'weatherInspectorOpen'), true, `${tag}: weather inspector opened`)
    const weatherPopReport = await audit('Screen 5: Battle (Weather Detail Popover)')
    assert.ok(weatherPopReport.widgets.some(w => w.id === 'cs-weather-detail'), `${tag}: cs-weather-detail present`)
    await touchTapWidget(page, 'cs-weather-detail', `${tag}: close weather detail popover`)
    await until(() => uiState(page, 'weatherInspectorOpen'), false, `${tag}: weather inspector closed`)

    // Open Mobile Tactic Hand Drawer -> audit -> close
    await touchTapWidget(page, 'cs-toggle-hand', `${tag}: open mobile tactic hand drawer`)
    await until(() => uiState(page, 'mobileHandOpen'), true, `${tag}: mobile hand drawer opened`)
    await audit('Screen 5: Battle (Mobile Tactic Hand Drawer)')
    await touchTapWidget(page, 'cs-close-hand', `${tag}: close mobile tactic hand drawer`)
    await until(() => uiState(page, 'mobileHandOpen'), false, `${tag}: mobile hand drawer closed`)

    // -----------------------------------------------------------------------
    // SCREEN 6: BATTLE — BOSS PHASE II + GLOWING AOE TELEGRAPH + BANTER
    // -----------------------------------------------------------------------
    const bossSeed = buildBossPhase2Seed()
    await seedSaveAndReload(page, bossSeed.save, expectedRenderer, `${tag} (Boss Phase II seed)`)
    assert.equal(await uiState(page, 'hasResumableBattle'), true, `${tag}: hasResumableBattle true`)
    await audit('Screen 6: Title (Resume Boss Battle)')

    await touchTapWidget(page, 'cs-resume-battle', `${tag}: tap Resume Boss Battle`)
    await until(() => uiState(page, 'screen'), 'battle', `${tag}: resumed Boss Phase II battle`)
    await until(() => uiState(page, 'battlePhase'), 'player', `${tag}: Boss Phase II player phase`)

    const bossStateBefore = await uiStateRecord(page)
    assert.equal(bossStateBefore.bossPhaseMax, 2, `${tag}: bossPhaseMax === 2`)
    assert.ok(
      typeof bossStateBefore.bossTelegraphCount === 'number' && bossStateBefore.bossTelegraphCount >= 1,
      `${tag}: bossTelegraphCount >= 1`
    )
    assert.ok(
      typeof bossStateBefore.bossTelegraphTilesCount === 'number' && bossStateBefore.bossTelegraphTilesCount >= 5,
      `${tag}: bossTelegraphTilesCount >= 5`
    )

    // Cast Knight's Bulwark Aura (sk-1) on self to shield adjacent bonded Archer -> triggers active Hero Bond Banter!
    await touchTapWidget(page, 'sk-1', `${tag}: tap Bulwark Aura (sk-1)`)
    const castOk = await page.evaluate(
      `window.__CROWNSHARD__?.selectTile?.(${bossSeed.casterCol}, ${bossSeed.casterRow}) ?? false`
    )
    assert.equal(castOk, true, `${tag}: cast Bulwark Aura to trigger bond banter`)

    await until(
      async () => {
        const text = await uiState(page, 'activeBanterText')
        return typeof text === 'string' && text.length > 0
      },
      true,
      `${tag}: activeBanterText non-null during Boss Phase II telegraph`
    )

    const bossStateAfter = await uiStateRecord(page)
    assert.equal(bossStateAfter.bossPhaseMax, 2, `${tag}: bossPhaseMax stays 2`)
    assert.ok(
      typeof bossStateAfter.bossTelegraphCount === 'number' && bossStateAfter.bossTelegraphCount >= 1,
      `${tag}: bossTelegraphCount stays >= 1`
    )
    assert.ok(
      typeof bossStateAfter.bossTelegraphTilesCount === 'number' && bossStateAfter.bossTelegraphTilesCount >= 5,
      `${tag}: bossTelegraphTilesCount stays >= 5`
    )
    assert.ok(
      typeof bossStateAfter.activeBanterText === 'string' && bossStateAfter.activeBanterText.length > 0,
      `${tag}: activeBanterText non-null`
    )

    await audit('Screen 6: Battle (Boss Phase II + Telegraph + Banter)')
    await maybeCaptureScreenshot(page, screenshotDir, run, '06-battle-boss-telegraph', capturedPaths)

    assert.deepEqual(page.errors, [], `${tag}: zero console/JS errors`)
    console.log(`PASS ${tag} — all 6 screens & 8 features passed mobile layout + touch audit`)
  } finally {
    await removeNamespace()
  }
}

function buildRunMatrix(): RunSpec[] {
  const rawViewports = process.env.RIDGETOP_MOBILE_VIEWPORTS?.trim()
  const viewportFilter = rawViewports
    ? rawViewports.split(',').map(s => s.trim()).filter(Boolean)
    : null
  const viewports = viewportFilter
    ? MOBILE_VIEWPORTS.filter(v => viewportFilter.includes(v.id))
    : [...MOBILE_VIEWPORTS]
  if (viewports.length === 0) {
    throw new Error(`No mobile viewports matched RIDGETOP_MOBILE_VIEWPORTS="${rawViewports ?? ''}"`)
  }

  const rawBackends = process.env.RIDGETOP_BACKENDS?.trim()
  if (rawBackends) {
    const backends = parseBackends(rawBackends, ['canvas'], ['webgpu', 'webgl2', 'canvas'])
    const runs: RunSpec[] = []
    for (let bi = 0; bi < backends.length; bi++) {
      const backend = backends[bi]
      for (const viewport of viewports) {
        runs.push({
          backend,
          viewport,
          captureScreenshots: bi === 0 && viewport.captureScreenshots
        })
      }
    }
    return runs
  }

  // Default matrix: Canvas 2D across ALL 4 mobile phone viewports + WebGL 2 on iPhone 14/15 Portrait (390x844)
  const runs: RunSpec[] = viewports.map(viewport => ({
    backend: 'canvas',
    viewport,
    captureScreenshots: viewport.captureScreenshots
  }))
  const iphone14 = viewports.find(v => v.id === '390x844')
  if (iphone14) {
    runs.push({
      backend: 'webgl2',
      viewport: iphone14,
      captureScreenshots: false
    })
  }
  return runs
}

async function main(): Promise<void> {
  const runs = buildRunMatrix()
  const screenshotDir = process.env.RIDGETOP_MOBILE_SCREENSHOT_DIR?.trim() || undefined
  const storageSeed = 'cs-mobile-' + Date.now().toString(36)
  const capturedPaths: string[] = []

  const chrome = await ensureChromeCdp()
  const server = await startHostedServer({
    existingUrl: process.env.RIDGETOP_URL,
    testing: false,
    tempPrefix: 'ridgetop-mobile-smoke-'
  })

  const openTabs: ChromiumPage[] = []
  try {
    for (const run of runs) {
      const tab = await openTab('about:blank')
      openTabs.push(tab)
      try {
        await runMobileVerification(tab, server.origin, run, screenshotDir, capturedPaths, storageSeed)
      } finally {
        const idx = openTabs.indexOf(tab)
        if (idx >= 0) openTabs.splice(idx, 1)
        await tab.close()
      }
    }
    if (capturedPaths.length > 0) {
      console.log(`Captured ${capturedPaths.length} mobile screenshots in ${screenshotDir}:`)
      for (const path of capturedPaths) {
        console.log(`  - ${path}`)
      }
    }
    console.log(`Crownshard mobile phone verification complete (${runs.length} runs passed).`)
  } finally {
    for (const tab of openTabs) {
      await tab.close().catch(() => {
        // Ignore tab cleanup failure during teardown.
      })
    }
    await server.stop()
    await chrome.stop()
  }
}

const isEntrypoint = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (isEntrypoint) {
  await main()
}
