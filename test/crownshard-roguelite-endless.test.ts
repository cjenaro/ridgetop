import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  ENDLESS_BIOME_POOLS,
  ENDLESS_BIOME_ROTATION,
  ENDLESS_BLESSINGS,
  ENDLESS_BLESSING_BY_ID,
  ENDLESS_BLESSING_IDS,
  SAVE_KEY,
  abandonBattle,
  abandonEndlessRun,
  applyEndlessBlessingsToUnit,
  buildEndlessWaveEnemies,
  computeCombatForecast,
  computeEndlessAttackerDamageMultiplier,
  computeEndlessBlessingModifiers,
  createInitialState,
  draftEndlessBlessing,
  endPlayerTurn,
  formatEndlessBiomeLabel,
  generateEndlessBlessingDraft,
  isEndlessBossWave,
  loadSave,
  persistSave,
  refreshHighlights,
  restoreBattleState,
  selectEndlessWaveStage,
  selectTile,
  serializeBattleState,
  serializeSave,
  startChapterBattle,
  startEndlessRun,
  stepGame,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { CHAPTERS, ENEMY_SPECS } from '../examples/crownshard/crownshard/data.ts'
import { cellHeightAt, gridToWorld, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, BiomeId, EndlessBlessingId, GameState, SaveData } from '../examples/crownshard/crownshard/types.ts'

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) }
  }
}

function placeUnit(state: GameState, unit: BattleUnit, col: number, row: number): void {
  const battle = state.battle!
  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = wx
  unit.y = wy
  unit.z = wz
  unit.path = []
  unit.moveProgress = 0
}

function forceActiveAlly(state: GameState, ally: BattleUnit): void {
  const battle = state.battle!
  battle.phase = 'player'
  battle.activeUnitUid = ally.uid
  battle.selectedUnitUid = ally.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  ally.moved = false
  ally.acted = false
  ally.stunTurns = 0
  refreshHighlights(battle, state.campaign)
}

function jump1Reachable(battle: BattleState, startCol: number, startRow: number): Set<string> {
  const visited = new Set<string>([`${startCol},${startRow}`])
  const queue: { col: number; row: number }[] = [{ col: startCol, row: startRow }]
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const curH = cellHeightAt(battle, cur.col, cur.row)
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (nc < 0 || nc >= battle.cols || nr < 0 || nr >= battle.rows) continue
      const key = `${nc},${nr}`
      if (visited.has(key)) continue
      const cell = battle.cells[nr][nc]
      if (!terrainWalkable(cell.terrain)) continue
      const nextH = cellHeightAt(battle, nc, nr)
      if (Math.abs(nextH - curH) > 1) continue
      visited.add(key)
      queue.push({ col: nc, row: nr })
    }
  }
  return visited
}

function winCurrentEndlessBattle(state: GameState): void {
  const battle = state.battle!
  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
    enemies[i].shield = 0
  }
  const last = enemies[enemies.length - 1]
  last.hp = 1
  last.shield = 0
  // Place ally & last enemy on two adjacent walkable tiles
  let placed = false
  for (let r = 0; r < battle.rows && !placed; r++) {
    for (let c = 0; c < battle.cols - 1 && !placed; c++) {
      if (terrainWalkable(battle.cells[r][c].terrain) && terrainWalkable(battle.cells[r][c + 1].terrain)) {
        const occA = battle.units.some(u => u.alive && u.uid !== ally.uid && u.uid !== last.uid && u.col === c && u.row === r)
        const occB = battle.units.some(u => u.alive && u.uid !== ally.uid && u.uid !== last.uid && u.col === c + 1 && u.row === r)
        if (!occA && !occB) {
          placeUnit(state, ally, c, r)
          placeUnit(state, last, c + 1, r)
          placed = true
        }
      }
    }
  }
  assert.equal(placed, true, 'Must find adjacent walkable tiles to finish battle')
  forceActiveAlly(state, ally)
  const struck = selectTile(state, last.col, last.row)
  assert.equal(struck, true, 'Final blow must execute')
  assert.equal(battle.phase, 'victory', 'Routing all enemies must win the Endless wave')
}

// =========================================================================
// 1. BIOME ROTATION, PERIODIC BOSS WAVES & JUMP-1 REACHABILITY
// =========================================================================

test('Endless biome rotation cycles all 9 biomes with zero back-to-back repeats and valid jump-1 reachable maps', () => {
  const seeds = [1337, 9001, 424242]
  for (const seed of seeds) {
    const firstBlock = new Set<BiomeId>()
    let prevBiome: BiomeId | null = null

    for (let wave = 1; wave <= 27; wave++) {
      const sel = selectEndlessWaveStage(seed, wave)
      // Deterministic repeat check
      const selAgain = selectEndlessWaveStage(seed, wave)
      assert.equal(selAgain.biome, sel.biome)
      assert.equal(selAgain.stageId, sel.stageId)

      // No back-to-back biome repeats, including across cycle boundaries (9->10, 18->19)
      if (prevBiome !== null) {
        assert.notEqual(
          sel.biome,
          prevBiome,
          `seed ${seed} wave ${wave} must not repeat previous biome ${prevBiome}`
        )
      }
      prevBiome = sel.biome
      if (wave <= 9) firstBlock.add(sel.biome)

      // Boss waves occur exactly every 3rd wave
      assert.equal(sel.isBossWave, wave % 3 === 0)
      assert.equal(isEndlessBossWave(wave), wave % 3 === 0)

      // Biome-appropriate wave enemies + boss verification
      const enemies = buildEndlessWaveEnemies(sel.chapter, wave, seed)
      assert.ok(enemies.length >= 4 && enemies.length <= 5, `wave ${wave} should spawn 4-5 enemies`)
      const pool = ENDLESS_BIOME_POOLS[sel.biome]
      const bossCount = enemies.filter(e => ENEMY_SPECS[e.id]?.isBoss).length
      if (wave % 3 === 0) {
        assert.equal(bossCount, 1, `boss wave ${wave} (${sel.biome}) must spawn 1 boss`)
        const bossSpawn = enemies.find(e => ENEMY_SPECS[e.id]?.isBoss)!
        const allowedBosses = [pool.bossId, ...(pool.eliteBossId ? [pool.eliteBossId] : [])]
        assert.ok(allowedBosses.includes(bossSpawn.id), `wave ${wave} boss ${bossSpawn.id} must match biome ${sel.biome}`)
      } else {
        assert.equal(bossCount, 0, `standard wave ${wave} must not spawn a boss`)
        for (const e of enemies) {
          assert.ok(pool.enemies.includes(e.id), `wave ${wave} enemy ${e.id} must belong to biome ${sel.biome}`)
        }
      }
    }

    // All 9 biomes are covered in the first 9-wave cycle!
    assert.equal(firstBlock.size, ENDLESS_BIOME_ROTATION.length)
    for (const b of ENDLESS_BIOME_ROTATION) {
      assert.equal(firstBlock.has(b), true, `seed ${seed} must visit biome ${b} in waves 1..9`)
      assert.ok(formatEndlessBiomeLabel(b).length > 0)
    }
  }

  // Launch actual Endless battles across 12 waves and verify non-overlapping walkable spawns + jump-1 connectivity!
  const state = createInitialState(7777)
  startEndlessRun(state, 1)
  const visitedBiomes = new Set<BiomeId>()
  let lastBattleBiome: BiomeId | null = null

  for (let wave = 1; wave <= 12; wave++) {
    const battle = startChapterBattle(state, 0, wave)
    assert.equal(battle.endlessWave, wave)
    visitedBiomes.add(battle.biome)
    if (lastBattleBiome !== null) {
      assert.notEqual(battle.biome, lastBattleBiome, `battle wave ${wave} must rotate off biome ${lastBattleBiome}`)
    }
    lastBattleBiome = battle.biome

    const occupied = new Set<string>()
    const allies = battle.units.filter(u => u.team === 'ally')
    const enemies = battle.units.filter(u => u.team === 'enemy')
    assert.ok(allies.length >= 1)
    assert.ok(enemies.length >= 4)

    for (const u of battle.units) {
      const cell = battle.cells[u.row][u.col]
      assert.equal(terrainWalkable(cell.terrain), true, `wave ${wave} unit ${u.uid} must stand on walkable terrain`)
      const key = `${u.col},${u.row}`
      assert.equal(occupied.has(key), false, `wave ${wave} spawns must not overlap at ${key}`)
      occupied.add(key)
    }

    for (const ally of allies) {
      const reach = jump1Reachable(battle, ally.col, ally.row)
      for (const foe of enemies) {
        assert.equal(
          reach.has(`${foe.col},${foe.row}`),
          true,
          `wave ${wave} (${battle.stageId}/${battle.biome}): hero (${ally.col},${ally.row}) must reach enemy (${foe.col},${foe.row}) with jump=1`
        )
      }
    }
  }
  assert.equal(visitedBiomes.size, 9, '12 consecutive waves must visit all 9 biomes')
})

// =========================================================================
// 2. RUN BLESSINGS CATALOG, DRAFTING, STACKING & CLEARING ON DEFEAT/ABANDON
// =========================================================================

test('12 distinct Run Blessings draft deterministically (1 of 3), stack without duplicates, and clear on defeat/abandon', () => {
  assert.equal(ENDLESS_BLESSINGS.length, 12)
  assert.equal(ENDLESS_BLESSING_IDS.length, 12)
  const rarities = new Set(ENDLESS_BLESSINGS.map(b => b.rarity))
  assert.deepEqual(
    Array.from(rarities).sort(),
    ['common', 'epic', 'legendary', 'rare']
  )
  for (const id of ENDLESS_BLESSING_IDS) {
    const spec = ENDLESS_BLESSING_BY_ID[id]
    assert.ok(spec && spec.name.length > 0 && spec.desc.length > 0)
  }

  // Deterministic 1-of-3 generation with no duplicates
  const d1 = generateEndlessBlessingDraft(5555, 1, [])
  const d1Repeat = generateEndlessBlessingDraft(5555, 1, [])
  assert.deepEqual(d1, d1Repeat)
  assert.equal(d1.length, 3)
  assert.equal(new Set(d1).size, 3)

  // Excludes already owned blessings and shrinks cleanly near completion
  const tenOwned = ENDLESS_BLESSING_IDS.slice(0, 10)
  const lastTwo = generateEndlessBlessingDraft(5555, 11, tenOwned)
  assert.equal(lastTwo.length, 2)
  for (const id of lastTwo) {
    assert.equal(tenOwned.includes(id), false)
  }
  assert.deepEqual(generateEndlessBlessingDraft(5555, 13, ENDLESS_BLESSING_IDS), [])

  // Full victory -> draft -> next wave flow
  const state = createInitialState(31415)
  const run = startEndlessRun(state, 1)
  assert.equal(state.campaign.endlessRun, run)
  assert.equal(run.currentWave, 1)
  assert.deepEqual(run.activeBlessings, [])

  const b1 = startChapterBattle(state, 0, 1)
  winCurrentEndlessBattle(state)

  assert.equal(state.campaign.endlessBest, 1)
  assert.equal(state.campaign.endlessRun?.pendingDraft.length, 3)
  const offered = state.campaign.endlessRun!.pendingDraft.slice()
  assert.equal(new Set(offered).size, 3)

  // Reject drafting a blessing that was not offered
  const unoffered = ENDLESS_BLESSING_IDS.find(id => !offered.includes(id))!
  assert.equal(draftEndlessBlessing(state, unoffered), false)

  // Claim offered blessing #0
  assert.equal(draftEndlessBlessing(state, offered[0]), true)
  assert.deepEqual(state.campaign.endlessRun?.activeBlessings, [offered[0]])
  assert.deepEqual(state.campaign.endlessRun?.pendingDraft, [])
  assert.equal(state.campaign.endlessRun?.currentWave, 2)

  // Start Wave 2 -> rotates biome and carries the claimed blessing
  const b2 = startChapterBattle(state, 0, 2)
  assert.notEqual(b2.biome, b1.biome)
  assert.deepEqual(b2.endlessBlessings, [offered[0]])

  // Win Wave 2 -> offers 3 new blessings that exclude offered[0]
  winCurrentEndlessBattle(state)
  assert.equal(state.campaign.endlessBest, 2)
  const offered2: EndlessBlessingId[] = state.campaign.endlessRun?.pendingDraft.slice() ?? []
  assert.equal(offered2.length, 3)
  assert.equal(offered2.includes(offered[0]), false, 'Already-owned blessing must not reappear in draft')
  assert.equal(draftEndlessBlessing(state, offered2[1]), true)
  assert.deepEqual(state.campaign.endlessRun?.activeBlessings, [offered[0], offered2[1]])

  // Defeat on Wave 3 clears temporary run blessings while keeping endlessBest = 2!
  const b3 = startChapterBattle(state, 0, 3)
  const allies = b3.units.filter(u => u.team === 'ally')
  const enemy = b3.units.find(u => u.team === 'enemy' && u.alive)!
  // Down all allies except one at 1 HP, then let enemy defeat them via lethal strike/burn
  for (let i = 0; i < allies.length - 1; i++) {
    allies[i].alive = false
    allies[i].downed = false
    allies[i].hp = 0
  }
  const lastAlly = allies[allies.length - 1]
  lastAlly.hp = 1
  lastAlly.shield = 0
  lastAlly.burnTurns = 2
  // Ensure enemy stays alive and lastAlly burns out on its turn start
  lastAlly.ct = 200
  enemy.ct = 0
  b3.phase = 'player'
  b3.activeUnitUid = lastAlly.uid
  // Disable Phoenix Grace if it happened to be drafted so defeat occurs cleanly
  b3.phoenixGraceUsed = true
  endPlayerTurn(state)
  // Step until defeat resolves
  for (let i = 0; i < 40 && state.battle?.phase !== 'defeat'; i++) {
    stepGame(state, 0.2)
  }
  assert.equal(state.battle?.phase, 'defeat')
  assert.equal(state.campaign.endlessRun, null, 'Defeat must clear temporary Endless run blessings')
  assert.equal(state.campaign.endlessBest, 2, 'Defeat must preserve endlessBest high-water mark')

  // Abandoning an active Endless run or battle also clears endlessRun while preserving endlessBest
  const run2 = startEndlessRun(state, 1)
  run2.activeBlessings.push('solar_zeal')
  assert.equal(abandonEndlessRun(state), true)
  assert.equal(state.campaign.endlessRun, null)
  assert.equal(state.campaign.endlessBest, 2)

  const run3 = startEndlessRun(state, 1)
  run3.activeBlessings.push('aegis_ward')
  startChapterBattle(state, 0, 1)
  assert.equal(abandonBattle(state), true)
  assert.equal(state.campaign.endlessRun, null)
  assert.equal(state.campaign.endlessBest, 2)
})

// =========================================================================
// 3. LIVE COMBAT EFFECTS OF BLESSINGS & COMBAT FORECAST PARITY
// =========================================================================

test('Run Blessings apply live stat, AP, lifesteal, regen, damage, burn-on-crit, and CombatForecast parity', () => {
  // Baseline battle (Wave 1, no blessings)
  const baseState = createInitialState(12345)
  startEndlessRun(baseState, 1)
  const baseBattle = startChapterBattle(baseState, 0, 1, { deployPhase: true })
  const baseKnight = baseBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const baseStats = {
    atk: baseKnight.atk,
    def: baseKnight.def,
    shield: baseKnight.shield,
    speed: baseKnight.speed,
    ct: baseKnight.ct,
    move: baseKnight.move,
    jump: baseKnight.jump,
    crit: baseKnight.crit,
    lifesteal: baseKnight.lifesteal,
    ap: baseBattle.ap,
    maxAp: baseBattle.maxAp
  }

  // Blessed battle with stat & AP blessings active
  const blessedState = createInitialState(12345)
  const run = startEndlessRun(blessedState, 1)
  run.activeBlessings.push(
    'solar_zeal',
    'aegis_ward',
    'quicksilver_step',
    'arcane_font',
    'vampiric_edge',
    'windrunner_stride',
    'executioners_eye',
    'iron_bastion'
  )
  const bBattle = startChapterBattle(blessedState, 0, 1, { deployPhase: true })
  const bKnight = bBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!

  assert.equal(bKnight.atk, Math.round(baseStats.atk * 1.15), 'solar_zeal grants +15% ATK')
  assert.equal(bKnight.shield, baseStats.shield + 18, 'aegis_ward grants +18 starting Shield')
  assert.equal(bKnight.speed, baseStats.speed + 2, 'quicksilver_step grants +2 SPD')
  assert.equal(bKnight.ct, baseStats.ct + 15, 'quicksilver_step grants +15 starting CT')
  assert.equal(bBattle.ap, baseStats.ap + 1, 'arcane_font grants +1 starting AP')
  assert.equal(bBattle.maxAp, baseStats.maxAp + 1, 'arcane_font grants +1 Max AP')
  assert.ok(Math.abs(bKnight.lifesteal - (baseStats.lifesteal + 0.12)) < 1e-6, 'vampiric_edge grants +12% Lifesteal')
  assert.equal(bKnight.move, baseStats.move + 1, 'windrunner_stride grants +1 Move')
  assert.equal(bKnight.jump, baseStats.jump + 1, 'windrunner_stride grants +1 Jump')
  assert.ok(Math.abs(bKnight.crit - (baseStats.crit + 0.15)) < 1e-6, 'executioners_eye grants +15% Crit')
  assert.equal(bKnight.def, baseStats.def + 3, 'iron_bastion grants +3 DEF')

  // Verify applyEndlessBlessingsToUnit ignores enemies
  const enemy = bBattle.units.find(u => u.team === 'enemy')!
  const enemyAtkBefore = enemy.atk
  applyEndlessBlessingsToUnit(enemy, ['solar_zeal', 'iron_bastion'])
  assert.equal(enemy.atk, enemyAtkBefore)

  // Verify Vampiric Edge lifesteal heals on live strike
  bBattle.phase = 'player'
  bKnight.hp = Math.max(10, bKnight.maxHp - 25)
  const hpBeforeStrike = bKnight.hp
  enemy.hp = 120
  enemy.maxHp = 120
  enemy.shield = 0
  enemy.def = 0
  // Find two adjacent walkable tiles at same height
  let c0 = 0
  let r0 = 0
  for (let r = 0; r < bBattle.rows; r++) {
    for (let c = 0; c < bBattle.cols - 1; c++) {
      if (terrainWalkable(bBattle.cells[r][c].terrain) && terrainWalkable(bBattle.cells[r][c + 1].terrain)) {
        c0 = c
        r0 = r
        break
      }
    }
  }
  placeUnit(blessedState, bKnight, c0, r0)
  placeUnit(blessedState, enemy, c0 + 1, r0)
  // Move other units out of the way so no pincer interferes
  for (const u of bBattle.units) {
    if (u.uid !== bKnight.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  enemy.alive = true
  bKnight.crit = 0 // deterministic non-crit strike
  forceActiveAlly(blessedState, bKnight)
  const fcBefore = computeCombatForecast(blessedState, enemy.col, enemy.row)!
  assert.ok(fcBefore && fcBefore.normalDmg > 0)
  assert.equal(selectTile(blessedState, enemy.col, enemy.row), true)
  assert.ok(bKnight.hp > hpBeforeStrike, 'vampiric_edge must heal ally on dealing damage')

  // Verify Ember Blade (+10% DMG & Burn on crit) + Frost Heart (+20% DMG vs Slowed/Stunned) & CombatForecast parity!
  const sA = createInitialState(8888)
  startEndlessRun(sA, 1)
  const battleNoDmgBless = startChapterBattle(sA, 0, 1)

  const sB = createInitialState(8888)
  const runB = startEndlessRun(sB, 1)
  runB.activeBlessings.push('ember_blade', 'frost_heart')
  const battleWithDmgBless = startChapterBattle(sB, 0, 1)

  const setupDuel = (st: GameState, slowEnemy: boolean, guaranteeCrit: boolean) => {
    const bt = st.battle!
    const hero = bt.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
    const foe = bt.units.find(u => u.team === 'enemy')!
    for (const u of bt.units) {
      if (u.uid !== hero.uid && u.uid !== foe.uid) {
        u.alive = false
        u.hp = 0
      }
    }
    hero.atk = 30
    hero.crit = guaranteeCrit ? 0.95 : 0
    foe.hp = 200
    foe.maxHp = 200
    foe.shield = 0
    foe.def = 4
    foe.facing = 'w'
    foe.slowTurns = slowEnemy ? 2 : 0
    foe.burnTurns = 0
    placeUnit(st, hero, c0, r0)
    placeUnit(st, foe, c0 + 1, r0)
    forceActiveAlly(st, hero)
    return { hero, foe }
  }

  const duelNoBless = setupDuel(sA, true, false)
  const duelBlessed = setupDuel(sB, true, false)
  const fcNoBless = computeCombatForecast(sA, duelNoBless.foe.col, duelNoBless.foe.row)!
  const fcBlessed = computeCombatForecast(sB, duelBlessed.foe.col, duelBlessed.foe.row)!

  // Ember Blade (1.10x) * Frost Heart (1.20x vs Slowed) = 1.32x multiplier
  const expectedMul = computeEndlessAttackerDamageMultiplier(['ember_blade', 'frost_heart'], duelBlessed.hero, duelBlessed.foe)
  assert.ok(Math.abs(expectedMul - 1.32) < 1e-6)
  assert.ok(fcBlessed.normalDmg > fcNoBless.normalDmg, 'Ember Blade + Frost Heart must boost forecast damage vs Slowed foe')

  // Live strike damage MUST match CombatForecast.normalDmg exactly!
  const foeHpBefore = duelBlessed.foe.hp
  assert.equal(selectTile(sB, duelBlessed.foe.col, duelBlessed.foe.row), true)
  assert.equal(foeHpBefore - duelBlessed.foe.hp, fcBlessed.normalDmg, 'Live damage must match CombatForecast.normalDmg')

  // Ember Blade inflicts Burn on critical hits!
  const sCrit = createInitialState(9999)
  const runCrit = startEndlessRun(sCrit, 1)
  runCrit.activeBlessings.push('ember_blade')
  startChapterBattle(sCrit, 0, 1)
  const duelCrit = setupDuel(sCrit, false, true)
  // Force 100% crit chance (clamp caps at 0.95, try up to 6 hits to confirm burn on crit)
  let burnedOnCrit = false
  for (let attempt = 0; attempt < 8 && !burnedOnCrit; attempt++) {
    duelCrit.foe.hp = 200
    duelCrit.foe.burnTurns = 0
    forceActiveAlly(sCrit, duelCrit.hero)
    selectTile(sCrit, duelCrit.foe.col, duelCrit.foe.row)
    if (duelCrit.foe.burnTurns > 0) burnedOnCrit = true
  }
  assert.equal(burnedOnCrit, true, 'ember_blade must inflict Burn on critical hits')
  assert.ok(battleNoDmgBless.endlessWave === 1 && battleWithDmgBless.endlessWave === 1)
})

test('Battle Mender (+8 HP turn-start regen) and Phoenix Grace (once-per-wave 40% auto-revive) trigger accurately', () => {
  const state = createInitialState(24680)
  const run = startEndlessRun(state, 1)
  run.activeBlessings.push('battle_mender', 'phoenix_grace')
  const battle = startChapterBattle(state, 0, 1)

  // Keep 1 ally and 1 enemy alive
  const allies = battle.units.filter(u => u.team === 'ally')
  const hero = allies[0]
  for (let i = 1; i < allies.length; i++) {
    allies[i].alive = false
    allies[i].downed = false
    allies[i].hp = 0
  }
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  // 1) Test Battle Mender (+8 HP on ally turn start)
  hero.hp = Math.max(10, hero.maxHp - 20)
  const injuredHp = hero.hp
  hero.ct = 180
  enemy.ct = 0
  forceActiveAlly(state, hero)
  // Ending player turn while enemy has 0 CT and hero has 180-60=120 CT immediately starts hero's next turn!
  endPlayerTurn(state)
  assert.equal(battle.activeUnitUid, hero.uid)
  assert.equal(hero.hp, Math.min(hero.maxHp, injuredHp + 8), 'battle_mender must heal +8 HP at start of ally turn')

  // 2) Test Phoenix Grace (once-per-wave auto-revive at 40% max HP on lethal burn tick)
  assert.ok(!battle.phoenixGraceUsed)
  hero.hp = 2
  hero.shield = 0
  hero.burnTurns = 2
  hero.ct = 180
  enemy.ct = 0
  forceActiveAlly(state, hero)
  endPlayerTurn(state)

  const expectedReviveHp = Math.max(1, Math.round(hero.maxHp * 0.4))
  // Note: battle_mender also triggers later in the same turn start after burn tick!
  assert.equal(battle.phoenixGraceUsed, true, 'Phoenix Grace must mark itself used after reviving')
  assert.equal(hero.alive, true, 'Hero must remain alive after Phoenix Grace auto-revive')
  assert.equal(hero.downed, false, 'Hero must not be downed after Phoenix Grace auto-revive')
  assert.equal(hero.burnTurns, 0, 'Phoenix Grace clears burn on revive')
  assert.equal(
    hero.hp,
    Math.min(hero.maxHp, expectedReviveHp + 8),
    'Hero revives at 40% HP (+8 from Battle Mender on that surviving turn start)'
  )

  // 3) Second fatal blow in the same wave must NOT trigger Phoenix Grace again -> Defeat!
  hero.hp = 2
  hero.shield = 0
  hero.burnTurns = 2
  hero.ct = 180
  enemy.ct = 0
  forceActiveAlly(state, hero)
  endPlayerTurn(state)
  assert.equal(hero.alive, false, 'Phoenix Grace must only trigger once per wave')
  assert.equal(battle.phase, 'defeat', 'Losing last hero after Phoenix Grace is spent must cause Defeat')
  assert.equal(state.campaign.endlessRun, null, 'Defeat clears temporary run state')
})

// =========================================================================
// 4. CAMPAIGN & BATTLE SAVE/RESUME ROUND-TRIP + LEGACY SAVE COMPATIBILITY
// =========================================================================

test('Campaign & BattleSaveSnapshot preserve endlessRun, activeBlessings, phoenixGraceUsed, and stay legacy-save compatible', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(54321)
  state.campaign.endlessBest = 4
  const run = startEndlessRun(state, 3)
  run.activeBlessings.push('arcane_font', 'phoenix_grace', 'ember_blade')
  run.lastBiome = 'crypt'

  const battle = startChapterBattle(state, 0, 3)
  battle.phoenixGraceUsed = true

  // Capture & validate battle snapshot
  const snap = serializeBattleState(battle, state.campaign.seed)!
  assert.ok(snap)
  assert.equal(snap.endlessWave, 3)
  assert.equal(snap.biome, battle.biome)
  assert.equal(snap.stageId, battle.stageId)
  assert.deepEqual(snap.endlessBlessings, ['arcane_font', 'phoenix_grace', 'ember_blade'])
  assert.equal(snap.phoenixGraceUsed, true)

  const validated = validateBattleSnapshot(snap)
  assert.ok(validated)
  assert.deepEqual(validated.endlessBlessings, ['arcane_font', 'phoenix_grace', 'ember_blade'])
  assert.equal(validated.phoenixGraceUsed, true)

  // Persist & reload full campaign + active battle
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.equal(loaded.campaign.endlessBest, 4)
  assert.equal(loaded.campaign.endlessRun?.seed, run.seed)
  assert.equal(loaded.campaign.endlessRun?.currentWave, 3)
  assert.deepEqual(loaded.campaign.endlessRun?.activeBlessings, ['arcane_font', 'phoenix_grace', 'ember_blade'])
  assert.equal(loaded.campaign.endlessRun?.lastBiome, battle.biome)

  const resumed = createInitialState(1, loaded)
  assert.ok(resumed.battle)
  assert.equal(resumed.battle.endlessWave, 3)
  assert.equal(resumed.battle.biome, battle.biome)
  assert.deepEqual(resumed.battle.endlessBlessings, ['arcane_font', 'phoenix_grace', 'ember_blade'])
  assert.equal(resumed.battle.phoenixGraceUsed, true)

  // Also test pendingDraft round-trip after victory!
  winCurrentEndlessBattle(resumed)
  const draftBeforeSave = resumed.campaign.endlessRun!.pendingDraft.slice()
  assert.equal(draftBeforeSave.length, 3)
  const savedAfterVictory = serializeSave(resumed)
  assert.deepEqual(savedAfterVictory.campaign.endlessRun?.pendingDraft, draftBeforeSave)
  const rehydratedAfterVictory = createInitialState(1, savedAfterVictory)
  assert.deepEqual(rehydratedAfterVictory.campaign.endlessRun?.pendingDraft, draftBeforeSave)

  // Legacy save compatibility (no endlessRun on campaign, no endlessBlessings/phoenixGraceUsed on battle snapshot)
  const legacyState = createInitialState(999)
  const legacyBattle = startChapterBattle(legacyState, 0, 0)
  const legacySnap = serializeBattleState(legacyBattle, legacyState.campaign.seed)!
  const rawLegacySave: SaveData = serializeSave(legacyState)
  const strippedCampaign = { ...rawLegacySave.campaign }
  delete strippedCampaign.endlessRun
  const strippedBattle = { ...legacySnap } as Record<string, unknown>
  delete strippedBattle.endlessBlessings
  delete strippedBattle.phoenixGraceUsed

  const legacyStorage = createMemoryStorage()
  legacyStorage.setItem(SAVE_KEY, JSON.stringify({
    version: 1,
    campaign: strippedCampaign,
    activeBattle: strippedBattle
  }))

  const loadedLegacy = loadSave(legacyStorage)
  assert.ok(loadedLegacy, 'Legacy save without endlessRun must load cleanly')
  assert.equal(loadedLegacy.campaign.endlessRun, null)
  const hydratedLegacy = createInitialState(1, loadedLegacy)
  assert.equal(hydratedLegacy.campaign.endlessRun, null)
  assert.ok(hydratedLegacy.battle)
  assert.equal(hydratedLegacy.battle.endlessBlessings, undefined)
  assert.equal(hydratedLegacy.battle.phoenixGraceUsed, undefined)

  // Backwards compatibility: calling startChapterBattle(state, idx, endlessWave) without startEndlessRun works!
  const compatState = createInitialState(707)
  assert.equal(compatState.campaign.endlessRun, null)
  const compatBattle = startChapterBattle(compatState, CHAPTERS.length - 1, 2)
  assert.equal(compatBattle.endlessWave, 2)
  const compatRun = compatState.campaign.endlessRun as { currentWave: number } | null
  assert.ok(compatRun !== null)
  assert.equal(compatRun.currentWave, 2)

  // Restore snapshot validation rejects invalid blessing IDs
  const invalidSnap = { ...snap, endlessBlessings: ['not_a_real_blessing'] }
  assert.equal(validateBattleSnapshot(invalidSnap), null)
  assert.equal(restoreBattleState(createInitialState(1), invalidSnap), false)

  // Modifier aggregation sanity check for stacking all 12 blessings
  const allMods = computeEndlessBlessingModifiers(ENDLESS_BLESSING_IDS)
  assert.ok(allMods.atkMul > 1.14)
  assert.equal(allMods.startShield, 18)
  assert.equal(allMods.speedBonus, 2)
  assert.equal(allMods.startCtBonus, 15)
  assert.equal(allMods.maxApBonus, 1)
  assert.equal(allMods.startApBonus, 1)
  assert.equal(allMods.lifestealBonus, 0.12)
  assert.equal(allMods.moveBonus, 1)
  assert.equal(allMods.jumpBonus, 1)
  assert.equal(allMods.critBonus, 0.15)
  assert.equal(allMods.defBonus, 3)
  assert.equal(allMods.turnStartRegen, 8)
  assert.equal(allMods.damageMul, 1.10)
  assert.equal(allMods.burnOnCrit, true)
  assert.equal(allMods.vsSlowOrStunMul, 1.20)
  assert.equal(allMods.phoenixReviveRatio, 0.40)
})

// =========================================================================
// 5. GODOT COMPILER COMPATIBILITY (`compileTsToGd`)
// =========================================================================

test('endless-roguelite.ts is browser-global-free and compiles cleanly via compileTsToGd', () => {
  const source = readFileSync(
    new URL('../examples/crownshard/crownshard/endless-roguelite.ts', import.meta.url),
    'utf8'
  )
  assert.equal(/\b(window|document|localStorage|sessionStorage|HTMLCanvasElement)\b/.test(source), false)

  const gd = compileTsToGd(source, 'endless-roguelite.ts')
  assert.equal(typeof gd, 'string')
  assert.ok(gd.length > 200)
  assert.ok(gd.includes('selectEndlessWaveStage'))
  assert.ok(gd.includes('buildEndlessWaveEnemies'))
  assert.ok(gd.includes('draftEndlessBlessing'))
  assert.ok(gd.includes('computeEndlessBlessingModifiers'))
})
