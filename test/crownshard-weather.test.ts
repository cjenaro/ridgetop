import assert from 'node:assert/strict'
import test from 'node:test'
import type { Color, LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { BIOME_STYLES } from '../examples/crownshard/crownshard/art.ts'
import { CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill,
  armTacticCard,
  computeCombatForecast,
  createInitialState,
  refreshHighlights,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  setUnitFacing,
  startChapterBattle,
  startStageBattle,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleWeatherId, BiomeId, GameState, TimeOfDayId } from '../examples/crownshard/crownshard/types.ts'
import {
  BATTLE_WEATHER_IDS,
  TIME_OF_DAY_IDS,
  WEATHER_SPECS,
  computeWeatherCombatModifiers,
  computeWeatherLighting,
  defaultAtmosphereForBiome,
  formatWeatherHudLabel,
  resolveBattleAtmosphere,
  weatherSlowDurationBonus
} from '../examples/crownshard/crownshard/weather.ts'

function clearFlatBoard(battle: BattleState): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = { col: c, row: r, terrain: 'grass', elevation: 0, heightLevel: 0, walkable: true }
    }
  }
}

function placeUnit(battle: BattleState, u: BattleState['units'][number], col: number, row: number): void {
  u.col = col
  u.row = row
  const [x, y, z] = gridToWorld(col, row, battle.cells[row][col].elevation, battle.cols, battle.rows)
  u.x = x
  u.y = y
  u.z = z
  u.path = []
  u.moveProgress = 0
}

function setupWeatherBattle(weather: BattleWeatherId, timeOfDay: TimeOfDayId = 'day', seed = 7777): {
  state: GameState
  battle: BattleState
  mage: BattleState['units'][number]
  cryo: BattleState['units'][number]
  knight: BattleState['units'][number]
  enemy: BattleState['units'][number]
} {
  const state = createInitialState(seed)
  state.campaign.heroes = [
    { uid: 'h_mage', heroId: 'mage', stars: 2, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_cryo', heroId: 'cryomancer', stars: 2, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_knight', heroId: 'knight', stars: 2, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_mage', 'h_cryo', 'h_knight']
  state.campaign.tactics.push(
    { uid: 'tac_fire', tacticId: 'flame_scroll' },
    { uid: 'tac_frost', tacticId: 'frost_nova_scroll' }
  )

  const battle = startChapterBattle(state, 0, 0, { weather, timeOfDay })
  clearFlatBoard(battle)

  const mage = battle.units.find(u => u.uid === 'h_mage')!
  const cryo = battle.units.find(u => u.uid === 'h_cryo')!
  const knight = battle.units.find(u => u.uid === 'h_knight')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  const enemy = enemies[0]!
  for (let i = 1; i < enemies.length; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
  }

  // Deterministic setup: high enemy HP, zero base crit variance for exact damage checks
  enemy.maxHp = 220
  enemy.hp = 220
  enemy.shield = 0
  enemy.def = 4
  setUnitFacing(enemy, 'w')

  mage.crit = 0
  cryo.crit = 0
  knight.crit = 0
  mage.cooldowns = [0, 0, 0]
  cryo.cooldowns = [0, 0, 0]
  knight.cooldowns = [0, 0, 0]
  mage.acted = false
  cryo.acted = false
  knight.acted = false

  placeUnit(battle, mage, 2, 2)
  placeUnit(battle, cryo, 2, 3)
  placeUnit(battle, knight, 3, 2)
  placeUnit(battle, enemy, 4, 2)

  battle.phase = 'player'
  battle.ap = 6
  battle.hand = ['tac_fire', 'tac_frost']
  battle.activeUnitUid = mage.uid
  battle.selectedUnitUid = mage.uid

  return { state, battle, mage, cryo, knight, enemy }
}

test('Deterministic weather & time-of-day assignment across campaign stages, biomes, and Endless waves', () => {
  // Border Watch remains Clear Daylight so tutorial & baseline expectations stay stable
  const border = resolveBattleAtmosphere({ stageId: 'border_watch', biome: 'meadow' })
  assert.deepEqual(border, { weather: 'clear', timeOfDay: 'day' })

  // Thematic campaign assignments cover all 4 weather archetypes deterministically
  const riverStage = resolveBattleAtmosphere({ stageId: 'sunken_bridge', biome: 'river' })
  assert.equal(riverStage.weather, 'rain')

  const frostStage = resolveBattleAtmosphere({ stageId: 'frostspire_pass', biome: 'frost' })
  assert.equal(frostStage.weather, 'blizzard')

  const cryptStage = resolveBattleAtmosphere({ stageId: 'lantern_crypt', biome: 'crypt' })
  assert.equal(cryptStage.weather, 'dusk')
  assert.equal(cryptStage.timeOfDay, 'night')

  const throneStage = resolveBattleAtmosphere({ stageId: 'eclipse_throne', biome: 'throne' })
  assert.equal(throneStage.weather, 'dusk')

  // Campaign spans all 4 weather types
  const seenCampaignWeathers = new Set<BattleWeatherId>()
  for (const ch of CHAPTERS) {
    const a1 = resolveBattleAtmosphere({ stageId: ch.id, biome: ch.biome })
    const a2 = resolveBattleAtmosphere({ stageId: ch.id, biome: ch.biome })
    assert.deepEqual(a1, a2, `Stage ${ch.id} weather must be deterministic`)
    seenCampaignWeathers.add(a1.weather)
  }
  for (const w of BATTLE_WEATHER_IDS) {
    assert.ok(seenCampaignWeathers.has(w), `Campaign stages should expose weather: ${w}`)
  }

  // Biome defaults are valid and deterministic
  const biomes: readonly BiomeId[] = ['meadow', 'river', 'crypt', 'frost', 'volcano', 'throne', 'dunes', 'aether', 'expanse']
  for (const b of biomes) {
    const d = defaultAtmosphereForBiome(b)
    assert.ok(BATTLE_WEATHER_IDS.includes(d.weather))
    assert.ok(TIME_OF_DAY_IDS.includes(d.timeOfDay))
  }

  // Endless mode waves are deterministic for the same seed+wave and rotate across all weather types
  const endlessWeathers = new Set<BattleWeatherId>()
  for (let wave = 1; wave <= 12; wave++) {
    const biome = biomes[(wave - 1) % biomes.length]
    const w1 = resolveBattleAtmosphere({ biome, endlessWave: wave, seed: 2026 })
    const w2 = resolveBattleAtmosphere({ biome, endlessWave: wave, seed: 2026 })
    assert.deepEqual(w1, w2, `Endless wave ${wave} must be deterministic`)
    endlessWeathers.add(w1.weather)
  }
  assert.equal(endlessWeathers.size, 4, 'Endless waves should encounter all 4 weather types')

  // HUD label formatting
  assert.equal(formatWeatherHudLabel('rain', 'day', true), 'Rain')
  assert.ok(formatWeatherHudLabel('rain', 'day', false).includes('Fire'))
  assert.ok(formatWeatherHudLabel('rain', 'day', false).includes('Frost'))
})

test('Rain reduces Fire damage, boosts Frost damage, extends Slow duration, and matches CombatForecast exactly', () => {
  // 1. Fire skill (Mage skill 1: Fireball, vfx='fire', status='burn') — Clear vs Rain
  const clearFire = setupWeatherBattle('clear')
  assert.equal(armSkill(clearFire.state, 1), true)
  const fcClearFire = computeCombatForecast(clearFire.state, clearFire.enemy.col, clearFire.enemy.row)
  assert.ok(fcClearFire, 'Expected Fireball forecast in Clear weather')
  assert.equal(fcClearFire.weatherNote, undefined)

  const rainFire = setupWeatherBattle('rain')
  assert.equal(armSkill(rainFire.state, 1), true)
  const fcRainFire = computeCombatForecast(rainFire.state, rainFire.enemy.col, rainFire.enemy.row)
  assert.ok(fcRainFire, 'Expected Fireball forecast in Rain weather')
  assert.equal(fcRainFire.weatherDamageMul, 0.85)
  assert.equal(fcRainFire.weatherNote, 'RAIN -15% FIRE')
  assert.ok(fcRainFire.normalDmg < fcClearFire.normalDmg, `Rain must reduce Fireball damage (${fcRainFire.normalDmg} < ${fcClearFire.normalDmg})`)

  // Execute Fireball in Rain and verify exact forecast-to-combat integer parity!
  const hpBeforeFire = rainFire.enemy.hp
  assert.equal(selectTile(rainFire.state, rainFire.enemy.col, rainFire.enemy.row), true)
  assert.equal(hpBeforeFire - rainFire.enemy.hp, fcRainFire.normalDmg, 'Actual Rain Fireball damage must match CombatForecast exactly')

  // 2. Frost skill (Cryomancer skill 1: Glacial Spike, vfx='frost', status='slow') — Clear vs Rain
  const clearFrost = setupWeatherBattle('clear')
  clearFrost.battle.activeUnitUid = clearFrost.cryo.uid
  clearFrost.battle.selectedUnitUid = clearFrost.cryo.uid
  assert.equal(armSkill(clearFrost.state, 1), true)
  const fcClearFrost = computeCombatForecast(clearFrost.state, clearFrost.enemy.col, clearFrost.enemy.row)
  assert.ok(fcClearFrost)

  const rainFrost = setupWeatherBattle('rain')
  rainFrost.battle.activeUnitUid = rainFrost.cryo.uid
  rainFrost.battle.selectedUnitUid = rainFrost.cryo.uid
  assert.equal(armSkill(rainFrost.state, 1), true)
  const fcRainFrost = computeCombatForecast(rainFrost.state, rainFrost.enemy.col, rainFrost.enemy.row)
  assert.ok(fcRainFrost)
  assert.equal(fcRainFrost.weatherDamageMul, 1.15)
  assert.equal(fcRainFrost.weatherNote, 'RAIN +15% FROST')
  assert.ok(fcRainFrost.normalDmg > fcClearFrost.normalDmg, `Rain must boost Frost skill damage (${fcRainFrost.normalDmg} > ${fcClearFrost.normalDmg})`)

  // Execute Frost skill in Rain: exact damage parity AND Slow lasts +1 turn (3 turns instead of 2)
  const hpBeforeFrost = rainFrost.enemy.hp
  assert.equal(selectTile(rainFrost.state, rainFrost.enemy.col, rainFrost.enemy.row), true)
  assert.equal(hpBeforeFrost - rainFrost.enemy.hp, fcRainFrost.normalDmg, 'Actual Rain Frost damage must match CombatForecast exactly')
  assert.equal(weatherSlowDurationBonus('rain'), 1)
  assert.equal(rainFrost.enemy.slowTurns, 3, 'Rain should extend Slow duration to 3 turns')

  // 3. Fire Tactic Card (Flame Scroll) also obeys Rain dampening with forecast parity
  const clearTac = setupWeatherBattle('clear')
  assert.equal(armTacticCard(clearTac.state, 'tac_fire'), true)
  const fcClearTac = computeCombatForecast(clearTac.state, clearTac.enemy.col, clearTac.enemy.row)
  assert.ok(fcClearTac)

  const rainTac = setupWeatherBattle('rain')
  assert.equal(armTacticCard(rainTac.state, 'tac_fire'), true)
  const fcRainTac = computeCombatForecast(rainTac.state, rainTac.enemy.col, rainTac.enemy.row)
  assert.ok(fcRainTac)
  assert.ok(fcRainTac.normalDmg < fcClearTac.normalDmg, 'Rain must dampen Fire Tactic card damage')
  const hpBeforeTac = rainTac.enemy.hp
  assert.equal(selectTile(rainTac.state, rainTac.enemy.col, rainTac.enemy.row), true)
  assert.equal(hpBeforeTac - rainTac.enemy.hp, fcRainTac.normalDmg, 'Rain Flame Scroll actual damage must match forecast')
})

test('Blizzard boosts Frost damage & Frost crit, dampens Fire, and matches CombatForecast exactly', () => {
  const clearCtx = setupWeatherBattle('clear')
  clearCtx.battle.activeUnitUid = clearCtx.cryo.uid
  clearCtx.battle.selectedUnitUid = clearCtx.cryo.uid
  assert.equal(armSkill(clearCtx.state, 1), true)
  const fcClearFrost = computeCombatForecast(clearCtx.state, clearCtx.enemy.col, clearCtx.enemy.row)
  assert.ok(fcClearFrost)

  const blizCtx = setupWeatherBattle('blizzard')
  blizCtx.battle.activeUnitUid = blizCtx.cryo.uid
  blizCtx.battle.selectedUnitUid = blizCtx.cryo.uid
  assert.equal(armSkill(blizCtx.state, 1), true)
  const fcBlizFrost = computeCombatForecast(blizCtx.state, blizCtx.enemy.col, blizCtx.enemy.row)
  assert.ok(fcBlizFrost)

  assert.equal(fcBlizFrost.weatherDamageMul, 1.2)
  assert.equal(fcBlizFrost.weatherCritBonus, 0.1)
  assert.equal(fcBlizFrost.weatherNote, 'BLIZZARD +20% FROST')
  assert.ok(fcBlizFrost.normalDmg > fcClearFrost.normalDmg, 'Blizzard must boost Frost damage by +20%')
  assert.ok(Math.abs((fcBlizFrost.critChance - fcClearFrost.critChance) - 0.1) < 1e-6, 'Blizzard must add +10% crit to Frost skills')

  // Blizzard dampens Fireball (-15%)
  const clearFire = setupWeatherBattle('clear')
  assert.equal(armSkill(clearFire.state, 1), true)
  const fcClearFire = computeCombatForecast(clearFire.state, clearFire.enemy.col, clearFire.enemy.row)
  assert.ok(fcClearFire)

  const blizFire = setupWeatherBattle('blizzard')
  assert.equal(armSkill(blizFire.state, 1), true)
  const fcBlizFire = computeCombatForecast(blizFire.state, blizFire.enemy.col, blizFire.enemy.row)
  assert.ok(fcBlizFire)
  assert.equal(fcBlizFire.weatherDamageMul, 0.85)
  assert.equal(fcBlizFire.weatherNote, 'BLIZZARD -15% FIRE')
  assert.ok(fcBlizFire.normalDmg < fcClearFire.normalDmg, 'Blizzard must reduce Fire damage')

  const hpBefore = blizFire.enemy.hp
  assert.equal(selectTile(blizFire.state, blizFire.enemy.col, blizFire.enemy.row), true)
  assert.equal(hpBefore - blizFire.enemy.hp, fcBlizFire.normalDmg, 'Actual Blizzard Fireball damage must match forecast')
})

test('Dusk increases Crit chance on all attacks and adds extra ambush Crit on Flank/Backstab', () => {
  const clearCtx = setupWeatherBattle('clear')
  clearCtx.battle.activeUnitUid = clearCtx.knight.uid
  clearCtx.battle.selectedUnitUid = clearCtx.knight.uid
  clearCtx.knight.crit = 0.15
  // Front attack: knight at (3,2), enemy at (4,2) facing 'w'
  clearCtx.battle.armedSkillIndex = null
  refreshHighlights(clearCtx.battle, clearCtx.state.campaign)
  const fcClearFront = computeCombatForecast(clearCtx.state, clearCtx.enemy.col, clearCtx.enemy.row)
  assert.ok(fcClearFront)
  assert.equal(fcClearFront.attackArc, 'front')

  const duskCtx = setupWeatherBattle('dusk', 'dusk')
  duskCtx.battle.activeUnitUid = duskCtx.knight.uid
  duskCtx.battle.selectedUnitUid = duskCtx.knight.uid
  duskCtx.knight.crit = 0.15
  duskCtx.battle.armedSkillIndex = null
  refreshHighlights(duskCtx.battle, duskCtx.state.campaign)
  const fcDuskFront = computeCombatForecast(duskCtx.state, duskCtx.enemy.col, duskCtx.enemy.row)
  assert.ok(fcDuskFront)
  assert.equal(fcDuskFront.attackArc, 'front')
  assert.equal(fcDuskFront.weatherCritBonus, 0.1)
  assert.equal(fcDuskFront.weatherNote, 'DUSK +10% CRIT')
  assert.ok(
    Math.abs((fcDuskFront.critChance - fcClearFront.critChance) - 0.1) < 1e-6,
    `Dusk front crit should be +10% (got ${fcDuskFront.critChance} vs ${fcClearFront.critChance})`
  )

  // Backstab attack at Dusk: enemy faces 'e', knight behind at (3,2) -> extra +15% ambush crit (+25% weather crit total)
  setUnitFacing(clearCtx.enemy, 'e')
  setUnitFacing(duskCtx.enemy, 'e')
  const fcClearBack = computeCombatForecast(clearCtx.state, clearCtx.enemy.col, clearCtx.enemy.row)
  const fcDuskBack = computeCombatForecast(duskCtx.state, duskCtx.enemy.col, duskCtx.enemy.row)
  assert.ok(fcClearBack && fcDuskBack)
  assert.equal(fcDuskBack.attackArc, 'back')
  assert.equal(fcDuskBack.weatherCritBonus, 0.25)
  assert.equal(fcDuskBack.weatherNote, 'DUSK +25% CRIT')
  assert.ok(
    Math.abs((fcDuskBack.critChance - fcClearBack.critChance) - 0.25) < 1e-6,
    `Dusk backstab crit should gain +25% over Clear backstab (${fcDuskBack.critChance} vs ${fcClearBack.critChance})`
  )

  // Pure modifier helper consistency
  const mod = computeWeatherCombatModifiers('dusk', null, 'flank')
  assert.equal(mod.critBonus, 0.25)
  assert.equal(mod.damageMul, 1)
  assert.equal(mod.note, 'DUSK +25% CRIT')
})

test('computeWeatherLighting produces finite, distinct lighting parameters for Clear, Rain, Blizzard, and Dusk', () => {
  const base = BIOME_STYLES.meadow
  const clearLight = computeWeatherLighting(base, 'clear', 'day')
  const rainLight = computeWeatherLighting(base, 'rain', 'day')
  const blizzardLight = computeWeatherLighting(base, 'blizzard', 'day')
  const duskLight = computeWeatherLighting(base, 'dusk', 'dusk')
  const nightLight = computeWeatherLighting(base, 'dusk', 'night')

  const allLights = [clearLight, rainLight, blizzardLight, duskLight, nightLight]
  for (const l of allLights) {
    for (const v of [...l.sky, ...l.fog, ...l.lightDir, ...l.lightColor, ...l.skyBounce, ...l.groundBounce, ...l.shadowTint, l.ambient, l.fogNear, l.fogFar, l.shadowStrength, l.rimStrength, l.pointIntensityMul]) {
      assert.ok(Number.isFinite(v), 'Every lighting component must be finite')
    }
    assert.ok(l.ambient >= 0 && l.ambient <= 1)
    assert.ok(l.fogFar > l.fogNear)
  }

  // Distinct directional sun angle at Dusk (lower Y angle than daylight!)
  assert.ok(duskLight.lightDir[1] < clearLight.lightDir[1] - 0.25, 'Dusk sun must sit significantly lower than Clear daylight')
  // Dusk light is warmer (higher R - B delta than Rain & Blizzard)
  const duskWarmth = duskLight.lightColor[0] - duskLight.lightColor[2]
  const rainWarmth = rainLight.lightColor[0] - rainLight.lightColor[2]
  const blizzardWarmth = blizzardLight.lightColor[0] - blizzardLight.lightColor[2]
  assert.ok(duskWarmth > rainWarmth + 0.25, 'Dusk light must be warmer than Rain light')
  assert.ok(duskWarmth > blizzardWarmth + 0.25, 'Dusk light must be warmer than Blizzard light')
  // Rain & Blizzard pull fog closer than Clear
  assert.ok(rainLight.fogFar < clearLight.fogFar)
  assert.ok(blizzardLight.fogFar < rainLight.fogFar)
  // Night boosts point light intensity for glowing braziers
  assert.ok(nightLight.pointIntensityMul > clearLight.pointIntensityMul)

  // Verify 3D scene integration renders weather particles and applies shifted lighting without errors
  let lightingCalls = 0
  let lastClearSky: Color | undefined
  let maxInstances = 0
  const stats: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    instances: 0,
    uploadBytes: 0,
    culledBatches: 0
  }
  const fakeRenderer = {
    name: 'Canvas 2D',
    canvas: undefined as unknown as HTMLCanvasElement,
    setLighting() { lightingCalls++ },
    release() {},
    releaseMesh() {},
    dispose() {},
    render(_m: unknown, batches: Iterable<{ count: number }>, clearColor?: Color) {
      lastClearSky = clearColor
      let n = 0
      for (const b of batches) n += b.count
      maxInstances = Math.max(maxInstances, n)
      return stats
    }
  } satisfies LowPolyRenderer
  const scene = createCrownshardScene(fakeRenderer)
  const rainSetup = setupWeatherBattle('rain', 'day')
  for (let i = 0; i < 6; i++) {
    rainSetup.state.time += 0.04
    scene.render(rainSetup.state, 0.04, 1280, 720)
  }
  assert.ok(lightingCalls >= 1, 'Scene should apply weather-shifted lighting')
  assert.ok(lastClearSky !== undefined, 'Scene should pass weather-shifted clear sky color')
  assert.ok(maxInstances > 0, 'Scene should render board + weather particle instances')

  // Switching to Blizzard updates lighting cleanly
  const prevLightingCalls = lightingCalls
  const blizSetup = setupWeatherBattle('blizzard', 'night')
  for (let i = 0; i < 5; i++) {
    blizSetup.state.time += 0.04
    scene.render(blizSetup.state, 0.04, 1280, 720)
  }
  assert.ok(lightingCalls > prevLightingCalls, 'Switching weather must re-apply shifted lighting')
})

test('Save/load round-trip preserves weather and timeOfDay, and gracefully defaults legacy saves', () => {
  const state = createInitialState(5150)
  const battle = startStageBattle(state, 'frostspire_pass', 0, { weather: 'blizzard', timeOfDay: 'night' })
  assert.equal(battle.weather, 'blizzard')
  assert.equal(battle.timeOfDay, 'night')

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  assert.equal(snap.weather, 'blizzard')
  assert.equal(snap.timeOfDay, 'night')

  const validated = validateBattleSnapshot(JSON.parse(JSON.stringify(snap)))
  assert.ok(validated)
  assert.equal(validated.weather, 'blizzard')
  assert.equal(validated.timeOfDay, 'night')

  const restoredState = createInitialState(999)
  assert.equal(restoreBattleState(restoredState, validated), true)
  assert.ok(restoredState.battle)
  assert.equal(restoredState.battle.weather, 'blizzard')
  assert.equal(restoredState.battle.timeOfDay, 'night')

  // Legacy snapshot missing weather/timeOfDay falls back cleanly to stage/biome default
  const legacyObj: Record<string, unknown> = JSON.parse(JSON.stringify(snap))
  delete legacyObj.weather
  delete legacyObj.timeOfDay
  const legacyState = createInitialState(999)
  assert.equal(restoreBattleState(legacyState, legacyObj), true)
  assert.ok(legacyState.battle)
  assert.equal(legacyState.battle.weather, 'blizzard')
  assert.equal(legacyState.battle.timeOfDay, 'day')

  // Invalid weather in snapshot is rejected
  const badObj: Record<string, unknown> = JSON.parse(JSON.stringify(snap))
  badObj.weather = 'tornado'
  assert.equal(validateBattleSnapshot(badObj), null)

  // Verify WEATHER_SPECS integrity for all IDs
  for (const id of BATTLE_WEATHER_IDS) {
    assert.equal(WEATHER_SPECS[id].id, id)
    assert.ok(WEATHER_SPECS[id].ruleSummary.length > 0)
  }
})
