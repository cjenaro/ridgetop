import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasWidgetDrawState } from 'ridgetop/ui'
import { EQUIPMENT_BY_ID, HERO_SPECS, RARITY_META } from '../examples/crownshard/crownshard/data.ts'
import {
  bulkSalvageCommonDupes, canMergeHero, createInitialState, equipItem, findBulkSalvageableCommonDupes,
  findEquipOwner, getEquipmentByUid, getHeroByUid, getMergeCandidates, hydrateSave, isEquipLocked, isHeroLocked,
  loadSave, mergeHero, persistSave, previewBulkSalvageCommonDupes, salvageEquipCard, salvageHeroCard,
  serializeSave, toggleEquipLock, toggleHeroLock
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type { OwnedEquipCard, OwnedHeroCard, SaveData } from '../examples/crownshard/crownshard/types.ts'
import {
  drawEquipCard, drawHeroHeader, drawHeroRosterCard, drawIcon
} from '../examples/crownshard/crownshard/ui-art.ts'

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) }
  }
}

function fakeCanvasCtx(drawnTexts: string[] = []): {
  ctx: CanvasRenderingContext2D
  arcs: number
  fills: number
  strokes: number
} {
  let arcs = 0
  let fills = 0
  let strokes = 0
  const grad = { addColorStop() {} }
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() { arcs++ },
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    ellipse() {},
    rect() {},
    clip() {},
    fill() { fills++ },
    stroke() { strokes++ },
    fillRect() {},
    strokeRect() {},
    fillText(text: string) { drawnTexts.push(text) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return {
    ctx,
    get arcs() { return arcs },
    get fills() { return fills },
    get strokes() { return strokes }
  }
}

const IDLE_WIDGET_STATE: CanvasWidgetDrawState = {
  hovered: false,
  pressed: false,
  focused: false,
  selected: false,
  disabled: false
}

test('toggleEquipLock & toggleHeroLock toggle cleanly and block salvaging locked items/heroes', () => {
  const state = createInitialState(4201)
  const sword = state.campaign.equipment[0]
  const archer = state.campaign.heroes[1]

  // Invalid UIDs safely return false
  assert.equal(toggleEquipLock(state, 'missing_eq'), false)
  assert.equal(toggleHeroLock(state, 'missing_hero'), false)

  // Toggle equipment lock on -> off -> on
  assert.equal(isEquipLocked(sword), false)
  assert.equal(toggleEquipLock(state, sword.uid), true)
  assert.equal(sword.locked, true)
  assert.equal(isEquipLocked(sword), true)

  const goldBeforeEquipSalvage = state.campaign.gold
  const soundsBeforeEquipSalvage = state.sounds.length
  assert.equal(salvageEquipCard(state, sword.uid), 0, 'Locked equipment must refuse to salvage')
  assert.equal(state.campaign.gold, goldBeforeEquipSalvage)
  assert.ok(getEquipmentByUid(state.campaign, sword.uid), 'Locked equipment must remain in inventory')
  assert.equal(state.sounds.length, soundsBeforeEquipSalvage, 'Refused salvage must not emit coin sound')

  // Unlocking allows salvage again
  assert.equal(toggleEquipLock(state, sword.uid), true)
  assert.equal(sword.locked, false)
  const earnedEquip = salvageEquipCard(state, sword.uid)
  assert.equal(earnedEquip, RARITY_META.common.salvage)
  assert.equal(state.campaign.gold, goldBeforeEquipSalvage + earnedEquip)
  assert.equal(getEquipmentByUid(state.campaign, sword.uid), undefined)

  // Toggle hero lock on -> blocks salvageHeroCard -> unlock -> allows salvageHeroCard
  assert.equal(isHeroLocked(archer), false)
  assert.equal(toggleHeroLock(state, archer.uid), true)
  assert.equal(archer.locked, true)
  assert.equal(isHeroLocked(archer), true)

  const goldBeforeHeroSalvage = state.campaign.gold
  const heroCountBefore = state.campaign.heroes.length
  assert.equal(salvageHeroCard(state, archer.uid), 0, 'Locked hero must refuse to salvage')
  assert.equal(state.campaign.gold, goldBeforeHeroSalvage)
  assert.equal(state.campaign.heroes.length, heroCountBefore)
  assert.ok(getHeroByUid(state.campaign, archer.uid))

  // Unlocking hero allows salvage
  assert.equal(toggleHeroLock(state, archer.uid), true)
  assert.equal(archer.locked, false)
  const earnedHero = salvageHeroCard(state, archer.uid)
  assert.equal(earnedHero, RARITY_META[HERO_SPECS[archer.heroId].rarity].salvage)
  assert.equal(state.campaign.heroes.length, heroCountBefore - 1)
})

test('mergeHero never consumes locked fodder copies, while a locked target hero can still ascend', () => {
  const state = createInitialState(4202)
  const knight1 = state.campaign.heroes[0]
  assert.equal(knight1.heroId, 'knight')

  // Add 2 extra 1* knights (total 3 copies)
  const knight2: OwnedHeroCard = {
    uid: 'hero_extra_1', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null
  }
  const knight3: OwnedHeroCard = {
    uid: 'hero_extra_2', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null
  }
  state.campaign.heroes.push(knight2, knight3)
  assert.equal(canMergeHero(state.campaign, knight1.uid), true)

  // Lock knight2 (fodder copy) -> only 2 eligible copies remain (target + knight3), so merge must be blocked!
  assert.equal(toggleHeroLock(state, knight2.uid), true)
  assert.equal(getMergeCandidates(state.campaign, knight1.uid).length, 2)
  assert.equal(canMergeHero(state.campaign, knight1.uid), false)
  assert.equal(mergeHero(state, knight1.uid), false, 'mergeHero must not consume locked fodder copies')
  assert.equal(knight1.stars, 1)
  assert.ok(getHeroByUid(state.campaign, knight2.uid), 'Locked fodder must remain intact')

  // Lock the TARGET knight1 AND add a 3rd unlocked copy (knight4) -> locked target CAN ascend using unlocked knight3 & knight4!
  assert.equal(toggleHeroLock(state, knight1.uid), true)
  const knight4: OwnedHeroCard = {
    uid: 'hero_extra_3', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null
  }
  state.campaign.heroes.push(knight4)

  const candidates = getMergeCandidates(state.campaign, knight1.uid)
  assert.equal(candidates.length, 3, 'Candidates should include locked target + 2 unlocked fodder copies')
  assert.equal(candidates[0].uid, knight1.uid)
  assert.ok(!candidates.some(c => c.uid === knight2.uid), 'Locked fodder must never appear in merge candidates')
  assert.equal(canMergeHero(state.campaign, knight1.uid), true)

  assert.equal(mergeHero(state, knight1.uid), true, 'Locked target hero must still be able to ascend')
  assert.equal(knight1.stars, 2)
  assert.equal(knight1.locked, true, 'Target hero lock must be preserved after ascension')
  assert.ok(getHeroByUid(state.campaign, knight2.uid), 'Locked fodder copy must survive merge untouched')
  assert.equal(getHeroByUid(state.campaign, knight3.uid), undefined)
  assert.equal(getHeroByUid(state.campaign, knight4.uid), undefined)
})

test('findBulkSalvageableCommonDupes & bulkSalvageCommonDupes salvage only excess unlocked unequipped common dupes', () => {
  const state = createInitialState(4203)
  const { campaign } = state
  // Initial campaign has 1 equipped iron_sword, 1 equipped hunter_bow, 1 equipped leather_jerkin.
  assert.deepEqual(findBulkSalvageableCommonDupes(campaign), [])
  assert.deepEqual(previewBulkSalvageCommonDupes(campaign), { count: 0, totalGold: 0, totalDust: 0, equipUids: [] })

  // Safe no-op when nothing qualifies
  const goldInit = campaign.gold
  const soundsInit = state.sounds.length
  assert.deepEqual(bulkSalvageCommonDupes(state), { salvagedCount: 0, totalGold: 0, totalDust: 0 })
  assert.equal(campaign.gold, goldInit)
  assert.equal(state.sounds.length, soundsInit)

  // Populate diverse inventory:
  // 1) iron_sword: 1 already equipped (starter) + 2 unlocked unequipped dupes + 1 locked unequipped dupe
  //    -> Expect BOTH unlocked unequipped dupes salvaged (equipped copy satisfies keep-1), locked copy spared!
  const swDupe1: OwnedEquipCard = { uid: 'eq_sw_dupe_1', equipId: 'iron_sword', slot: 'weapon' }
  const swDupe2: OwnedEquipCard = { uid: 'eq_sw_dupe_2', equipId: 'iron_sword', slot: 'weapon' }
  const swLocked: OwnedEquipCard = { uid: 'eq_sw_locked', equipId: 'iron_sword', slot: 'weapon', locked: true }

  // 2) iron_plate (Common, none equipped): 3 unlocked unequipped copies
  //    -> Expect 1st copy kept, 2nd & 3rd salvaged (2 salvaged)
  const plate1: OwnedEquipCard = { uid: 'eq_plate_1', equipId: 'iron_plate', slot: 'armor' }
  const plate2: OwnedEquipCard = { uid: 'eq_plate_2', equipId: 'iron_plate', slot: 'armor' }
  const plate3: OwnedEquipCard = { uid: 'eq_plate_3', equipId: 'iron_plate', slot: 'armor' }

  // 3) copper_signet (Common, none equipped): 1 unlocked + 1 locked + 1 unlocked
  //    -> Locked copy satisfies keep-1, so BOTH unlocked copies are excess dupes (2 salvaged), locked spared!
  const sig1: OwnedEquipCard = { uid: 'eq_sig_1', equipId: 'copper_signet', slot: 'relic' }
  const sigLocked: OwnedEquipCard = { uid: 'eq_sig_locked', equipId: 'copper_signet', slot: 'relic', locked: true }
  const sig2: OwnedEquipCard = { uid: 'eq_sig_2', equipId: 'copper_signet', slot: 'relic' }

  // 4) Single unequipped Common item (hunter_bow already equipped, so test unequipped single by unequipping?
  //    Instead verify plate1 survives, and add 1 extra hunter_bow equipped on mage? Wait: also check unequipped single!)
  //    Let's test higher rarities with 3 copies each — NONE should ever be salvaged:
  const unc1: OwnedEquipCard = { uid: 'eq_unc_1', equipId: 'ember_wand', slot: 'weapon' }
  const unc2: OwnedEquipCard = { uid: 'eq_unc_2', equipId: 'ember_wand', slot: 'weapon' }
  const rare1: OwnedEquipCard = { uid: 'eq_rare_1', equipId: 'sunsteel_blade', slot: 'weapon' }
  const rare2: OwnedEquipCard = { uid: 'eq_rare_2', equipId: 'sunsteel_blade', slot: 'weapon' }
  const epic1: OwnedEquipCard = { uid: 'eq_epic_1', equipId: 'dragonfang_spear', slot: 'weapon' }
  const epic2: OwnedEquipCard = { uid: 'eq_epic_2', equipId: 'dragonfang_spear', slot: 'weapon' }
  const leg1: OwnedEquipCard = { uid: 'eq_leg_1', equipId: 'solis_crownblade', slot: 'weapon' }
  const leg2: OwnedEquipCard = { uid: 'eq_leg_2', equipId: 'solis_crownblade', slot: 'weapon' }

  // 5) Equip another iron_sword copy onto Mage so we also confirm equipped copies are NEVER touched
  const swEquippedOnMage: OwnedEquipCard = { uid: 'eq_sw_mage', equipId: 'iron_sword', slot: 'weapon' }

  campaign.equipment.push(
    swDupe1, swDupe2, swLocked, swEquippedOnMage,
    plate1, plate2, plate3,
    sig1, sigLocked, sig2,
    unc1, unc2, rare1, rare2, epic1, epic2, leg1, leg2
  )
  equipItem(state, campaign.heroes[2].uid, swEquippedOnMage.uid)
  assert.ok(findEquipOwner(campaign, swEquippedOnMage.uid))

  // Verify rarities in data.ts match expectations
  assert.equal(EQUIPMENT_BY_ID.ember_wand.rarity, 'uncommon')
  assert.equal(EQUIPMENT_BY_ID.sunsteel_blade.rarity, 'rare')
  assert.equal(EQUIPMENT_BY_ID.dragonfang_spear.rarity, 'epic')
  assert.equal(EQUIPMENT_BY_ID.solis_crownblade.rarity, 'legendary')

  const expectedUids = [
    swDupe1.uid,
    swDupe2.uid,
    plate2.uid,
    plate3.uid,
    sig1.uid,
    sig2.uid
  ]
  const expectedGold = expectedUids.length * RARITY_META.common.salvage
  const expectedDust = expectedUids.length * 10

  const found = findBulkSalvageableCommonDupes(campaign)
  assert.deepEqual(found.map(i => i.uid), expectedUids)

  const preview = previewBulkSalvageCommonDupes(campaign)
  assert.equal(preview.count, expectedUids.length)
  assert.equal(preview.totalGold, expectedGold)
  assert.equal(preview.totalDust, expectedDust)
  assert.deepEqual(preview.equipUids, expectedUids)

  const goldBefore = campaign.gold
  const dustBefore = campaign.dust
  state.sounds = []
  const result = bulkSalvageCommonDupes(state)
  assert.deepEqual(result, { salvagedCount: expectedUids.length, totalGold: expectedGold, totalDust: expectedDust })
  assert.equal(campaign.gold, goldBefore + expectedGold)
  assert.equal(campaign.dust, dustBefore + expectedDust)
  assert.deepEqual(state.sounds, [{ kind: 'coin' }], 'Bulk salvage should emit a single coalesced coin sound')

  // Verify all salvaged UIDs are gone
  for (const uid of expectedUids) {
    assert.equal(getEquipmentByUid(campaign, uid), undefined, `Expected ${uid} to be salvaged`)
  }

  // Verify protected items remain untouched
  for (const keepUid of [
    swLocked.uid, swEquippedOnMage.uid,
    plate1.uid, sigLocked.uid,
    unc1.uid, unc2.uid, rare1.uid, rare2.uid, epic1.uid, epic2.uid, leg1.uid, leg2.uid
  ]) {
    assert.ok(getEquipmentByUid(campaign, keepUid), `Expected ${keepUid} to be preserved`)
  }

  // Re-running bulk salvage immediately must be a safe no-op (never salvages the last remaining copy of iron_plate!)
  assert.deepEqual(findBulkSalvageableCommonDupes(campaign), [])
  assert.deepEqual(bulkSalvageCommonDupes(state), { salvagedCount: 0, totalGold: 0, totalDust: 0 })
  assert.ok(getEquipmentByUid(campaign, plate1.uid), 'Last remaining copy of iron_plate must never be salvaged')
})

test('Save/load round-trip preserves locked state on heroes and equipment and stays backwards-compatible with legacy saves', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(4204)
  const knight = state.campaign.heroes[0]
  const archer = state.campaign.heroes[1]
  const sword = state.campaign.equipment[0]
  const bow = state.campaign.equipment[1]

  assert.equal(toggleHeroLock(state, knight.uid), true)
  assert.equal(toggleEquipLock(state, sword.uid), true)

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded, 'Persisted save must load cleanly')
  assert.equal(loaded.campaign.heroes.find(h => h.uid === knight.uid)?.locked, true)
  assert.equal(loaded.campaign.heroes.find(h => h.uid === archer.uid)?.locked, false)
  assert.equal(loaded.campaign.equipment.find(e => e.uid === sword.uid)?.locked, true)
  assert.equal(loaded.campaign.equipment.find(e => e.uid === bow.uid)?.locked, false)

  // Hydrate into a fresh GameState and verify lock protection still holds!
  const restored = createInitialState(9999, loaded)
  assert.equal(getHeroByUid(restored.campaign, knight.uid)?.locked, true)
  assert.equal(getHeroByUid(restored.campaign, archer.uid)?.locked, false)
  assert.equal(getEquipmentByUid(restored.campaign, sword.uid)?.locked, true)
  assert.equal(getEquipmentByUid(restored.campaign, bow.uid)?.locked, false)
  assert.equal(salvageEquipCard(restored, sword.uid), 0, 'Restored locked equipment must stay protected')
  assert.equal(salvageHeroCard(restored, knight.uid), 0, 'Restored locked hero must stay protected')

  // Legacy v1 save without any `locked` field anywhere on heroes or equipment
  const baseSave = serializeSave(createInitialState(4205))
  const legacyRaw = JSON.parse(JSON.stringify(baseSave)) as SaveData
  for (const h of legacyRaw.campaign.heroes) delete h.locked
  for (const e of legacyRaw.campaign.equipment) delete e.locked

  const legacyStorage = createMemoryStorage()
  legacyStorage.setItem('ridgetop.crownshard.save.v1', JSON.stringify(legacyRaw))
  const loadedLegacy = loadSave(legacyStorage)
  assert.ok(loadedLegacy, 'Legacy save without locked fields must load cleanly')
  for (const h of loadedLegacy.campaign.heroes) {
    assert.equal(h.locked, false, 'Legacy heroes must default locked to false')
  }
  for (const e of loadedLegacy.campaign.equipment) {
    assert.equal(e.locked, false, 'Legacy equipment must default locked to false')
  }

  const hydratedLegacy = createInitialState(1111)
  assert.equal(hydrateSave(hydratedLegacy, loadedLegacy), true)
  for (const h of hydratedLegacy.campaign.heroes) {
    assert.equal(h.locked, false)
  }
  for (const e of hydratedLegacy.campaign.equipment) {
    assert.equal(e.locked, false)
  }
})

test('drawEquipCard, drawHeroRosterCard, drawHeroHeader, and drawIcon render locked indicators cleanly without throwing', () => {
  const state = createInitialState(4206)
  const hero = state.campaign.heroes[0]
  const heroSpec = HERO_SPECS[hero.heroId]
  const equipSpec = EQUIPMENT_BY_ID.solis_crownblade

  // 1. drawEquipCard: unlocked vs locked (Armory width + narrow slot + empty slot)
  const unlockedEquipMock = fakeCanvasCtx()
  drawEquipCard(
    unlockedEquipMock.ctx,
    { x: 0, y: 0, width: 280, height: 52 },
    { slot: 'weapon', spec: equipSpec, ownerText: 'Bag', locked: false },
    IDLE_WIDGET_STATE
  )
  const lockedEquipMock = fakeCanvasCtx()
  drawEquipCard(
    lockedEquipMock.ctx,
    { x: 0, y: 0, width: 280, height: 52 },
    { slot: 'weapon', spec: equipSpec, ownerText: 'Bag', locked: true },
    IDLE_WIDGET_STATE
  )
  assert.ok(
    lockedEquipMock.arcs > unlockedEquipMock.arcs,
    'Locked equip card should draw the golden lock medallion and padlock shackle'
  )

  // Narrow slot locked & empty slot
  const narrowLockedMock = fakeCanvasCtx()
  drawEquipCard(
    narrowLockedMock.ctx,
    { x: 0, y: 0, width: 100, height: 48 },
    { slot: 'weapon', spec: equipSpec, locked: true },
    IDLE_WIDGET_STATE
  )
  assert.ok(narrowLockedMock.arcs > 0)
  drawEquipCard(
    narrowLockedMock.ctx,
    { x: 0, y: 0, width: 100, height: 48 },
    { slot: 'relic' },
    IDLE_WIDGET_STATE
  )

  // 2. drawHeroRosterCard: unlocked vs locked (full card + mobile token mode)
  const unlockedHeroMock = fakeCanvasCtx()
  drawHeroRosterCard(
    unlockedHeroMock.ctx,
    { x: 0, y: 0, width: 220, height: 48 },
    { hero: { ...hero, locked: false }, spec: heroSpec, inSquad: true, copies: 1, need: 3, readyMerge: false },
    IDLE_WIDGET_STATE
  )
  const lockedHeroMock = fakeCanvasCtx()
  drawHeroRosterCard(
    lockedHeroMock.ctx,
    { x: 0, y: 0, width: 220, height: 48 },
    { hero: { ...hero, locked: true }, spec: heroSpec, inSquad: true, copies: 1, need: 3, readyMerge: false },
    IDLE_WIDGET_STATE
  )
  assert.ok(
    lockedHeroMock.arcs > unlockedHeroMock.arcs,
    'Locked hero roster card should draw the golden lock medallion and padlock shackle'
  )

  const tokenLockedMock = fakeCanvasCtx()
  drawHeroRosterCard(
    tokenLockedMock.ctx,
    { x: 0, y: 0, width: 58, height: 64 },
    { hero: { ...hero, locked: true }, spec: heroSpec, inSquad: true, copies: 1, need: 3, readyMerge: true, token: true },
    IDLE_WIDGET_STATE
  )
  assert.ok(tokenLockedMock.arcs >= 3)

  // 3. drawHeroHeader: locked renders LOCKED badge
  const headerTexts: string[] = []
  const headerMock = fakeCanvasCtx(headerTexts)
  drawHeroHeader(
    headerMock.ctx,
    { x: 0, y: 0, width: 420, height: 50 },
    { name: heroSpec.name, title: heroSpec.title, stars: hero.stars, rarity: heroSpec.rarity, power: 150, inSquad: true, locked: true }
  )
  assert.ok(headerTexts.includes('LOCKED'), `drawHeroHeader must draw LOCKED chip when locked (saw: ${headerTexts.join(', ')})`)

  // 4. drawIcon lock & unlock
  const iconMock = fakeCanvasCtx()
  drawIcon(iconMock.ctx, 'lock', 12, 12, 14, '#ffc83b')
  drawIcon(iconMock.ctx, 'unlock', 32, 12, 14, '#b8c7e6')
  assert.ok(iconMock.arcs >= 2 && iconMock.fills >= 2 && iconMock.strokes >= 2)
})
