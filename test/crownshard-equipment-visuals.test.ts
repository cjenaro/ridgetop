import assert from 'node:assert/strict'
import test from 'node:test'
import { createMeshPool, renderRig } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats, Rig } from '../packages/ridgetop/framework/index.ts'
import {
  createPortraitStore,
  getHeroPortraitPixels,
  heroPortraitKey
} from '../examples/crownshard/crownshard/art.ts'
import {
  HERO_CHARACTER_SPECS,
  resolveHeroCharacterSpec,
  resolveHeroRig
} from '../examples/crownshard/crownshard/characters.ts'
import { EQUIPMENT_BY_ID, EQUIPMENT_LIST } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import { createInitialState, equipItem, stepGame } from '../examples/crownshard/crownshard/simulation.ts'
import type { EquipSlot, HeroClassId } from '../examples/crownshard/crownshard/types.ts'

const ALL_HERO_IDS = Object.keys(HERO_CHARACTER_SPECS) as HeroClassId[]

/** Compute a deterministic structural & geometry hash of an assembled Rig (joint ids, vertex counts, positions & vertex colors). */
function hashRigGeometry(rig: Rig): string {
  let h1 = 2166136261 >>> 0
  let h2 = 3355443229 >>> 0
  const mix = (n: number) => {
    const v = Math.round(n * 1000) | 0
    h1 = Math.imul(h1 ^ v, 16777619) >>> 0
    h2 = Math.imul(h2 ^ (v + 0x9e3779b9), 2246822519) >>> 0
  }
  for (const joint of rig.joints) {
    mix(joint.id.length)
    for (let i = 0; i < joint.id.length; i++) mix(joint.id.charCodeAt(i))
    const parts = joint.parts ?? []
    mix(parts.length)
    for (const part of parts) {
      mix(part.mesh.vertexCount)
      mix(part.unlit ?? 0)
      if (part.color) {
        for (let c = 0; c < 4; c++) mix(part.color[c])
      }
      const d = part.mesh.data
      // Sample every vertex position + normal + color so any mesh or tint change alters the hash
      const stride = Math.max(1, Math.floor(part.mesh.vertexCount / 180))
      for (let i = 0; i < part.mesh.vertexCount; i += stride) {
        const o = i * 6
        mix(d[o]); mix(d[o + 1]); mix(d[o + 2])
      }
      if (part.mesh.colors) {
        const c = part.mesh.colors
        for (let i = 0; i < part.mesh.vertexCount; i += stride) {
          const ci = i * 3
          mix(c[ci]); mix(c[ci + 1]); mix(c[ci + 2])
        }
      }
    }
  }
  return `${h1.toString(16).padStart(8, '0')}:${h2.toString(16).padStart(8, '0')}`
}

function measureRigBoundsY(rig: Rig): { minY: number; maxY: number } {
  const pool = createMeshPool(32)
  const joints = renderRig(rig, { position: [0, 0, 0] }, {}, pool)
  let minY = Infinity
  let maxY = -Infinity
  for (const joint of rig.joints) {
    const world = joints[joint.id]
    if (!world || !joint.parts) continue
    for (const part of joint.parts) {
      const lp = part.position ?? [0, 0, 0]
      const ps = part.scale ?? [1, 1, 1]
      const baseY = world.position[1] + lp[1] * world.scale[1]
      const sy = ps[1] * world.scale[1]
      const data = part.mesh.data
      for (let i = 0; i < part.mesh.vertexCount; i++) {
        const wy = baseY + data[i * 6 + 1] * sy
        assert.ok(Number.isFinite(wy), `Non-finite vertex Y in ${joint.id}/${part.name}`)
        if (wy < minY) minY = wy
        if (wy > maxY) maxY = wy
      }
    }
  }
  return { minY, maxY }
}

function fakeRenderer() {
  let drawn = 0
  let maxInstances = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0 } as unknown as RenderStats
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

test('all 18 equipment items produce distinct 3D rig visuals vs baseline and vs every sibling in the same slot', () => {
  assert.equal(EQUIPMENT_LIST.length, 18, 'Expected all 18 Crownshard equipment items')
  assert.equal(Object.keys(EQUIPMENT_BY_ID).length, 18)

  for (const heroId of ALL_HERO_IDS) {
    const baseSpec = resolveHeroCharacterSpec(heroId)
    const baseRig = resolveHeroRig(heroId)
    const baseHash = hashRigGeometry(baseRig)
    const basePartsSig = JSON.stringify(baseSpec.parts)

    const hashesBySlot: Record<EquipSlot, Map<string, string>> = {
      weapon: new Map(),
      armor: new Map(),
      relic: new Map()
    }
    const specsBySlot: Record<EquipSlot, Map<string, string>> = {
      weapon: new Map(),
      armor: new Map(),
      relic: new Map()
    }

    for (const item of EQUIPMENT_LIST) {
      const loadout = item.slot === 'weapon'
        ? { weaponId: item.id }
        : item.slot === 'armor'
          ? { armorId: item.id }
          : { relicId: item.id }

      const spec = resolveHeroCharacterSpec(heroId, loadout)
      const rig = resolveHeroRig(heroId, loadout)
      const hash = hashRigGeometry(rig)
      const specSig = JSON.stringify(spec.parts)

      // Distinct from unequipped baseline (both part mapping and assembled 3D mesh geometry!)
      assert.notEqual(
        specSig,
        basePartsSig,
        `${item.id} (${item.slot}) must change resolved CharacterSpec parts on ${heroId}`
      )
      assert.notEqual(
        hash,
        baseHash,
        `${item.id} (${item.slot}) must change assembled 3D Rig geometry on ${heroId}`
      )

      // Grounded cleanly (no weapon/boot dipping below y = 0)
      if (heroId === 'knight') {
        const bounds = measureRigBoundsY(rig)
        assert.ok(
          bounds.minY >= -0.025,
          `${item.id} on ${heroId} must stay above ground (got minY=${bounds.minY.toFixed(4)})`
        )
        assert.ok(bounds.maxY >= 1.50 && bounds.maxY <= 2.30, `${item.id} height out of bounds: ${bounds.maxY}`)
      }

      // Distinct from every other item in the same slot
      const prevSpecOwner = specsBySlot[item.slot].get(specSig)
      assert.equal(
        prevSpecOwner,
        undefined,
        `${item.id} shares identical CharacterSpec parts with ${prevSpecOwner} on ${heroId}`
      )
      specsBySlot[item.slot].set(specSig, item.id)

      const prevHashOwner = hashesBySlot[item.slot].get(hash)
      assert.equal(
        prevHashOwner,
        undefined,
        `${item.id} shares identical 3D geometry hash with ${prevHashOwner} on ${heroId}`
      )
      hashesBySlot[item.slot].set(hash, item.id)
    }
  }
})

test('2* and 3* star ascension never clobbers equipped frostguard_plate, aegis_of_dawn, ranger_cloak, or swift_boots', () => {
  for (const stars of [2, 3] as const) {
    // Frostguard Plate retains its glacial chest, pauldrons & fur collar at 2* and 3*
    const frostSpec = resolveHeroCharacterSpec('knight', { stars, armorId: 'frostguard_plate' })
    assert.equal(frostSpec.parts?.chest, 'chest_frostguard')
    assert.equal(frostSpec.parts?.pauldrons, 'pauldrons_frostguard')
    assert.equal(frostSpec.parts?.collar, 'collar_frostguard')
    if (stars === 3) assert.equal(frostSpec.parts?.back, 'halo_radiant')

    // Aegis of Dawn retains its dawn chest, angel-wing pauldrons, collar & upgraded shield at 2* and 3*
    const aegisSpec = resolveHeroCharacterSpec('knight', { stars, armorId: 'aegis_of_dawn' })
    assert.equal(aegisSpec.parts?.chest, 'chest_aegis_dawn')
    assert.equal(aegisSpec.parts?.pauldrons, 'pauldrons_aegis_dawn')
    assert.equal(aegisSpec.parts?.collar, 'collar_aegis_dawn')
    assert.equal(aegisSpec.parts?.offHand, 'shield_aegis_dawn')

    // Gale Striders (swift_boots) retains its winged jade boots at 2* and 3* instead of boot_cuff_gold
    const swiftSpec = resolveHeroCharacterSpec('archer', { stars, relicId: 'swift_boots' })
    assert.equal(swiftSpec.parts?.bootL, 'boot_gale_striders')
    assert.equal(swiftSpec.parts?.bootR, 'boot_gale_striders')
    // While still keeping 2* gilded pauldrons when no armor overrides pauldrons!
    assert.equal(swiftSpec.parts?.pauldrons, 'pauldrons_gilded')

    // Windrunner Cloak keeps its emerald cape even at 3*
    const cloakSpec = resolveHeroCharacterSpec('rogue', { stars, armorId: 'ranger_cloak' })
    assert.equal(cloakSpec.parts?.back, 'cape_windrunner')
    assert.equal(cloakSpec.parts?.pauldrons, 'pauldrons_windrunner')

    // Equipped 2*/3* rigs differ geometrically from bare 2*/3* rigs
    const bareStarHash = hashRigGeometry(resolveHeroRig('knight', { stars }))
    const frostHash = hashRigGeometry(resolveHeroRig('knight', { stars, armorId: 'frostguard_plate' }))
    const aegisHash = hashRigGeometry(resolveHeroRig('knight', { stars, armorId: 'aegis_of_dawn' }))
    const swiftHash = hashRigGeometry(resolveHeroRig('knight', { stars, relicId: 'swift_boots' }))
    assert.notEqual(frostHash, bareStarHash)
    assert.notEqual(aegisHash, bareStarHash)
    assert.notEqual(swiftHash, bareStarHash)
  }
})

test('weapon class off-hand conflicts are cleanly resolved (Archer clears recurve bow for melee/staff; bows replace offhand)', () => {
  // Baseline Archer holds recurve bow in off-hand
  assert.equal(resolveHeroCharacterSpec('archer').parts?.offHand, 'offhand_bow_recurve')

  // Equipping any non-bow weapon on Archer clears offhand_bow_recurve
  const nonBowWeapons = ['iron_sword', 'sunsteel_blade', 'dragonfang_spear', 'ember_wand', 'frostbite_staff', 'solis_crownblade']
  for (const weaponId of nonBowWeapons) {
    const spec = resolveHeroCharacterSpec('archer', { weaponId })
    assert.equal(
      spec.parts?.offHand,
      undefined,
      `Equipping ${weaponId} on Archer must clear offhand_bow_recurve (got ${spec.parts?.offHand})`
    )
    assert.ok(spec.parts?.mainHand && spec.parts.mainHand !== 'weapon_arrow_nocked')
  }

  // Equipping a bow on Knight replaces heater shield with Yew Longbow and nocked arrow
  const knightBow = resolveHeroCharacterSpec('knight', { weaponId: 'hunter_bow' })
  assert.equal(knightBow.parts?.mainHand, 'weapon_yew_arrow')
  assert.equal(knightBow.parts?.offHand, 'offhand_bow_yew')

  // Equipping a two-handed halberd or staff on Rogue clears offhand_dagger
  assert.equal(resolveHeroCharacterSpec('rogue', { weaponId: 'dragonfang_spear' }).parts?.offHand, undefined)
  assert.equal(resolveHeroCharacterSpec('rogue', { weaponId: 'frostbite_staff' }).parts?.offHand, undefined)
})

test('loadout-aware portrait key generator & lazy baker produce distinct keys/pixels and cache cleanly headless', () => {
  const kBase = heroPortraitKey('knight')
  const kStar1Empty = heroPortraitKey('knight', { stars: 1 })
  const kStar2 = heroPortraitKey('knight', { stars: 2 })
  const kStar3 = heroPortraitKey('knight', { stars: 3 })
  const kFrost = heroPortraitKey('knight', { stars: 1, armorId: 'frostguard_plate' })
  const kCrown = heroPortraitKey('knight', { stars: 2, weaponId: 'solis_crownblade', armorId: 'aegis_of_dawn', relicId: 'blood_amulet' })

  assert.equal(kBase, 'knight')
  assert.equal(kStar1Empty, 'knight')
  assert.equal(new Set([kBase, kStar2, kStar3, kFrost, kCrown]).size, 5, 'Distinct loadouts must yield distinct portrait keys')

  // Lazy DOM-free pixel baking caches exact object identity on repeat calls
  const pBase1 = getHeroPortraitPixels('knight', undefined, 48)
  const pBase2 = getHeroPortraitPixels('knight', { stars: 1 }, 48)
  assert.equal(pBase1, pBase2, 'Identical loadouts must hit the portrait pixel cache')
  assert.equal(pBase1.size, 48)
  assert.equal(pBase1.pixels.length, 48 * 48 * 4)

  const pFrost = getHeroPortraitPixels('knight', { armorId: 'frostguard_plate' }, 48)
  const pCrown = getHeroPortraitPixels('knight', { stars: 3, weaponId: 'solis_crownblade', armorId: 'aegis_of_dawn', relicId: 'blood_amulet' }, 48)
  assert.notDeepEqual(pFrost.pixels, pBase1.pixels, 'Equipping frostguard_plate must visibly alter baked bust portrait pixels')
  assert.notDeepEqual(pCrown.pixels, pBase1.pixels, 'Ascending & equipping legendary gear must visibly alter baked bust portrait pixels')
  assert.notDeepEqual(pCrown.pixels, pFrost.pixels, 'Different equipment loadouts must bake visually distinct portraits')

  // createPortraitStore handles headless Node (no document) gracefully without throwing
  const store = createPortraitStore(48)
  assert.equal(store.getKey('archer', { stars: 2, weaponId: 'dragonfang_spear' }), 'archer:2:dragonfang_spear::')
  assert.equal(store.getHero('archer', { stars: 2, weaponId: 'dragonfang_spear' }), undefined)
  const pxViaStore = store.getHeroPixels('archer', { stars: 2, weaponId: 'dragonfang_spear' })
  assert.equal(pxViaStore.size, 48)
  assert.ok(pxViaStore.pixels.some((v, idx) => idx % 4 === 3 && v > 0), 'Portrait must contain opaque hero silhouette pixels')
})

test('Camp Armory focus framing and triggerCampEquipFlourish run cleanly for squad and benched heroes', () => {
  const state = createInitialState(1337)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  const hero = state.campaign.heroes[0]
  state.campaign.selectedCampHeroUid = hero.uid

  // Add a legendary weapon + armor + relic and equip them while in Armory framing
  state.campaign.equipment.push(
    { uid: 'eq_test_wep', equipId: 'dragonfang_spear', slot: 'weapon' },
    { uid: 'eq_test_arm', equipId: 'frostguard_plate', slot: 'armor' },
    { uid: 'eq_test_rel', equipId: 'swift_boots', slot: 'relic' }
  )

  scene.setCampFraming('armory')
  assert.equal(equipItem(state, hero.uid, 'eq_test_wep'), true)
  scene.triggerCampEquipFlourish(hero.uid, 'weapon', EQUIPMENT_BY_ID.dragonfang_spear.accentHex)

  const dt = 1 / 60
  for (let i = 0; i < 45; i++) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }

  assert.equal(equipItem(state, hero.uid, 'eq_test_arm'), true)
  scene.triggerCampEquipFlourish(hero.uid, 'armor', EQUIPMENT_BY_ID.frostguard_plate.accentHex)
  for (let i = 0; i < 30; i++) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }

  assert.equal(equipItem(state, hero.uid, 'eq_test_rel'), true)
  scene.triggerCampEquipFlourish(hero.uid, 'relic', EQUIPMENT_BY_ID.swift_boots.accentHex)
  for (let i = 0; i < 60; i++) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }

  // Also test inspecting a benched hero (not in squadUids) in Armory mode
  state.campaign.heroes.push({
    uid: 'hero_benched_paladin',
    heroId: 'paladin',
    stars: 2,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  })
  state.campaign.selectedCampHeroUid = 'hero_benched_paladin'
  scene.triggerCampEquipFlourish('hero_benched_paladin', 'weapon', '#ffe066')
  for (let i = 0; i < 30; i++) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }

  assert.equal(fake.drawn, 165)
  assert.ok(fake.maxInstances > 40, 'Armory render should emit camp diorama, hero rig, and flourish particles')
})
