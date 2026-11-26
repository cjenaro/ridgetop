import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { HERO_SPECS, TACTIC_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, armTacticCard, computeCombatForecast, computeMoveTiles, computeReviveHp,
  computeTacticTargetTiles, computeTurnOrderPreview, createInitialState, endPlayerTurn, getUnitByUid,
  restoreBattleState, selectTile, serializeBattleState, startChapterBattle, stepGame, unitAt, validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import { KO_COUNTDOWN_TURNS, gridToWorld, isUnitActive, isUnitDowned } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GameState } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatForecast } from '../examples/crownshard/crownshard/ui-art.ts'

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
  const cell = battle.cells[row][col]
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = x
  unit.y = y
  unit.z = z
  unit.path = []
  unit.moveProgress = 0
}

function fakeRenderer() {
  let drawn = 0
  let maxInstances = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let n = 0
      for (const b of batches) n += b.count
      maxInstances = Math.max(maxInstances, n)
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get maxInstances() { return maxInstances }
  }
}

function fakeCanvasCtx() {
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
    save() { ops++ },
    restore() { ops++ },
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    ellipse() {},
    rect() {},
    clip() {},
    fill() { ops++ },
    stroke() { ops++ },
    fillRect() { ops++ },
    strokeRect() {},
    fillText() { ops++ },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 7 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, get ops() { return ops } }
}

function createClericSquadState(seed = 2027, clericStars: 1 | 2 | 3 = 1): GameState {
  const state = createInitialState(seed)
  const clericCard = {
    uid: 'hero_cleric_test',
    heroId: 'cleric' as const,
    stars: clericStars,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  state.campaign.heroes.push(clericCard)
  state.campaign.squadUids = [state.campaign.heroes[0].uid, clericCard.uid, state.campaign.heroes[1].uid]
  return state
}

test('Hero reaching 0 HP enters 3-turn downed KO state while other allies stand, blocking enemy tile occupancy', () => {
  const state = createInitialState(301)
  const battle = startChapterBattle(state, 0)
  const allies = battle.units.filter(u => u.team === 'ally')
  assert.ok(allies.length >= 2)

  // Put Knight at 1 HP with burn so burn knocks them to 0 HP on their turn
  const knight = allies.find(u => u.heroId === 'knight')!
  knight.hp = 1
  knight.shield = 0
  knight.burnTurns = 2
  knight.empowerTurns = 2
  knight.slowTurns = 1
  knight.ct = 140
  battle.floatingNumbers.length = 0
  state.sounds.length = 0
  state.vfx.length = 0

  // Advance turn so Knight's burn tick drops them to 0 HP
  endPlayerTurn(state)

  assert.equal(battle.phase === 'victory' || battle.phase === 'defeat', false, 'Battle must continue while other allies stand')
  assert.equal(knight.hp, 0)
  assert.equal(knight.alive, false)
  assert.equal(knight.downed, true)
  assert.equal(knight.koCountdown, KO_COUNTDOWN_TURNS)
  assert.equal(isUnitDowned(knight), true)
  assert.equal(isUnitActive(knight), false)
  assert.equal(knight.burnTurns, 0, 'Downed hero active statuses must clear')
  assert.equal(knight.empowerTurns, 0)
  assert.equal(knight.slowTurns, 0)
  assert.equal(unitAt(battle, knight.col, knight.row), undefined, 'unitAt only returns active standing units')
  assert.ok(
    battle.floatingNumbers.some(f => f.text === `DOWNED (${KO_COUNTDOWN_TURNS})`),
    'Entering downed state must emit DOWNED (3) floating callout'
  )
  assert.ok(state.sounds.some(s => s.kind === 'ko'), 'Entering downed state must emit KO sound')
  assert.ok(state.vfx.some(v => v.kind === 'ko' && v.downed === true), 'Entering downed state must emit downed KO VFX')

  // Enemies cannot walk onto the downed hero's tile
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  enemy.moved = false
  const enemyMoves = computeMoveTiles(battle, enemy)
  assert.equal(
    enemyMoves.some(t => t.col === knight.col && t.row === knight.row),
    false,
    'Enemies must not be able to walk onto a tile occupied by a downed hero'
  )
})

test('All allies dropping to 0 HP triggers immediate Defeat even when heroes enter downed state', () => {
  const state = createInitialState(302)
  const battle = startChapterBattle(state, 0)
  const allies = battle.units.filter(u => u.team === 'ally')

  // Down all allies except the last one
  for (let i = 0; i < allies.length - 1; i++) {
    allies[i].hp = 0
    allies[i].alive = false
    allies[i].downed = true
    allies[i].koCountdown = 3
  }
  const lastAlly = allies[allies.length - 1]
  lastAlly.hp = 1
  lastAlly.shield = 0
  lastAlly.burnTurns = 2
  lastAlly.ct = 140

  endPlayerTurn(state)
  let guard = 0
  while (battle.phase !== 'defeat' && guard++ < 200) {
    if (battle.phase === 'player') endPlayerTurn(state)
    else stepGame(state, STEP)
  }
  assert.equal(battle.phase, 'defeat', '0 standing alive allies must immediately trigger Defeat')
  assert.equal(battle.units.filter(u => u.alive && u.team === 'ally').length, 0)
})

test('Downed hero KO countdown ticks 3 -> 2 -> 1 -> 0 and permanently fades unrevivable', () => {
  const state = createClericSquadState(303, 1)
  const battle = startChapterBattle(state, 0)
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const cleric = battle.units.find(u => u.heroId === 'cleric')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemies = battle.units.filter(u => u.team === 'enemy')

  // Keep standing heroes & enemies healthy so battle persists across 3 full CT cycles
  for (const u of battle.units) {
    u.hp = 999
    u.maxHp = 999
  }
  // Place enemies far away so no lethal interruption happens
  placeUnit(battle, cleric, 0, 1)
  placeUnit(battle, archer, 0, 3)
  placeUnit(battle, knight, 1, 2)
  if (enemies[0]) placeUnit(battle, enemies[0], 6, 1)
  for (let i = 1; i < enemies.length; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }

  // Down the Knight manually at countdown 3, CT = 0
  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 3
  knight.ct = 0

  const seenCountdowns = new Set<number>([knight.koCountdown])
  const seenFloats = new Set<string>()
  let guard = 0
  while ((knight.downed || knight.koCountdown > 0) && guard++ < 800) {
    for (const f of battle.floatingNumbers) seenFloats.add(f.text)
    seenCountdowns.add(knight.koCountdown)
    if (battle.phase === 'player') {
      endPlayerTurn(state)
    } else if (battle.phase === 'enemy') {
      stepGame(state, STEP)
    } else {
      break
    }
  }
  for (const f of battle.floatingNumbers) seenFloats.add(f.text)
  seenCountdowns.add(knight.koCountdown)

  assert.equal(knight.alive, false)
  assert.equal(knight.downed, false, 'Expired hero must permanently fade (downed = false)')
  assert.equal(knight.koCountdown, 0)
  assert.equal(isUnitDowned(knight), false)
  assert.ok(seenCountdowns.has(3) && seenCountdowns.has(2) && seenCountdowns.has(1) && seenCountdowns.has(0))
  assert.ok(seenFloats.has('KO IN 2...'), 'Should emit KO IN 2... warning')
  assert.ok(seenFloats.has('KO IN 1...'), 'Should emit KO IN 1... warning')
  assert.ok(seenFloats.has('FALLEN!'), 'Should emit FALLEN! callout on expiration')

  // Once expired, Cleric Sunbeam Mend and Sunleaf Tonic must NOT revive the faded hero!
  while (battle.phase === 'enemy' && guard++ < 1200) stepGame(state, STEP)
  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  battle.selectedUnitUid = cleric.uid
  cleric.acted = false
  cleric.moved = false
  cleric.cooldowns = [0, 0, 0]
  placeUnit(battle, cleric, 1, 1)
  assert.equal(armSkill(state, 0), true)
  const fcExpired = computeCombatForecast(state, knight.col, knight.row)
  assert.ok(fcExpired && fcExpired.emptyTileTarget && !fcExpired.isRevive, 'Expired hero tile should forecast as empty space, not revivable')
  assert.equal(selectTile(state, knight.col, knight.row), true)
  assert.equal(knight.alive, false, 'Expired hero must remain unrevivable by Cleric skill')

  // Tactic card also excludes permanently faded hero
  const tonicCard = state.campaign.tactics.find(t => t.tacticId === 'healing_draught')!
  battle.ap = 4
  const tonicTargets = computeTacticTargetTiles(battle, state.campaign, tonicCard.uid)
  assert.equal(
    tonicTargets.some(t => t.col === knight.col && t.row === knight.row),
    false,
    'Revive tactic card must not target permanently faded hero'
  )
})

test('Cleric Sunbeam Mend, Sanctuary Wave, and Dawn Judgment revive downed heroes and preview REVIVE cleanly', () => {
  // 1. Single-target Cleric Sunbeam Mend + CombatForecast preview
  const state = createClericSquadState(304, 3)
  const battle = startChapterBattle(state, 0)
  const cleric = battle.units.find(u => u.heroId === 'cleric')!
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!

  placeUnit(battle, cleric, 1, 1)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, archer, 2, 1)

  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 2
  knight.ct = 40

  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  battle.selectedUnitUid = cleric.uid
  cleric.acted = false
  cleric.moved = false
  cleric.cooldowns = [0, 0, 0]

  assert.equal(HERO_SPECS.cleric.skills[0].canRevive, true)
  assert.equal(armSkill(state, 0), true)
  assert.ok(battle.targetTiles.some(t => t.col === knight.col && t.row === knight.row), 'Sunbeam Mend must target downed ally tile')

  const fc = computeCombatForecast(state, knight.col, knight.row)
  assert.ok(fc, 'CombatForecast must resolve on downed ally tile for revive-capable skill')
  const expectedHp = computeReviveHp(knight, HERO_SPECS.cleric.skills[0].reviveHpRatio)
  assert.equal(fc.isRevive, true)
  assert.equal(fc.isOffensive, false)
  assert.equal(fc.targetUid, knight.uid)
  assert.equal(fc.healAmount, expectedHp)
  assert.equal(fc.targetHpBefore, 0)
  assert.equal(fc.targetHpAfterNormal, expectedHp)
  assert.equal(fc.reviveKoCountdown, 2)

  // Draw revive CombatForecast card on mock canvas without throwing
  const canvasMock = fakeCanvasCtx()
  drawCombatForecast(canvasMock.ctx, { x: 0, y: 0, width: 320, height: 104 }, fc)
  assert.ok(canvasMock.ops > 10, 'drawCombatForecast should render revive card cleanly')

  assert.equal(
    computeTurnOrderPreview(battle, 12).some(e => e.uid === knight.uid),
    false,
    'Downed hero must not appear as an active combatant on the turn order timeline'
  )

  // Execute Sunbeam Mend to revive Knight!
  battle.floatingNumbers.length = 0
  state.vfx.length = 0
  state.sounds.length = 0
  assert.equal(selectTile(state, knight.col, knight.row), true)

  assert.equal(knight.alive, true)
  assert.equal(knight.downed, false)
  assert.equal(knight.koCountdown, 0)
  assert.equal(knight.hp, expectedHp)
  assert.equal(knight.shield, HERO_SPECS.cleric.skills[0].shieldAmount)
  assert.equal(knight.ct, 0, 'Revived hero starts fresh at 0 CT')
  assert.ok(battle.floatingNumbers.some(f => f.text === 'REVIVED!'), 'Revive must emit REVIVED! floating callout')
  assert.ok(state.vfx.some(v => v.kind === 'revive' && v.uid === knight.uid), 'Revive must emit golden beam VFX event')
  assert.ok(state.sounds.some(s => s.kind === 'heal'), 'Revive must emit heal sound')
  assert.ok(
    computeTurnOrderPreview(battle, 12).some(e => e.uid === knight.uid),
    'Revived hero must re-enter turn order timeline'
  )

  // 2. Sanctuary Wave (Tier 2 aura) revives adjacent downed ally immediately
  archer.hp = 0
  archer.alive = false
  archer.downed = true
  archer.koCountdown = 1
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 1), true)
  assert.equal(archer.alive, true, 'Sanctuary Wave aura must revive adjacent downed ally')
  assert.equal(archer.downed, false)
  assert.equal(archer.koCountdown, 0)
  assert.equal(archer.hp, computeReviveHp(archer, HERO_SPECS.cleric.skills[1].reviveHpRatio))

  // 3. Dawn Judgment (Tier 3 area3) revives downed ally inside AoE
  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 3
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 2), true)
  const fcDawn = computeCombatForecast(state, knight.col, knight.row)
  assert.ok(fcDawn && fcDawn.isRevive, 'Dawn Judgment targeting downed ally must preview revive')
  assert.equal(selectTile(state, knight.col, knight.row), true)
  assert.equal(knight.alive, true, 'Dawn Judgment must revive downed ally in area')
  assert.equal(knight.downed, false)
  assert.equal(knight.koCountdown, 0)
})

test('Revive Tactic Cards (Sunleaf Tonic & Phoenix Sigil) preview and revive downed heroes on the board', () => {
  const state = createInitialState(305)
  // Add Phoenix Sigil to campaign tactics & test both Sunleaf Tonic and Phoenix Sigil
  const phoenixOwned = { uid: 'tac_phoenix_test', tacticId: 'phoenix_sigil' }
  state.campaign.tactics.push(phoenixOwned)
  assert.equal(TACTIC_BY_ID.healing_draught.canRevive, true)
  assert.equal(TACTIC_BY_ID.phoenix_sigil.canRevive, true)

  const battle = startChapterBattle(state, 0)
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!

  // Down Knight and put Phoenix Sigil into hand
  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 3
  battle.ap = 4
  if (!battle.hand.includes(phoenixOwned.uid)) battle.hand.push(phoenixOwned.uid)

  // Arm Phoenix Sigil
  assert.equal(armTacticCard(state, phoenixOwned.uid), true)
  assert.ok(
    battle.targetTiles.some(t => t.col === knight.col && t.row === knight.row),
    'Phoenix Sigil must highlight downed hero tile as valid target'
  )

  const fc = computeCombatForecast(state, knight.col, knight.row)
  assert.ok(fc && fc.mode === 'tactic' && fc.isRevive, 'Phoenix Sigil forecast must indicate revive')
  assert.equal(fc.healAmount, computeReviveHp(knight, TACTIC_BY_ID.phoenix_sigil.reviveHpRatio))

  assert.equal(selectTile(state, knight.col, knight.row), true)
  assert.equal(knight.alive, true)
  assert.equal(knight.downed, false)
  assert.equal(knight.koCountdown, 0)
  assert.equal(knight.hp, computeReviveHp(knight, TACTIC_BY_ID.phoenix_sigil.reviveHpRatio))
  assert.equal(knight.shield, TACTIC_BY_ID.phoenix_sigil.shield)

  // Also test starter Sunleaf Tonic (healing_draught) reviving a downed hero
  const tonicOwned = state.campaign.tactics.find(t => t.tacticId === 'healing_draught')!
  archer.hp = 0
  archer.alive = false
  archer.downed = true
  archer.koCountdown = 1
  battle.ap = 4
  if (!battle.hand.includes(tonicOwned.uid)) battle.hand.push(tonicOwned.uid)

  assert.equal(armTacticCard(state, tonicOwned.uid), true)
  assert.ok(battle.targetTiles.some(t => t.col === archer.col && t.row === archer.row))
  assert.equal(selectTile(state, archer.col, archer.row), true)
  assert.equal(archer.alive, true)
  assert.equal(archer.downed, false)
  assert.equal(archer.koCountdown, 0)
  assert.equal(archer.hp, computeReviveHp(archer, TACTIC_BY_ID.healing_draught.reviveHpRatio))
})

test('Mid-battle auto-save round-trip preserves downed & koCountdown and stays backwards-compatible', () => {
  const state = createInitialState(306)
  const battle = startChapterBattle(state, 0)
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!

  // Ensure active unit is NOT the downed hero
  battle.activeUnitUid = archer.uid
  battle.selectedUnitUid = archer.uid

  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 2
  knight.ct = 35

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  const knightSnap = snap.units.find(u => u.uid === knight.uid)!
  assert.equal(knightSnap.alive, false)
  assert.equal(knightSnap.downed, true)
  assert.equal(knightSnap.koCountdown, 2)

  // JSON round-trip restore
  const parsed = JSON.parse(JSON.stringify(snap)) as unknown
  const resumed = createInitialState(999)
  assert.equal(restoreBattleState(resumed, parsed), true)
  const restoredKnight = resumed.battle!.units.find(u => u.uid === knight.uid)!
  assert.equal(restoredKnight.alive, false)
  assert.equal(restoredKnight.downed, true)
  assert.equal(restoredKnight.koCountdown, 2)
  assert.equal(restoredKnight.ct, 35)
  assert.equal(isUnitDowned(restoredKnight), true)

  // Legacy snapshot omitting downed/koCountdown fields defaults cleanly to false / 0
  const legacyUnits = snap.units.map(u => {
    const { downed: _d, koCountdown: _k, ...rest } = u
    return rest
  })
  const legacySnap = { ...snap, units: legacyUnits }
  const validatedLegacy = validateBattleSnapshot(legacySnap)
  assert.ok(validatedLegacy, 'Legacy snapshot without downed/koCountdown must remain valid')
  const legacyKnight = validatedLegacy.units.find(u => u.uid === knight.uid)!
  assert.equal(legacyKnight.downed, false)
  assert.equal(legacyKnight.koCountdown, 0)

  // Corrupted snapshot with an alive unit standing on top of a downed hero must be rejected
  const overlapping = {
    ...snap,
    units: snap.units.map(u =>
      u.uid === archer.uid ? { ...u, col: knight.col, row: knight.row } : u
    )
  }
  assert.equal(validateBattleSnapshot(overlapping), null, 'Overlapping alive and downed units must be rejected')
})

test('CrownshardScene renders downed heroes (countdown 3 -> 2 -> 1), permanent fade-out, and post-revive heroes without throwing', () => {
  const state = createClericSquadState(307, 1)
  const battle = startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  const cleric = battle.units.find(u => u.heroId === 'cleric')!
  const knight = battle.units.find(u => u.heroId === 'knight')!
  placeUnit(battle, cleric, 1, 1)
  placeUnit(battle, knight, 1, 2)

  const renderFor = (seconds: number) => {
    const dt = 1 / 60
    for (let t = 0; t < seconds; t += dt) {
      stepGame(state, dt)
      scene.render(state, dt, 1280, 720)
    }
  }

  // Standing baseline
  renderFor(0.2)

  // Down Knight with countdown 3 -> 2 -> 1 and render each stage (plus armed revive highlight + forecast!)
  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 3
  state.vfx.push({ kind: 'ko', at: [knight.x, knight.y + 0.6, knight.z], downed: true })
  renderFor(0.4)

  knight.koCountdown = 2
  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  armSkill(state, 0)
  const fc = computeCombatForecast(state, knight.col, knight.row)
  scene.setForecast(fc)
  renderFor(0.3)

  knight.koCountdown = 1
  renderFor(0.3)

  // Revive Knight via Cleric skill and render golden revive beam + stand-up!
  scene.setForecast(null)
  assert.equal(selectTile(state, knight.col, knight.row), true)
  assert.equal(knight.alive, true)
  renderFor(0.6)

  // Also verify permanent fade-out from downed -> fallen renders cleanly without throwing
  knight.hp = 0
  knight.alive = false
  knight.downed = true
  knight.koCountdown = 1
  renderFor(0.2)
  knight.downed = false
  knight.koCountdown = 0
  renderFor(1.2)

  // Verify scene also renders a restored battle where a hero starts already downed on frame 1
  const restoredState = createClericSquadState(308, 1)
  const rb = startChapterBattle(restoredState, 0)
  const rk = rb.units.find(u => u.heroId === 'knight')!
  rk.hp = 0
  rk.alive = false
  rk.downed = true
  rk.koCountdown = 2
  const scene2 = createCrownshardScene(fake.renderer)
  scene2.render(restoredState, 1 / 60, 1280, 720)

  assert.ok(fake.drawn > 100)
  assert.ok(fake.maxInstances > 40)
})
