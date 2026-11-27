import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasWidgetDrawState } from '../packages/ridgetop/framework/ui.ts'
import { computeEquipmentStatDiff } from '../examples/crownshard/crownshard/armory-diff.ts'
import { EQUIPMENT_BY_ID, EQUIPMENT_LIST, HERO_LIST } from '../examples/crownshard/crownshard/data.ts'
import { canHeroEquipItem } from '../examples/crownshard/crownshard/equip-families.ts'
import {
  GEAR_SET_ORDER,
  GEAR_SET_SPECS,
  computeGearSetCombatBonuses,
  computeGearSetStatBonuses,
  getEquipSetId,
  getEquipSetSpec,
  getHeroActiveGearSetIds,
  getHeroActiveGearSets,
  getHeroGearSetProgress,
  getItemsInGearSet,
  getUnitActiveGearSets
} from '../examples/crownshard/crownshard/gear-sets.ts'
import {
  armSkill,
  computeCombatForecast,
  computeHeroStats,
  createInitialState,
  equipItem,
  getHeroByUid,
  loadSave,
  persistSave,
  restoreBattleState,
  selectHeroByUid,
  selectTile,
  serializeBattleState,
  startChapterBattle,
  unequipItem
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, terrainElevation } from '../examples/crownshard/crownshard/types.ts'
import type {
  BattleState,
  BattleUnit,
  CampaignState,
  GearSetId,
  GridCell,
  HeroClassId,
  OwnedEquipCard,
  OwnedHeroCard,
  TileTerrain
} from '../examples/crownshard/crownshard/types.ts'
import {
  drawArmoryStatDiffPanel,
  drawEquipCard,
  drawGearSetBanner,
  drawHeroHeader,
  drawUnitCard
} from '../examples/crownshard/crownshard/ui-art.ts'

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    }
  }
}

function fakeCanvas2dContext() {
  let ops = 0
  const texts: string[] = []
  const grad = { addColorStop() {} }
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
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
    fillText(text: string) {
      ops++
      texts.push(String(text))
    },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.0 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

function addEquip(campaign: CampaignState, equipId: string): OwnedEquipCard {
  const spec = EQUIPMENT_BY_ID[equipId]
  assert.ok(spec, `Unknown equipment id: ${equipId}`)
  const card: OwnedEquipCard = {
    uid: `eq_set_test_${campaign.nextUid++}`,
    equipId: spec.id,
    slot: spec.slot
  }
  campaign.equipment.push(card)
  return card
}

function makeCell(col: number, row: number, terrain: TileTerrain = 'grass', heightLevel = 0): GridCell {
  return {
    col,
    row,
    terrain,
    heightLevel,
    elevation: terrainElevation(terrain, heightLevel),
    walkable: terrain !== 'water' && terrain !== 'lava' && terrain !== 'pillar' && terrain !== 'void' && terrain !== 'barricade'
  }
}

function flattenBoard(battle: BattleState, terrain: TileTerrain = 'grass', heightLevel = 0): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, terrain, heightLevel)
    }
  }
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

function setupDuelBattle(
  heroId: HeroClassId,
  equipIds: readonly string[],
  seed = 9001
): { state: ReturnType<typeof createInitialState>; battle: BattleState; heroUnit: BattleUnit; enemy: BattleUnit } {
  const state = createInitialState(seed)
  const heroCard: OwnedHeroCard = {
    uid: `hero_duel_${heroId}`,
    heroId,
    stars: 2,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  state.campaign.heroes = [heroCard]
  state.campaign.squadUids = [heroCard.uid]
  for (const eqId of equipIds) {
    const eq = addEquip(state.campaign, eqId)
    assert.equal(equipItem(state, heroCard.uid, eq.uid), true, `${heroId} must equip ${eqId}`)
  }

  const battle = startChapterBattle(state, 0, 0, { deployPhase: false })
  flattenBoard(battle)
  const heroUnit = battle.units.find(u => u.team === 'ally')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  assert.ok(heroUnit && enemy)
  for (const u of battle.units) {
    if (u.uid !== heroUnit.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  heroUnit.crit = 0
  heroUnit.atk = 30
  heroUnit.acted = false
  heroUnit.moved = false
  heroUnit.cooldowns = [0, 0, 0]
  enemy.hp = 200
  enemy.maxHp = 200
  enemy.shield = 0
  enemy.def = 4
  enemy.facing = 'w'
  battle.phase = 'player'
  battle.activeUnitUid = heroUnit.uid
  selectHeroByUid(state, heroUnit.uid)
  return { state, battle, heroUnit, enemy }
}

test('Every gear set and every set item has valid class-compatible 2-piece pairings under canHeroEquipItem', () => {
  assert.deepEqual(GEAR_SET_ORDER, ['solis', 'frostguard', 'windrunner', 'shadowfang', 'astral'])
  assert.equal(EQUIPMENT_LIST.length, 33)

  // Every set has >= 4 items and at least one hero class that can equip a 2-piece combo across distinct slots
  for (const setId of GEAR_SET_ORDER) {
    const spec = GEAR_SET_SPECS[setId]
    assert.equal(spec.id, setId)
    assert.equal(spec.piecesRequired, 2)
    assert.ok(spec.tag.length >= 4 && spec.tag.length <= 6)
    assert.ok(spec.perkName.length > 3)

    const items = getItemsInGearSet(setId)
    assert.ok(items.length >= 4, `Set ${setId} should have at least 4 items (found ${items.length})`)

    let validPairings = 0
    for (const item of items) {
      assert.equal(getEquipSetId(item.id), setId)
      assert.equal(getEquipSetSpec(item.id), spec)

      // Every individual set item must be able to complete 2/2 with a class-compatible partner in a different slot
      let itemCanComplete = false
      for (const hero of HERO_LIST) {
        if (!canHeroEquipItem(hero.id, item.id)) continue
        for (const partner of items) {
          if (partner.id === item.id || partner.slot === item.slot) continue
          if (canHeroEquipItem(hero.id, partner.id)) {
            itemCanComplete = true
            validPairings += 1
          }
        }
      }
      assert.equal(
        itemCanComplete,
        true,
        `Set item ${item.id} (${item.family} ${item.slot}) in set ${setId} must have at least one class-compatible 2pc partner`
      )
    }
    assert.ok(validPairings > 0, `Set ${setId} must have class-compatible 2-piece combinations`)
  }

  // Every hero class can complete at least 2 distinct themed sets
  for (const hero of HERO_LIST) {
    const completableSets = new Set<GearSetId>()
    for (const setId of GEAR_SET_ORDER) {
      const items = getItemsInGearSet(setId).filter(it => canHeroEquipItem(hero.id, it.id))
      const distinctSlots = new Set(items.map(it => it.slot))
      if (distinctSlots.size >= 2) completableSets.add(setId)
    }
    assert.ok(
      completableSets.size >= 2,
      `Hero ${hero.id} should be able to complete at least 2 gear sets (got ${[...completableSets].join(', ')})`
    )
  }

  // Untagged starter items return null cleanly
  assert.equal(getEquipSetId('iron_sword'), null)
  assert.equal(getEquipSetSpec('copper_signet'), null)
  assert.equal(getEquipSetId(undefined), null)
})

test('Equipping 1 piece yields 1/2 progress with zero bonus; equipping 2 matching pieces activates stat bonuses in computeHeroStats & BattleUnit', () => {
  const cases: readonly {
    readonly setId: GearSetId
    readonly heroId: HeroClassId
    readonly piece1: string
    readonly piece2: string
  }[] = [
    { setId: 'solis', heroId: 'knight', piece1: 'sunsteel_blade', piece2: 'aegis_of_dawn' },
    { setId: 'frostguard', heroId: 'knight', piece1: 'dragonfang_spear', piece2: 'frostguard_plate' },
    { setId: 'frostguard', heroId: 'cryomancer', piece1: 'frostbite_staff', piece2: 'glacier_raiment' },
    { setId: 'windrunner', heroId: 'archer', piece1: 'gale_longbow', piece2: 'ranger_cloak' },
    { setId: 'shadowfang', heroId: 'rogue', piece1: 'shadowfang_bow', piece2: 'blood_amulet' },
    { setId: 'astral', heroId: 'mage', piece1: 'ember_wand', piece2: 'astral_vestments' }
  ]

  for (const c of cases) {
    const state = createInitialState(1000)
    const hero: OwnedHeroCard = {
      uid: `h_${c.setId}_${c.heroId}`,
      heroId: c.heroId,
      stars: 1,
      weaponUid: null,
      armorUid: null,
      relicUid: null
    }
    state.campaign.heroes = [hero]
    state.campaign.squadUids = [hero.uid]

    const baseStats = computeHeroStats(state.campaign, hero)
    assert.deepEqual(getHeroActiveGearSets(state.campaign, hero), [])
    assert.deepEqual(getHeroGearSetProgress(state.campaign, hero), [])

    // 1 piece: 1/2 progress, NO stat bonus
    const eq1 = addEquip(state.campaign, c.piece1)
    assert.equal(equipItem(state, hero.uid, eq1.uid), true)
    const prog1 = getHeroGearSetProgress(state.campaign, hero)
    assert.equal(prog1.length, 1)
    assert.equal(prog1[0].setId, c.setId)
    assert.equal(prog1[0].equippedCount, 1)
    assert.equal(prog1[0].active, false)
    assert.deepEqual(getHeroActiveGearSets(state.campaign, hero), [])
    const bonus1 = computeGearSetStatBonuses(c.piece1, undefined, undefined)
    assert.equal(bonus1.atk + bonus1.def + bonus1.hp + bonus1.speed + bonus1.shieldStart, 0)

    const stats1 = computeHeroStats(state.campaign, hero)
    const spec1 = EQUIPMENT_BY_ID[c.piece1]
    assert.equal(stats1.atk, baseStats.atk + spec1.atk, `${c.setId} 1pc must NOT grant set ATK`)
    assert.equal(stats1.maxHp, baseStats.maxHp + spec1.hp, `${c.setId} 1pc must NOT grant set HP`)

    // 2 matching pieces: 2/2 active, exact stat bonus applied in Camp AND BattleUnit!
    const eq2 = addEquip(state.campaign, c.piece2)
    assert.equal(equipItem(state, hero.uid, eq2.uid), true)
    const prog2 = getHeroGearSetProgress(state.campaign, hero)
    assert.equal(prog2.length, 1)
    assert.equal(prog2[0].setId, c.setId)
    assert.equal(prog2[0].equippedCount, 2)
    assert.equal(prog2[0].active, true)
    assert.deepEqual(getHeroActiveGearSetIds(state.campaign, hero), [c.setId])

    const stats2 = computeHeroStats(state.campaign, hero)
    const spec2 = EQUIPMENT_BY_ID[c.piece2]
    const expectedBonus = GEAR_SET_SPECS[c.setId].statBonus
    assert.equal(stats2.atk, baseStats.atk + spec1.atk + spec2.atk + expectedBonus.atk, `${c.setId} 2pc ATK`)
    assert.equal(stats2.def, baseStats.def + spec1.def + spec2.def + expectedBonus.def, `${c.setId} 2pc DEF`)
    assert.equal(stats2.maxHp, baseStats.maxHp + spec1.hp + spec2.hp + expectedBonus.hp, `${c.setId} 2pc HP`)
    assert.equal(
      stats2.shieldStart,
      baseStats.shieldStart + spec1.shieldStart + spec2.shieldStart + expectedBonus.shieldStart,
      `${c.setId} 2pc Start Shield`
    )
    assert.ok(
      Math.abs(stats2.crit - Math.min(0.85, baseStats.crit + spec1.crit + spec2.crit + expectedBonus.crit)) < 1e-6,
      `${c.setId} 2pc Crit`
    )
    assert.ok(
      Math.abs(stats2.lifesteal - Math.min(0.75, baseStats.lifesteal + spec1.lifesteal + spec2.lifesteal + expectedBonus.lifesteal)) < 1e-6,
      `${c.setId} 2pc Lifesteal`
    )

    // Launch battle and verify BattleUnit inherits exact stats + active set detection
    const battle = startChapterBattle(state, 0, 0, { deployPhase: false })
    const unit = battle.units.find(u => u.uid === hero.uid)!
    assert.ok(unit)
    assert.equal(unit.atk, stats2.atk)
    assert.equal(unit.def, stats2.def)
    assert.equal(unit.maxHp, stats2.maxHp)
    assert.equal(unit.shield, stats2.shieldStart)
    assert.equal(unit.speed, stats2.speed)
    assert.deepEqual(getUnitActiveGearSets(unit).map(s => s.setId), [c.setId])
    assert.deepEqual(getHeroActiveGearSets(unit).map(s => s.setId), [c.setId])
  }
})

test('computeEquipmentStatDiff detects set activation/deactivation and matches exact post-equip stats', () => {
  const state = createInitialState(2027)
  const { campaign } = state
  const knight = campaign.heroes[0]
  if (knight.weaponUid) assert.equal(unequipItem(state, knight.uid, 'weapon'), true)
  if (knight.armorUid) assert.equal(unequipItem(state, knight.uid, 'armor'), true)
  if (knight.relicUid) assert.equal(unequipItem(state, knight.uid, 'relic'), true)

  const sunsteel = addEquip(campaign, 'sunsteel_blade')
  const aegis = addEquip(campaign, 'aegis_of_dawn')
  const heart = addEquip(campaign, 'heart_of_solis')
  const ironPlate = addEquip(campaign, 'iron_plate')
  const frostStaff = addEquip(campaign, 'frostbite_staff')

  // Equip 1st Solis piece
  assert.equal(equipItem(state, knight.uid, sunsteel.uid), true)
  assert.deepEqual(getHeroActiveGearSetIds(campaign, knight), [])

  // Preview 2nd Solis piece (Aegis of Dawn) -> activates 2pc Solis (+4 ATK, +14 HP, +8 SHD on top of item stats)
  const activateDiff = computeEquipmentStatDiff(campaign, knight.uid, aegis.uid)!
  assert.ok(activateDiff)
  assert.equal(activateDiff.candidateSetId, 'solis')
  assert.deepEqual(activateDiff.activatedSets, ['solis'])
  assert.deepEqual(activateDiff.deactivatedSets, [])
  assert.equal(activateDiff.stats.atk.delta, EQUIPMENT_BY_ID.aegis_of_dawn.atk + GEAR_SET_SPECS.solis.statBonus.atk)
  assert.equal(activateDiff.stats.maxHp.delta, EQUIPMENT_BY_ID.aegis_of_dawn.hp + GEAR_SET_SPECS.solis.statBonus.hp)

  // Verify exact parity after actually equipping
  assert.equal(equipItem(state, knight.uid, aegis.uid), true)
  const realAfterActivate = computeHeroStats(campaign, getHeroByUid(campaign, knight.uid)!)
  assert.equal(activateDiff.stats.atk.after, realAfterActivate.atk)
  assert.equal(activateDiff.stats.maxHp.after, realAfterActivate.maxHp)
  assert.equal(activateDiff.powerAfter, realAfterActivate.powerScore)

  // Preview breaking 2pc Solis (Aegis -> Watchman Plate) -> deactivatedSets: ['solis'] and subtracts set bonus!
  const breakDiff = computeEquipmentStatDiff(campaign, knight.uid, ironPlate.uid)!
  assert.deepEqual(breakDiff.activatedSets, [])
  assert.deepEqual(breakDiff.deactivatedSets, ['solis'])
  assert.equal(
    breakDiff.stats.atk.delta,
    EQUIPMENT_BY_ID.iron_plate.atk - EQUIPMENT_BY_ID.aegis_of_dawn.atk - GEAR_SET_SPECS.solis.statBonus.atk
  )
  assert.equal(
    breakDiff.stats.maxHp.delta,
    EQUIPMENT_BY_ID.iron_plate.hp - EQUIPMENT_BY_ID.aegis_of_dawn.hp - GEAR_SET_SPECS.solis.statBonus.hp
  )

  // Equip 3rd Solis piece (Heart of Solis) -> swapping Aegis to Watchman Plate keeps 2/2 Solis active!
  assert.equal(equipItem(state, knight.uid, heart.uid), true)
  const keepSetDiff = computeEquipmentStatDiff(campaign, knight.uid, ironPlate.uid)!
  assert.deepEqual(keepSetDiff.activatedSets, [])
  assert.deepEqual(keepSetDiff.deactivatedSets, [])
  assert.equal(keepSetDiff.stats.atk.delta, EQUIPMENT_BY_ID.iron_plate.atk - EQUIPMENT_BY_ID.aegis_of_dawn.atk)

  // Class-incompatible item never claims set activation
  const incompatDiff = computeEquipmentStatDiff(campaign, knight.uid, frostStaff.uid)!
  assert.equal(incompatDiff.compatible, false)
  assert.deepEqual(incompatDiff.activatedSets, [])
  assert.deepEqual(incompatDiff.deactivatedSets, [])
})

test('2-piece combat multipliers apply in live battle AND match CombatForecast exactly across all 5 sets', () => {
  // 1. Solis (+10% Skill DMG, NOT basic strike)
  {
    const base = setupDuelBattle('knight', ['sunsteel_blade'], 5001)
    const set = setupDuelBattle('knight', ['sunsteel_blade', 'aegis_of_dawn'], 5001)
    placeUnit(base.battle, base.heroUnit, 2, 2)
    placeUnit(base.battle, base.enemy, 3, 2)
    placeUnit(set.battle, set.heroUnit, 2, 2)
    placeUnit(set.battle, set.enemy, 3, 2)
    selectHeroByUid(base.state, base.heroUnit.uid)
    selectHeroByUid(set.state, set.heroUnit.uid)

    // Basic strike unaffected by Solis skill bonus
    const fcStrikeBase = computeCombatForecast(base.state, 3, 2)!
    const fcStrikeSet = computeCombatForecast(set.state, 3, 2)!
    assert.equal(fcStrikeSet.normalDmg, fcStrikeBase.normalDmg, 'Solis 2pc should not boost basic strike DMG')

    // Skill cast (Shield Bash) gets +10% Skill DMG in forecast AND live combat!
    assert.equal(armSkill(base.state, 0), true)
    assert.equal(armSkill(set.state, 0), true)
    const fcSkillBase = computeCombatForecast(base.state, 3, 2)!
    const fcSkillSet = computeCombatForecast(set.state, 3, 2)!
    assert.ok(fcSkillSet.normalDmg > fcSkillBase.normalDmg, `Solis 2pc skill DMG (${fcSkillSet.normalDmg}) must exceed base (${fcSkillBase.normalDmg})`)

    const hpBefore = set.enemy.hp
    assert.equal(selectTile(set.state, 3, 2), true)
    assert.equal(hpBefore - set.enemy.hp, fcSkillSet.normalDmg, 'Solis 2pc live skill damage must match CombatForecast exactly')
  }

  // 2. Frostguard (+15% DMG vs Slowed/Stunned foes)
  {
    const set = setupDuelBattle('knight', ['dragonfang_spear', 'frostguard_plate'], 5002)
    placeUnit(set.battle, set.heroUnit, 2, 2)
    placeUnit(set.battle, set.enemy, 3, 2)
    selectHeroByUid(set.state, set.heroUnit.uid)
    set.enemy.slowTurns = 0
    set.enemy.stunTurns = 0
    const fcClean = computeCombatForecast(set.state, 3, 2)!

    set.enemy.slowTurns = 2
    const fcSlow = computeCombatForecast(set.state, 3, 2)!
    assert.ok(fcSlow.normalDmg > fcClean.normalDmg, `Frostguard 2pc vs Slow (${fcSlow.normalDmg}) must exceed clean (${fcClean.normalDmg})`)

    const hpBefore = set.enemy.hp
    assert.equal(selectTile(set.state, 3, 2), true)
    assert.equal(hpBefore - set.enemy.hp, fcSlow.normalDmg, 'Frostguard 2pc live damage vs Slow must match CombatForecast exactly')

    // Also verify Stun trigger
    const bonusStun = computeGearSetCombatBonuses(set.heroUnit, { stunTurns: 1 }, false, 'front')
    assert.equal(bonusStun.damageMul, 1.15)
    assert.deepEqual(bonusStun.triggeredSets, ['frostguard'])
  }

  // 3. Windrunner (+10% Flank/Backstab DMG, NOT frontal)
  {
    const base = setupDuelBattle('archer', ['gale_longbow'], 5003)
    const set = setupDuelBattle('archer', ['gale_longbow', 'ranger_cloak'], 5003)
    placeUnit(base.battle, base.heroUnit, 2, 2)
    placeUnit(base.battle, base.enemy, 4, 2)
    placeUnit(set.battle, set.heroUnit, 2, 2)
    placeUnit(set.battle, set.enemy, 4, 2)
    selectHeroByUid(base.state, base.heroUnit.uid)
    selectHeroByUid(set.state, set.heroUnit.uid)

    // Frontal attack (enemy faces west toward attacker at col 2) -> equal damage
    base.enemy.facing = 'w'
    set.enemy.facing = 'w'
    assert.equal(computeCombatForecast(set.state, 4, 2)!.normalDmg, computeCombatForecast(base.state, 4, 2)!.normalDmg)

    // Flank attack (enemy faces north) -> +10% Windrunner bonus!
    base.enemy.facing = 'n'
    set.enemy.facing = 'n'
    const fcBaseFlank = computeCombatForecast(base.state, 4, 2)!
    const fcSetFlank = computeCombatForecast(set.state, 4, 2)!
    assert.equal(fcSetFlank.attackArc, 'flank')
    assert.ok(fcSetFlank.normalDmg > fcBaseFlank.normalDmg, `Windrunner 2pc flank (${fcSetFlank.normalDmg}) must exceed base (${fcBaseFlank.normalDmg})`)

    // Backstab live execution matches forecast exactly
    set.enemy.facing = 'e'
    const fcSetBack = computeCombatForecast(set.state, 4, 2)!
    assert.equal(fcSetBack.attackArc, 'back')
    const hpBefore = set.enemy.hp
    assert.equal(selectTile(set.state, 4, 2), true)
    assert.equal(hpBefore - set.enemy.hp, fcSetBack.normalDmg, 'Windrunner 2pc live backstab damage must match CombatForecast exactly')
  }

  // 4. Shadowfang (+12% DMG vs Poisoned/Burning targets)
  {
    const set = setupDuelBattle('rogue', ['shadowfang_bow', 'shadowsilk_vest'], 5004)
    placeUnit(set.battle, set.heroUnit, 2, 2)
    placeUnit(set.battle, set.enemy, 3, 2)
    selectHeroByUid(set.state, set.heroUnit.uid)
    set.enemy.poisonStacks = 0
    set.enemy.burnTurns = 0
    const fcClean = computeCombatForecast(set.state, 3, 2)!

    set.enemy.poisonStacks = 2
    const fcPoison = computeCombatForecast(set.state, 3, 2)!
    assert.ok(fcPoison.normalDmg > fcClean.normalDmg, `Shadowfang 2pc vs Poison (${fcPoison.normalDmg}) must exceed clean (${fcClean.normalDmg})`)

    const hpBefore = set.enemy.hp
    assert.equal(selectTile(set.state, 3, 2), true)
    assert.equal(hpBefore - set.enemy.hp, fcPoison.normalDmg, 'Shadowfang 2pc live damage vs Poison must match CombatForecast exactly')

    const bonusBurn = computeGearSetCombatBonuses(set.heroUnit, { burnTurns: 2 }, false, 'front')
    assert.equal(bonusBurn.damageMul, 1.12)
    assert.deepEqual(bonusBurn.triggeredSets, ['shadowfang'])
  }

  // 5. Astral (+15% Skill DMG)
  {
    const base = setupDuelBattle('mage', ['celestial_staff'], 5005)
    const set = setupDuelBattle('mage', ['celestial_staff', 'starweaver_mantle'], 5005)
    placeUnit(base.battle, base.heroUnit, 2, 2)
    placeUnit(base.battle, base.enemy, 4, 2)
    placeUnit(set.battle, set.heroUnit, 2, 2)
    placeUnit(set.battle, set.enemy, 4, 2)
    selectHeroByUid(base.state, base.heroUnit.uid)
    selectHeroByUid(set.state, set.heroUnit.uid)

    assert.equal(armSkill(base.state, 0), true)
    assert.equal(armSkill(set.state, 0), true)
    const fcBase = computeCombatForecast(base.state, 4, 2)!
    const fcSet = computeCombatForecast(set.state, 4, 2)!
    assert.ok(fcSet.normalDmg > fcBase.normalDmg, `Astral 2pc skill DMG (${fcSet.normalDmg}) must exceed base (${fcBase.normalDmg})`)

    const hpBefore = set.enemy.hp
    assert.equal(selectTile(set.state, 4, 2), true)
    assert.equal(hpBefore - set.enemy.hp, fcSet.normalDmg, 'Astral 2pc live skill damage must match CombatForecast exactly')
  }
})

test('Campaign save/load and mid-battle snapshot round-trip preserve active 2-piece gear sets and combat bonuses', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(6060)
  const knight = state.campaign.heroes[0]
  const sunsteel = addEquip(state.campaign, 'sunsteel_blade')
  const aegis = addEquip(state.campaign, 'aegis_of_dawn')
  assert.equal(equipItem(state, knight.uid, sunsteel.uid), true)
  assert.equal(equipItem(state, knight.uid, aegis.uid), true)
  const expectedStats = computeHeroStats(state.campaign, knight)

  // Start battle so both campaign AND activeBattle snapshot are persisted
  const battle = startChapterBattle(state, 0, 0, { deployPhase: false })
  flattenBoard(battle)
  const unitBefore = battle.units.find(u => u.uid === knight.uid)!
  assert.deepEqual(getUnitActiveGearSets(unitBefore).map(s => s.setId), ['solis'])

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  const hydrated = createInitialState(6060, loaded)
  const hydratedKnight = getHeroByUid(hydrated.campaign, knight.uid)!
  assert.deepEqual(getHeroActiveGearSetIds(hydrated.campaign, hydratedKnight), ['solis'])
  assert.deepEqual(computeHeroStats(hydrated.campaign, hydratedKnight), expectedStats)

  // Battle snapshot round-trip
  const snap = serializeBattleState(battle)
  assert.ok(snap)
  const resumedOk = restoreBattleState(hydrated, snap)
  assert.equal(resumedOk, true)
  const resumed = hydrated.battle!
  assert.ok(resumed)
  const resumedUnit = resumed.units.find(u => u.uid === knight.uid)!
  assert.equal(resumedUnit.weaponId, 'sunsteel_blade')
  assert.equal(resumedUnit.armorId, 'aegis_of_dawn')
  assert.deepEqual(getUnitActiveGearSets(resumedUnit).map(s => s.setId), ['solis'])
  assert.equal(resumedUnit.atk, expectedStats.atk)
  assert.equal(resumedUnit.maxHp, expectedStats.maxHp)
  assert.equal(computeGearSetCombatBonuses(resumedUnit, null, true, 'front').damageMul, 1.10)
})

test('Canvas 2D UI draw helpers render set tags, active/partial set banners, diff highlights, and battle badges cleanly at desktop & mobile widths', () => {
  const state = createInitialState(7070)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const sunsteel = addEquip(campaign, 'sunsteel_blade')
  const aegis = addEquip(campaign, 'aegis_of_dawn')
  const ironPlate = addEquip(campaign, 'iron_plate')
  assert.equal(equipItem(state, knight.uid, sunsteel.uid), true)

  const widgetState: CanvasWidgetDrawState = {
    hovered: false,
    pressed: false,
    focused: false,
    disabled: false,
    selected: false
  }

  // 1. Equipment cards show set tag across desktop (340), mobile Armory (230), and narrow Squad slot (108)
  for (const w of [108, 230, 340]) {
    const c = fakeCanvas2dContext()
    drawEquipCard(c.ctx, { x: 4, y: 4, width: w, height: 46 }, {
      slot: 'weapon',
      spec: EQUIPMENT_BY_ID.sunsteel_blade,
      ownerText: 'Bag'
    }, widgetState)
    assert.ok(c.ops > 10)
    if (w >= 230) {
      assert.ok(c.texts.includes('SOLIS'), `Expected SOLIS tag on equip card width=${w}`)
    }
  }

  // 2. Partial 1/2 progress banner & Hero Header
  const partialProgress = getHeroGearSetProgress(campaign, knight)
  for (const w of [320, 360, 520, 760]) {
    const c = fakeCanvas2dContext()
    drawGearSetBanner(c.ctx, { x: 8, y: 8, width: w, height: 22 }, partialProgress, w < 420)
    assert.ok(c.texts.some(t => t.includes('1/2 SOLIS')), `Expected 1/2 SOLIS at width=${w}`)

    const h = fakeCanvas2dContext()
    drawHeroHeader(h.ctx, { x: 8, y: 8, width: w, height: 50 }, {
      name: 'Sir Aldric',
      title: 'Knight',
      stars: 1,
      rarity: 'common',
      power: 150,
      inSquad: true,
      equipFamily: 'vanguard',
      gearSets: partialProgress
    })
    assert.ok(h.ops > 15)
  }

  // 3. Armory diff panel highlights newly activated 2pc Solis at both tall (82/96) and short (64) heights
  const activateDiff = computeEquipmentStatDiff(campaign, knight.uid, aegis.uid)!
  for (const [w, h] of [[260, 96], [340, 96], [740, 82], [740, 64]] as const) {
    const c = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(c.ctx, { x: 6, y: 6, width: w, height: h }, activateDiff)
    assert.ok(
      c.texts.some(t => t.includes('2pc Solis')),
      `Expected "+ 2pc Solis" highlight in diff panel at ${w}x${h}`
    )
  }

  // 4. Active 2/2 banner + breaking diff + Battle Unit Card badge
  assert.equal(equipItem(state, knight.uid, aegis.uid), true)
  const activeProgress = getHeroGearSetProgress(campaign, knight)
  {
    const c = fakeCanvas2dContext()
    drawGearSetBanner(c.ctx, { x: 8, y: 8, width: 350, height: 22 }, activeProgress, true)
    assert.ok(c.texts.some(t => t.includes('2/2 SOLIS')))
    assert.ok(c.texts.some(t => t.includes('Solar Resonance')))
  }

  const breakDiff = computeEquipmentStatDiff(campaign, knight.uid, ironPlate.uid)!
  {
    const c = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(c.ctx, { x: 6, y: 6, width: 740, height: 82 }, breakDiff)
    assert.ok(c.texts.some(t => t.includes('Loses 2pc Solis')))
  }

  const battle = startChapterBattle(state, 0, 0, { deployPhase: false })
  const knightUnit = battle.units.find(u => u.uid === knight.uid)!
  {
    const c = fakeCanvas2dContext()
    drawUnitCard(c.ctx, { x: 8, y: 8, width: 260, height: 96 }, knightUnit, undefined, knightUnit.speed, 'Knight')
    assert.ok(c.texts.includes('2pc SOLIS'), 'Battle Unit Card should render 2pc SOLIS badge')
  }
})
