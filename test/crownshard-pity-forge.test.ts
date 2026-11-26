import assert from 'node:assert/strict'
import test from 'node:test'
import type { CanvasWidgetDrawState } from '../packages/ridgetop/framework/ui.ts'
import { EQUIPMENT_BY_ID, EQUIPMENT_LIST, HERO_LIST, HERO_SPECS, RARITY_META, RARITY_ORDER } from '../examples/crownshard/crownshard/data.ts'
import {
  EPIC_PITY_THRESHOLD, EQUIP_CRAFT_COST, EQUIP_SALVAGE_DUST, HERO_CRAFT_COST, HERO_SALVAGE_SHARDS,
  LEGENDARY_PITY_THRESHOLD, MAX_HERO_OVERFLOW_SHARDS, canCraftEquipment, canCraftHero, craftEquipment,
  craftHero, getCraftableEquipment, getCraftableHeroes, getDuplicateMaxHeroShards, getEquipCraftCost,
  getEquipSalvageDust, getHeroCraftCost, getHeroSalvageShards, getPackPityStatus, hasMaxedHero,
  selectProtectedEquipment, selectProtectedHero
} from '../examples/crownshard/crownshard/forge.ts'
import {
  SAVE_KEY, buyPack, createInitialState, loadSave, persistSave, salvageEquipCard, salvageHeroCard, serializeSave
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type { HeroClassId, Rarity, SaveData } from '../examples/crownshard/crownshard/types.ts'
import {
  drawAnimatedRevealCard, drawCampHeader, drawForgeBalanceBanner, drawForgeRecipeCard, drawPityBanner, drawRevealCard
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
    fillText() { ops++ },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, get ops() { return ops } }
}

test('Pack pity counter guarantees Epic+ by pack #10 and Legendary by pack #40 and resets accurately', () => {
  assert.equal(EPIC_PITY_THRESHOLD, 10)
  assert.equal(LEGENDARY_PITY_THRESHOLD, 40)

  // Initial status
  const initState = createInitialState(101)
  assert.deepEqual(getPackPityStatus(initState.campaign), {
    packsSinceEpic: 0,
    epicIn: 10,
    packsSinceLegendary: 0,
    legendaryIn: 40
  })

  // Test across multiple seeds: never exceed 10 packs without Epic+ or 40 packs without Legendary
  for (const seed of [1337, 2026, 7777]) {
    const state = createInitialState(seed)
    state.campaign.gold = 200000
    let dryEpic = 0
    let dryLeg = 0
    let sawEpicPity = false
    let sawLegPity = false

    for (let i = 0; i < 90; i++) {
      const beforeEpic = state.campaign.packsSinceEpic
      const beforeLeg = state.campaign.packsSinceLegendary
      const pulled = buyPack(state, 'recruit')
      assert.ok(pulled && pulled.length === 3)

      const hasLeg = pulled.some(c => c.rarity === 'legendary')
      const hasEpicPlus = pulled.some(c => c.rarity === 'epic' || c.rarity === 'legendary')

      if (beforeLeg + 1 >= LEGENDARY_PITY_THRESHOLD) {
        assert.equal(hasLeg, true, `Pack #${i + 1} (seed ${seed}) hit Legendary pity and must drop a Legendary`)
        assert.ok(pulled.some(c => c.pityTriggered === 'legendary'))
        sawLegPity = true
      } else if (beforeEpic + 1 >= EPIC_PITY_THRESHOLD) {
        assert.equal(hasEpicPlus, true, `Pack #${i + 1} (seed ${seed}) hit Epic pity and must drop Epic+`)
        assert.ok(pulled.some(c => c.pityTriggered === 'epic'))
        sawEpicPity = true
      }

      if (hasLeg) {
        dryLeg = 0
        dryEpic = 0
        assert.equal(state.campaign.packsSinceLegendary, 0, 'Legendary drop must reset packsSinceLegendary to 0')
        assert.equal(state.campaign.packsSinceEpic, 0, 'Legendary drop must also reset packsSinceEpic to 0')
      } else if (hasEpicPlus) {
        dryEpic = 0
        dryLeg++
        assert.equal(state.campaign.packsSinceEpic, 0, 'Epic drop must reset packsSinceEpic to 0')
        assert.equal(state.campaign.packsSinceLegendary, beforeLeg + 1, 'Epic drop must keep incrementing packsSinceLegendary')
      } else {
        dryEpic++
        dryLeg++
        assert.equal(state.campaign.packsSinceEpic, beforeEpic + 1)
        assert.equal(state.campaign.packsSinceLegendary, beforeLeg + 1)
      }

      assert.ok(dryEpic < EPIC_PITY_THRESHOLD, `Never exceed ${EPIC_PITY_THRESHOLD} packs without Epic+`)
      assert.ok(dryLeg < LEGENDARY_PITY_THRESHOLD, `Never exceed ${LEGENDARY_PITY_THRESHOLD} packs without Legendary`)

      const status = getPackPityStatus(state.campaign)
      assert.equal(status.epicIn, Math.max(1, EPIC_PITY_THRESHOLD - state.campaign.packsSinceEpic))
      assert.equal(status.legendaryIn, Math.max(1, LEGENDARY_PITY_THRESHOLD - state.campaign.packsSinceLegendary))
    }

    assert.ok(sawEpicPity, `Expected Epic pity to trigger at least once in 90 recruit packs (seed ${seed})`)
    assert.ok(sawLegPity, `Expected Legendary pity to trigger at least once in 90 recruit packs (seed ${seed})`)
  }

  // Exact boundary check: setting packsSinceEpic = 9 makes next pack guarantee Epic+
  const nearEpic = createInitialState(500)
  nearEpic.campaign.gold = 1000
  nearEpic.campaign.packsSinceEpic = 9
  assert.equal(getPackPityStatus(nearEpic.campaign).epicIn, 1)
  const epicPull = buyPack(nearEpic, 'recruit')!
  assert.ok(epicPull.some(c => RARITY_ORDER.indexOf(c.rarity) >= RARITY_ORDER.indexOf('epic')))
  assert.equal(nearEpic.campaign.packsSinceEpic, 0)

  // Exact boundary check: setting packsSinceLegendary = 39 makes next pack guarantee Legendary and reset both
  const nearLeg = createInitialState(501)
  nearLeg.campaign.gold = 1000
  nearLeg.campaign.packsSinceEpic = 7
  nearLeg.campaign.packsSinceLegendary = 39
  assert.equal(getPackPityStatus(nearLeg.campaign).legendaryIn, 1)
  const legPull = buyPack(nearLeg, 'recruit')!
  assert.ok(legPull.some(c => c.rarity === 'legendary'))
  assert.equal(nearLeg.campaign.packsSinceLegendary, 0)
  assert.equal(nearLeg.campaign.packsSinceEpic, 0)
})

test('Duplicate protection prioritizes unowned heroes/equipment and converts 3★ maxed hero copies into Hero Shards', () => {
  // 1. Equipment duplicate protection prioritizes unowned high-rarity items before duplicates
  const eqState = createInitialState(303)
  const epicEquip = EQUIPMENT_LIST.filter(e => e.rarity === 'epic')
  assert.equal(epicEquip.length, 3)

  // Own the first two epic items; duplicate protection must deterministically choose the 3rd unowned one
  eqState.campaign.equipment.push(
    { uid: 'eq_e0', equipId: epicEquip[0].id, slot: epicEquip[0].slot },
    { uid: 'eq_e1', equipId: epicEquip[1].id, slot: epicEquip[1].slot }
  )
  for (const roll of [0, 0.25, 0.5, 0.99]) {
    const picked = selectProtectedEquipment(epicEquip, eqState.campaign, roll)
    assert.equal(picked.id, epicEquip[2].id, 'Must pick the sole unowned Epic equipment item before duplicating')
  }

  // Once all 3 are owned, falls back to normal rolling across the pool
  eqState.campaign.equipment.push({ uid: 'eq_e2', equipId: epicEquip[2].id, slot: epicEquip[2].slot })
  const fallbackEq = selectProtectedEquipment(epicEquip, eqState.campaign, 0.1)
  assert.ok(epicEquip.some(e => e.id === fallbackEq.id))

  // 2. Hero duplicate protection: unowned > non-maxed (<3★) > fallback
  const hState = createInitialState(304)
  const uncommonHeroes = HERO_LIST.filter(h => h.rarity === 'uncommon')
  assert.equal(uncommonHeroes.length, 2) // cleric, rogue

  // Own Cleric (1★) only -> must prioritize Rogue (unowned)
  hState.campaign.heroes.push({
    uid: 'h_cleric', heroId: 'cleric', stars: 1, weaponUid: null, armorUid: null, relicUid: null
  })
  for (const roll of [0, 0.4, 0.95]) {
    assert.equal(selectProtectedHero(uncommonHeroes, hState.campaign, roll).id, 'rogue')
  }

  // Now own Cleric (3★ MAX) and Rogue (1★) -> must prioritize Rogue (not yet 3★)
  hState.campaign.heroes.find(h => h.heroId === 'cleric')!.stars = 3
  hState.campaign.heroes.push({
    uid: 'h_rogue', heroId: 'rogue', stars: 1, weaponUid: null, armorUid: null, relicUid: null
  })
  assert.equal(hasMaxedHero(hState.campaign, 'cleric'), true)
  assert.equal(hasMaxedHero(hState.campaign, 'rogue'), false)
  for (const roll of [0, 0.5, 0.99]) {
    assert.equal(selectProtectedHero(uncommonHeroes, hState.campaign, roll).id, 'rogue')
  }

  // 3. End-to-end buyPack: when ALL heroes are 3★ maxed, pulling any hero converts it into bonus Hero Shards
  const maxState = createInitialState(909)
  maxState.campaign.gold = 50000
  maxState.campaign.heroes = HERO_LIST.map((spec, idx) => ({
    uid: `max_h_${idx}`,
    heroId: spec.id,
    stars: 3 as const,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }))
  const heroCountBefore = maxState.campaign.heroes.length
  const shardsBefore = maxState.campaign.shards
  let convertedCount = 0

  for (let i = 0; i < 12; i++) {
    const pulled = buyPack(maxState, 'sovereign')!
    for (const card of pulled) {
      if (card.kind === 'hero') {
        convertedCount++
        const expectedShards = getDuplicateMaxHeroShards(card.rarity)
        assert.equal(card.convertedShards, expectedShards)
        assert.equal(card.detail, `MAX ★ → +${expectedShards} SHARDS`)
        assert.equal(card.isNew, false)
      }
    }
  }

  assert.ok(convertedCount > 0, 'Expected at least one hero roll across 12 packs')
  assert.equal(
    maxState.campaign.heroes.length,
    heroCountBefore,
    'Excess copies of 3★ maxed heroes must NOT clutter the hero roster'
  )
  assert.ok(
    maxState.campaign.shards > shardsBefore,
    'Excess copies of 3★ maxed heroes must award bonus Hero Shards'
  )
})

test('Salvaging equipment yields Arcane Dust and salvaging heroes yields Hero Shards in addition to Gold', () => {
  const state = createInitialState(404)
  assert.equal(state.campaign.dust, 0)
  assert.equal(state.campaign.shards, 0)

  // Verify exact equipment salvage Dust schedule across all 5 rarities
  const sampleEquipByRarity: Record<Rarity, string> = {
    common: 'iron_sword',
    uncommon: 'ember_wand',
    rare: 'sunsteel_blade',
    epic: 'dragonfang_spear',
    legendary: 'solis_crownblade'
  }
  const expectedDust: Record<Rarity, number> = {
    common: 10,
    uncommon: 25,
    rare: 60,
    epic: 150,
    legendary: 400
  }

  let runningDust = 0
  for (const rarity of RARITY_ORDER) {
    assert.equal(EQUIP_SALVAGE_DUST[rarity], expectedDust[rarity])
    assert.equal(getEquipSalvageDust(rarity), expectedDust[rarity])
    const uid = `test_eq_${rarity}`
    const spec = EQUIPMENT_BY_ID[sampleEquipByRarity[rarity]]
    state.campaign.equipment.push({ uid, equipId: spec.id, slot: spec.slot })
    const goldBefore = state.campaign.gold
    const earnedGold = salvageEquipCard(state, uid)
    assert.equal(earnedGold, RARITY_META[rarity].salvage)
    assert.equal(state.campaign.gold, goldBefore + earnedGold)
    runningDust += expectedDust[rarity]
    assert.equal(state.campaign.dust, runningDust, `Salvaging ${rarity} equipment must add ${expectedDust[rarity]} Dust`)
  }

  // Verify exact hero salvage Shards schedule across all 5 rarities AND star multipliers (1★, 2★, 3★)
  const sampleHeroByRarity: Record<Rarity, HeroClassId> = {
    common: 'knight',
    uncommon: 'cleric',
    rare: 'paladin',
    epic: 'cryomancer',
    legendary: 'champion'
  }
  const expectedBaseShards: Record<Rarity, number> = {
    common: 15,
    uncommon: 35,
    rare: 80,
    epic: 180,
    legendary: 400
  }

  let runningShards = 0
  for (const rarity of RARITY_ORDER) {
    assert.equal(HERO_SALVAGE_SHARDS[rarity], expectedBaseShards[rarity])
    for (const stars of [1, 2, 3] as const) {
      assert.equal(getHeroSalvageShards(rarity, stars), expectedBaseShards[rarity] * stars)
      const uid = `test_h_${rarity}_${stars}`
      state.campaign.heroes.push({
        uid,
        heroId: sampleHeroByRarity[rarity],
        stars,
        weaponUid: null,
        armorUid: null,
        relicUid: null
      })
      const goldBefore = state.campaign.gold
      const earnedGold = salvageHeroCard(state, uid)
      assert.ok(earnedGold > 0)
      assert.equal(state.campaign.gold, goldBefore + earnedGold)
      runningShards += expectedBaseShards[rarity] * stars
      assert.equal(
        state.campaign.shards,
        runningShards,
        `Salvaging ${stars}★ ${rarity} hero must add ${expectedBaseShards[rarity] * stars} Shards`
      )
    }
  }
})

test('Armory Forge craftHero & craftEquipment deduct exact costs, add targeted cards, and fail safely when broke', () => {
  const state = createInitialState(505)

  // Verify recipe catalog helpers
  assert.equal(getCraftableHeroes().length, HERO_LIST.length)
  assert.equal(getCraftableEquipment('all').length, EQUIPMENT_LIST.length)
  assert.equal(
    getCraftableEquipment('weapon').length +
    getCraftableEquipment('armor').length +
    getCraftableEquipment('relic').length,
    EQUIPMENT_LIST.length
  )

  // Insufficient funds fail safely with zero mutation
  const cryomancerCost = getHeroCraftCost('cryomancer')
  assert.equal(cryomancerCost, HERO_CRAFT_COST.epic)
  assert.equal(canCraftHero(state.campaign, 'cryomancer'), false)
  state.campaign.shards = cryomancerCost - 1
  const heroLenBefore = state.campaign.heroes.length
  assert.equal(craftHero(state, 'cryomancer'), null)
  assert.equal(state.campaign.shards, cryomancerCost - 1, 'Failed hero craft must not deduct shards')
  assert.equal(state.campaign.heroes.length, heroLenBefore, 'Failed hero craft must not add hero')

  // Exact Shards succeed and add targeted 1★ hero directly into roster
  state.campaign.shards = cryomancerCost + 45
  assert.equal(canCraftHero(state.campaign, 'cryomancer'), true)
  const craftedHero = craftHero(state, 'cryomancer')
  assert.ok(craftedHero)
  assert.equal(craftedHero.heroId, 'cryomancer')
  assert.equal(craftedHero.stars, 1)
  assert.equal(state.campaign.shards, 45)
  assert.ok(state.campaign.heroes.some(h => h.uid === craftedHero.uid && h.heroId === 'cryomancer'))

  // Insufficient Dust fails safely
  const relicId = 'heart_of_solis'
  const relicCost = getEquipCraftCost(relicId)
  assert.equal(relicCost, EQUIP_CRAFT_COST.legendary)
  assert.equal(canCraftEquipment(state.campaign, relicId), false)
  state.campaign.dust = relicCost - 1
  const eqLenBefore = state.campaign.equipment.length
  assert.equal(craftEquipment(state, relicId), null)
  assert.equal(state.campaign.dust, relicCost - 1)
  assert.equal(state.campaign.equipment.length, eqLenBefore)

  // Unknown equipment ID fails safely
  assert.equal(getEquipCraftCost('nonexistent_relic'), 0)
  assert.equal(canCraftEquipment(state.campaign, 'nonexistent_relic'), false)
  assert.equal(craftEquipment(state, 'nonexistent_relic'), null)

  // Exact Dust succeeds and adds targeted relic directly into Armory inventory
  state.campaign.dust = relicCost + 120
  assert.equal(canCraftEquipment(state.campaign, relicId), true)
  const craftedRelic = craftEquipment(state, relicId)
  assert.ok(craftedRelic)
  assert.equal(craftedRelic.equipId, relicId)
  assert.equal(craftedRelic.slot, 'relic')
  assert.equal(state.campaign.dust, 120)
  assert.ok(state.campaign.equipment.some(e => e.uid === craftedRelic.uid && e.equipId === relicId))

  // Overflow shard bonus exceeds base 1★ salvage shards for every rarity
  for (const r of RARITY_ORDER) {
    assert.ok(MAX_HERO_OVERFLOW_SHARDS[r] > HERO_SALVAGE_SHARDS[r])
  }
})

test('Save/load round-trip preserves dust, shards, and pity counters with full legacy save backwards compatibility', () => {
  const state = createInitialState(606)
  state.campaign.dust = 640
  state.campaign.shards = 915
  state.campaign.packsSinceEpic = 6
  state.campaign.packsSinceLegendary = 27

  // Direct serializeSave -> createInitialState round-trip
  const serialized = serializeSave(state)
  assert.equal(serialized.campaign.dust, 640)
  assert.equal(serialized.campaign.shards, 915)
  assert.equal(serialized.campaign.packsSinceEpic, 6)
  assert.equal(serialized.campaign.packsSinceLegendary, 27)

  const restoredDirect = createInitialState(999, serialized)
  assert.equal(restoredDirect.campaign.dust, 640)
  assert.equal(restoredDirect.campaign.shards, 915)
  assert.equal(restoredDirect.campaign.packsSinceEpic, 6)
  assert.equal(restoredDirect.campaign.packsSinceLegendary, 27)

  // Storage persistSave -> loadSave -> createInitialState round-trip
  const storage = createMemoryStorage()
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  const restoredStorage = createInitialState(999, loaded)
  assert.equal(restoredStorage.campaign.dust, 640)
  assert.equal(restoredStorage.campaign.shards, 915)
  assert.equal(restoredStorage.campaign.packsSinceEpic, 6)
  assert.equal(restoredStorage.campaign.packsSinceLegendary, 27)

  // Legacy save JSON omitting dust, shards, packsSinceEpic, packsSinceLegendary
  const legacyRaw = JSON.parse(storage.getItem(SAVE_KEY)!) as Record<string, Record<string, unknown>>
  delete legacyRaw.campaign.dust
  delete legacyRaw.campaign.shards
  delete legacyRaw.campaign.packsSinceEpic
  delete legacyRaw.campaign.packsSinceLegendary
  storage.setItem(SAVE_KEY, JSON.stringify(legacyRaw))

  const loadedLegacy = loadSave(storage)
  assert.ok(loadedLegacy)
  const restoredLegacy = createInitialState(999, loadedLegacy)
  assert.equal(restoredLegacy.campaign.dust, 0)
  assert.equal(restoredLegacy.campaign.shards, 0)
  assert.equal(restoredLegacy.campaign.packsSinceEpic, 0)
  assert.equal(restoredLegacy.campaign.packsSinceLegendary, 0)

  // Direct legacy SaveData object passed straight to createInitialState
  const directLegacy = legacyRaw as unknown as SaveData
  const restoredDirectLegacy = createInitialState(999, directLegacy)
  assert.equal(restoredDirectLegacy.campaign.dust, 0)
  assert.equal(restoredDirectLegacy.campaign.shards, 0)
  assert.equal(restoredDirectLegacy.campaign.packsSinceEpic, 0)
  assert.equal(restoredDirectLegacy.campaign.packsSinceLegendary, 0)
})

test('Pity banner, Forge UI, Camp header balances, and shard-converted reveal cards render cleanly without throwing', () => {
  const { ctx } = fakeCanvas2dContext()
  const widgetState: CanvasWidgetDrawState = {
    hovered: false,
    pressed: false,
    focused: false,
    disabled: false,
    selected: false
  }

  // Pity banner (normal, hot/next-pack, and compact)
  drawPityBanner(ctx, { x: 0, y: 0, width: 680, height: 42 }, {
    packsSinceEpic: 4, epicIn: 6, packsSinceLegendary: 18, legendaryIn: 22
  }, false)
  drawPityBanner(ctx, { x: 0, y: 0, width: 320, height: 36 }, {
    packsSinceEpic: 9, epicIn: 1, packsSinceLegendary: 39, legendaryIn: 1
  }, true)

  // Forge balance banner (desktop + compact)
  drawForgeBalanceBanner(ctx, { x: 0, y: 0, width: 520, height: 34 }, 350, 720, false)
  drawForgeBalanceBanner(ctx, { x: 0, y: 0, width: 280, height: 34 }, 350, 720, true)

  // Forge recipe cards (hero & equipment)
  drawForgeRecipeCard(ctx, { x: 0, y: 0, width: 360, height: 52 }, {
    kind: 'hero',
    rarity: HERO_SPECS.champion.rarity,
    name: `${HERO_SPECS.champion.name} (${HERO_SPECS.champion.title})`,
    subtitle: 'HP 96 · ATK 25 · DEF 9 · SPD 12',
    refId: 'champion',
    ownedCount: 0,
    maxed: false,
    cost: getHeroCraftCost('champion'),
    currency: 'shards',
    affordable: true
  }, widgetState)

  drawForgeRecipeCard(ctx, { x: 0, y: 0, width: 360, height: 52 }, {
    kind: 'relic',
    rarity: EQUIPMENT_BY_ID.heart_of_solis.rarity,
    name: EQUIPMENT_BY_ID.heart_of_solis.name,
    subtitle: EQUIPMENT_BY_ID.heart_of_solis.desc,
    refId: 'heart_of_solis',
    accentHex: EQUIPMENT_BY_ID.heart_of_solis.accentHex,
    ownedCount: 1,
    cost: getEquipCraftCost('heart_of_solis'),
    currency: 'dust',
    affordable: false
  }, widgetState)

  // Camp header with Dust & Shards balances
  drawCampHeader(ctx, { x: 0, y: 0, width: 700, height: 42 }, 450, 1280, false, { dust: 240, shards: 510 })

  // Reveal card & animated reveal card with MAX ★ shard conversion + Pity badge
  drawRevealCard(ctx, { x: 0, y: 0, width: 170, height: 220 }, {
    rarity: 'legendary',
    kind: 'hero',
    refId: 'champion',
    name: 'Aurelius (Sunblade)',
    detail: 'MAX ★ → +600 SHARDS',
    value: 720,
    isNew: false,
    convertedShards: 600,
    pityTriggered: 'legendary'
  })

  drawAnimatedRevealCard(ctx, { x: 0, y: 0, width: 170, height: 220 }, {
    rarity: 'epic',
    kind: 'weapon',
    refId: 'dragonfang_spear',
    name: 'Dragonfang Halberd',
    detail: 'WEAPON · +15 ATK, +1 Range, +15% Lifesteal, Venom.',
    value: 360,
    isNew: true,
    pityTriggered: 'epic',
    equipAccent: EQUIPMENT_BY_ID.dragonfang_spear.accentHex
  }, { enterT: 1, flipT: 1, elapsed: 2.5, hovered: false })
})
