import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP, createPerfMonitor, verifyTrace } from '../packages/ridgetop/framework/index.ts'
import { CHAPTERS, CHAPTER_BY_ID, EQUIPMENT_BY_ID, HERO_SPECS, PLAYABLE_CHAPTERS, RARITY_META, RARITY_ORDER } from '../examples/crownshard/crownshard/data.ts'
import {
  armSkill, armTacticCard, autoEquipBestFit, buyPack, canMergeHero, computeAttackArc, computeCombatForecast,
  computeDeckValue, computeHeroStats, createInitialState, effectiveSpeed, endPlayerTurn, equipItem,
  findBestFitUpgrades, getHeroSkill, getUnitByUid, isEndlessUnlocked, isStageCleared, isStageUnlocked,
  maxSquadSize, mergeHero, rotateActiveUnitFacing, salvageEquipCard, selectHeroByUid, selectTile, serializeSave,
  setUnitFacing, startChapterBattle, startStageBattle, stepGame, unequipItem
} from '../examples/crownshard/crownshard/simulation.ts'
import { terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { GameState } from '../examples/crownshard/crownshard/types.ts'

test('Crownshard starts with Knight, Archer, Mage, starter equipment, and tactic deck', () => {
  const state = createInitialState(1337)
  assert.equal(state.campaign.heroes.length, 3)
  assert.deepEqual(state.campaign.heroes.map(h => h.heroId), ['knight', 'archer', 'mage'])
  assert.equal(state.campaign.squadUids.length, 3)
  assert.equal(maxSquadSize(state.campaign), 3)
  assert.ok(state.campaign.equipment.length >= 3)
  assert.ok(state.campaign.tactics.length >= 6)
  assert.equal(state.campaign.gold, 100)
})

test('3-of-a-kind hero merging upgrades 1* -> 2* and 2* -> 3*, unlocking skills and boosting stats', () => {
  const state = createInitialState(42)
  const knight = state.campaign.heroes[0]
  assert.equal(knight.heroId, 'knight')
  assert.equal(knight.stars, 1)
  const stats1 = computeHeroStats(state.campaign, knight)

  // Cannot merge with only 1 copy
  assert.equal(canMergeHero(state.campaign, knight.uid), false)

  // Add 2 more 1* Knights (total 3 identical 1* Knights!)
  state.campaign.heroes.push(
    { uid: 'k_copy_1', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'k_copy_2', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  )
  assert.equal(canMergeHero(state.campaign, knight.uid), true)
  assert.equal(mergeHero(state, knight.uid), true)
  assert.equal(knight.stars, 2)
  assert.equal(state.campaign.heroes.filter(h => h.heroId === 'knight').length, 1)

  const stats2 = computeHeroStats(state.campaign, knight)
  assert.ok(stats2.maxHp > stats1.maxHp * 1.3, 'Upgrading to 2* should substantially boost HP')
  assert.ok(stats2.atk > stats1.atk * 1.2, 'Upgrading to 2* should substantially boost ATK')

  // Verify Skill 2 is now unlocked in battle while Skill 3 remains locked
  const battle = startChapterBattle(state, 0)
  const battleKnight = battle.units.find(u => u.uid === knight.uid)!
  assert.ok(getHeroSkill(battleKnight, 0), 'Skill 1 unlocked at 2*')
  assert.ok(getHeroSkill(battleKnight, 1), 'Skill 2 unlocked at 2*')
  assert.equal(getHeroSkill(battleKnight, 2), null, 'Skill 3 still locked until 3*')

  // Merge 2x 2* Knights -> 3* Knight unlocking Skill 3!
  state.campaign.heroes.push(
    { uid: 'k_2star', heroId: 'knight', stars: 2, weaponUid: null, armorUid: null, relicUid: null }
  )
  assert.equal(mergeHero(state, knight.uid), true)
  assert.equal(knight.stars, 3)
  const battle3 = startChapterBattle(state, 0)
  const battleKnight3 = battle3.units.find(u => u.uid === knight.uid)!
  assert.ok(getHeroSkill(battleKnight3, 2), 'Skill 3 unlocked at 3*')
})

test('Equipment cards equip, swap owners, boost stats, and salvage for rarity-scaled gold', () => {
  const state = createInitialState(99)
  const knight = state.campaign.heroes[0]
  const mage = state.campaign.heroes[2]
  state.campaign.heroes.push({
    uid: 'hero_cleric_swap',
    heroId: 'cleric',
    stars: 1,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  })
  const cleric = state.campaign.heroes[3]

  // Unequip starter apprentice_staff from Mage first for clean baseline stat delta check
  assert.equal(unequipItem(state, mage.uid, 'weapon'), true)
  const beforeMage = computeHeroStats(state.campaign, mage)
  // Add a Legendary Arcane weapon & Rare Arcane armor
  state.campaign.equipment.push(
    { uid: 'eq_leg', equipId: 'celestial_staff', slot: 'weapon' },
    { uid: 'eq_rare', equipId: 'astral_vestments', slot: 'armor' }
  )
  assert.equal(equipItem(state, mage.uid, 'eq_leg'), true)
  assert.equal(equipItem(state, mage.uid, 'eq_rare'), true)
  const afterMage = computeHeroStats(state.campaign, mage)
  assert.equal(afterMage.atk, beforeMage.atk + EQUIPMENT_BY_ID.celestial_staff.atk + EQUIPMENT_BY_ID.astral_vestments.atk)
  assert.equal(afterMage.maxHp, beforeMage.maxHp + EQUIPMENT_BY_ID.celestial_staff.hp + EQUIPMENT_BY_ID.astral_vestments.hp)
  assert.equal(afterMage.shieldStart, EQUIPMENT_BY_ID.astral_vestments.shieldStart)

  // Knight (Vanguard) cannot equip Arcane staff
  assert.equal(equipItem(state, knight.uid, 'eq_leg'), false)
  assert.equal(mage.weaponUid, 'eq_leg')

  // Equipping same Arcane weapon on Cleric cleanly transfers it away from Mage
  assert.equal(equipItem(state, cleric.uid, 'eq_leg'), true)
  assert.equal(cleric.weaponUid, 'eq_leg')
  assert.equal(mage.weaponUid, null)

  // Unequip & salvage: Legendary sells for way more than Common
  assert.equal(unequipItem(state, cleric.uid, 'weapon'), true)
  const commonGold = salvageEquipCard(state, state.campaign.equipment[0].uid)
  const legGold = salvageEquipCard(state, 'eq_leg')
  assert.ok(legGold >= commonGold * 10, `Legendary salvage (${legGold}g) should far exceed Common (${commonGold}g)`)
})

test('Buying Recruit, Vanguard, and Sovereign card decks enforces rarity floors and keeps Epics/Legendaries scarce', () => {
  const state = createInitialState(777)
  state.campaign.gold = 50000
  const initialVal = computeDeckValue(state.campaign)

  const r1 = buyPack(state, 'recruit')
  assert.ok(r1 && r1.length === 3, 'Recruit deck yields 3 cards')

  const r2 = buyPack(state, 'vanguard')
  assert.ok(r2 && r2.length === 4, 'Vanguard deck yields 4 cards')
  assert.ok(
    r2.some(c => RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf('rare')),
    'Vanguard deck must guarantee at least 1 Rare+ card'
  )

  const r3 = buyPack(state, 'sovereign')
  assert.ok(r3 && r3.length === 4, 'Sovereign deck yields 4 cards')
  assert.ok(
    r3.some(c => RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf('rare')),
    'Sovereign deck must guarantee at least 1 Rare+ card'
  )

  const newVal = computeDeckValue(state.campaign)
  assert.ok(newVal > initialVal + 400, 'Opening decks must raise deck valuation')
  assert.ok(RARITY_META.legendary.value > RARITY_META.epic.value)
  assert.ok(RARITY_META.epic.value > RARITY_META.rare.value)
  assert.ok(RARITY_META.rare.value > RARITY_META.uncommon.value)
  assert.ok(RARITY_META.uncommon.value > RARITY_META.common.value)

  // Verify long-game scarcity: across 120 Recruit decks (360 cards), Epics & Legendaries stay genuinely rare
  let epicOrLeg = 0
  let totalCards = 0
  for (let i = 0; i < 120; i++) {
    const pulled = buyPack(state, 'recruit')
    assert.ok(pulled)
    for (const card of pulled) {
      totalCards++
      if (card.rarity === 'epic' || card.rarity === 'legendary') epicOrLeg++
    }
  }
  assert.ok(
    epicOrLeg / totalCards < 0.04,
    `Recruit pack Epic/Legendary rate (${epicOrLeg}/${totalCards}) should stay scarce for long-game pacing`
  )
})

test('Speed-based CT initiative turn order, movement, skills, tactic cards, victory loot, and save round-trip', () => {
  const state = createInitialState(2026)
  const battle = startChapterBattle(state, 0)
  assert.equal(battle.phase, 'player')
  assert.equal(battle.ap, 3)
  assert.equal(battle.hand.length, 4)
  assert.equal(battle.turnOrder.length, 8, 'Turn order timeline must preview 8 upcoming turns')

  // Fastest unit (Lyra with Yew Longbow = 14 SPD) acts first!
  const firstUnit = getUnitByUid(battle, battle.activeUnitUid)!
  assert.equal(firstUnit.heroId, 'archer', 'Fastest hero (Lyra) should act first based on Speed/CT')
  assert.equal(battle.turnOrder[0].uid, firstUnit.uid)
  assert.equal(battle.turnOrder[0].isCurrent, true)
  assert.ok(battle.moveTiles.length > 0, 'Active hero should have reachable blue tiles')

  // Move active hero onto a reachable tile and step until arrival
  const dest = battle.moveTiles[0]
  assert.equal(selectTile(state, dest.col, dest.row), true)
  for (let i = 0; i < 120; i++) stepGame(state, STEP)
  assert.equal(firstUnit.col, dest.col)
  assert.equal(firstUnit.row, dest.row)
  assert.equal(firstUnit.moved, true)

  // Play a Tactic Card from hand
  const handCardUid = battle.hand[0]
  assert.equal(armTacticCard(state, handCardUid), true)
  if (battle.armedTacticUid && battle.targetTiles.length > 0) {
    const tgt = battle.targetTiles[0]
    assert.equal(selectTile(state, tgt.col, tgt.row), true)
    assert.equal(battle.hand.includes(handCardUid), false, 'Played card must move to discard pile')
  }

  // End active hero's turn -> only moved (didn't attack), so Wait bonus saves 20 CT (plus any CT ticks elapsed)
  const ctBeforeEnd = firstUnit.ct
  endPlayerTurn(state)
  assert.ok(firstUnit.ct >= Math.max(0, ctBeforeEnd - 80), 'Ending turn without attacking should grant +20 CT wait bonus')

  // Step through interleaved enemy/ally CT turns until another player unit acts
  const currentPhase = (): string => battle.phase
  let guard = 0
  while (currentPhase() === 'enemy' && guard++ < 600) {
    stepGame(state, STEP)
  }
  assert.equal(currentPhase(), 'player', 'Speed/CT timeline must advance cleanly to next player hero turn')
  assert.ok(battle.turn >= 2)
  assert.ok(battle.activeUnitUid && battle.activeUnitUid !== firstUnit.uid, 'Next faster unit on timeline should act')

  // Slow reduces effective speed
  const slowTarget = battle.units.find(u => u.alive && u.team === 'enemy')!
  const baseSpd = effectiveSpeed(slowTarget)
  slowTarget.slowTurns = 2
  assert.ok(effectiveSpeed(slowTarget) < baseSpd, 'Slow status must reduce effective speed')

  // Defeat all enemies to verify Victory Rewards & Campaign progression
  const goldBefore = state.campaign.gold
  const eqBefore = state.campaign.equipment.length
  const heroBefore = state.campaign.heroes.length
  const activeHero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }
  const lastEnemy = enemies[enemies.length - 1]
  lastEnemy.hp = 5
  activeHero.col = Math.max(0, lastEnemy.col - 1)
  activeHero.row = lastEnemy.row
  activeHero.acted = false
  activeHero.cooldowns = [0, 0, 0]
  assert.equal(selectHeroByUid(state, activeHero.uid), true)
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, lastEnemy.col, lastEnemy.row), true)

  assert.equal(battle.phase, 'victory')
  assert.ok(battle.reward, 'Victory must populate battle reward')
  assert.equal(state.campaign.chaptersCleared, 1)
  assert.equal(state.campaign.gold, goldBefore + CHAPTERS[0].rewardGold)
  assert.equal(state.campaign.equipment.length, eqBefore + 1)
  assert.equal(state.campaign.heroes.length, heroBefore + 1)

  // Save/load round-trip preserves everything cleanly
  const saved = serializeSave(state)
  const restored = createInitialState(999, saved)
  assert.equal(restored.campaign.gold, state.campaign.gold)
  assert.equal(restored.campaign.chaptersCleared, 1)
  assert.equal(restored.campaign.heroes.length, state.campaign.heroes.length)
  assert.equal(restored.campaign.equipment.length, state.campaign.equipment.length)
})

test('createPerfMonitor tracks smoothed FPS, worst-frame spikes, and render stats', () => {
  const perf = createPerfMonitor(16)
  perf.record({ now: 0, simMs: 0.4, renderMs: 2.1, hudMs: 0.2, uiMs: 0.1, backend: 'WebGL 2', width: 1280, height: 720 })
  perf.record({ now: 16.6, simMs: 0.5, renderMs: 2.0, stats: { drawCalls: 10, triangles: 2400, instances: 90, uploadBytes: 4096, culledBatches: 0 } })
  const snap = perf.record({ now: 33.2, simMs: 0.4, renderMs: 2.2 })
  assert.ok(snap.fps > 58 && snap.fps < 62, `Expected ~60 FPS, got ${snap.fps}`)
  assert.equal(snap.backend, 'WebGL 2')
  assert.equal(snap.drawCalls, 10)
  assert.equal(snap.triangles, 2400)
})

test('Crownshard battle simulation passes Ridgetop verifyTrace determinism & bounded invariants', () => {
  const initial = createInitialState(505)
  startChapterBattle(initial, 0)

  const actions = Array.from({ length: 180 }, (_, i) => i)
  const report = verifyTrace<GameState, number>({
    initial,
    step(state, tick) {
      if (tick === 10 && state.battle && state.battle.moveTiles.length > 0) {
        const t = state.battle.moveTiles[0]
        selectTile(state, t.col, t.row)
      }
      if (tick === 80 && state.battle?.phase === 'player') {
        endPlayerTurn(state)
      }
      stepGame(state, STEP)
      return state
    },
    actions,
    checks: [
      {
        id: 'finite-unit-coords-and-hp',
        test: ({ after }) => {
          const b = after.battle
          if (!b) return true
          return b.units.every(u =>
            Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.z) &&
            u.hp >= 0 && u.hp <= u.maxHp && u.shield >= 0
          )
        }
      },
      {
        id: 'bounded-ap-and-hand',
        test: ({ after }) => {
          const b = after.battle
          if (!b) return true
          return b.ap >= 0 && b.hand.length <= 6
        }
      }
    ]
  })
  assert.equal(report.status, 'pass')
})

test('World Map has branching stages, special levels, full continent playable nodes, difficulty tiers, and valid variable-size grids', () => {
  assert.ok(CHAPTERS.length >= 24, 'World Map should span a full multi-region continent')
  assert.equal(PLAYABLE_CHAPTERS.length, CHAPTERS.length, 'All continent & frontier World Map stages should be playable')

  const gridSizes = new Set<string>()
  const kinds = new Set<string>()
  const diffs = new Set<number>()
  const regions = new Set<string>()

  for (const ch of CHAPTERS) {
    regions.add(ch.region)
    const rows = ch.grid.length
    const cols = ch.grid[0]?.length ?? 0
    assert.ok(rows >= 5 && rows <= 8, `${ch.id} rows out of expected range: ${rows}`)
    assert.ok(cols >= 6 && cols <= 10, `${ch.id} cols out of expected range: ${cols}`)
    for (const row of ch.grid) assert.equal(row.length, cols, `${ch.id} grid must be rectangular`)
    if (!ch.comingSoon) gridSizes.add(`${cols}x${rows}`)
    kinds.add(ch.kind)
    diffs.add(ch.difficulty)

    assert.ok(ch.enemies.length >= 3, `${ch.id} needs >= 3 enemies`)
    assert.ok(ch.rewardGold > ch.replayGold, `${ch.id} first-clear gold should exceed replay gold`)
    if (ch.rewardEquipId) assert.ok(EQUIPMENT_BY_ID[ch.rewardEquipId], `Missing reward equip ${ch.rewardEquipId}`)
    if (ch.rewardHeroId) assert.ok(HERO_SPECS[ch.rewardHeroId], `Missing reward hero ${ch.rewardHeroId}`)
    for (const reqId of ch.requires) assert.ok(CHAPTER_BY_ID[reqId], `${ch.id} requires missing stage ${reqId}`)

    const occupied = new Set<string>()
    for (const [col, row] of ch.heroSpawns) {
      assert.ok(col >= 0 && col < cols && row >= 0 && row < rows, `${ch.id} hero spawn (${col},${row}) out of bounds`)
      assert.ok(terrainWalkable(ch.grid[row][col]), `${ch.id} hero spawn (${col},${row}) not walkable`)
      assert.ok(!occupied.has(`${col},${row}`), `${ch.id} duplicate spawn (${col},${row})`)
      occupied.add(`${col},${row}`)
    }
    for (const sp of ch.enemies) {
      assert.ok(sp.col >= 0 && sp.col < cols && sp.row >= 0 && sp.row < rows, `${ch.id} enemy spawn (${sp.col},${sp.row}) out of bounds`)
      assert.ok(terrainWalkable(ch.grid[sp.row][sp.col]), `${ch.id} enemy spawn (${sp.col},${sp.row}) not walkable`)
      assert.ok(!occupied.has(`${sp.col},${sp.row}`), `${ch.id} overlapping spawn (${sp.col},${sp.row})`)
      occupied.add(`${sp.col},${sp.row}`)
    }
  }

  assert.ok(gridSizes.size >= 7, `Expected varied playable map sizes across stages, got ${[...gridSizes].join(', ')}`)
  assert.equal(regions.size, 9, 'Should span all 6 core Solis regions + 3 outer future frontier regions')
  assert.ok(kinds.has('story') && kinds.has('special') && kinds.has('treasure') && kinds.has('elite') && kinds.has('boss') && kinds.has('town'))
  assert.equal(diffs.size, 8, 'Should span difficulty tiers I through VIII so future regions scale beyond today\'s endgame')
  const maxPlayableDiff = Math.max(...PLAYABLE_CHAPTERS.map(ch => ch.difficulty))
  const maxWorldDiff = Math.max(...CHAPTERS.map(ch => ch.difficulty))
  assert.equal(maxPlayableDiff, 8, 'Outer Frontier expansion scales playable stages up to Tier VIII')
  assert.ok(maxWorldDiff >= maxPlayableDiff, 'World Map max tier should cover all playable tiers')
  assert.equal(Object.keys(HERO_SPECS).length, 8)
})

test('World Map enforces prerequisite locks, bifurcations, coming-soon gating, and one-time special rewards on replay', () => {
  const state = createInitialState(4040)
  // Initially only Border Watch is unlocked; Soon... nodes remain unlaunchable even if prereqs are met
  assert.equal(isStageUnlocked(state.campaign, 'border_watch'), true)
  assert.equal(isStageUnlocked(state.campaign, 'miller_ford'), false)
  assert.equal(isStageUnlocked(state.campaign, 'sunken_bridge'), false)
  assert.equal(isStageUnlocked(state.campaign, 'oakhaven_market'), false)
  assert.equal(isEndlessUnlocked(state.campaign), false)

  const winStage = (stageId: string) => {
    const battle = startStageBattle(state, stageId)
    assert.equal(battle.stageId, stageId)
    assert.equal(battle.cols, CHAPTER_BY_ID[stageId].grid[0].length)
    assert.equal(battle.rows, CHAPTER_BY_ID[stageId].grid.length)
    const active = getUnitByUid(battle, battle.activeUnitUid)!
    const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
    for (let i = 0; i < enemies.length - 1; i++) {
      enemies[i].hp = 0
      enemies[i].alive = false
    }
    const last = enemies[enemies.length - 1]
    last.hp = 4
    active.col = Math.max(0, last.col - 1)
    active.row = last.row
    active.acted = false
    active.cooldowns = [0, 0, 0]
    assert.equal(selectHeroByUid(state, active.uid), true)
    assert.equal(armSkill(state, 0), true)
    assert.equal(selectTile(state, last.col, last.row), true)
    assert.equal(battle.phase, 'victory')
    return battle.reward!
  }

  // First clear of Border Watch grants one-time Watchman Plate + Knight + first-clear gold
  const firstReward = winStage('border_watch')
  assert.equal(firstReward.firstClear, true)
  assert.equal(firstReward.specialRewardsClaimed, true)
  assert.equal(firstReward.gold, CHAPTER_BY_ID.border_watch.rewardGold)
  assert.equal(firstReward.equipCard?.equipId, 'iron_plate')
  assert.equal(firstReward.heroCard?.heroId, 'knight')
  assert.equal(isStageCleared(state.campaign, 'border_watch'), true)
  assert.equal(isStageUnlocked(state.campaign, 'sunken_bridge'), true)
  assert.equal(isStageUnlocked(state.campaign, 'miller_ford'), true)
  assert.equal(isStageUnlocked(state.campaign, 'oakhaven_market'), true, 'Oakhaven City unlocks after clearing Border Watch')
  assert.equal(isStageUnlocked(state.campaign, 'gloomwood_heart'), false, 'Later regional expansion nodes stay locked until prerequisite stages are cleared')

  // Replaying Border Watch awards replayGold and does NOT re-award both one-time specials!
  const replayReward = winStage('border_watch')
  assert.equal(replayReward.firstClear, false)
  assert.equal(replayReward.specialRewardsClaimed, false)
  assert.equal(replayReward.gold, CHAPTER_BY_ID.border_watch.replayGold)
  const dropCount = (replayReward.equipCard ? 1 : 0) + (replayReward.heroCard ? 1 : 0) + (replayReward.tacticCard ? 1 : 0)
  assert.equal(dropCount, 1, 'Replay victory should award exactly one repeatable drop')

  // Clearing Sunken Bridge unlocks BOTH bifurcated routes (Sunwell Glade AND Lantern Crypt) + 4th squad slot!
  const bridgeReward = winStage('sunken_bridge')
  assert.equal(bridgeReward.unlockedSlot4, true)
  assert.equal(maxSquadSize(state.campaign), 4)
  assert.equal(isStageUnlocked(state.campaign, 'sunwell_glade'), true)
  assert.equal(isStageUnlocked(state.campaign, 'lantern_crypt'), true)
  assert.equal(isStageUnlocked(state.campaign, 'frostspire_pass'), false)

  // Taking ONLY the North bifurcation (Sunwell Glade) unlocks Frostspire Pass via unlockMode: 'any'
  // while Cursed Vault (which requires Lantern Crypt) remains locked!
  const gladeReward = winStage('sunwell_glade')
  assert.equal(gladeReward.heroCard?.heroId, 'cleric')
  assert.equal(isStageUnlocked(state.campaign, 'frostspire_pass'), true)
  assert.equal(isStageUnlocked(state.campaign, 'cursed_vault'), false)
})

test('Move+Attack in one click approaches optimal tile and executes Strike or Skill on arrival', () => {
  const state = createInitialState(2027)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  assert.equal(active.heroId, 'archer')

  // Verify an enemy outside direct range but inside move+range appears in moveAttackTiles
  assert.ok(battle.moveAttackTiles.length > 0, 'Active hero should have Move+Attack reachable enemies')
  const entry = battle.moveAttackTiles[0]
  const enemy = battle.units.find(u => u.alive && u.col === entry.col && u.row === entry.row)!
  const hpBefore = enemy.hp

  // Forecast before clicking confirms requiresMove, valid path, and Strike vs Skill comparison!
  const fcStrike = computeCombatForecast(state, enemy.col, enemy.row)
  assert.ok(fcStrike, 'Move+Attack target must return a combat forecast')
  assert.equal(fcStrike.mode, 'strike')
  assert.equal(fcStrike.requiresMove, true)
  assert.ok(fcStrike.path.length > 0, 'Move+Attack forecast must include approach path')
  assert.equal(fcStrike.approachCol, entry.fromCol)
  assert.equal(fcStrike.approachRow, entry.fromRow)
  assert.ok(fcStrike.normalDmg >= 4)
  assert.ok(fcStrike.critDmg > fcStrike.normalDmg, 'Crit damage should exceed normal damage')
  assert.ok(fcStrike.alternatives.length >= 2, 'Forecast must compare Strike vs unlocked Skill')
  const strikeAlt = fcStrike.alternatives.find(a => a.skillIndex === null)
  const skillAlt = fcStrike.alternatives.find(a => a.skillIndex === 0)
  assert.ok(strikeAlt && skillAlt, 'Alternatives should include Strike and Skill 1')
  assert.ok(skillAlt.normalDmg > strikeAlt.normalDmg, 'Piercing Shot should forecast higher damage than basic Strike')

  // Arm Skill 0 and verify forecast switches to Skill mode with higher damage
  assert.equal(armSkill(state, 0), true)
  const fcSkill = computeCombatForecast(state, enemy.col, enemy.row)
  assert.ok(fcSkill)
  assert.equal(fcSkill.mode, 'skill')
  assert.equal(fcSkill.normalDmg, skillAlt.normalDmg)

  // Clicking the enemy directly starts Move+Cast and automatically hits upon arrival!
  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.ok(active.path.length > 0, 'Hero should begin moving along approach path')
  assert.ok(battle.pendingAction !== null, 'Pending skill action should be queued for arrival')
  for (let i = 0; i < 160; i++) stepGame(state, STEP)

  assert.equal(active.col, fcSkill.approachCol)
  assert.equal(active.row, fcSkill.approachRow)
  assert.equal(active.moved, true)
  assert.equal(active.acted, true, 'Hero must automatically execute queued skill upon arrival')
  assert.equal(battle.pendingAction, null)
  assert.ok(enemy.hp < hpBefore, 'Enemy must take damage after Move+Cast completes')
})

test('Combat forecast detects high ground bonus and lethal KO accurately', () => {
  const state = createInitialState(2028)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Place active hero on a hill tile adjacent to a low-HP enemy
  battle.cells[2][2] = { col: 2, row: 2, terrain: 'hill', elevation: 0.45, walkable: true }
  battle.cells[2][3] = { col: 3, row: 2, terrain: 'grass', elevation: 0, walkable: true }
  active.col = 2
  active.row = 2
  enemy.col = 3
  enemy.row = 2
  enemy.hp = 10
  enemy.shield = 0
  selectHeroByUid(state, active.uid)

  const fc = computeCombatForecast(state, enemy.col, enemy.row)
  assert.ok(fc)
  assert.equal(fc.requiresMove, false)
  assert.equal(fc.highGround, true, 'Hill -> Grass must report high ground bonus')
  assert.equal(fc.lethalNormal, true, 'Low-HP target must be flagged lethalNormal (KO!)')
  assert.equal(fc.targetHpAfterNormal, 0)
})

test('Best Fit auto-equip picks best unequipped upgrades and NEVER steals from other heroes', () => {
  const state = createInitialState(2029)
  const knight = state.campaign.heroes[0]
  const archer = state.campaign.heroes[1]
  const mage = state.campaign.heroes[2]

  // Put a legendary weapon on Knight so we can verify Best Fit on Mage NEVER steals it!
  state.campaign.equipment.push(
    { uid: 'eq_knight_leg', equipId: 'solis_crownblade', slot: 'weapon' },
    { uid: 'eq_bag_rare_wep', equipId: 'frostbite_staff', slot: 'weapon' },
    { uid: 'eq_bag_common_wep', equipId: 'iron_sword', slot: 'weapon' },
    { uid: 'eq_bag_vanguard_arm', equipId: 'runed_mail', slot: 'armor' },
    { uid: 'eq_bag_rare_arm', equipId: 'astral_vestments', slot: 'armor' },
    { uid: 'eq_bag_relic', equipId: 'blood_amulet', slot: 'relic' }
  )
  equipItem(state, knight.uid, 'eq_knight_leg')
  const archerWeaponBefore = archer.weaponUid

  // Mage starts with Common apprentice_staff and empty armor/relic -> should pick 3 class-compatible upgrades
  const pending = findBestFitUpgrades(state.campaign, mage.uid)
  assert.equal(pending.length, 3, 'Mage should detect 3 unequipped class-compatible upgrades')
  const equipped = autoEquipBestFit(state, mage.uid)
  assert.equal(equipped.length, 3)

  // Must choose Frostbite Staff & Astral Vestments (ignoring Vanguard gear), and NEVER steal Knight's Solis Crownblade!
  assert.equal(mage.weaponUid, 'eq_bag_rare_wep', 'Should pick highest-scoring unequipped Arcane weapon')
  assert.equal(mage.armorUid, 'eq_bag_rare_arm', 'Should pick highest-scoring unequipped Arcane armor')
  assert.equal(mage.relicUid, 'eq_bag_relic')
  assert.equal(knight.weaponUid, 'eq_knight_leg', 'Must never steal equipment from Knight')
  assert.equal(archer.weaponUid, archerWeaponBefore, 'Must never steal equipment from Archer')

  // Running Best Fit again with only inferior items left in bag must NOT downgrade Mage
  const secondRun = autoEquipBestFit(state, mage.uid)
  assert.equal(secondRun.length, 0, 'Must not swap when already wearing best unequipped gear')
  assert.equal(mage.weaponUid, 'eq_bag_rare_wep')
})

test('Skills can target empty spaces and allies (friendly fire) without being encouraged', () => {
  const state = createInitialState(3030)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const ally = battle.units.find(u => u.alive && u.team === 'ally' && u.uid !== active.uid)!

  // Position active archer near both an empty ground tile and an ally
  active.col = 1
  active.row = 2
  ally.col = 2
  ally.row = 2
  ally.shield = 0
  const emptyCol = 1
  const emptyRow = 1
  // Ensure empty tile has no occupant
  for (const u of battle.units) {
    if (u.col === emptyCol && u.row === emptyRow) { u.col = 0; u.row = 0 }
  }
  battle.cells[emptyRow][emptyCol] = { col: emptyCol, row: emptyRow, terrain: 'grass', elevation: 0, walkable: true }

  // Arm Skill 0 (Piercing Shot, single-target enemy skill) -> empty ground & ally tile are BOTH targetable!
  assert.equal(armSkill(state, 0), true)
  assert.ok(battle.targetTiles.some(t => t.col === emptyCol && t.row === emptyRow), 'Empty space in range must be targetable by skill')
  assert.ok(battle.targetTiles.some(t => t.col === ally.col && t.row === ally.row), 'Ally tile in range must be targetable by skill')

  // Forecast on empty ground reports emptyTileTarget cleanly
  const fcEmpty = computeCombatForecast(state, emptyCol, emptyRow)
  assert.ok(fcEmpty)
  assert.equal(fcEmpty.emptyTileTarget, true)
  assert.equal(fcEmpty.targetTeam, 'none')
  assert.equal(fcEmpty.friendlyFire, false)

  // Forecast on ally warns friendlyFire while still showing projected damage
  const fcAlly = computeCombatForecast(state, ally.col, ally.row)
  assert.ok(fcAlly)
  assert.equal(fcAlly.friendlyFire, true)
  assert.equal(fcAlly.friendlyFireCount, 1)
  assert.equal(fcAlly.isOffensive, true)
  assert.ok(fcAlly.normalDmg >= 4)

  // Firing at an empty space consumes action & cooldown and emits NO TARGET float
  assert.equal(selectTile(state, emptyCol, emptyRow), true)
  assert.equal(active.acted, true)
  assert.ok(active.cooldowns[0] > 0)
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'NO TARGET'))

  // Reset action & cooldown, then explicitly click ally tile -> ally actually takes damage!
  active.acted = false
  active.cooldowns[0] = 0
  const allyHpBefore = ally.hp
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, ally.col, ally.row), true)
  assert.ok(ally.hp < allyHpBefore, 'Targeting an ally with an offensive skill must deal friendly-fire damage')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'ALLY HIT!'))
})

test('Directional facing computes Front, Flank (+15%), and Backstab (+30%) positioning advantages', () => {
  assert.equal(computeAttackArc(4, 2, 3, 2, 'e'), 'front')
  assert.equal(computeAttackArc(3, 1, 3, 2, 'e'), 'flank')
  assert.equal(computeAttackArc(3, 3, 3, 2, 'e'), 'flank')
  assert.equal(computeAttackArc(2, 2, 3, 2, 'e'), 'back')

  const state = createInitialState(3031)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Flat identical elevation so ONLY facing differs
  for (let r = 1; r <= 3; r++) {
    for (let c = 2; c <= 4; c++) {
      battle.cells[r][c] = { col: c, row: r, terrain: 'grass', elevation: 0, walkable: true }
    }
  }
  active.col = 2
  active.row = 2
  enemy.col = 3
  enemy.row = 2
  enemy.hp = 80
  enemy.maxHp = 80
  enemy.shield = 0
  selectHeroByUid(state, active.uid)

  // Enemy faces West (toward attacker) -> FRONT
  setUnitFacing(enemy, 'w')
  const fcFront = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(fcFront.attackArc, 'front')

  // Enemy faces North (side exposed) -> FLANK (+15% DMG, +10% Crit)
  setUnitFacing(enemy, 'n')
  const fcFlank = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(fcFlank.attackArc, 'flank')
  assert.ok(fcFlank.normalDmg > fcFront.normalDmg, `Flank (${fcFlank.normalDmg}) must exceed Front (${fcFront.normalDmg})`)
  assert.ok(fcFlank.critChance > fcFront.critChance, 'Flank must boost crit chance')

  // Enemy faces East (back exposed!) -> BACKSTAB (+30% DMG, +20% Crit)
  setUnitFacing(enemy, 'e')
  const fcBack = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(fcBack.attackArc, 'back')
  assert.ok(fcBack.normalDmg > fcFlank.normalDmg, `Backstab (${fcBack.normalDmg}) must exceed Flank (${fcFlank.normalDmg})`)
  assert.ok(fcBack.critChance > fcFlank.critChance, 'Backstab must boost crit chance above Flank')

  // Player can manually rotate active unit's facing during their turn
  const beforeFacing = active.facing
  assert.equal(rotateActiveUnitFacing(state), true)
  assert.notEqual(active.facing, beforeFacing)
})
