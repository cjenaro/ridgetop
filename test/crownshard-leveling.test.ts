import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasWidgetDrawState } from 'ridgetop/ui'
import { CHAPTERS, HERO_LIST, HERO_SPECS } from '../examples/crownshard/crownshard/data.ts'
import {
  MAX_HERO_LEVEL, XP_ACTION_BOSS_KO, XP_ACTION_DAMAGE, XP_ACTION_KO, XP_ACTION_REVIVE, XP_ACTION_SUPPORT,
  XP_MERGE_TRANSFER_RATIO, XP_VICTORY_BASE, XP_VICTORY_PER_DIFFICULTY, XP_VICTORY_SURVIVAL_BONUS,
  grantHeroXp, heroLevelProgress, levelStatBonuses, totalXpForLevel, victoryXpBonus, xpRequiredForLevel
} from '../examples/crownshard/crownshard/leveling.ts'
import {
  SAVE_KEY, armSkill, computeHeroStats, createInitialState, effectiveSpeed, getHeroByUid, getUnitByUid,
  hydrateSave, loadSave, mergeHero, persistSave, refreshHighlights, restoreBattleState, selectHeroByUid,
  selectTile, serializeBattleState, serializeSave, startChapterBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleHeroXpGain, BattleState, BattleUnit, OwnedHeroCard, SaveData } from '../examples/crownshard/crownshard/types.ts'
import {
  drawHeroHeader, drawHeroRosterCard, drawHeroXpSummaryAnimated, drawUnitCard
} from '../examples/crownshard/crownshard/ui-art.ts'

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null },
    setItem(key: string, value: string) { store.set(key, value) },
    removeItem(key: string) { store.delete(key) }
  }
}

function fakeCanvasCtx(drawnTexts: string[]): CanvasRenderingContext2D {
  const grad = { addColorStop() {} }
  return {
    save() {},
    restore() {},
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
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    fillText(text: string) { drawnTexts.push(text) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.2 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
  unit.col = col
  unit.row = row
  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.x = wx
  unit.y = wy
  unit.z = wz
}

function flattenArena(battle: BattleState): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c].terrain = 'grass'
      battle.cells[r][c].elevation = 0
      battle.cells[r][c].walkable = true
    }
  }
}

test('Level 1 grants strictly 0 bonus stats and Levels 2..20 scale HP/ATK/DEF/SPD/CRIT monotonically up to MAX_HERO_LEVEL', () => {
  assert.equal(MAX_HERO_LEVEL, 20)

  // Progressive XP curve strictly increases from Lv 1..19 and returns 0 at MAX_HERO_LEVEL
  let prevReq = 0
  for (let lv = 1; lv < MAX_HERO_LEVEL; lv++) {
    const req = xpRequiredForLevel(lv)
    assert.ok(req > prevReq, `XP required at Lv ${lv} (${req}) must exceed Lv ${lv - 1} (${prevReq})`)
    prevReq = req
  }
  assert.equal(xpRequiredForLevel(MAX_HERO_LEVEL), 0)
  assert.equal(xpRequiredForLevel(MAX_HERO_LEVEL + 5), 0)

  const state = createInitialState(101)
  for (const spec of HERO_LIST) {
    // Baseline parity at Level 1 (explicit and omitted level)
    const lv1Bonus = levelStatBonuses(spec.id, 1)
    assert.deepEqual(lv1Bonus, { hp: 0, atk: 0, def: 0, speed: 0, crit: 0 })
    assert.deepEqual(levelStatBonuses(spec.id, undefined), { hp: 0, atk: 0, def: 0, speed: 0, crit: 0 })

    const baseCard: OwnedHeroCard = {
      uid: `test_${spec.id}`, heroId: spec.id, stars: 1,
      weaponUid: null, armorUid: null, relicUid: null
    }
    const lv1Card: OwnedHeroCard = { ...baseCard, level: 1, xp: 0 }
    assert.deepEqual(
      computeHeroStats(state.campaign, baseCard),
      computeHeroStats(state.campaign, lv1Card),
      `${spec.id} stats at Level 1 must match omitted-level baseline exactly`
    )

    // Monotonic scaling from Lv 1 through Lv 20
    let prev = lv1Bonus
    let prevStats = computeHeroStats(state.campaign, lv1Card)
    for (let lv = 2; lv <= MAX_HERO_LEVEL; lv++) {
      const cur = levelStatBonuses(spec.id, lv)
      assert.ok(cur.hp > prev.hp, `${spec.id} HP bonus must strictly increase at Lv ${lv}`)
      assert.ok(cur.atk > prev.atk, `${spec.id} ATK bonus must strictly increase at Lv ${lv}`)
      assert.ok(cur.def >= prev.def, `${spec.id} DEF bonus must be non-decreasing at Lv ${lv}`)
      assert.ok(cur.speed >= prev.speed, `${spec.id} SPD bonus must be non-decreasing at Lv ${lv}`)
      assert.ok(cur.crit >= prev.crit, `${spec.id} CRIT bonus must be non-decreasing at Lv ${lv}`)

      const curStats = computeHeroStats(state.campaign, { ...lv1Card, level: lv })
      assert.ok(curStats.powerScore > prevStats.powerScore, `${spec.id} powerScore must increase at Lv ${lv}`)
      prev = cur
      prevStats = curStats
    }

    // Milestone SPD & CRIT nudges at levels 5, 10, 15, 20
    const b4 = levelStatBonuses(spec.id, 4)
    const b5 = levelStatBonuses(spec.id, 5)
    const b10 = levelStatBonuses(spec.id, 10)
    const b15 = levelStatBonuses(spec.id, 15)
    const b20 = levelStatBonuses(spec.id, 20)
    assert.ok(b5.speed > b4.speed && b5.crit > b4.crit, `${spec.id} should gain SPD & CRIT milestone at Lv 5`)
    assert.ok(b10.speed > b5.speed && b10.crit > b5.crit, `${spec.id} should gain SPD & CRIT milestone at Lv 10`)
    assert.ok(b15.speed > b10.speed && b15.crit > b10.crit, `${spec.id} should gain SPD & CRIT milestone at Lv 15`)
    assert.ok(b20.speed > b15.speed && b20.crit > b15.crit, `${spec.id} should gain SPD & CRIT milestone at Lv 20`)
    assert.ok(b20.def > lv1Bonus.def, `${spec.id} must gain DEF by Lv 20`)

    // Clamping above MAX_HERO_LEVEL
    assert.deepEqual(levelStatBonuses(spec.id, 99), b20)
  }
})

test('grantHeroXp resolves multi-level-ups with overflow preserved and caps cleanly at Level 20', () => {
  const hero: OwnedHeroCard = {
    uid: 'hero_xp_1', heroId: 'knight', stars: 1, level: 1, xp: 0,
    weaponUid: null, armorUid: null, relicUid: null
  }

  // Zero / negative grants are safe no-ops
  const noop = grantHeroXp(hero, 0)
  assert.equal(noop.levelsGained, 0)
  assert.equal(noop.xpGained, 0)
  assert.equal(hero.level, 1)
  assert.equal(hero.xp, 0)

  // Multi-level grant: Lv1->2 (40) + Lv2->3 (69) + 16 overflow = 125 XP
  const req1 = xpRequiredForLevel(1)
  const req2 = xpRequiredForLevel(2)
  const res = grantHeroXp(hero, req1 + req2 + 16)
  assert.equal(res.oldLevel, 1)
  assert.equal(res.newLevel, 3)
  assert.equal(res.levelsGained, 2)
  assert.equal(res.xpGained, req1 + req2 + 16)
  assert.equal(res.xpOverflow, 16)
  assert.equal(hero.level, 3)
  assert.equal(hero.xp, 16)

  const prog = heroLevelProgress(hero.level, hero.xp)
  assert.equal(prog.level, 3)
  assert.equal(prog.xp, 16)
  assert.equal(prog.xpForNext, xpRequiredForLevel(3))
  assert.equal(prog.xpToNext, xpRequiredForLevel(3) - 16)
  assert.equal(prog.isMaxLevel, false)

  // Massive XP grant caps cleanly at Level 20 with 0 overflow
  const capRes = grantHeroXp(hero, 999_999)
  assert.equal(capRes.oldLevel, 3)
  assert.equal(capRes.newLevel, MAX_HERO_LEVEL)
  assert.equal(capRes.levelsGained, MAX_HERO_LEVEL - 3)
  assert.equal(capRes.xpOverflow, 0)
  assert.equal(hero.level, MAX_HERO_LEVEL)
  assert.equal(hero.xp, 0)

  // Further XP at Level 20 yields 0 gain
  const maxed = grantHeroXp(hero, 500)
  assert.equal(maxed.levelsGained, 0)
  assert.equal(maxed.xpGained, 0)
  assert.equal(maxed.newLevel, MAX_HERO_LEVEL)
  assert.equal(hero.xp, 0)

  const maxProg = heroLevelProgress(hero.level, hero.xp)
  assert.equal(maxProg.isMaxLevel, true)
  assert.equal(maxProg.ratio, 1)
  assert.equal(maxProg.xpToNext, 0)
})

test('Combat actions (attack, KO, boss KO, heal/revive) and battle victory award XP, emit callouts, and level up heroes', () => {
  const state = createInitialState(2027)
  // Add a Cleric to squad so we can test heal & revive XP too
  const clericCard: OwnedHeroCard = {
    uid: 'hero_cleric_test', heroId: 'cleric', stars: 1, level: 1, xp: 0,
    weaponUid: null, armorUid: null, relicUid: null
  }
  state.campaign.heroes.push(clericCard)
  state.campaign.squadUids = [state.campaign.heroes[0].uid, state.campaign.heroes[1].uid, clericCard.uid]

  const battle = startChapterBattle(state, 0)
  flattenArena(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const cleric = battle.units.find(u => u.heroId === 'cleric')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  assert.ok(enemies.length >= 2)

  const target1 = enemies[0]
  const target2 = enemies[1]
  // Remove any extra enemies beyond 2 so we control victory cleanly
  for (let i = 2; i < enemies.length; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, cleric, 1, 3)
  placeUnit(battle, target1, 3, 2)
  placeUnit(battle, target2, 5, 4)

  // 1) Non-lethal basic attack -> +8 XP
  target1.hp = 999
  target1.maxHp = 999
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.moved = false
  knight.acted = false
  refreshHighlights(battle, state.campaign)
  battle.floatingNumbers.length = 0

  assert.equal(selectHeroByUid(state, knight.uid), true)
  assert.equal(selectTile(state, target1.col, target1.row), true)

  const knightOwned = getHeroByUid(state.campaign, knight.uid)!
  assert.equal(battle.xpEarnedByHero[knight.uid], XP_ACTION_DAMAGE)
  assert.equal(knightOwned.xp, XP_ACTION_DAMAGE)
  assert.ok(
    battle.floatingNumbers.some(f => f.text === `+${XP_ACTION_DAMAGE} XP`),
    'Damage hit must emit +8 XP floating callout'
  )

  // 2) Securing a KO -> +8 + 22 = +30 XP (total 38 XP, still Lv 1)
  target1.hp = 1
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.moved = false
  knight.acted = false
  knight.cooldowns = [0, 0, 0]
  refreshHighlights(battle, state.campaign)
  battle.floatingNumbers.length = 0

  assert.equal(selectHeroByUid(state, knight.uid), true)
  assert.equal(selectTile(state, target1.col, target1.row), true)
  assert.equal(target1.alive, false)
  assert.equal(battle.xpEarnedByHero[knight.uid], XP_ACTION_DAMAGE + XP_ACTION_DAMAGE + XP_ACTION_KO)
  assert.ok(
    battle.floatingNumbers.some(f => f.text === `+${XP_ACTION_DAMAGE + XP_ACTION_KO} XP`),
    'KO strike must emit +30 XP floating callout'
  )

  // 3) Cleric heals living ally (+10 XP) and revives downed ally (+20 XP)
  archer.hp = Math.max(1, archer.maxHp - 15)
  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  battle.selectedUnitUid = cleric.uid
  cleric.moved = false
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  refreshHighlights(battle, state.campaign)
  battle.floatingNumbers.length = 0

  assert.equal(armSkill(state, 0), true) // Sunbeam Mend
  assert.equal(selectTile(state, archer.col, archer.row), true)
  assert.equal(battle.xpEarnedByHero[cleric.uid], XP_ACTION_SUPPORT)
  assert.ok(battle.floatingNumbers.some(f => f.text === `+${XP_ACTION_SUPPORT} XP`))

  // Now down the archer and revive with Cleric -> +20 XP
  archer.hp = 0
  archer.alive = false
  archer.downed = true
  archer.koCountdown = 3
  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  battle.selectedUnitUid = cleric.uid
  cleric.moved = false
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  refreshHighlights(battle, state.campaign)
  battle.floatingNumbers.length = 0

  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, archer.col, archer.row), true)
  assert.equal(archer.alive, true)
  assert.equal(battle.xpEarnedByHero[cleric.uid], XP_ACTION_SUPPORT + XP_ACTION_REVIVE)
  assert.ok(battle.floatingNumbers.some(f => f.text === `+${XP_ACTION_REVIVE} XP`))

  // 4) Down archer again so victory tests both surviving and downed victory XP bonuses,
  //    and make target2 a boss so finishing it triggers Boss KO XP + mid-battle LEVEL UP! + Victory bonus!
  archer.hp = 0
  archer.alive = false
  archer.downed = true
  archer.koCountdown = 2
  ;(target2 as { isBoss: boolean }).isBoss = true
  target2.hp = 1
  placeUnit(battle, knight, 4, 4)
  const knightMaxHpBefore = knight.maxHp
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.moved = false
  knight.acted = false
  knight.cooldowns = [0, 0, 0]
  refreshHighlights(battle, state.campaign)
  battle.floatingNumbers.length = 0
  state.vfx.length = 0

  assert.equal(selectHeroByUid(state, knight.uid), true)
  assert.equal(selectTile(state, target2.col, target2.row), true)

  assert.equal(battle.phase, 'victory')
  assert.ok(battle.reward, 'Victory must populate reward')
  assert.ok(
    battle.floatingNumbers.some(f => f.text.startsWith('LEVEL UP! LV ')),
    'Leveling up in battle must emit LEVEL UP! LV N callout'
  )
  assert.ok(
    state.vfx.some(v => v.kind === 'levelup'),
    'Leveling up in battle must emit levelup VFX event'
  )
  assert.ok(knight.level >= 2, 'Live BattleUnit level must advance on level-up')
  assert.ok(knight.maxHp > knightMaxHpBefore, 'Live BattleUnit maxHp must increase on level-up')

  // Verify exact XP totals for surviving vs downed heroes on Victory
  const diff = CHAPTERS[0].difficulty
  const survivedVictoryBonus = victoryXpBonus(diff, 0, true)
  const downedVictoryBonus = victoryXpBonus(diff, 0, false)
  assert.equal(downedVictoryBonus, XP_VICTORY_BASE + diff * XP_VICTORY_PER_DIFFICULTY)
  assert.equal(survivedVictoryBonus, downedVictoryBonus + XP_VICTORY_SURVIVAL_BONUS)

  const expectedKnightTotal =
    XP_ACTION_DAMAGE +
    (XP_ACTION_DAMAGE + XP_ACTION_KO) +
    (XP_ACTION_DAMAGE + XP_ACTION_BOSS_KO) +
    survivedVictoryBonus
  const expectedClericTotal = XP_ACTION_SUPPORT + XP_ACTION_REVIVE + survivedVictoryBonus
  const expectedArcherTotal = downedVictoryBonus

  assert.equal(battle.reward.heroXpGains.length, 3)
  const kGain = battle.reward.heroXpGains.find(g => g.uid === knight.uid)!
  const cGain = battle.reward.heroXpGains.find(g => g.uid === cleric.uid)!
  const aGain = battle.reward.heroXpGains.find(g => g.uid === archer.uid)!

  assert.equal(kGain.xpGained, expectedKnightTotal)
  assert.equal(kGain.oldLevel, 1)
  assert.ok(kGain.newLevel >= 3, `Knight with ${expectedKnightTotal} XP should reach at least Lv 3, got Lv ${kGain.newLevel}`)
  assert.equal(kGain.levelsGained, kGain.newLevel - kGain.oldLevel)
  assert.equal(kGain.survived, true)

  assert.equal(cGain.xpGained, expectedClericTotal)
  assert.ok(cGain.newLevel >= 2)
  assert.equal(cGain.survived, true)

  assert.equal(aGain.xpGained, expectedArcherTotal)
  assert.equal(aGain.survived, false)
  assert.ok(aGain.newLevel >= 2, 'Even a downed hero on Chapter 1 victory gets 40 XP -> Lv 2!')
})

test('mergeHero preserves highest level & XP across merged copies and transfers +25% bonus XP from consumed copies', () => {
  // Case A: Target is Lv 1 (0 XP), sacrificed copy is Lv 6 (25 XP) -> merged hero keeps Lv 6 (25 XP) + 25% of other copies
  const stateA = createInitialState(301)
  const targetA = stateA.campaign.heroes[0]
  assert.equal(targetA.heroId, 'knight')
  targetA.level = 1
  targetA.xp = 0

  stateA.campaign.heroes.push(
    { uid: 'k_high', heroId: 'knight', stars: 1, level: 6, xp: 25, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'k_mid', heroId: 'knight', stars: 1, level: 3, xp: 10, weaponUid: null, armorUid: null, relicUid: null }
  )

  const expectedBaseTotal = totalXpForLevel(6, 25)
  const expectedBonus = Math.floor((totalXpForLevel(1, 0) + totalXpForLevel(3, 10)) * XP_MERGE_TRANSFER_RATIO)

  assert.equal(mergeHero(stateA, targetA.uid), true)
  assert.equal(targetA.stars, 2)
  assert.equal(totalXpForLevel(targetA.level, targetA.xp), expectedBaseTotal + expectedBonus)
  assert.ok((targetA.level ?? 1) >= 6, 'Merged hero must never lose level progress when a sacrificed copy is higher level')

  // Case B: High-level target merged with low-level copies preserves high level & XP + bonus
  const stateB = createInitialState(302)
  const targetB = stateB.campaign.heroes[0]
  targetB.level = 5
  targetB.xp = 30
  stateB.campaign.heroes.push(
    { uid: 'k_low1', heroId: 'knight', stars: 1, level: 2, xp: 20, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'k_low2', heroId: 'knight', stars: 1, level: 1, xp: 0, weaponUid: null, armorUid: null, relicUid: null }
  )
  const expectedTotalB = totalXpForLevel(5, 30) + Math.floor(totalXpForLevel(2, 20) * XP_MERGE_TRANSFER_RATIO)
  assert.equal(mergeHero(stateB, targetB.uid), true)
  assert.equal(targetB.stars, 2)
  assert.equal(totalXpForLevel(targetB.level, targetB.xp), expectedTotalB)
})

test('Save/load round-trip persists level & xp and remains 100% backwards-compatible with legacy saves', () => {
  const state = createInitialState(404)
  const knight = state.campaign.heroes[0]
  const archer = state.campaign.heroes[1]
  grantHeroXp(knight, 175) // Lv 3+ with overflow
  grantHeroXp(archer, 55)  // Lv 2 with overflow

  const expectedKnightLv = knight.level!
  const expectedKnightXp = knight.xp!
  const expectedArcherLv = archer.level!
  const expectedArcherXp = archer.xp!

  // Also test mid-battle snapshot persistence of unit level and battle XP tracking
  const battle = startChapterBattle(state, 0)
  const battleKnight = getUnitByUid(battle, knight.uid)!
  assert.equal(battleKnight.level, expectedKnightLv)
  battle.xpEarnedByHero[knight.uid] = 24

  const storage = createMemoryStorage()
  persistSave(storage, state)

  const loaded = loadSave(storage)
  assert.ok(loaded, 'loadSave must parse persisted save')
  assert.equal(loaded.campaign.heroes[0].level, expectedKnightLv)
  assert.equal(loaded.campaign.heroes[0].xp, expectedKnightXp)
  assert.equal(loaded.campaign.heroes[1].level, expectedArcherLv)
  assert.equal(loaded.campaign.heroes[1].xp, expectedArcherXp)

  const restored = createInitialState(999, loaded)
  assert.equal(restored.campaign.heroes[0].level, expectedKnightLv)
  assert.equal(restored.campaign.heroes[0].xp, expectedKnightXp)
  assert.ok(restored.battle, 'Active battle must restore')
  assert.equal(getUnitByUid(restored.battle, knight.uid)?.level, expectedKnightLv)
  assert.equal(restored.battle.xpEarnedByHero[knight.uid], 24)
  assert.equal(restored.battle.heroStartLevelByUid[knight.uid], expectedKnightLv)

  // Legacy save omitting `level` and `xp` on heroes AND omitting `level`/`xpEarnedByHero` on activeBattle
  const rawSave = JSON.parse(JSON.stringify(serializeSave(state))) as SaveData
  for (const h of rawSave.campaign.heroes) {
    delete h.level
    delete h.xp
  }
  if (rawSave.activeBattle) {
    const snap = rawSave.activeBattle as unknown as Record<string, unknown>
    delete snap.xpEarnedByHero
    delete snap.heroStartLevelByUid
    for (const u of rawSave.activeBattle.units) {
      delete (u as unknown as Record<string, unknown>).level
    }
  }

  const legacyStorage = createMemoryStorage()
  legacyStorage.setItem(SAVE_KEY, JSON.stringify(rawSave))
  const legacyLoaded = loadSave(legacyStorage)
  assert.ok(legacyLoaded, 'Legacy save without level/xp must load cleanly')
  for (const h of legacyLoaded.campaign.heroes) {
    assert.equal(h.level, 1, 'Legacy hero without level must default to 1')
    assert.equal(h.xp, 0, 'Legacy hero without xp must default to 0')
  }

  const hydrated = createInitialState(555)
  assert.equal(hydrateSave(hydrated, rawSave), true)
  for (const h of hydrated.campaign.heroes) {
    assert.equal(h.level, 1)
    assert.equal(h.xp, 0)
  }
  assert.ok(hydrated.battle, 'Legacy active battle without level/xpEarnedByHero must restore')
  for (const u of hydrated.battle.units) {
    assert.equal(u.level, 1)
  }

  // Also test direct serializeBattleState -> restoreBattleState round-trip
  const freshSnap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(freshSnap)
  const freshTarget = createInitialState(777)
  assert.equal(restoreBattleState(freshTarget, freshSnap), true)
  assert.equal(getUnitByUid(freshTarget.battle!, knight.uid)?.level, expectedKnightLv)
})

test('UI painters (drawHeroRosterCard, drawHeroHeader, drawUnitCard, drawHeroXpSummaryAnimated) render Lv.N and XP cleanly', () => {
  const state = createInitialState(606)
  const knightCard = state.campaign.heroes[0]
  grantHeroXp(knightCard, 125) // Lv 3 with 16 XP
  const spec = HERO_SPECS[knightCard.heroId]
  const stats = computeHeroStats(state.campaign, knightCard)
  const prog = heroLevelProgress(knightCard.level, knightCard.xp)

  const idleWidgetState: CanvasWidgetDrawState = {
    hovered: false,
    pressed: false,
    focused: false,
    disabled: false,
    selected: true
  }

  // 1) drawHeroRosterCard (desktop row & mobile token)
  const rosterTexts: string[] = []
  drawHeroRosterCard(
    fakeCanvasCtx(rosterTexts),
    { x: 0, y: 0, width: 220, height: 48 },
    { hero: knightCard, spec, inSquad: true, copies: 1, need: 3, readyMerge: false, token: false },
    idleWidgetState
  )
  assert.ok(rosterTexts.some(t => t === `Lv.${prog.level}`), `Expected Lv.${prog.level} on desktop roster card, got ${JSON.stringify(rosterTexts)}`)

  const tokenTexts: string[] = []
  drawHeroRosterCard(
    fakeCanvasCtx(tokenTexts),
    { x: 0, y: 0, width: 64, height: 64 },
    { hero: knightCard, spec, inSquad: true, copies: 1, need: 3, readyMerge: true, token: true },
    idleWidgetState
  )
  assert.ok(tokenTexts.some(t => t === `Lv.${prog.level}`), `Expected Lv.${prog.level} on token roster card`)

  // 2) drawHeroHeader (mid-level & MAX level)
  const headerTexts: string[] = []
  drawHeroHeader(
    fakeCanvasCtx(headerTexts),
    { x: 0, y: 0, width: 340, height: 50 },
    {
      name: spec.name, title: spec.title, stars: knightCard.stars, rarity: spec.rarity,
      power: stats.powerScore, inSquad: true, level: knightCard.level, xp: knightCard.xp
    }
  )
  assert.ok(headerTexts.some(t => t === `Lv.${prog.level}`), 'Hero header must draw Lv.N badge')
  assert.ok(headerTexts.some(t => t === `${prog.xp}/${prog.xpForNext} XP`), 'Hero header must draw XP progress readout')

  const maxHeaderTexts: string[] = []
  drawHeroHeader(
    fakeCanvasCtx(maxHeaderTexts),
    { x: 0, y: 0, width: 340, height: 50 },
    {
      name: spec.name, title: spec.title, stars: 3, rarity: spec.rarity,
      power: stats.powerScore, inSquad: true, level: MAX_HERO_LEVEL, xp: 0
    }
  )
  assert.ok(maxHeaderTexts.some(t => t === `Lv.${MAX_HERO_LEVEL}`))
  assert.ok(maxHeaderTexts.some(t => t === 'MAX LV'))

  // 3) drawUnitCard (full & compact, ally & enemy)
  const battle = startChapterBattle(state, 0)
  const ally = battle.units.find(u => u.uid === knightCard.uid)!
  const enemy = battle.units.find(u => u.team === 'enemy')!

  const unitFullTexts: string[] = []
  drawUnitCard(
    fakeCanvasCtx(unitFullTexts),
    { x: 0, y: 0, width: 212, height: 134 },
    ally, undefined, effectiveSpeed(ally), 'Knight', prog
  )
  assert.ok(unitFullTexts.some(t => t === `Lv.${ally.level}`), 'Full unit card must render Lv.N badge')

  const unitCompactTexts: string[] = []
  drawUnitCard(
    fakeCanvasCtx(unitCompactTexts),
    { x: 0, y: 0, width: 174, height: 62 },
    ally, undefined, effectiveSpeed(ally), 'Knight', prog
  )
  assert.ok(unitCompactTexts.some(t => t === `Lv.${ally.level}`), 'Compact unit card must render Lv.N badge')

  const enemyCardTexts: string[] = []
  drawUnitCard(
    fakeCanvasCtx(enemyCardTexts),
    { x: 0, y: 0, width: 212, height: 134 },
    enemy, undefined, effectiveSpeed(enemy), 'Foe'
  )
  assert.ok(enemyCardTexts.some(t => t === `Lv.${enemy.level}`), 'Enemy unit card must render Lv.N badge cleanly')

  // 4) drawHeroXpSummaryAnimated (Victory XP summary)
  const gains: BattleHeroXpGain[] = [
    {
      uid: knightCard.uid, heroId: 'knight', name: 'Sir Aldric',
      xpGained: 93, oldLevel: 1, newLevel: 2, levelsGained: 1,
      currentXp: 53, xpForNext: 69, isMaxLevel: false, survived: true
    },
    {
      uid: 'h2', heroId: 'archer', name: 'Lyra',
      xpGained: 40, oldLevel: 2, newLevel: 2, levelsGained: 0,
      currentXp: 40, xpForNext: 69, isMaxLevel: false, survived: false
    }
  ]
  const victoryTexts: string[] = []
  drawHeroXpSummaryAnimated(
    fakeCanvasCtx(victoryTexts),
    { x: 0, y: 0, width: 464, height: 70 },
    gains,
    {},
    1
  )
  assert.ok(victoryTexts.some(t => t === 'Lv.2'))
  assert.ok(victoryTexts.some(t => t === '+93 XP'))
  assert.ok(victoryTexts.some(t => t === 'LEVEL UP!'))
  assert.ok(victoryTexts.some(t => t === '+40 XP'))
})
