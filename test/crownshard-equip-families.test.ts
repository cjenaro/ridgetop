import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasWidgetDrawState } from '../packages/ridgetop/framework/ui.ts'
import { computeEquipmentStatDiff } from '../examples/crownshard/crownshard/armory-diff.ts'
import { EQUIPMENT_BY_ID, EQUIPMENT_LIST, HERO_LIST, RARITY_ORDER } from '../examples/crownshard/crownshard/data.ts'
import {
  EQUIP_FAMILY_META,
  EQUIP_FAMILY_ORDER,
  HERO_EQUIP_FAMILY,
  canHeroEquipItem,
  getEquipCompatibilityReason,
  getEquipFamily,
  getEquipFamilyMeta,
  getEquipShortLockLabel,
  getHeroEquipFamily,
  getHeroEquipFamilyMeta,
  sanitizeHeroEquipmentFamilies
} from '../examples/crownshard/crownshard/equip-families.ts'
import {
  SAVE_KEY,
  autoEquipBestFit,
  createInitialState,
  equipItem,
  findBestFitUpgrades,
  loadSave,
  persistSave,
  serializeSave
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type { EquipFamily, HeroClassId, SaveData } from '../examples/crownshard/crownshard/types.ts'
import {
  drawArmoryStatDiffPanel,
  drawEquipCard,
  drawEquipFamilyPill,
  drawForgeRecipeCard,
  drawHeroHeader
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
    measureText(s: string) { return { width: s.length * 6.2 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

const VANGUARD_HEROES: readonly HeroClassId[] = ['knight', 'paladin', 'champion']
const ARCANE_HEROES: readonly HeroClassId[] = ['mage', 'cleric', 'cryomancer']
const SKIRMISHER_HEROES: readonly HeroClassId[] = ['archer', 'rogue']

test('Hero and Equipment family mappings cover all 8 hero classes and all 33 equipment items cleanly', () => {
  assert.deepEqual(EQUIP_FAMILY_ORDER, ['vanguard', 'arcane', 'skirmisher', 'universal'])
  assert.equal(HERO_LIST.length, 8)
  assert.equal(Object.keys(HERO_EQUIP_FAMILY).length, 8)

  for (const heroId of VANGUARD_HEROES) {
    assert.equal(getHeroEquipFamily(heroId), 'vanguard')
    assert.equal(getHeroEquipFamilyMeta(heroId).shortLabel, 'Swords/Plate')
  }
  for (const heroId of ARCANE_HEROES) {
    assert.equal(getHeroEquipFamily(heroId), 'arcane')
    assert.equal(getHeroEquipFamilyMeta(heroId).shortLabel, 'Staves/Robes')
  }
  for (const heroId of SKIRMISHER_HEROES) {
    assert.equal(getHeroEquipFamily(heroId), 'skirmisher')
    assert.equal(getHeroEquipFamilyMeta(heroId).shortLabel, 'Bows/Light')
  }

  // Every equipment item has a valid family; all relics are universal; all non-relics belong to one of the 3 class families
  const countByFamilyAndSlot: Record<EquipFamily, { weapon: number; armor: number; relic: number }> = {
    vanguard: { weapon: 0, armor: 0, relic: 0 },
    arcane: { weapon: 0, armor: 0, relic: 0 },
    skirmisher: { weapon: 0, armor: 0, relic: 0 },
    universal: { weapon: 0, armor: 0, relic: 0 }
  }
  for (const item of EQUIPMENT_LIST) {
    const fam = getEquipFamily(item.id)
    assert.equal(fam, item.family)
    assert.ok(getEquipFamilyMeta(fam))
    if (item.slot === 'relic') {
      assert.equal(fam, 'universal', `Relic ${item.id} must be universal`)
    } else {
      assert.notEqual(fam, 'universal', `Non-relic ${item.id} must belong to a class family`)
    }
    countByFamilyAndSlot[fam][item.slot] += 1
  }

  // Balanced progression across all 3 class families (Common through Legendary weapons & armor)
  for (const fam of ['vanguard', 'arcane', 'skirmisher'] as const) {
    assert.ok(countByFamilyAndSlot[fam].weapon >= 4, `${fam} should have at least 4 weapons`)
    assert.ok(countByFamilyAndSlot[fam].armor >= 4, `${fam} should have at least 4 armor items`)
    for (const slot of ['weapon', 'armor'] as const) {
      const rarities = new Set(
        EQUIPMENT_LIST.filter(e => e.family === fam && e.slot === slot).map(e => e.rarity)
      )
      assert.ok(rarities.has('common'), `${fam} ${slot} must have Common tier`)
      assert.ok(rarities.has('rare'), `${fam} ${slot} must have Rare tier`)
      assert.ok(rarities.has('epic'), `${fam} ${slot} must have Epic tier`)
      assert.ok(rarities.has('legendary'), `${fam} ${slot} must have Legendary tier`)
    }
  }
  assert.equal(countByFamilyAndSlot.universal.relic, 5)
  assert.equal(RARITY_ORDER.length, 5)
})

test('Class-family equip rules strictly enforce Vanguard, Arcane, Skirmisher, and Universal Relic rules across all 8 heroes', () => {
  const vanguardItems = EQUIPMENT_LIST.filter(e => e.family === 'vanguard')
  const arcaneItems = EQUIPMENT_LIST.filter(e => e.family === 'arcane')
  const skirmisherItems = EQUIPMENT_LIST.filter(e => e.family === 'skirmisher')
  const relics = EQUIPMENT_LIST.filter(e => e.slot === 'relic')

  // Vanguard (Knight, Paladin, Sunblade): YES Swords/Plate & Relics, NO Staves/Robes/Bows/Light
  for (const heroId of VANGUARD_HEROES) {
    for (const item of vanguardItems) {
      assert.equal(canHeroEquipItem(heroId, item.id), true, `${heroId} must equip ${item.id}`)
      assert.equal(getEquipCompatibilityReason(heroId, item.id), null)
    }
    for (const item of [...arcaneItems, ...skirmisherItems]) {
      assert.equal(canHeroEquipItem(heroId, item.id), false, `${heroId} must NOT equip ${item.id}`)
      const reason = getEquipCompatibilityReason(heroId, item.id)
      assert.ok(reason && reason.includes(EQUIP_FAMILY_META[item.family].shortLabel))
    }
  }

  // Arcane (Mage, Cleric, Cryomancer): YES Staves/Robes & Relics, NO Swords/Plate/Bows/Light
  for (const heroId of ARCANE_HEROES) {
    for (const item of arcaneItems) {
      assert.equal(canHeroEquipItem(heroId, item.id), true, `${heroId} must equip ${item.id}`)
      assert.equal(getEquipCompatibilityReason(heroId, item.id), null)
    }
    for (const item of [...vanguardItems, ...skirmisherItems]) {
      assert.equal(canHeroEquipItem(heroId, item.id), false, `${heroId} must NOT equip ${item.id}`)
      const reason = getEquipCompatibilityReason(heroId, item.id)
      assert.ok(reason && reason.includes(EQUIP_FAMILY_META[item.family].shortLabel))
    }
  }

  // Skirmisher (Archer, Rogue): YES Bows/Light & Relics, NO Swords/Plate/Staves/Robes
  for (const heroId of SKIRMISHER_HEROES) {
    for (const item of skirmisherItems) {
      assert.equal(canHeroEquipItem(heroId, item.id), true, `${heroId} must equip ${item.id}`)
      assert.equal(getEquipCompatibilityReason(heroId, item.id), null)
    }
    for (const item of [...vanguardItems, ...arcaneItems]) {
      assert.equal(canHeroEquipItem(heroId, item.id), false, `${heroId} must NOT equip ${item.id}`)
      const reason = getEquipCompatibilityReason(heroId, item.id)
      assert.ok(reason && reason.includes(EQUIP_FAMILY_META[item.family].shortLabel))
    }
  }

  // Relics are universal for all 8 hero classes
  for (const hero of HERO_LIST) {
    for (const relic of relics) {
      assert.equal(canHeroEquipItem(hero.id, relic.id), true, `${hero.id} must equip universal relic ${relic.id}`)
      assert.equal(getEquipCompatibilityReason(hero.id, relic.id), null)
    }
  }

  // Unknown item fails closed safely
  assert.equal(canHeroEquipItem('knight', 'nonexistent_item'), false)
  assert.ok(getEquipCompatibilityReason('knight', 'nonexistent_item'))
  assert.equal(getEquipShortLockLabel('ember_wand'), 'Staves/Robes only')
  assert.equal(getEquipShortLockLabel('iron_sword'), 'Swords/Plate only')
  assert.equal(getEquipShortLockLabel('hunter_bow'), 'Bows/Light only')
  assert.equal(getEquipShortLockLabel('heart_of_solis'), 'Universal')
})

test('equipItem enforces class-family restrictions without mutating state or stealing from previous owners', () => {
  const state = createInitialState(4242)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const archer = campaign.heroes[1]
  const mage = campaign.heroes[2]

  // Starter campaign gear must already be 100% class-compatible
  for (const hero of campaign.heroes) {
    for (const uid of [hero.weaponUid, hero.armorUid, hero.relicUid]) {
      if (!uid) continue
      const eq = campaign.equipment.find(e => e.uid === uid)!
      assert.equal(
        canHeroEquipItem(hero.heroId, eq.equipId),
        true,
        `Starter hero ${hero.heroId} has incompatible starter item ${eq.equipId}`
      )
    }
  }

  // Mage cannot steal Knight's Iron Broadsword
  const knightSwordUid = knight.weaponUid!
  assert.equal(equipItem(state, mage.uid, knightSwordUid), false)
  assert.equal(knight.weaponUid, knightSwordUid, 'Failed incompatible equip must never unequip previous owner')
  assert.notEqual(mage.weaponUid, knightSwordUid)

  // Knight cannot equip Archer's Yew Longbow or Scout Brigandine
  assert.equal(equipItem(state, knight.uid, archer.weaponUid!), false)
  assert.equal(equipItem(state, knight.uid, archer.armorUid!), false)
  assert.equal(archer.weaponUid !== null, true)
  assert.equal(archer.armorUid !== null, true)

  // Archer cannot equip Mage's Apprentice Staff
  assert.equal(equipItem(state, archer.uid, mage.weaponUid!), false)

  // Universal relic CAN be equipped and transferred across all 3 families
  campaign.equipment.push({ uid: 'eq_heart', equipId: 'heart_of_solis', slot: 'relic' })
  assert.equal(equipItem(state, knight.uid, 'eq_heart'), true)
  assert.equal(knight.relicUid, 'eq_heart')
  assert.equal(equipItem(state, mage.uid, 'eq_heart'), true)
  assert.equal(knight.relicUid, null)
  assert.equal(mage.relicUid, 'eq_heart')
  assert.equal(equipItem(state, archer.uid, 'eq_heart'), true)
  assert.equal(mage.relicUid, null)
  assert.equal(archer.relicUid, 'eq_heart')

  // Best Fit strictly ignores incompatible higher-rarity items
  campaign.equipment.push(
    { uid: 'eq_leg_blade', equipId: 'solis_crownblade', slot: 'weapon' },
    { uid: 'eq_leg_aegis', equipId: 'aegis_of_dawn', slot: 'armor' },
    { uid: 'eq_leg_robe', equipId: 'starweaver_mantle', slot: 'armor' }
  )
  const archerBest = findBestFitUpgrades(campaign, archer.uid)
  assert.equal(archerBest.length, 0, 'Archer must ignore Vanguard & Arcane legendary gear in Best Fit')
  const mageBest = autoEquipBestFit(state, mage.uid)
  assert.equal(mageBest.length, 1)
  assert.equal(mage.armorUid, 'eq_leg_robe')
  assert.notEqual(mage.weaponUid, 'eq_leg_blade')
})

test('Legacy save migration gracefully unequips incompatible gear back into inventory without losing items', () => {
  const base = createInitialState(7777)
  const serialized = serializeSave(base)

  // Inject legacy incompatible equipment loadouts:
  // - Mage wearing Iron Broadsword (Vanguard) + Scout Brigandine (Skirmisher) + Copper Signet (Universal Relic)
  // - Knight wearing Yew Longbow (Skirmisher) + Acolyte Robe (Arcane)
  // - Archer wearing Frostbite Staff (Arcane)
  serialized.campaign.equipment.push(
    { uid: 'leg_sword', equipId: 'iron_sword', slot: 'weapon' },
    { uid: 'leg_leather', equipId: 'leather_jerkin', slot: 'armor' },
    { uid: 'leg_signet', equipId: 'copper_signet', slot: 'relic' },
    { uid: 'leg_bow', equipId: 'hunter_bow', slot: 'weapon' },
    { uid: 'leg_robe', equipId: 'acolyte_robe', slot: 'armor' },
    { uid: 'leg_staff', equipId: 'frostbite_staff', slot: 'weapon' }
  )
  const legacyKnight = serialized.campaign.heroes[0]
  const legacyArcher = serialized.campaign.heroes[1]
  const legacyMage = serialized.campaign.heroes[2]
  legacyKnight.weaponUid = 'leg_bow'
  legacyKnight.armorUid = 'leg_robe'
  legacyArcher.weaponUid = 'leg_staff'
  legacyMage.weaponUid = 'leg_sword'
  legacyMage.armorUid = 'leg_leather'
  legacyMage.relicUid = 'leg_signet'

  const equipCountBefore = serialized.campaign.equipment.length

  // 1. Direct createInitialState(seed, legacySave) migration
  const restoredDirect = createInitialState(8888, structuredClone(serialized))
  assert.equal(restoredDirect.campaign.equipment.length, equipCountBefore, 'No items may be deleted during migration')
  assert.equal(restoredDirect.campaign.heroes[0].weaponUid, null, 'Knight bow unequipped')
  assert.equal(restoredDirect.campaign.heroes[0].armorUid, null, 'Knight robe unequipped')
  assert.equal(restoredDirect.campaign.heroes[1].weaponUid, null, 'Archer staff unequipped')
  assert.equal(restoredDirect.campaign.heroes[2].weaponUid, null, 'Mage sword unequipped')
  assert.equal(restoredDirect.campaign.heroes[2].armorUid, null, 'Mage leather unequipped')
  assert.equal(restoredDirect.campaign.heroes[2].relicUid, 'leg_signet', 'Universal relic preserved on Mage')
  // All unequipped items remain intact in inventory
  for (const uid of ['leg_sword', 'leg_leather', 'leg_signet', 'leg_bow', 'leg_robe', 'leg_staff']) {
    assert.ok(
      restoredDirect.campaign.equipment.some(e => e.uid === uid),
      `Migrated item ${uid} must stay in inventory`
    )
  }

  // 2. Storage loadSave() migration path
  const storage = createMemoryStorage()
  storage.setItem(SAVE_KEY, JSON.stringify(serialized))
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.equal(loaded.campaign.equipment.length, equipCountBefore)
  assert.equal(loaded.campaign.heroes[2].weaponUid, null)
  assert.equal(loaded.campaign.heroes[2].armorUid, null)
  assert.equal(loaded.campaign.heroes[2].relicUid, 'leg_signet')

  // 3. Direct helper return count check
  const copySave: SaveData = structuredClone(serialized)
  const cleared = sanitizeHeroEquipmentFamilies(copySave.campaign)
  assert.equal(cleared, 5, 'Should clear exactly the 5 incompatible slots')

  // Re-persisting clean state round-trips without losing anything
  persistSave(storage, restoredDirect)
  const reloaded = loadSave(storage)
  assert.ok(reloaded)
  assert.equal(reloaded.campaign.heroes[2].relicUid, 'leg_signet')
})

test('armory-diff reports compatibility & lock reasons accurately and UI draw helpers render cleanly at desktop and mobile widths', () => {
  const state = createInitialState(5150)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const mage = campaign.heroes[2]

  campaign.equipment.push(
    { uid: 'eq_sunsteel', equipId: 'sunsteel_blade', slot: 'weapon' },
    { uid: 'eq_celestial', equipId: 'celestial_staff', slot: 'weapon' },
    { uid: 'eq_heart', equipId: 'heart_of_solis', slot: 'relic' }
  )

  const compatDiff = computeEquipmentStatDiff(campaign, knight.uid, 'eq_sunsteel')!
  assert.equal(compatDiff.compatible, true)
  assert.equal(compatDiff.incompatibilityReason, null)
  assert.equal(compatDiff.heroFamily, 'vanguard')
  assert.equal(compatDiff.candidateFamily, 'vanguard')
  assert.ok(compatDiff.netPowerDelta > 0)

  const relicDiff = computeEquipmentStatDiff(campaign, mage.uid, 'eq_heart')!
  assert.equal(relicDiff.compatible, true)
  assert.equal(relicDiff.incompatibilityReason, null)
  assert.equal(relicDiff.candidateFamily, 'universal')
  assert.ok(relicDiff.netPowerDelta > 0)

  const incompatDiff = computeEquipmentStatDiff(campaign, knight.uid, 'eq_celestial')!
  assert.equal(incompatDiff.compatible, false)
  assert.equal(incompatDiff.heroFamily, 'vanguard')
  assert.equal(incompatDiff.candidateFamily, 'arcane')
  assert.equal(incompatDiff.incompatibilityReason, 'Requires Staves/Robes (Mage, Cleric, Cryomancer)')
  assert.equal(incompatDiff.netPowerDelta, 0)
  assert.equal(incompatDiff.hasAnyChange, false)

  // Render checks at desktop and narrow mobile widths (375x667, 390x844, 844x390 card widths)
  const widgetState: CanvasWidgetDrawState = {
    hovered: false,
    pressed: false,
    focused: false,
    disabled: false,
    selected: false
  }
  for (const w of [235, 340, 520, 740]) {
    const c = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(c.ctx, { x: 8, y: 8, width: w, height: 64 }, incompatDiff)
    assert.ok(c.ops > 10)
    assert.ok(c.texts.some(t => t.includes('CLASS LOCKED')))
    assert.ok(c.texts.some(t => t.includes('Staves/Robes')))

    drawEquipCard(c.ctx, { x: 8, y: 80, width: w, height: 46 }, {
      slot: 'weapon',
      spec: EQUIPMENT_BY_ID.celestial_staff,
      incompatible: true,
      incompatibleLabel: 'Staves/Robes only'
    }, { ...widgetState, disabled: true })

    drawEquipCard(c.ctx, { x: 8, y: 132, width: w, height: 46 }, {
      slot: 'weapon',
      spec: EQUIPMENT_BY_ID.sunsteel_blade,
      ownerText: 'Bag'
    }, widgetState)

    drawEquipFamilyPill(c.ctx, { x: 8, y: 184, width: Math.min(w, 160), height: 28 }, 'vanguard', {
      prefix: 'Gear: ',
      countText: '4/8',
      compact: w < 300
    })

    drawHeroHeader(c.ctx, { x: 8, y: 220, width: Math.max(w, 280), height: 48 }, {
      name: 'Sir Aldric',
      title: 'Knight',
      stars: 1,
      rarity: 'common',
      power: 150,
      inSquad: true,
      equipFamily: 'vanguard'
    })

    drawForgeRecipeCard(c.ctx, { x: 8, y: 276, width: w, height: 50 }, {
      kind: 'armor',
      rarity: 'legendary',
      name: 'Starweaver Mantle',
      subtitle: EQUIPMENT_BY_ID.starweaver_mantle.desc,
      refId: 'starweaver_mantle',
      accentHex: EQUIPMENT_BY_ID.starweaver_mantle.accentHex,
      ownedCount: 0,
      cost: 1600,
      currency: 'dust',
      affordable: false,
      equipFamily: 'arcane'
    }, widgetState)
  }
})
