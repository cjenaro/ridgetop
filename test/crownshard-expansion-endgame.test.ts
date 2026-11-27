import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { bakePortraitPixels } from '../examples/crownshard/crownshard/art.ts'
import { attackClipFor, deathClipFor, gaitFor } from '../examples/crownshard/crownshard/animations.ts'
import { ENEMY_CHARACTER_SPECS, ENEMY_RIGS } from '../examples/crownshard/crownshard/characters.ts'
import { CHAPTER_BY_ID, ENEMY_SPECS } from '../examples/crownshard/crownshard/data.ts'
import {
  chooseEnemySpecialMove,
  getEnemyAttackElement,
  getEnemyBasicAttackStatus,
  getEnemyBiomeAffinity
} from '../examples/crownshard/crownshard/enemy-archetypes.ts'
import {
  BRIMSTONE_MAW_STAGE_ID,
  CINDER_ARENA_MAX_ROUNDS,
  CINDER_ARENA_STAGE_ID,
  CINDER_ARENA_WAVES,
  CROWNLESS_DEEP_FLOOR10_BONUS_DUST,
  CROWNLESS_DEEP_FLOOR10_BONUS_SHARDS,
  CROWNLESS_DEEP_FLOOR10_LEGEND_EQUIP,
  CROWNLESS_DEEP_FLOOR10_LEGEND_HERO,
  CROWNLESS_DEEP_FLOORS,
  CROWNLESS_DEEP_MAX_FLOOR,
  CROWNLESS_DEEP_STAGE_ID,
  SAVE_KEY,
  STARFALL_ATOLL_FIRST_CLEAR_DUST,
  STARFALL_ATOLL_FIRST_CLEAR_SHARDS,
  STARFALL_ATOLL_STAGE_ID,
  armSkill,
  canAdvanceGauntletRound,
  canTraverseStep,
  createInitialState,
  formatAbyssFloorLabel,
  getCrownlessDeepFloorSpec,
  getMaxSelectableCrownlessDeepFloor,
  getNextCrownlessDeepFloor,
  getObjectiveProgressText,
  getSelectedCrownlessDeepFloor,
  getUnitByUid,
  igniteNearbyLavaGeysers,
  isChestClaimed,
  loadSave,
  persistSave,
  selectHeroByUid,
  selectTile,
  serializeSave,
  setSelectedCrownlessDeepFloor,
  startStageBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { cellHeightLevel, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, GameState } from '../examples/crownshard/crownshard/types.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem(key: string) { return map.get(key) ?? null },
    setItem(key: string, value: string) { map.set(key, value) },
    removeItem(key: string) { map.delete(key) }
  }
}

function reachableJump1(battle: BattleState, startCol: number, startRow: number): Set<string> {
  const seen = new Set<string>([`${startCol},${startRow}`])
  const queue: [number, number][] = [[startCol, startRow]]
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  while (queue.length > 0) {
    const [cc, cr] = queue.shift()!
    const from = battle.cells[cr][cc]
    for (const [dc, dr] of dirs) {
      const nc = cc + dc
      const nr = cr + dr
      if (nr < 0 || nr >= battle.rows || nc < 0 || nc >= battle.cols) continue
      const key = `${nc},${nr}`
      if (seen.has(key)) continue
      const to = battle.cells[nr][nc]
      if (!canTraverseStep(from, to, 1)) continue
      seen.add(key)
      queue.push([nc, nr])
    }
  }
  return seen
}

function defeatRemainingEnemiesViaHeroSkill(state: GameState): void {
  const battle = state.battle!
  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  const active = allies[0]
  assert.ok(active, 'must have an alive ally')
  battle.phase = 'player'
  battle.activeUnitUid = active.uid
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  assert.ok(enemies.length > 0, 'must have alive enemies')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }
  const last = enemies[enemies.length - 1]
  last.hp = 1
  last.shield = 0
  // Place active hero adjacent to last enemy on a walkable tile
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  for (const [dc, dr] of dirs) {
    const c = last.col + dc
    const r = last.row + dr
    if (c >= 0 && c < battle.cols && r >= 0 && r < battle.rows && battle.cells[r][c].walkable) {
      active.col = c
      active.row = r
      break
    }
  }
  active.acted = false
  active.moved = false
  active.cooldowns = [0, 0, 0]
  assert.equal(selectHeroByUid(state, active.uid), true)
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, last.col, last.row), true)
}

// ============================================================================
// 1. All 4 Endgame Nodes Playability, Connectivity & Non-Overlap Scope
// ============================================================================

test('All 4 endgame expansion nodes are playable, jump-1 connected, with valid spawns & objectives', () => {
  const ownedIds = [
    CINDER_ARENA_STAGE_ID,
    BRIMSTONE_MAW_STAGE_ID,
    STARFALL_ATOLL_STAGE_ID,
    CROWNLESS_DEEP_STAGE_ID
  ] as const

  for (const id of ownedIds) {
    const ch = CHAPTER_BY_ID[id]
    assert.ok(ch, `Stage ${id} must exist`)
    assert.equal(Boolean(ch.comingSoon), false, `${id} must be playable (!comingSoon)`)
    assert.ok(ch.heights, `${id} must define explicit heights`)

    const state = createInitialState(7700 + ch.index)
    const battle = startStageBattle(state, id)

    let hasVoid = false
    let hasStairs = false
    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        const cell = battle.cells[r][c]
        if (cell.terrain === 'void') hasVoid = true
        if (cell.terrain === 'stairs') hasStairs = true
      }
    }
    assert.equal(hasVoid, true, `${id} should include void chasm cutouts`)
    assert.equal(hasStairs, true, `${id} should include stairs/ramps`)

    // Non-overlapping walkable spawns & jump-1 reachability
    const occupied = new Set<string>()
    for (const u of battle.units) {
      const cell = battle.cells[u.row][u.col]
      assert.equal(cell.walkable && terrainWalkable(cell.terrain), true, `${id}: ${u.uid} on walkable tile`)
      const key = `${u.col},${u.row}`
      assert.equal(occupied.has(key), false, `${id}: duplicate spawn at ${key}`)
      occupied.add(key)
    }

    for (const [hc, hr] of ch.heroSpawns) {
      const reach = reachableJump1(battle, hc, hr)
      for (const sp of ch.enemies) {
        assert.equal(
          reach.has(`${sp.col},${sp.row}`),
          true,
          `${id}: hero (${hc},${hr}) must reach enemy (${sp.col},${sp.row}) with jump=1`
        )
      }
      if (battle.objective.goalTile) {
        assert.equal(
          reach.has(`${battle.objective.goalTile.col},${battle.objective.goalTile.row}`),
          true,
          `${id}: goalTile must be jump-1 reachable`
        )
      }
      for (const ct of battle.objective.chestTiles) {
        assert.equal(reach.has(`${ct.col},${ct.row}`), true, `${id}: chestTile (${ct.col},${ct.row}) must be jump-1 reachable`)
      }
    }
  }

  // Verify non-owned Soon... nodes were NOT altered
  assert.equal(CHAPTER_BY_ID.mirage_oasis.comingSoon, true, 'Non-owned Soon node mirage_oasis stays comingSoon')
  assert.equal(CHAPTER_BY_ID.tempest_spire.comingSoon, true, 'Non-owned Soon node tempest_spire stays comingSoon')
  assert.equal(CHAPTER_BY_ID.first_sun_sanctum.comingSoon, true, 'Non-owned Soon node first_sun_sanctum stays comingSoon')
})

// ============================================================================
// 2. Cinder Arena — 3-Round Gladiator Gauntlet & Mid-Gauntlet Save/Resume
// ============================================================================

test('Cinder Arena runs 3-round gladiator wave escalation, +25% HP / +1 AP recovery, and mid-gauntlet save/resume', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(8801)
  const battle = startStageBattle(state, CINDER_ARENA_STAGE_ID)

  assert.equal(battle.gauntletRound, 1)
  assert.equal(battle.gauntletMaxRounds, CINDER_ARENA_MAX_ROUNDS)
  assert.equal(CINDER_ARENA_WAVES.length, 3)
  assert.ok(getObjectiveProgressText(battle).includes('Round 1/3'))

  // Injure living heroes & spend AP so we can verify inter-round recovery (+25% HP & +1 AP)
  const allies = battle.units.filter(u => u.team === 'ally' && u.alive)
  const expectedHeals = new Map<string, number>()
  for (const h of allies) {
    h.hp = Math.max(1, Math.floor(h.maxHp * 0.4))
    expectedHeals.set(h.uid, h.hp + Math.max(1, Math.round(h.maxHp * 0.25)))
  }
  battle.ap = 1

  // Clear Round 1 -> should advance to Round 2 (NOT victory!)
  defeatRemainingEnemiesViaHeroSkill(state)
  assert.equal(battle.phase, 'player', 'Clearing Round 1 must not end battle prematurely')
  assert.equal(battle.gauntletRound, 2)
  assert.equal(battle.ap, 2, 'Heroes should recover +1 AP between rounds')
  for (const h of allies) {
    assert.equal(h.hp, expectedHeals.get(h.uid), `${h.name} should recover +25% max HP between rounds`)
  }
  assert.ok(battle.bannerText.includes('ROUND 2 / 3'), `Expected Round 2 banner, got: ${battle.bannerText}`)
  assert.ok(
    battle.combatLog.some(e => e.text.includes('Round 2/3') && e.text.includes('+25% HP')),
    'Combat log should record Round 2 transition and recovery'
  )
  const round2Alive = battle.units.filter(u => u.team === 'enemy' && u.alive)
  assert.equal(round2Alive.length, CINDER_ARENA_WAVES[1].enemies.length)
  assert.equal(canAdvanceGauntletRound(battle), false, 'Round 2 has live foes so cannot advance yet')

  // Save mid-gauntlet during Round 2 and resume cleanly!
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded?.activeBattle)
  assert.equal(loaded.activeBattle.gauntletRound, 2)
  assert.equal(loaded.activeBattle.gauntletMaxRounds, 3)

  const resumed = createInitialState(9999, loaded)
  assert.ok(resumed.battle)
  assert.equal(resumed.battle.stageId, CINDER_ARENA_STAGE_ID)
  assert.equal(resumed.battle.gauntletRound, 2)
  assert.equal(resumed.battle.gauntletMaxRounds, 3)

  // Clear Round 2 on resumed state -> enters Round 3 Champion Wave with Magma Warden!
  defeatRemainingEnemiesViaHeroSkill(resumed)
  assert.equal(resumed.battle.phase, 'player', 'Clearing Round 2 must spawn Round 3 Champion wave')
  assert.equal(resumed.battle.gauntletRound, 3)
  assert.ok(resumed.battle.bannerText.includes('3 / 3'))
  const round3Alive = resumed.battle.units.filter(u => u.team === 'enemy' && u.alive)
  assert.ok(round3Alive.some(e => e.enemyId === 'magma_warden' && e.isBoss), 'Round 3 must feature Arena Champion Magma Warden')

  // Clear Round 3 -> Victory!
  defeatRemainingEnemiesViaHeroSkill(resumed)
  assert.equal(resumed.battle.phase, 'victory')
  assert.equal(resumed.battle.reward?.gauntletRoundsCleared, 3)
  assert.equal(resumed.battle.reward?.equipCard?.equipId, 'dragonfang_spear')
})

// ============================================================================
// 3. Brimstone Maw — Ignis Titan Raid Boss, Cataclysm Slam & 3D Rig Validity
// ============================================================================

test('Ignis Titan has valid 3D rig/portrait/animations, Cataclysm Slam ignites lava geysers, and Assassinate victory works', () => {
  // Rig, spec, portrait, animations validation
  const spec = ENEMY_SPECS.ignis_titan
  assert.ok(spec)
  assert.equal(spec.isBoss, true)
  assert.equal(spec.ai, 'boss')
  assert.equal(getEnemyBiomeAffinity('ignis_titan'), 'volcano')
  assert.equal(getEnemyAttackElement('ignis_titan'), 'fire')
  assert.equal(getEnemyBasicAttackStatus('ignis_titan')?.status, 'burn')
  assert.equal(attackClipFor(undefined, 'ignis_titan'), 'attack_pound')
  assert.equal(deathClipFor(undefined, 'ignis_titan', true), 'death_crumble')
  assert.equal(gaitFor(undefined, 'ignis_titan'), 'stomp')

  assert.ok(ENEMY_CHARACTER_SPECS.ignis_titan)
  const rig = ENEMY_RIGS.ignis_titan
  assert.ok(rig && rig.joints.length > 0)
  const parts = rig.joints.flatMap(j => j.parts ?? [])
  assert.ok(parts.length >= 10, `Ignis Titan rig should have rich towering parts (got ${parts.length})`)
  for (const part of parts) {
    assert.ok(part.mesh.vertexCount > 0 && part.mesh.radius > 0)
  }

  const portraits = bakePortraitPixels(48)
  assert.ok(portraits.ignis_titan, 'Ignis Titan must have a baked bust portrait')
  assert.ok(portraits.abyssal_sentinel, 'Abyssal Sentinel must have a baked bust portrait')

  // Brimstone Maw battle & Cataclysm Slam geyser ignition
  const state = createInitialState(8802)
  const battle = startStageBattle(state, BRIMSTONE_MAW_STAGE_ID)
  assert.equal(battle.objective.kind, 'assassinate')

  const titan = battle.units.find(u => u.enemyId === 'ignis_titan')!
  assert.ok(titan && titan.isBoss)
  assert.equal(battle.objective.targetEnemyUid, titan.uid)

  const special = chooseEnemySpecialMove(battle, titan)
  assert.ok(special)
  assert.equal(special.move, 'cataclysm_slam')
  assert.equal(special.pattern, 'cross')
  assert.equal(special.knockbackDistance, 1)
  assert.equal(special.status, 'burn')
  assert.equal(special.ignitesGeysers, true)

  // Make all lava_geyser tiles dormant, position a hero adjacent to Ignis Titan & nearby geyser
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      if (battle.cells[r][c].terrain === 'lava_geyser') {
        battle.cells[r][c].geyserActive = false
      }
    }
  }
  const ignitedTest = igniteNearbyLavaGeysers(battle, 4, 2, 2)
  assert.ok(ignitedTest.length > 0, 'igniteNearbyLavaGeysers should awaken nearby caldera vents')
  for (const g of ignitedTest) {
    assert.equal(battle.cells[g.row][g.col].geyserActive, true)
  }

  // Reset geysers dormant and let Ignis Titan execute its actual enemy turn (Cataclysm Slam!)
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      if (battle.cells[r][c].terrain === 'lava_geyser') {
        battle.cells[r][c].geyserActive = false
      }
    }
  }
  const victim = battle.units.find(u => u.team === 'ally' && u.alive)!
  victim.col = 3
  victim.row = 2
  victim.hp = 999
  victim.maxHp = 999
  titan.col = 4
  titan.row = 2
  titan.cooldowns = [0, 0, 0]
  battle.phase = 'enemy'
  battle.activeUnitUid = titan.uid
  battle.enemyDelay = 0.01
  battle.enemyActedThisTurn = false
  stepGame(state, 0.05)

  assert.ok(victim.hp < 999, 'Cataclysm Slam should damage the hero')
  assert.ok(victim.burnTurns > 0, 'Cataclysm Slam should inflict Burn')
  assert.ok(victim.col < 3 || victim.row !== 2 || state.vfx.some(v => v.kind === 'displace'), 'Cataclysm Slam should apply knockback 1')
  assert.equal(battle.cells[2][2].geyserActive, true, 'Cataclysm Slam must ignite nearby lava_geyser at (2,2)')
  assert.ok(state.vfx.some(v => v.kind === 'special' && v.move === 'titan_slam'))

  // Slaying Ignis Titan while minions remain alive immediately secures Assassinate victory!
  const otherAliveEnemies = battle.units.filter(u => u.team === 'enemy' && u.alive && u.uid !== titan.uid)
  assert.ok(otherAliveEnemies.length >= 2)
  titan.hp = 1
  titan.shield = 0
  const striker = battle.units.find(u => u.team === 'ally' && u.alive)!
  striker.col = titan.col - 1
  striker.row = titan.row
  striker.acted = false
  striker.cooldowns = [0, 0, 0]
  battle.phase = 'player'
  battle.activeUnitUid = striker.uid
  assert.equal(selectHeroByUid(state, striker.uid), true)
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, titan.col, titan.row), true)

  assert.equal(battle.phase, 'victory', 'Slaying Ignis Titan must immediately trigger Assassinate victory')
  assert.equal(battle.reward?.equipCard?.equipId, 'heart_of_solis')
})

// ============================================================================
// 4. Starfall Atoll — Split-Island Relic Chests, Seize Objective & Mythic Spoils
// ============================================================================

test('Starfall Atoll enforces 2 mythic chests + summit Starfall Altar seize and awards bonus Dust/Shards', () => {
  const state = createInitialState(8803)
  const battle = startStageBattle(state, STARFALL_ATOLL_STAGE_ID)

  assert.equal(battle.objective.kind, 'seize')
  assert.equal(battle.objective.chestTiles.length, 2)
  assert.equal(battle.objective.requiredChests, 2)
  assert.deepEqual(battle.objective.goalTile, { col: 9, row: 3 })
  assert.equal(cellHeightLevel(battle.cells[3][9]), 3, 'Starfall Altar sits on elevated summit height 3')

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const [chest1, chest2] = battle.objective.chestTiles
  const goal = battle.objective.goalTile!

  // Stepping onto goalTile BEFORE claiming both chests does NOT win yet
  hero.path = [goal]
  hero.moveProgress = 0.9
  stepGame(state, 0.05)
  assert.notEqual(battle.phase, 'victory', 'Seizing altar before claiming required mythic chests must not win')

  // Claim both mythic chests
  hero.path = [chest1]
  hero.moveProgress = 0.9
  stepGame(state, 0.05)
  assert.equal(isChestClaimed(battle.objective, chest1.col, chest1.row), true)

  hero.path = [chest2]
  hero.moveProgress = 0.9
  stepGame(state, 0.05)
  assert.equal(isChestClaimed(battle.objective, chest2.col, chest2.row), true)
  assert.notEqual(battle.phase, 'victory', 'Still need to seize summit Starfall Altar after claiming chests')

  const dustBefore = state.campaign.dust
  const shardsBefore = state.campaign.shards

  // Step onto summit Starfall Altar -> Victory!
  hero.path = [goal]
  hero.moveProgress = 0.9
  stepGame(state, 0.05)

  assert.equal(battle.phase, 'victory')
  assert.equal(battle.reward?.equipCard?.equipId, 'heart_of_solis')
  assert.equal(battle.reward?.bonusDust, STARFALL_ATOLL_FIRST_CLEAR_DUST)
  assert.equal(battle.reward?.bonusShards, STARFALL_ATOLL_FIRST_CLEAR_SHARDS)
  assert.equal(state.campaign.dust, dustBefore + STARFALL_ATOLL_FIRST_CLEAR_DUST)
  assert.equal(state.campaign.shards, shardsBefore + STARFALL_ATOLL_FIRST_CLEAR_SHARDS)
})

// ============================================================================
// 5. Crownless Deep — 10-Floor Secret Abyss Dungeon, Progression & Persistence
// ============================================================================

test('Crownless Deep defines 10 distinct jump-1 connected floors (Tiers VI–VIII) with Floor 10 Abyssal Sovereign climax', () => {
  assert.equal(CROWNLESS_DEEP_FLOORS.length, CROWNLESS_DEEP_MAX_FLOOR)
  const titles = new Set<string>()
  let prevGold = 0
  let prevDust = 0

  for (let floor = 1; floor <= CROWNLESS_DEEP_MAX_FLOOR; floor++) {
    const spec = getCrownlessDeepFloorSpec(floor)
    assert.equal(spec.floor, floor)
    assert.ok(!titles.has(spec.title), `Floor ${floor} title must be unique`)
    titles.add(spec.title)
    assert.ok(spec.difficulty >= 6 && spec.difficulty <= 8, `Floor ${floor} must be Tier VI–VIII`)
    assert.ok(spec.rewardGold > prevGold, `Floor ${floor} rewardGold should escalate`)
    assert.ok(spec.bonusDust >= prevDust, `Floor ${floor} bonusDust should escalate`)
    prevGold = spec.rewardGold
    prevDust = spec.bonusDust
    assert.equal(formatAbyssFloorLabel(floor), `Floor ${floor} / 10`)

    // Start battle on each floor and verify non-overlapping walkable spawns & jump-1 connectivity!
    const state = createInitialState(8900 + floor)
    const battle = startStageBattle(state, CROWNLESS_DEEP_STAGE_ID, 0, { abyssFloor: floor })
    assert.equal(battle.abyssFloor, floor)
    assert.equal(battle.biome, spec.biome)
    assert.equal(battle.difficulty, spec.difficulty)
    assert.ok(getObjectiveProgressText(battle).includes(`Floor ${floor} / 10`))

    const occupied = new Set<string>()
    for (const u of battle.units) {
      const cell = battle.cells[u.row][u.col]
      assert.equal(cell.walkable && terrainWalkable(cell.terrain), true, `Floor ${floor}: unit ${u.uid} on walkable tile`)
      const key = `${u.col},${u.row}`
      assert.equal(occupied.has(key), false, `Floor ${floor}: duplicate spawn ${key}`)
      occupied.add(key)
    }

    for (const [hc, hr] of spec.heroSpawns) {
      const reach = reachableJump1(battle, hc, hr)
      for (const sp of spec.enemies) {
        assert.equal(
          reach.has(`${sp.col},${sp.row}`),
          true,
          `Crownless Deep Floor ${floor}: hero (${hc},${hr}) must reach enemy (${sp.col},${sp.row}) with jump=1`
        )
      }
    }
  }

  // Floor 10 Climax assertions
  const f10 = getCrownlessDeepFloorSpec(10)
  assert.equal(f10.difficulty, 8)
  assert.equal(f10.objective.kind, 'assassinate')
  assert.equal(f10.objective.targetName, 'Abyssal Sovereign')
  assert.ok(f10.enemies.some(e => e.id === 'eclipse_archon' && e.name === 'Abyssal Sovereign'))
})

test('Crownless Deep persists floor progression, supports legacy saves & replay selection, and awards one-time Floor 10 legendaries', () => {
  const storage = createMemoryStorage()

  // 1. Legacy save compatibility (no crownlessDeepFloor field at all!)
  const fresh = createInitialState(8810)
  const legacySave = serializeSave(fresh)
  delete legacySave.campaign.crownlessDeepFloor
  delete legacySave.campaign.crownlessDeepSelectedFloor
  delete legacySave.campaign.crownlessDeepRewardClaimed
  storage.setItem(SAVE_KEY, JSON.stringify(legacySave))

  const loadedLegacy = loadSave(storage)
  assert.ok(loadedLegacy)
  assert.equal(loadedLegacy.campaign.crownlessDeepFloor, 0, 'Legacy saves default to 0 floors cleared')

  const state = createInitialState(8811, loadedLegacy)
  assert.equal(state.campaign.crownlessDeepFloor, 0)
  assert.equal(getNextCrownlessDeepFloor(state.campaign), 1)
  assert.equal(getSelectedCrownlessDeepFloor(state.campaign), 1)

  // 2. Clear Floor 1 -> unlocks Floor 2 & persists in save
  const b1 = startStageBattle(state, CROWNLESS_DEEP_STAGE_ID)
  assert.equal(b1.abyssFloor, 1)
  defeatRemainingEnemiesViaHeroSkill(state)
  assert.equal(b1.phase, 'victory')
  assert.equal(b1.reward?.abyssFloor, 1)
  assert.equal(state.campaign.crownlessDeepFloor, 1)
  assert.equal(getNextCrownlessDeepFloor(state.campaign), 2)
  assert.equal(getMaxSelectableCrownlessDeepFloor(state.campaign), 2)

  // Floor selector allows replaying Floor 1 or descending Floor 2 (and clamps > 2)
  assert.equal(setSelectedCrownlessDeepFloor(state.campaign, 9), 2)
  assert.equal(setSelectedCrownlessDeepFloor(state.campaign, 1), 1)
  assert.equal(getSelectedCrownlessDeepFloor(state.campaign), 1)

  // Save/load round-trip preserves crownlessDeepFloor & selected floor + mid-battle abyssFloor
  const b2 = startStageBattle(state, CROWNLESS_DEEP_STAGE_ID, 0, { abyssFloor: 2 })
  assert.equal(b2.abyssFloor, 2)
  persistSave(storage, state)
  const reloaded = loadSave(storage)
  assert.ok(reloaded?.activeBattle)
  assert.equal(reloaded.campaign.crownlessDeepFloor, 1)
  assert.equal(reloaded.campaign.crownlessDeepSelectedFloor, 1)
  assert.equal(reloaded.activeBattle.abyssFloor, 2)

  const resumed = createInitialState(8812, reloaded)
  assert.equal(resumed.campaign.crownlessDeepFloor, 1)
  assert.equal(resumed.battle?.abyssFloor, 2)

  // 3. Floor 10 first completion awards one-time legendary Solis Crownblade + Champion + bonus Dust/Shards
  resumed.campaign.crownlessDeepFloor = 9
  const dustBefore10 = resumed.campaign.dust
  const shardsBefore10 = resumed.campaign.shards
  const b10 = startStageBattle(resumed, CROWNLESS_DEEP_STAGE_ID, 0, { abyssFloor: 10 })
  assert.equal(b10.abyssFloor, 10)
  defeatRemainingEnemiesViaHeroSkill(resumed)
  assert.equal(b10.phase, 'victory')
  assert.equal(resumed.campaign.crownlessDeepFloor, 10)
  assert.equal(resumed.campaign.crownlessDeepRewardClaimed, true)
  assert.equal(b10.reward?.abyssFloor, 10)
  assert.equal(b10.reward?.abyssCompleted, true)
  assert.equal(b10.reward?.equipCard?.equipId, CROWNLESS_DEEP_FLOOR10_LEGEND_EQUIP)
  assert.equal(b10.reward?.heroCard?.heroId, CROWNLESS_DEEP_FLOOR10_LEGEND_HERO)
  const f10Spec = getCrownlessDeepFloorSpec(10)
  assert.equal(resumed.campaign.dust, dustBefore10 + f10Spec.bonusDust + CROWNLESS_DEEP_FLOOR10_BONUS_DUST)
  assert.equal(resumed.campaign.shards, shardsBefore10 + f10Spec.bonusShards + CROWNLESS_DEEP_FLOOR10_BONUS_SHARDS)

  // 4. Replaying Floor 10 does NOT re-award the one-time legendary bundle!
  const dustBeforeReplay = resumed.campaign.dust
  const b10Replay = startStageBattle(resumed, CROWNLESS_DEEP_STAGE_ID, 0, { abyssFloor: 10 })
  defeatRemainingEnemiesViaHeroSkill(resumed)
  assert.equal(b10Replay.phase, 'victory')
  assert.equal(b10Replay.reward?.abyssCompleted, undefined)
  assert.equal(b10Replay.reward?.gold, f10Spec.replayGold)
  assert.equal(resumed.campaign.dust, dustBeforeReplay + f10Spec.bonusDust)
})

// ============================================================================
// 6. Godot Compiler Compatibility (`compileTsToGd`)
// ============================================================================

test('expansion-endgame.ts is browser-global-free and compiles cleanly via compileTsToGd', () => {
  const source = readFileSync(
    new URL('../examples/crownshard/crownshard/expansion-endgame.ts', import.meta.url),
    'utf8'
  )
  assert.equal(/\b(window|document|localStorage|sessionStorage|HTMLElement)\b/.test(source), false)
  const gd = compileTsToGd(source, 'expansion-endgame.ts')
  assert.ok(gd.length > 500, 'Compiled GDScript output should be non-empty')
  assert.ok(gd.includes('func isGauntletStage'), 'GDScript output should contain exported gauntlet helper')
  assert.ok(gd.includes('func getCrownlessDeepFloorSpec'), 'GDScript output should contain exported abyss helper')
  assert.ok(gd.includes('func igniteNearbyLavaGeysers'), 'GDScript output should contain exported geyser helper')
})
