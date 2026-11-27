import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasWidgetDrawState } from 'ridgetop/ui'
import { computeEquipmentStatDiff } from '../examples/crownshard/crownshard/armory-diff.ts'
import { EQUIPMENT_BY_ID, EQUIPMENT_LIST, RARITY_META } from '../examples/crownshard/crownshard/data.ts'
import { getEquipSalvageDust } from '../examples/crownshard/crownshard/forge.ts'
import {
  MAX_EQUIP_UPGRADE,
  computeUpgradedEquipStats,
  countUpgradedEquipment,
  findEligibleFuseDuplicate,
  formatEquipDisplayName,
  formatUpgradedEquipSummary,
  getEquipUpgradeCosts,
  getEquipUpgradePreview,
  getUpgradedEquipSalvageYield,
  normalizeEquipUpgradeLevel,
  upgradeEquipWithDuplicate,
  upgradeEquipWithGold
} from '../examples/crownshard/crownshard/gear-upgrade.ts'
import {
  bulkSalvageCommonDupes,
  computeHeroStats,
  createInitialState,
  equipItem,
  findBestFitUpgrades,
  findBulkSalvageableCommonDupes,
  getEquipmentByUid,
  hydrateSave,
  loadSave,
  persistSave,
  previewBulkSalvageCommonDupes,
  restoreBattleState,
  salvageEquipCard,
  serializeBattleState,
  serializeSave,
  startChapterBattle,
  toggleEquipLock
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type { CampaignState, OwnedEquipCard, SaveData } from '../examples/crownshard/crownshard/types.ts'
import { drawArmoryTemperBar, drawEquipCard } from '../examples/crownshard/crownshard/ui-art.ts'

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) }
  }
}

function addEquip(
  campaign: CampaignState,
  equipId: string,
  opts: { upgradeLevel?: number; locked?: boolean } = {}
): OwnedEquipCard {
  const spec = EQUIPMENT_BY_ID[equipId]
  assert.ok(spec, `Unknown equipment id: ${equipId}`)
  const card: OwnedEquipCard = {
    uid: `eq_test_${campaign.nextUid++}`,
    equipId: spec.id,
    slot: spec.slot,
    ...(opts.upgradeLevel !== undefined ? { upgradeLevel: opts.upgradeLevel } : {}),
    ...(opts.locked ? { locked: true } : {})
  }
  campaign.equipment.push(card)
  return card
}

function fakeCanvasCtx(): { ctx: CanvasRenderingContext2D; texts: string[]; get ops(): number } {
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
    arc() { ops++ },
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
    measureText(s: string) { return { width: s.length * 6.2 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

const IDLE_WIDGET_STATE: CanvasWidgetDrawState = {
  hovered: false,
  pressed: false,
  focused: false,
  selected: false,
  disabled: false
}

test('base +0 stats match original EquipmentSpec identically and normalizeEquipUpgradeLevel clamps safely', () => {
  assert.equal(normalizeEquipUpgradeLevel(undefined), 0)
  assert.equal(normalizeEquipUpgradeLevel(null), 0)
  assert.equal(normalizeEquipUpgradeLevel('3'), 0)
  assert.equal(normalizeEquipUpgradeLevel(Number.NaN), 0)
  assert.equal(normalizeEquipUpgradeLevel(Number.POSITIVE_INFINITY), 0)
  assert.equal(normalizeEquipUpgradeLevel(-5), 0)
  assert.equal(normalizeEquipUpgradeLevel(0), 0)
  assert.equal(normalizeEquipUpgradeLevel(2.9), 2)
  assert.equal(normalizeEquipUpgradeLevel(5), 5)
  assert.equal(normalizeEquipUpgradeLevel(99), MAX_EQUIP_UPGRADE)

  for (const spec of EQUIPMENT_LIST) {
    const base = computeUpgradedEquipStats(spec, 0)
    assert.equal(base.atk, spec.atk, `${spec.id} +0 atk`)
    assert.equal(base.def, spec.def, `${spec.id} +0 def`)
    assert.equal(base.hp, spec.hp, `${spec.id} +0 hp`)
    assert.equal(base.speed, spec.speed, `${spec.id} +0 speed`)
    assert.equal(base.move, spec.move, `${spec.id} +0 move`)
    assert.equal(base.jump, spec.jump ?? 0, `${spec.id} +0 jump`)
    assert.equal(base.range, spec.range, `${spec.id} +0 range`)
    assert.equal(base.crit, spec.crit, `${spec.id} +0 crit`)
    assert.equal(base.lifesteal, spec.lifesteal, `${spec.id} +0 lifesteal`)
    assert.equal(base.shieldStart, spec.shieldStart, `${spec.id} +0 shieldStart`)
    assert.equal(formatEquipDisplayName(spec, 0), spec.name)
    assert.equal(formatEquipDisplayName(spec, 3), `${spec.name} +3`)

    // Verify strictly non-decreasing stats across +0 -> +5 and strict increase on non-zero primary stats
    let prev = base
    for (let lvl = 1; lvl <= MAX_EQUIP_UPGRADE; lvl++) {
      const next = computeUpgradedEquipStats(spec, lvl)
      if (spec.atk > 0) assert.ok(next.atk >= prev.atk + 1, `${spec.id} +${lvl} atk should increase`)
      if (spec.def > 0) assert.ok(next.def >= prev.def + 1, `${spec.id} +${lvl} def should increase`)
      if (spec.hp > 0) assert.ok(next.hp >= prev.hp + 3, `${spec.id} +${lvl} hp should increase`)
      if (spec.shieldStart > 0) assert.ok(next.shieldStart >= prev.shieldStart + 2, `${spec.id} +${lvl} shieldStart`)
      if (spec.crit > 0) assert.ok(next.crit > prev.crit, `${spec.id} +${lvl} crit should increase`)
      if (spec.lifesteal > 0) assert.ok(next.lifesteal > prev.lifesteal, `${spec.id} +${lvl} lifesteal should increase`)
      prev = next
    }
  }
})

test('duplicate fusion upgrades +0 -> +5, respects locks/equipped fodder, prefers lowest level dupe, and boosts hero stats', () => {
  const state = createInitialState(5101)
  const { campaign } = state
  campaign.gold = 2000

  const knight = campaign.heroes[0]
  const targetSword = getEquipmentByUid(campaign, knight.weaponUid)!
  assert.equal(targetSword.equipId, 'iron_sword')

  // Lock the TARGET sword — a locked & equipped target MUST still be temperable!
  assert.equal(toggleEquipLock(state, targetSword.uid), true)

  // Add fodder copies:
  // - 1 locked duplicate (must NEVER be consumed)
  // - 1 equipped duplicate on a second Vanguard hero (must NEVER be consumed)
  // - 1 different weapon (must NEVER be consumed)
  // - 5 eligible unlocked unequipped duplicates (including one already +2 to verify lowest-level preference!)
  const lockedDupe = addEquip(campaign, 'iron_sword', { locked: true })
  const paladin = {
    uid: `hero_test_${campaign.nextUid++}`,
    heroId: 'paladin' as const,
    stars: 1 as const,
    level: 1,
    xp: 0,
    weaponUid: null as string | null,
    armorUid: null,
    relicUid: null
  }
  campaign.heroes.push(paladin)
  const equippedDupe = addEquip(campaign, 'iron_sword')
  assert.equal(equipItem(state, paladin.uid, equippedDupe.uid), true)
  const otherWeapon = addEquip(campaign, 'sunsteel_blade')

  const boostedDupe = addEquip(campaign, 'iron_sword', { upgradeLevel: 2 })
  const baseDupes = [
    addEquip(campaign, 'iron_sword'),
    addEquip(campaign, 'iron_sword'),
    addEquip(campaign, 'iron_sword'),
    addEquip(campaign, 'iron_sword')
  ]

  // Lowest-level (+0) duplicate must be chosen before the +2 duplicate
  const firstCandidate = findEligibleFuseDuplicate(campaign, targetSword.uid)
  assert.ok(firstCandidate)
  assert.equal(normalizeEquipUpgradeLevel(firstCandidate.upgradeLevel), 0)
  assert.notEqual(firstCandidate.uid, boostedDupe.uid)

  const baseHeroStats = computeHeroStats(campaign, knight)
  let prevHeroStats = baseHeroStats

  // Fuse 5 times: +0 -> +1 -> +2 -> +3 -> +4 -> +5
  for (let expectedLevel = 1; expectedLevel <= MAX_EQUIP_UPGRADE; expectedLevel++) {
    const preview = getEquipUpgradePreview(campaign, targetSword.uid)
    assert.ok(preview)
    assert.equal(preview.currentLevel, expectedLevel - 1)
    assert.equal(preview.nextLevel, expectedLevel)
    assert.equal(preview.isMaxLevel, false)
    assert.equal(preview.canFuseDuplicate, true)
    assert.equal(preview.eligibleDuplicateCount, 6 - expectedLevel)

    const goldBefore = campaign.gold
    const soundsBefore = state.sounds.length
    const res = upgradeEquipWithDuplicate(state, targetSword.uid)
    assert.ok(res, `Expected duplicate fusion to +${expectedLevel} to succeed`)
    assert.equal(res.method, 'duplicate')
    assert.equal(res.oldLevel, expectedLevel - 1)
    assert.equal(res.newLevel, expectedLevel)
    assert.equal(res.goldSpent, preview.fuseGoldCost)
    assert.equal(campaign.gold, goldBefore - preview.fuseGoldCost)
    assert.equal(targetSword.upgradeLevel, expectedLevel)
    assert.equal(res.displayName, `Iron Broadsword +${expectedLevel}`)
    assert.equal(state.sounds.length, soundsBefore + 1)
    assert.equal(state.sounds[state.sounds.length - 1].kind, 'merge')
    assert.equal(getEquipmentByUid(campaign, res.consumedDuplicateUid), undefined)

    // First 4 fusions must consume the +0 dupes, saving the +2 dupe until the 5th fusion
    if (expectedLevel <= 4) {
      assert.ok(baseDupes.some(d => d.uid === res.consumedDuplicateUid))
      assert.ok(getEquipmentByUid(campaign, boostedDupe.uid), '+2 dupe must be spared while +0 dupes exist')
    } else {
      assert.equal(res.consumedDuplicateUid, boostedDupe.uid)
    }

    const nextHeroStats = computeHeroStats(campaign, knight)
    assert.ok(nextHeroStats.atk > prevHeroStats.atk, `Hero ATK must increase at +${expectedLevel}`)
    assert.ok(nextHeroStats.crit > prevHeroStats.crit, `Hero CRIT must increase at +${expectedLevel}`)
    assert.ok(nextHeroStats.powerScore > prevHeroStats.powerScore, `Hero Power must increase at +${expectedLevel}`)
    prevHeroStats = nextHeroStats
  }

  // Protected items must still be completely untouched
  assert.ok(getEquipmentByUid(campaign, lockedDupe.uid), 'Locked duplicate must never be consumed')
  assert.ok(getEquipmentByUid(campaign, equippedDupe.uid), 'Equipped duplicate must never be consumed')
  assert.equal(paladin.weaponUid, equippedDupe.uid)
  assert.ok(getEquipmentByUid(campaign, otherWeapon.uid), 'Unrelated weapon must never be consumed')

  // Attempting to fuse past +5 fails cleanly even if another dupe is added
  addEquip(campaign, 'iron_sword')
  const maxPreview = getEquipUpgradePreview(campaign, targetSword.uid)!
  assert.equal(maxPreview.isMaxLevel, true)
  assert.equal(maxPreview.canFuseDuplicate, false)
  assert.equal(maxPreview.canGoldReforge, false)
  assert.equal(upgradeEquipWithDuplicate(state, targetSword.uid), null)
  assert.equal(targetSword.upgradeLevel, MAX_EQUIP_UPGRADE)
})

test('gold reforge deducts exact gold across weapon/armor/relic and rejects insufficient gold or +5 cap', () => {
  const state = createInitialState(5102)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const relic = addEquip(campaign, 'heart_of_solis')
  const armor = addEquip(campaign, 'iron_plate')
  assert.equal(equipItem(state, knight.uid, armor.uid), true)
  assert.equal(equipItem(state, knight.uid, relic.uid), true)

  const relicSpec = EQUIPMENT_BY_ID.heart_of_solis
  const costsLvl0 = getEquipUpgradeCosts(relicSpec, 0)!
  assert.ok(costsLvl0.reforgeGoldCost > costsLvl0.fuseGoldCost)

  // Insufficient gold -> fails without mutating gold, level, or sounds
  campaign.gold = costsLvl0.reforgeGoldCost - 1
  const soundsBeforeFail = state.sounds.length
  const previewLowGold = getEquipUpgradePreview(campaign, relic.uid)!
  assert.equal(previewLowGold.canGoldReforge, false)
  assert.equal(upgradeEquipWithGold(state, relic.uid), null)
  assert.equal(campaign.gold, costsLvl0.reforgeGoldCost - 1)
  assert.equal(normalizeEquipUpgradeLevel(relic.upgradeLevel), 0)
  assert.equal(state.sounds.length, soundsBeforeFail)

  // Exact gold to reforge relic all the way from +0 -> +5
  const knightBefore = computeHeroStats(campaign, knight)
  campaign.gold = 5000
  for (let lvl = 1; lvl <= MAX_EQUIP_UPGRADE; lvl++) {
    const expectedCost = getEquipUpgradeCosts(relicSpec, lvl - 1)!.reforgeGoldCost
    const goldBefore = campaign.gold
    const res = upgradeEquipWithGold(state, relic.uid)
    assert.ok(res)
    assert.equal(res.method, 'gold')
    assert.equal(res.newLevel, lvl)
    assert.equal(res.goldSpent, expectedCost)
    assert.equal(res.consumedDuplicateUid, null)
    assert.equal(campaign.gold, goldBefore - expectedCost)
  }

  // Maxed relic rejects further gold reforge
  const goldAtMax = campaign.gold
  assert.equal(getEquipUpgradeCosts(relicSpec, MAX_EQUIP_UPGRADE), null)
  assert.equal(upgradeEquipWithGold(state, relic.uid), null)
  assert.equal(campaign.gold, goldAtMax)

  // Armor also reforges cleanly and boosts knight HP, DEF, and Shield
  const armorRes = upgradeEquipWithGold(state, armor.uid)
  assert.ok(armorRes)
  assert.equal(armorRes.newLevel, 1)
  const knightAfter = computeHeroStats(campaign, knight)
  assert.ok(knightAfter.maxHp > knightBefore.maxHp)
  assert.ok(knightAfter.atk > knightBefore.atk)
  assert.ok(knightAfter.def > knightBefore.def)
  assert.ok(knightAfter.shieldStart > knightBefore.shieldStart)
  assert.ok(knightAfter.lifesteal > knightBefore.lifesteal)
  assert.equal(countUpgradedEquipment(campaign), 2)
})

test('armory-diff reflects upgraded stats accurately and shows +N in item names', () => {
  const state = createInitialState(5103)
  const { campaign } = state
  const knight = campaign.heroes[0]
  campaign.gold = 5000

  // Knight starts with +0 iron_sword; create a second iron_sword and temper it to +3
  const temperedSword = addEquip(campaign, 'iron_sword')
  assert.ok(upgradeEquipWithGold(state, temperedSword.uid))
  assert.ok(upgradeEquipWithGold(state, temperedSword.uid))
  assert.ok(upgradeEquipWithGold(state, temperedSword.uid))
  assert.equal(temperedSword.upgradeLevel, 3)

  const diff = computeEquipmentStatDiff(campaign, knight.uid, temperedSword.uid)
  assert.ok(diff)
  assert.equal(diff.candidateName, 'Iron Broadsword +3')
  assert.equal(diff.candidateUpgradeLevel, 3)
  assert.equal(diff.currentItemName, 'Iron Broadsword')
  assert.equal(diff.currentItemUpgradeLevel, 0)
  assert.ok(diff.stats.atk.delta > 0, 'Upgraded +3 sword must show positive ATK delta vs +0 copy')
  assert.ok(diff.stats.crit.delta > 0, 'Upgraded +3 sword must show positive CRIT delta vs +0 copy')
  assert.ok(diff.netPowerDelta > 0)

  // Verify exact parity with real equipItem + computeHeroStats
  const cloned = structuredClone(state)
  assert.equal(equipItem(cloned, knight.uid, temperedSword.uid), true)
  const realAfter = computeHeroStats(cloned.campaign, cloned.campaign.heroes[0])
  assert.equal(diff.stats.atk.after, realAfter.atk)
  assert.equal(diff.stats.crit.after, Math.round(realAfter.crit * 100))
  assert.equal(diff.powerAfter, realAfter.powerScore)

  // Best Fit should recognize the +3 sword as an upgrade over the equipped +0 sword
  const bestFit = findBestFitUpgrades(campaign, knight.uid)
  assert.ok(bestFit.some(eq => eq.uid === temperedSword.uid))

  // Equip the +3 sword, then compare the +0 sword -> currentItemName has +3 and delta is negative
  const baseSwordUid = knight.weaponUid!
  assert.equal(equipItem(state, knight.uid, temperedSword.uid), true)
  const reverseDiff = computeEquipmentStatDiff(campaign, knight.uid, baseSwordUid)!
  assert.equal(reverseDiff.currentItemName, 'Iron Broadsword +3')
  assert.equal(reverseDiff.currentItemUpgradeLevel, 3)
  assert.equal(reverseDiff.candidateName, 'Iron Broadsword')
  assert.ok(reverseDiff.stats.atk.delta < 0)
  assert.ok(reverseDiff.netPowerDelta < 0)
})

test('bulk salvage never auto-salvages upgraded +1..+5 items, and manual salvage refunds bonus gold & dust', () => {
  const state = createInitialState(5104)
  const { campaign } = state
  campaign.gold = 2000

  // Add 3 unequipped unlocked common copies of iron_plate: one +0, one +1, one +4
  const plateBase1 = addEquip(campaign, 'iron_plate')
  const plateBase2 = addEquip(campaign, 'iron_plate')
  const plateUp1 = addEquip(campaign, 'iron_plate', { upgradeLevel: 1 })
  const plateUp4 = addEquip(campaign, 'iron_plate', { upgradeLevel: 4 })

  const salvageable = findBulkSalvageableCommonDupes(campaign)
  assert.equal(salvageable.some(e => e.uid === plateUp1.uid), false, '+1 common must never be bulk salvaged')
  assert.equal(salvageable.some(e => e.uid === plateUp4.uid), false, '+4 common must never be bulk salvaged')
  assert.equal(salvageable.some(e => e.uid === plateBase1.uid), true)
  assert.equal(salvageable.some(e => e.uid === plateBase2.uid), true)

  const preview = previewBulkSalvageCommonDupes(campaign)
  assert.equal(preview.count, 2)
  const res = bulkSalvageCommonDupes(state)
  assert.equal(res.salvagedCount, 2)
  assert.ok(getEquipmentByUid(campaign, plateUp1.uid), '+1 common must remain after bulk salvage')
  assert.ok(getEquipmentByUid(campaign, plateUp4.uid), '+4 common must remain after bulk salvage')

  // Manual salvage of +0 vs +4: +0 matches base rarity salvage, +4 awards bonus gold & dust
  const spec = EQUIPMENT_BY_ID.iron_plate
  const baseYield = getUpgradedEquipSalvageYield(spec, 0)
  assert.equal(baseYield.gold, RARITY_META.common.salvage)
  assert.equal(baseYield.dust, getEquipSalvageDust('common'))

  const up4Yield = getUpgradedEquipSalvageYield(spec, 4)
  assert.ok(up4Yield.gold > baseYield.gold)
  assert.ok(up4Yield.dust > baseYield.dust)

  const goldBefore = campaign.gold
  const dustBefore = campaign.dust
  const earnedGold = salvageEquipCard(state, plateUp4.uid)
  assert.equal(earnedGold, up4Yield.gold)
  assert.equal(campaign.gold, goldBefore + up4Yield.gold)
  assert.equal(campaign.dust, dustBefore + up4Yield.dust)
})

test('battle units inherit tempered equipment stats and SaveData / BattleSaveSnapshot round-trip preserves upgradeLevel', () => {
  const state = createInitialState(5105)
  const { campaign } = state
  campaign.gold = 4000

  const knight = campaign.heroes[0]
  const sword = getEquipmentByUid(campaign, knight.weaponUid)!
  const plate = addEquip(campaign, 'iron_plate')
  const signet = addEquip(campaign, 'copper_signet')
  assert.equal(equipItem(state, knight.uid, plate.uid), true)
  assert.equal(equipItem(state, knight.uid, signet.uid), true)

  const statsBeforeTemper = computeHeroStats(campaign, knight)

  // Temper weapon -> +3, armor -> +2, relic -> +1
  assert.ok(upgradeEquipWithGold(state, sword.uid))
  assert.ok(upgradeEquipWithGold(state, sword.uid))
  assert.ok(upgradeEquipWithGold(state, sword.uid))
  assert.ok(upgradeEquipWithGold(state, plate.uid))
  assert.ok(upgradeEquipWithGold(state, plate.uid))
  assert.ok(upgradeEquipWithGold(state, signet.uid))

  const statsAfterTemper = computeHeroStats(campaign, knight)
  assert.ok(statsAfterTemper.atk > statsBeforeTemper.atk)
  assert.ok(statsAfterTemper.def > statsBeforeTemper.def)
  assert.ok(statsAfterTemper.maxHp > statsBeforeTemper.maxHp)
  assert.ok(statsAfterTemper.shieldStart > statsBeforeTemper.shieldStart)

  // Start battle and verify BattleUnit inherits tempered stats and upgrade levels
  startChapterBattle(state, 0)
  assert.ok(state.battle)
  // Transition battle to player phase so serializeBattleState accepts it
  state.battle.phase = 'player'
  const knightUnit = state.battle.units.find(u => u.uid === knight.uid)!
  assert.ok(knightUnit)
  assert.equal(knightUnit.atk, statsAfterTemper.atk)
  assert.equal(knightUnit.def, statsAfterTemper.def)
  assert.equal(knightUnit.maxHp, statsAfterTemper.maxHp)
  assert.equal(knightUnit.shield, statsAfterTemper.shieldStart)
  assert.equal(knightUnit.weaponUpgrade, 3)
  assert.equal(knightUnit.armorUpgrade, 2)
  assert.equal(knightUnit.relicUpgrade, 1)

  // Round-trip BattleSaveSnapshot + Campaign SaveData through storage
  const battleSnap = serializeBattleState(state.battle, state.campaign.seed)
  assert.ok(battleSnap)
  const snapKnight = battleSnap.units.find(u => u.uid === knight.uid)!
  assert.equal(snapKnight.weaponUpgrade, 3)
  assert.equal(snapKnight.armorUpgrade, 2)
  assert.equal(snapKnight.relicUpgrade, 1)

  const storage = createMemoryStorage()
  persistSave(storage, state, battleSnap)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.ok(loaded.activeBattle)

  const fresh = createInitialState(9999)
  hydrateSave(fresh, loaded)
  const restoredSword = getEquipmentByUid(fresh.campaign, sword.uid)!
  const restoredPlate = getEquipmentByUid(fresh.campaign, plate.uid)!
  const restoredSignet = getEquipmentByUid(fresh.campaign, signet.uid)!
  assert.equal(restoredSword.upgradeLevel, 3)
  assert.equal(restoredPlate.upgradeLevel, 2)
  assert.equal(restoredSignet.upgradeLevel, 1)
  assert.deepEqual(computeHeroStats(fresh.campaign, fresh.campaign.heroes[0]), statsAfterTemper)

  assert.equal(restoreBattleState(fresh, loaded.activeBattle), true)
  const restoredUnit = fresh.battle!.units.find(u => u.uid === knight.uid)!
  assert.equal(restoredUnit.weaponUpgrade, 3)
  assert.equal(restoredUnit.armorUpgrade, 2)
  assert.equal(restoredUnit.relicUpgrade, 1)
  assert.equal(restoredUnit.atk, statsAfterTemper.atk)

  // Corrupt / out-of-range upgradeLevel values in saves are safely clamped to 0..5
  const corrupted: SaveData = structuredClone(serializeSave(state))
  corrupted.campaign.equipment[0].upgradeLevel = 99
  corrupted.campaign.equipment[1].upgradeLevel = -4
  const sanitizedState = createInitialState(1234, corrupted)
  assert.equal(sanitizedState.campaign.equipment[0].upgradeLevel, MAX_EQUIP_UPGRADE)
  assert.equal(sanitizedState.campaign.equipment[1].upgradeLevel, undefined)
})

test('drawEquipCard and drawArmoryTemperBar render +N badges and stat previews cleanly across desktop and phone widths', () => {
  const state = createInitialState(5106)
  const { campaign } = state
  campaign.gold = 1000
  const sword = campaign.equipment[0]
  const spec = EQUIPMENT_BY_ID[sword.equipId]
  assert.ok(upgradeEquipWithGold(state, sword.uid))
  assert.ok(upgradeEquipWithGold(state, sword.uid))
  assert.equal(sword.upgradeLevel, 2)

  // Standard card (Armory mobile 231px & desktop 340px)
  for (const w of [231, 340]) {
    const canvas = fakeCanvasCtx()
    drawEquipCard(
      canvas.ctx,
      { x: 0, y: 0, width: w, height: 46 },
      { slot: spec.slot, spec, upgradeLevel: sword.upgradeLevel },
      IDLE_WIDGET_STATE
    )
    assert.ok(canvas.ops > 10)
    assert.ok(canvas.texts.includes('+2'), `Width ${w}: expected +2 badge`)
    assert.ok(
      canvas.texts.some(t => t.includes(formatUpgradedEquipSummary(spec, 2))),
      `Width ${w}: expected upgraded stat summary`
    )
  }

  // Narrow slot card (Squad tab mobile equipped slot ~104px)
  {
    const canvas = fakeCanvasCtx()
    drawEquipCard(
      canvas.ctx,
      { x: 0, y: 0, width: 104, height: 44 },
      { slot: spec.slot, spec, upgradeLevel: 5 },
      IDLE_WIDGET_STATE
    )
    assert.ok(canvas.texts.includes('+5'), 'Narrow equipped slot should display +5 badge')
  }

  // Temper preview bar (+2 -> +3) at phone portrait, landscape phone, and desktop widths
  const preview = getEquipUpgradePreview(campaign, sword.uid)!
  for (const [w, h, compact] of [[363, 22, true], [440, 30, true], [460, 34, false]] as const) {
    const canvas = fakeCanvasCtx()
    drawArmoryTemperBar(canvas.ctx, { x: 0, y: 0, width: w, height: h }, preview, { compact })
    assert.ok(canvas.ops > 8)
    assert.ok(canvas.texts.includes('+2→+3'), `Width ${w}: expected +2→+3 chip`)
    assert.ok(canvas.texts.some(t => t.includes('ATK') && t.includes('→')), `Width ${w}: expected ATK before→after preview`)
  }

  // Temper preview bar at MAX +5
  sword.upgradeLevel = MAX_EQUIP_UPGRADE
  const maxPreview = getEquipUpgradePreview(campaign, sword.uid)!
  {
    const canvas = fakeCanvasCtx()
    drawArmoryTemperBar(canvas.ctx, { x: 0, y: 0, width: 363, height: 22 }, maxPreview, { compact: true })
    assert.ok(canvas.texts.includes('MAX +5'))
  }
})
