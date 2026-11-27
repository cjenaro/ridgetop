import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import type { InstanceBatch, LowPolyRenderer } from 'ridgetop'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'

import { CHAPTER_BY_ID, ENEMY_SPECS, PLAYABLE_CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import {
  BIOME_AMBIENT_PROFILES,
  BIOME_IDS,
  BIOME_MUSIC_THEMES,
  createCrownshardAudio
} from '../examples/crownshard/crownshard/audio.ts'
import {
  BIOME_STYLES,
  ENEMY_RIGS,
  bakePortraitPixels,
  buildStaticBoardBatches
} from '../examples/crownshard/crownshard/art.ts'
import { BIOME_SCENE_PALETTES, createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  ASTRAL_RIFT_DAMAGE,
  ASTRAL_RIFT_PERIOD,
  FRONTIER_BIOMES,
  FRONTIER_BOSS_IDS,
  FRONTIER_STAGE_IDS,
  LIGHTNING_CONDUIT_DAMAGE,
  computeCombatForecast,
  computeEnemyThreat,
  findPincerAssisters,
  planAutoBattleAction,
  LIGHTNING_CONDUIT_PERIOD,
  SANDSTORM_GUST_DAMAGE,
  SANDSTORM_GUST_PERIOD,
  UNBROKEN_CROWN_PHASE2_ATK_BONUS,
  UNBROKEN_CROWN_PHASE2_BANNER,
  UNBROKEN_CROWN_PHASE2_SHIELD,
  canTraverseStep,
  chooseEnemySpecialMove,
  createInitialState,
  endPlayerTurn,
  evaluateFrontierRoundHazard,
  getUnitByUid,
  isStageUnlocked,
  restoreBattleState,
  selectHeroByUid,
  selectTile,
  serializeBattleState,
  serializeSave,
  startStageBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { cellHeightLevel, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BiomeId, EnemyArchetypeId } from '../examples/crownshard/crownshard/types.ts'

function fakeRenderer(): LowPolyRenderer {
  return {
    backend: 'canvas',
    canvas: null as unknown as HTMLCanvasElement,
    width: 1280,
    height: 720,
    pixelRatio: 1,
    setLighting() {},
    setBackground() {},
    release() {},
    render(_matrix: unknown, batches: readonly InstanceBatch[]) {
      return {
        backend: 'canvas',
        drawCalls: batches.length,
        instances: batches.reduce((sum, b) => sum + b.count, 0),
        triangles: 0,
        uploadedBatches: 0,
        reusedBatches: 0
      }
    },
    dispose() {}
  } as unknown as LowPolyRenderer
}

// ============================================================================
// 1. All 7 Outer Frontier Nodes: Playability, Unlock Chain, Spawns, Reachability
// ============================================================================

test('All 7 Outer Frontier nodes are playable, jump-1 connected, with valid spawns, objectives, and Tier V-VIII progression', () => {
  const expectedFrontier: readonly {
    id: string
    biome: BiomeId
    difficulty: number
    objectiveKind: string
    requires: readonly string[]
  }[] = [
    { id: 'mirage_oasis', biome: 'dunes', difficulty: 5, objectiveKind: 'rout', requires: ['eclipse_throne'] },
    { id: 'sunken_obelisk', biome: 'dunes', difficulty: 6, objectiveKind: 'seize', requires: ['mirage_oasis'] },
    { id: 'dune_sovereign', biome: 'dunes', difficulty: 6, objectiveKind: 'assassinate', requires: ['sunken_obelisk'] },
    { id: 'tempest_spire', biome: 'aether', difficulty: 7, objectiveKind: 'rout', requires: ['dune_sovereign'] },
    { id: 'skybreak_bastion', biome: 'aether', difficulty: 7, objectiveKind: 'assassinate', requires: ['tempest_spire'] },
    { id: 'obsidian_rift', biome: 'expanse', difficulty: 7, objectiveKind: 'rout', requires: ['skybreak_bastion'] },
    { id: 'first_sun_sanctum', biome: 'expanse', difficulty: 8, objectiveKind: 'assassinate', requires: ['obsidian_rift'] }
  ]

  assert.deepEqual([...FRONTIER_STAGE_IDS], expectedFrontier.map(e => e.id))

  // Verify sibling endgame stages (starfall_atoll & abyssal_deep) exist and are playable post-Wave 7 merge
  assert.ok(CHAPTER_BY_ID.starfall_atoll && !CHAPTER_BY_ID.starfall_atoll.comingSoon)
  assert.ok(CHAPTER_BY_ID.abyssal_deep && !CHAPTER_BY_ID.abyssal_deep.comingSoon)

  const state = createInitialState(9001)
  // Unlock progression chain step by step starting after eclipse_throne
  assert.equal(isStageUnlocked(state.campaign, 'mirage_oasis'), false)
  state.campaign.clearedStageIds.push('eclipse_throne')
  assert.equal(isStageUnlocked(state.campaign, 'mirage_oasis'), true)

  for (let i = 0; i < expectedFrontier.length; i++) {
    const spec = expectedFrontier[i]
    const ch = CHAPTER_BY_ID[spec.id]
    assert.ok(ch, `Missing chapter ${spec.id}`)
    assert.ok(!ch.comingSoon, `${spec.id} must be playable (!comingSoon)`)
    assert.equal(ch.biome, spec.biome, `${spec.id} biome mismatch`)
    assert.equal(ch.difficulty, spec.difficulty, `${spec.id} difficulty mismatch`)
    assert.deepEqual([...ch.requires], [...spec.requires], `${spec.id} unlock chain mismatch`)
    assert.equal(PLAYABLE_CHAPTERS.some(p => p.id === spec.id), true, `${spec.id} must be in PLAYABLE_CHAPTERS`)
    assert.equal(isStageUnlocked(state.campaign, spec.id), true, `${spec.id} should unlock in sequence`)

    const battleState = createInitialState(9100 + i)
    const battle = startStageBattle(battleState, spec.id)
    assert.equal(battle.biome, spec.biome)
    assert.equal(battle.objective.kind, spec.objectiveKind, `${spec.id} objective kind mismatch`)

    // Verify Tempest Spire spans full height levels 0..4 over void chasms
    if (spec.id === 'tempest_spire') {
      const heights = new Set<number>()
      let voidCount = 0
      for (let r = 0; r < battle.rows; r++) {
        for (let c = 0; c < battle.cols; c++) {
          const cell = battle.cells[r][c]
          if (cell.terrain === 'void') voidCount++
          else heights.add(cellHeightLevel(cell))
        }
      }
      assert.ok(voidCount >= 8, 'Tempest Spire must feature sky-bridge void chasms')
      for (let lvl = 0; lvl <= 4; lvl++) {
        assert.equal(heights.has(lvl), true, `Tempest Spire must include heightLevel ${lvl}`)
      }
    }

    // Verify all spawns are walkable, non-overlapping, and jump-1 connected
    const occupied = new Set<string>()
    for (const u of battle.units) {
      const cell = battle.cells[u.row][u.col]
      assert.equal(cell.walkable && terrainWalkable(cell.terrain), true, `${spec.id} spawn (${u.col},${u.row}) walkable`)
      const key = `${u.col},${u.row}`
      assert.equal(occupied.has(key), false, `${spec.id} overlapping spawn at ${key}`)
      occupied.add(key)
    }

    const reachableFrom = (sc: number, sr: number): Set<string> => {
      const seen = new Set<string>([`${sc},${sr}`])
      const q: [number, number][] = [[sc, sr]]
      while (q.length > 0) {
        const [cc, cr] = q.shift()!
        const from = battle.cells[cr][cc]
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = cc + dc
          const nr = cr + dr
          if (nc < 0 || nc >= battle.cols || nr < 0 || nr >= battle.rows) continue
          const k = `${nc},${nr}`
          if (seen.has(k)) continue
          if (!canTraverseStep(from, battle.cells[nr][nc], 1)) continue
          seen.add(k)
          q.push([nc, nr])
        }
      }
      return seen
    }

    for (const [hc, hr] of ch.heroSpawns) {
      const reach = reachableFrom(hc, hr)
      for (const e of ch.enemies) {
        assert.equal(reach.has(`${e.col},${e.row}`), true, `${spec.id}: hero (${hc},${hr}) must reach enemy (${e.col},${e.row}) with jump=1`)
      }
    }

    // Mark cleared so next frontier stage unlocks
    state.campaign.clearedStageIds.push(spec.id)
  }

  // Verify snapshot save/resume across all 7 frontier stages
  for (const id of FRONTIER_STAGE_IDS) {
    const s = createInitialState(9300)
    const b = startStageBattle(s, id)
    const snap = serializeBattleState(b, s.campaign.seed)
    assert.ok(snap, `${id} must serialize BattleSaveSnapshot`)
    const resumed = createInitialState(9301)
    assert.equal(restoreBattleState(resumed, JSON.parse(JSON.stringify(snap))), true, `${id} must restore BattleSaveSnapshot`)
    assert.equal(resumed.battle?.stageId, id)
    assert.equal(resumed.battle?.biome, b.biome)
  }
})

// ============================================================================
// 2. Three New Frontier Biomes: Audio, Ambient Profiles, 3D Board Geometry
// ============================================================================

test('All 3 Frontier biomes (dunes, aether, expanse) have distinct audio themes, ambient profiles, palettes, and 3D board batches', () => {
  const frontierStages: Record<'dunes' | 'aether' | 'expanse', string> = {
    dunes: 'dune_sovereign',
    aether: 'tempest_spire',
    expanse: 'first_sun_sanctum'
  }

  const audio = createCrownshardAudio()
  const signatures = new Set<string>()

  for (const biome of FRONTIER_BIOMES) {
    assert.equal(BIOME_IDS.includes(biome), true, `${biome} must be registered in BIOME_IDS`)
    const theme = BIOME_MUSIC_THEMES[biome]
    const ambient = BIOME_AMBIENT_PROFILES[biome]
    const palette = BIOME_SCENE_PALETTES[biome]
    const style = BIOME_STYLES[biome]

    assert.ok(theme && theme.melody.notes.length >= 16 && theme.bossMelody.length >= 16)
    assert.ok(ambient && ambient.bedId.length > 0 && ambient.drone.frequency > 0)
    assert.ok(palette && style && palette === style)

    const state = createInitialState(9400)
    const battle = startStageBattle(state, frontierStages[biome as 'dunes' | 'aether' | 'expanse'])
    const built = buildStaticBoardBatches(biome, battle.cells)
    assert.ok(built.batches.length >= 6, `${biome} must emit rich 3D diorama batches`)
    assert.ok(built.brazierPositions.length >= 4, `${biome} must emit perimeter light/brazier anchors`)
    const totalInstances = built.batches.reduce((sum, b) => sum + b.count, 0)
    assert.ok(totalInstances > 80, `${biome} board should have substantial geometry (${totalInstances})`)
    signatures.add(`${built.batches.length}:${built.brazierPositions.length}:${totalInstances}`)

    // Switch audio & render scene without throwing
    audio.setBattleBiome(biome)
    assert.equal(audio.getBattleBiome(), biome)
    audio.update(state, 0.25, true)

    const scene = createCrownshardScene(fakeRenderer())
    const stats = scene.render(state, 1 / 60, 1280, 720)
    assert.ok(stats.instances > 0)
  }

  assert.equal(signatures.size, 3, 'All 3 Frontier biomes must emit distinct 3D architecture signatures')
})

// ============================================================================
// 3. Three Frontier Raid Bosses: Rigs, Portraits, Specials & Combat Behavior
// ============================================================================

test('All 3 Frontier Raid Bosses have valid ENEMY_SPECS, 3D rigs, portraits, specials, and combat behavior', () => {
  const portraits = bakePortraitPixels(48)
  const expectedBosses: readonly {
    id: EnemyArchetypeId
    stageId: string
    expectedMove: string
  }[] = [
    { id: 'dune_sovereign_boss', stageId: 'dune_sovereign', expectedMove: 'sandstorm_vortex' },
    { id: 'astral_warden_boss', stageId: 'skybreak_bastion', expectedMove: 'tempest_surge' },
    { id: 'unbroken_crown_boss', stageId: 'first_sun_sanctum', expectedMove: 'solar_corona' }
  ]

  assert.deepEqual([...FRONTIER_BOSS_IDS], expectedBosses.map(b => b.id))

  for (const cfg of expectedBosses) {
    const spec = ENEMY_SPECS[cfg.id]
    assert.ok(spec, `Missing ENEMY_SPECS.${cfg.id}`)
    assert.equal(spec.isBoss, true, `${cfg.id} must have isBoss: true`)
    assert.equal(spec.ai, 'boss', `${cfg.id} must use boss AI`)

    const rig = ENEMY_RIGS[cfg.id]
    assert.ok(rig && rig.joints.length > 0, `${cfg.id} must have a valid 3D rig`)
    const rigParts = rig.joints.flatMap(j => j.parts ?? [])
    assert.ok(rigParts.length >= 12, `${cfg.id} must have a richly detailed 3D rig (${rigParts.length} parts)`)

    const portrait = portraits[cfg.id]
    assert.ok(portrait && portrait.pixels.length === 48 * 48 * 4, `${cfg.id} must bake a valid portrait`)
    let opaquePixels = 0
    for (let i = 3; i < portrait.pixels.length; i += 4) {
      if (portrait.pixels[i] > 0) opaquePixels++
    }
    assert.ok(opaquePixels > 120, `${cfg.id} baked portrait must be visible (${opaquePixels} opaque px)`)

    const state = createInitialState(9500)
    const battle = startStageBattle(state, cfg.stageId)
    const boss = battle.units.find(u => u.enemyId === cfg.id)
    assert.ok(boss && boss.isBoss && boss.alive, `${cfg.stageId} must spawn ${cfg.id}`)

    boss.cooldowns = [0, 0, 0]
    const decision = chooseEnemySpecialMove(battle, boss)
    assert.ok(decision, `${cfg.id} must select a signature special move`)
    assert.equal(decision.move, cfg.expectedMove)

    // Render scene cleanly with the boss on the board
    const scene = createCrownshardScene(fakeRenderer())
    const stats = scene.render(state, 1 / 60, 1280, 720)
    assert.ok(stats.instances > 0)
  }
})

// ============================================================================
// 4. First Sun Sanctum: Unbroken Crown 2-Phase Awakening + Save/Resume Parity
// ============================================================================

test('Unbroken Crown triggers Phase 2 Solar Eclipse Awakening at <= 50% HP and persists cleanly across BattleSaveSnapshot', () => {
  const state = createInitialState(9600)
  const battle = startStageBattle(state, 'first_sun_sanctum')

  const boss = battle.units.find(u => u.enemyId === 'unbroken_crown_boss')!
  assert.ok(boss)
  assert.equal(boss.bossPhase, 1, 'Unbroken Crown must start in Phase 1')

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  assert.equal(hero.team, 'ally')

  // Position hero right beside boss, debuff boss, and set boss HP just above 50% so a single hit drops it <= 50%
  const targetHpBefore = Math.floor(boss.maxHp * 0.5) + 4
  boss.hp = targetHpBefore
  boss.shield = 0
  boss.burnTurns = 2
  boss.slowTurns = 2
  boss.poisonStacks = 3
  const atkBefore = boss.atk
  const unitCountBefore = battle.units.length

  // Move hero adjacent to boss (boss is at 8,3; place hero at 7,3 which is walkable H4)
  hero.col = 7
  hero.row = 3
  hero.atk = 45
  hero.acted = false
  hero.moved = true
  selectHeroByUid(state, hero.uid)

  const hit = selectTile(state, boss.col, boss.row)
  assert.equal(hit, true, 'Hero strike on Unbroken Crown must succeed')

  // Verify Phase 2 Awakening triggered!
  assert.equal(boss.bossPhase, 2, 'Dropping <= 50% HP must transition bossPhase 1 -> 2')
  assert.equal(battle.bannerText, UNBROKEN_CROWN_PHASE2_BANNER)
  assert.ok(boss.shield >= UNBROKEN_CROWN_PHASE2_SHIELD, `Boss should gain +${UNBROKEN_CROWN_PHASE2_SHIELD} shield`)
  assert.equal(boss.atk, atkBefore + UNBROKEN_CROWN_PHASE2_ATK_BONUS, 'Boss ATK should increase in Phase 2')
  assert.equal(boss.burnTurns, 0, 'Phase 2 awakening must cleanse Burn')
  assert.equal(boss.slowTurns, 0, 'Phase 2 awakening must cleanse Slow')
  assert.equal(boss.poisonStacks, 0, 'Phase 2 awakening must cleanse Poison')
  assert.ok(boss.empowerTurns >= 2, 'Phase 2 awakening must grant Empower')
  assert.ok(boss.hasteTurns >= 2, 'Phase 2 awakening must grant Haste')

  const summonedGuards = battle.units.filter(u => u.summonerUid === boss.uid && u.alive)
  assert.equal(summonedGuards.length, 2, 'Phase 2 awakening must summon 2 vanguard guards')
  assert.equal(battle.units.length, unitCountBefore + 2)

  // Verify upgraded Phase 2 special move
  boss.cooldowns = [0, 0, 0]
  const p2Special = chooseEnemySpecialMove(battle, boss)
  assert.ok(p2Special)
  assert.equal(p2Special.move, 'eclipse_cataclysm')

  // Idempotency check: hitting boss again in Phase 2 must NOT re-trigger Phase 2 or summon extra guards
  const shieldBeforeSecondHit = boss.shield
  hero.acted = false
  selectHeroByUid(state, hero.uid)
  selectTile(state, boss.col, boss.row)
  assert.equal(boss.bossPhase, 2)
  assert.ok(boss.shield <= shieldBeforeSecondHit, 'Phase 2 shield must not re-apply on subsequent hits')
  assert.equal(battle.units.filter(u => u.summonerUid === boss.uid).length, 2, 'Must not summon again after Phase 2')

  // Full Save/Resume round-trip parity via JSON serialization
  const savedJson = JSON.parse(JSON.stringify(serializeSave(state)))
  const restored = createInitialState(9999, savedJson)
  assert.ok(restored.battle, 'Saved First Sun Sanctum battle must restore')
  const restoredBoss = restored.battle.units.find(u => u.enemyId === 'unbroken_crown_boss')!
  assert.ok(restoredBoss)
  assert.equal(restoredBoss.bossPhase, 2, 'bossPhase=2 must survive BattleSaveSnapshot round-trip')
  assert.equal(restoredBoss.shield, boss.shield)
  assert.equal(restoredBoss.atk, boss.atk)
  assert.equal(
    restored.battle.units.filter(u => u.summonerUid === restoredBoss.uid && u.alive).length,
    2,
    'Summoned Phase 2 vanguard guards must survive BattleSaveSnapshot round-trip'
  )

  // Render Phase 2 scene without throwing
  const scene = createCrownshardScene(fakeRenderer())
  stepGame(restored, 1 / 60)
  const stats = scene.render(restored, 1 / 60, 1280, 720)
  assert.ok(stats.instances > 0)
})

// ============================================================================
// 5. Frontier Round-Boundary Hazards: Sandstorm Gust, Lightning Conduit & Astral Rift
// ============================================================================

test('Dunes Sandstorm Gust, Aether Lightning Conduit, and Expanse Astral Rift fire on round boundaries and respect cover', () => {
  // A. Sunbleached Dunes (mirage_oasis): exposed dune unit takes Sandstorm Gust on even rounds; pillar-sheltered unit is safe!
  const duneState = createInitialState(9701)
  const duneBattle = startStageBattle(duneState, 'mirage_oasis')
  const exposedHero = duneBattle.units.find(u => u.team === 'ally')!
  const shelteredHero = duneBattle.units.filter(u => u.team === 'ally')[1]!
  // Place exposedHero on exposed H1 dune (col 2, row 0 = H1 hill, no adjacent pillar)
  exposedHero.col = 2
  exposedHero.row = 0
  exposedHero.shield = 0
  const exposedHpBefore = exposedHero.hp
  // Place shelteredHero on H1 stone (col 1, row 2 = shrine, AND adjacent to pillar at 2,2)
  shelteredHero.col = 1
  shelteredHero.row = 2
  shelteredHero.shield = 0
  const shelteredHpBefore = shelteredHero.hp

  // Odd round (1) -> no gust
  assert.equal(evaluateFrontierRoundHazard(duneBattle, 1).triggered, false)
  // Even round (SANDSTORM_GUST_PERIOD = 2) -> triggers!
  const duneEval = evaluateFrontierRoundHazard(duneBattle, SANDSTORM_GUST_PERIOD)
  assert.equal(duneEval.triggered, true)
  assert.equal(duneEval.kind, 'sandstorm')
  assert.equal(duneEval.strikes.some(s => s.unitUid === exposedHero.uid), true)
  assert.equal(duneEval.strikes.some(s => s.unitUid === shelteredHero.uid), false)

  // Advance round via endPlayerTurn to round 2 and verify live simulation damage + Slow!
  duneBattle.objective.roundsElapsed = SANDSTORM_GUST_PERIOD - 1
  endPlayerTurn(duneState)
  assert.equal(exposedHero.hp, exposedHpBefore - SANDSTORM_GUST_DAMAGE)
  assert.ok(exposedHero.slowTurns > 0, 'Sandstorm Gust must inflict Slow on exposed units')
  assert.equal(shelteredHero.hp, shelteredHpBefore, 'Sheltered unit on Shrine/by Pillar must take 0 Sandstorm damage')

  // B. Aether Isles (tempest_spire): Lightning Conduit arcs onto conduit-adjacent / high-spire / sky-bridge units on even rounds
  const aetherState = createInitialState(9702)
  const aetherBattle = startStageBattle(aetherState, 'tempest_spire')
  const conduitHero = aetherBattle.units.find(u => u.team === 'ally')!
  const groundedHero = aetherBattle.units.filter(u => u.team === 'ally')[1]!
  // Col 3, row 1 is sky-bridge ('bridge' adjacent to 'void' at 3,2)
  conduitHero.col = 3
  conduitHero.row = 1
  conduitHero.shield = 0
  const conduitHpBefore = conduitHero.hp
  // Col 1, row 2 is 'shrine' (grounds lightning safely!)
  groundedHero.col = 1
  groundedHero.row = 2
  groundedHero.shield = 0
  const groundedHpBefore = groundedHero.hp

  const aetherEval = evaluateFrontierRoundHazard(aetherBattle, LIGHTNING_CONDUIT_PERIOD)
  assert.equal(aetherEval.triggered, true)
  assert.equal(aetherEval.kind, 'lightning_conduit')
  assert.equal(aetherEval.strikes.some(s => s.unitUid === conduitHero.uid), true)
  assert.equal(aetherEval.strikes.some(s => s.unitUid === groundedHero.uid), false)

  aetherBattle.objective.roundsElapsed = LIGHTNING_CONDUIT_PERIOD - 1
  endPlayerTurn(aetherState)
  assert.equal(conduitHero.hp, conduitHpBefore - LIGHTNING_CONDUIT_DAMAGE)
  assert.equal(groundedHero.hp, groundedHpBefore, 'Shrine tile must ground Lightning Conduit safely')

  // C. Shattered Expanse (obsidian_rift): Astral Rift pulses on void-edge tiles every 3 rounds
  const expanseState = createInitialState(9703)
  const expanseBattle = startStageBattle(expanseState, 'obsidian_rift')
  const riftHero = expanseBattle.units.find(u => u.team === 'ally')!
  // Col 6, row 0 is hill (0 terrain DEF) adjacent to void at (7,0)
  riftHero.col = 6
  riftHero.row = 0
  riftHero.shield = 0
  const riftHpBefore = riftHero.hp

  const expanseEval = evaluateFrontierRoundHazard(expanseBattle, ASTRAL_RIFT_PERIOD)
  assert.equal(expanseEval.triggered, true)
  assert.equal(expanseEval.kind, 'astral_rift')
  assert.equal(expanseEval.strikes.some(s => s.unitUid === riftHero.uid), true)

  expanseBattle.objective.roundsElapsed = ASTRAL_RIFT_PERIOD - 1
  endPlayerTurn(expanseState)
  assert.equal(riftHero.hp, riftHpBefore - ASTRAL_RIFT_DAMAGE)
  assert.ok(riftHero.burnTurns > 0, 'Astral Rift Pulse must inflict Burn on void-edge units')
})

// ============================================================================
// 6. Godot Compiler Compatibility for expansion-frontier.ts
// ============================================================================

test('expansion-frontier.ts compiles cleanly to GDScript via compileTsToGd', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const frontierPath = resolve(here, '../examples/crownshard/crownshard/expansion-frontier.ts')
  const source = readFileSync(frontierPath, 'utf8')
  const gd = compileTsToGd(source, 'expansion-frontier.ts')
  assert.ok(gd.includes('func evaluateFrontierRoundHazard('), 'GDScript output should contain evaluateFrontierRoundHazard')
  assert.ok(gd.includes('func applyFrontierBossPhaseTransition('), 'GDScript output should contain applyFrontierBossPhaseTransition')
  assert.ok(gd.includes('func shouldTriggerUnbrokenCrownPhase2('), 'GDScript output should contain shouldTriggerUnbrokenCrownPhase2')
})

test('Wave 7 QA regressions: Unbroken Crown Phase 2 via Poison DoT & 2x2 Frostwyrm Auto-Battle/Threat/Flank/Pincer', () => {
  // 1. Unbroken Crown dropping <= 50% HP via Poison DoT must still awaken Phase 2
  const state = createInitialState(9901)
  const battle = startStageBattle(state, 'first_sun_sanctum')
  const crown = battle.units.find(u => u.enemyId === 'unbroken_crown_boss')!
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== crown.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  crown.hp = Math.floor(crown.maxHp * 0.5) + 4
  crown.shield = 0
  crown.poisonStacks = 3
  crown.ct = 999
  battle.phase = 'player'
  const actor = battle.units.find(u => u.alive && u.team === 'ally')!
  battle.activeUnitUid = actor.uid
  endPlayerTurn(state)
  assert.equal(crown.bossPhase, 2, 'Unbroken Crown must trigger Phase 2 when Poison DoT drops HP <= 50%')

  // 2. 2x2 Frostwyrm Rimefang: Auto-Battle strikes adjacent footprint cell, Threat covers all 4 cells, Flank arc & Pincer work
  const wyrmState = createInitialState(9902)
  const wyrmBattle = startStageBattle(wyrmState, 'wyrm_eyrie')
  const rimefang = wyrmBattle.units.find(u => u.enemyId === 'frostwyrm_rimefang')!
  const allies = wyrmBattle.units.filter(u => u.alive && u.team === 'ally')
  for (const u of wyrmBattle.units) {
    if (u.team === 'enemy' && u.uid !== rimefang.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  // Flatten a clear arena around Rimefang at (5,2)..(6,3)
  for (let r = 0; r < wyrmBattle.rows; r++) {
    for (let c = 0; c < wyrmBattle.cols; c++) {
      wyrmBattle.cells[r][c] = {
        ...wyrmBattle.cells[r][c],
        terrain: 'snow',
        heightLevel: 0,
        elevation: 0,
        walkable: true
      }
    }
  }
  rimefang.col = 5
  rimefang.row = 2
  rimefang.facing = 'e'
  // Pin Rimefang onto its 2x2 perch using pillars around the non-attacking borders so moveTiles is empty
  for (const [pc, pr] of [[4, 2], [4, 3], [7, 2], [7, 3], [5, 1], [5, 4]]) {
    wyrmBattle.cells[pr][pc] = { ...wyrmBattle.cells[pr][pc], terrain: 'pillar', walkable: false }
  }
  const threat = computeEnemyThreat(wyrmBattle, rimefang.uid)
  assert.equal(threat.moveTiles.length, 0, 'Pinned Rimefang should have 0 moveTiles')
  assert.equal(
    threat.attackTiles.some(t => t.col === 8 && t.row === 4),
    true,
    '2x2 Frostwyrm threat must radiate range 3 from bottom-right footprint cell (6,3) to (8,4)'
  )
  assert.equal(
    threat.attackTiles.some(t => t.col === 6 && t.row === 3),
    false,
    'Pinned 2x2 Frostwyrm threat must not falsely flag its own footprint cell'
  )

  // Knight at (6,1) facing Rimefang's (6,2) cell while Rimefang faces East -> Flank arc!
  const knight = allies[0]
  const partner = allies[1] ?? allies[0]
  knight.col = 6
  knight.row = 1
  knight.moved = true
  knight.acted = false
  knight.cooldowns = [3, 3, 3]
  partner.col = 6
  partner.row = 4 // directly across the 2x2 body from (6,1) -> (6,2)+(6,3) -> (6,4)!
  wyrmBattle.phase = 'player'
  wyrmBattle.activeUnitUid = knight.uid
  wyrmBattle.hand = []
  selectHeroByUid(wyrmState, knight.uid)

  const fc = computeCombatForecast(wyrmState, 6, 2)!
  assert.ok(fc, 'CombatForecast must resolve when targeting Rimefang non-anchor cell (6,2)')
  assert.equal(fc.attackArc, 'flank', 'Attacking north flank of East-facing 2x2 Rimefang must register flank arc')

  if (partner.uid !== knight.uid) {
    const pincers = findPincerAssisters(wyrmBattle, knight, knight.col, knight.row, rimefang)
    assert.ok(pincers.some(p => p.uid === partner.uid), 'Pincer must detect ally across 2x2 Rimefang body')
  }

  const abPlan = planAutoBattleAction(wyrmState)
  assert.ok(abPlan !== null && abPlan.kind === 'attack', `Auto-Battle adjacent to non-anchor Rimefang cell must attack, got ${abPlan?.kind}`)
  assert.equal(abPlan.targetCol, 6)
  assert.equal(abPlan.targetRow, 2)
})
