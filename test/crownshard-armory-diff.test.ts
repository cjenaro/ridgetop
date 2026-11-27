import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ARMORY_STAT_ORDER,
  computeEquipmentStatDiff,
  formatCompactStatDelta,
  formatStatDelta
} from '../examples/crownshard/crownshard/armory-diff.ts'
import type { ArmoryStatKey } from '../examples/crownshard/crownshard/armory-diff.ts'
import { EQUIPMENT_BY_ID, HERO_SPECS } from '../examples/crownshard/crownshard/data.ts'
import {
  computeHeroStats,
  createInitialState,
  equipItem,
  getHeroByUid
} from '../examples/crownshard/crownshard/simulation.ts'
import type { CampaignState, GameState, OwnedEquipCard } from '../examples/crownshard/crownshard/types.ts'
import {
  drawArmoryStatDiffPanel,
  drawStatStrip
} from '../examples/crownshard/crownshard/ui-art.ts'
import type { StatStripItem } from '../examples/crownshard/crownshard/ui-art.ts'

interface RecordedTextDraw {
  readonly text: string
  readonly fillStyle: string
}

function fakeCanvas2dContext() {
  let ops = 0
  const texts: RecordedTextDraw[] = []
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
      texts.push({ text: String(text), fillStyle: String(ctx.fillStyle) })
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

function addEquip(campaign: CampaignState, equipId: string): OwnedEquipCard {
  const spec = EQUIPMENT_BY_ID[equipId]
  assert.ok(spec, `Unknown equipment id: ${equipId}`)
  const card: OwnedEquipCard = {
    uid: `eq_test_${campaign.nextUid++}`,
    equipId: spec.id,
    slot: spec.slot
  }
  campaign.equipment.push(card)
  return card
}

function assertExactEquipParity(state: GameState, heroUid: string, candidateUid: string) {
  const diff = computeEquipmentStatDiff(state.campaign, heroUid, candidateUid)
  assert.ok(diff, 'Expected non-null EquipmentStatDiff')

  const cloned: GameState = structuredClone(state)
  const ok = equipItem(cloned, heroUid, candidateUid)
  assert.equal(ok, true)
  const heroAfter = getHeroByUid(cloned.campaign, heroUid)!
  const realAfter = computeHeroStats(cloned.campaign, heroAfter)

  assert.equal(diff.stats.atk.after, realAfter.atk, 'ATK after parity')
  assert.equal(diff.stats.def.after, realAfter.def, 'DEF after parity')
  assert.equal(diff.stats.maxHp.after, realAfter.maxHp, 'HP after parity')
  assert.equal(diff.stats.speed.after, realAfter.speed, 'SPD after parity')
  assert.equal(diff.stats.move.after, realAfter.move, 'MOVE after parity')
  assert.equal(diff.stats.range.after, realAfter.range, 'RANGE after parity')
  assert.equal(diff.stats.crit.after, Math.round(realAfter.crit * 100), 'CRIT % after parity')
  assert.equal(diff.powerAfter, realAfter.powerScore, 'Power after parity')
  assert.equal(diff.netPowerDelta, diff.powerAfter - diff.powerBefore, 'netPowerDelta parity')
  return diff
}

test('computeEquipmentStatDiff never mutates campaign state across all comparison scenarios', () => {
  const state = createInitialState(1337)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const archer = campaign.heroes[1]

  const crownblade = addEquip(campaign, 'solis_crownblade')
  const heart = addEquip(campaign, 'heart_of_solis')
  const cloak = addEquip(campaign, 'ranger_cloak')

  const snapshotBefore = JSON.stringify(campaign)

  // Empty relic slot, weapon upgrade, armor trade-off, cross-hero swap, already-equipped, invalid UIDs
  computeEquipmentStatDiff(campaign, knight.uid, heart.uid)
  computeEquipmentStatDiff(campaign, knight.uid, crownblade.uid)
  computeEquipmentStatDiff(campaign, knight.uid, cloak.uid)
  computeEquipmentStatDiff(campaign, knight.uid, archer.weaponUid!)
  computeEquipmentStatDiff(campaign, knight.uid, knight.weaponUid!)
  computeEquipmentStatDiff(campaign, 'missing_hero', crownblade.uid)
  computeEquipmentStatDiff(campaign, knight.uid, 'missing_equip')

  assert.equal(
    JSON.stringify(campaign),
    snapshotBefore,
    'computeEquipmentStatDiff must never mutate campaign or hero equipment slots'
  )
})

test('computeEquipmentStatDiff accurately computes positive, negative, zero, and mixed deltas across all 7 stats', () => {
  const state = createInitialState(2026)
  const { campaign } = state
  const knight = campaign.heroes[0] // Starts with iron_sword (+5 ATK, +4% CRIT) & leather_jerkin (+14 HP, +2 DEF), empty relic

  // 1. Empty slot -> Heart of Solis (+12 ATK, +4 DEF, +34 HP, +3 SPD, +1 MOVE, +0 RANGE, +18% CRIT)
  const heart = addEquip(campaign, 'heart_of_solis')
  const emptyRelicDiff = assertExactEquipParity(state, knight.uid, heart.uid)
  assert.equal(emptyRelicDiff.heroName, HERO_SPECS.knight.name)
  assert.equal(emptyRelicDiff.slot, 'relic')
  assert.equal(emptyRelicDiff.candidateName, 'Heart of Solis')
  assert.equal(emptyRelicDiff.currentItemName, null)
  assert.equal(emptyRelicDiff.isAlreadyEquipped, false)
  assert.equal(emptyRelicDiff.currentOwnerName, null)
  assert.equal(emptyRelicDiff.stats.atk.delta, 12)
  assert.equal(emptyRelicDiff.stats.def.delta, 4)
  assert.equal(emptyRelicDiff.stats.maxHp.delta, 34)
  assert.equal(emptyRelicDiff.stats.speed.delta, 3)
  assert.equal(emptyRelicDiff.stats.move.delta, 1)
  assert.equal(emptyRelicDiff.stats.range.delta, 0)
  assert.equal(emptyRelicDiff.stats.crit.delta, 18)
  assert.ok(emptyRelicDiff.netPowerDelta > 0)
  assert.equal(emptyRelicDiff.hasAnyChange, true)

  // 2. Empty relic slot -> Skyhawk Crest (+8 ATK, +1 DEF, +14 HP, +2 SPD, +0 MOVE, +1 RANGE, +20% CRIT)
  const skyhawk = addEquip(campaign, 'eagle_charm')
  const rangeUpgradeDiff = assertExactEquipParity(state, knight.uid, skyhawk.uid)
  assert.equal(rangeUpgradeDiff.stats.range.before, 1)
  assert.equal(rangeUpgradeDiff.stats.range.after, 2)
  assert.equal(rangeUpgradeDiff.stats.range.delta, 1)
  assert.equal(rangeUpgradeDiff.stats.crit.delta, 20)

  // 3. Weapon upgrade: Iron Broadsword -> Dragonfang Halberd (+10 ATK, +2 DEF, +10 HP, +1 SPD, +0 MOVE, +1 RANGE, +8% CRIT)
  const halberd = addEquip(campaign, 'dragonfang_spear')
  const weaponUpgrade = assertExactEquipParity(state, knight.uid, halberd.uid)
  assert.equal(weaponUpgrade.currentItemName, 'Iron Broadsword')
  assert.equal(weaponUpgrade.stats.atk.delta, 10)
  assert.equal(weaponUpgrade.stats.def.delta, 2)
  assert.equal(weaponUpgrade.stats.maxHp.delta, 10)
  assert.equal(weaponUpgrade.stats.speed.delta, 1)
  assert.equal(weaponUpgrade.stats.move.delta, 0)
  assert.equal(weaponUpgrade.stats.range.delta, 1)
  assert.equal(weaponUpgrade.stats.crit.delta, 8)
  assert.ok(weaponUpgrade.netPowerDelta > 0)

  // 4. Equip top-tier gear on knight, then compare downgrades across weapon, armor, and relic
  const crownblade = addEquip(campaign, 'solis_crownblade')
  const aegis = addEquip(campaign, 'aegis_of_dawn')
  const ironPlate = addEquip(campaign, 'iron_plate')
  const ironSwordUid = knight.weaponUid!
  const signet = addEquip(campaign, 'copper_signet')

  assert.equal(equipItem(state, knight.uid, crownblade.uid), true)
  assert.equal(equipItem(state, knight.uid, aegis.uid), true)
  assert.equal(equipItem(state, knight.uid, heart.uid), true)

  // Downgrade weapon: Solis Crownblade -> Iron Broadsword
  const weaponDowngrade = assertExactEquipParity(state, knight.uid, ironSwordUid)
  assert.equal(weaponDowngrade.stats.atk.delta, -17)
  assert.equal(weaponDowngrade.stats.def.delta, -3)
  assert.equal(weaponDowngrade.stats.maxHp.delta, -16)
  assert.equal(weaponDowngrade.stats.speed.delta, -2)
  assert.equal(weaponDowngrade.stats.move.delta, 0)
  assert.equal(weaponDowngrade.stats.range.delta, 0)
  assert.equal(weaponDowngrade.stats.crit.delta, -21)
  assert.ok(weaponDowngrade.netPowerDelta < 0)

  // Downgrade relic: Heart of Solis -> Copper Signet (tests negative MOVE too!)
  const relicDowngrade = assertExactEquipParity(state, knight.uid, signet.uid)
  assert.equal(relicDowngrade.stats.atk.delta, -9)
  assert.equal(relicDowngrade.stats.def.delta, -3)
  assert.equal(relicDowngrade.stats.maxHp.delta, -26)
  assert.equal(relicDowngrade.stats.speed.delta, -2)
  assert.equal(relicDowngrade.stats.move.delta, -1)
  assert.equal(relicDowngrade.stats.crit.delta, -13)
  assert.ok(relicDowngrade.netPowerDelta < 0)

  // Downgrade armor: Aegis of Dawn -> Watchman Plate (both Vanguard plate)
  const armorDowngrade = assertExactEquipParity(state, knight.uid, ironPlate.uid)
  assert.equal(armorDowngrade.stats.atk.delta, -4)
  assert.equal(armorDowngrade.stats.def.delta, -7)
  assert.equal(armorDowngrade.stats.maxHp.delta, -40)
  assert.equal(armorDowngrade.stats.speed.delta, -2)
  assert.ok(armorDowngrade.netPowerDelta < 0)

  // 5. Mixed trade-off: Heart of Solis -> Skyhawk Crest (-4 ATK, -3 DEF, -20 HP, -1 SPD, -1 MOVE, +1 RANGE, +2% CRIT)
  const mixedDiff = assertExactEquipParity(state, knight.uid, skyhawk.uid)
  assert.equal(mixedDiff.stats.atk.delta, -4)
  assert.equal(mixedDiff.stats.def.delta, -3)
  assert.equal(mixedDiff.stats.maxHp.delta, -20)
  assert.equal(mixedDiff.stats.speed.delta, -1)
  assert.equal(mixedDiff.stats.move.delta, -1)
  assert.equal(mixedDiff.stats.range.delta, 1)
  assert.equal(mixedDiff.stats.crit.delta, 2)
  assert.equal(mixedDiff.hasAnyChange, true)

  // 6. Already-equipped item on same hero -> all 7 deltas are 0 and netPowerDelta === 0
  const selfDiff = computeEquipmentStatDiff(campaign, knight.uid, crownblade.uid)!
  assert.equal(selfDiff.isAlreadyEquipped, true)
  assert.equal(selfDiff.currentOwnerName, null)
  assert.equal(selfDiff.netPowerDelta, 0)
  assert.equal(selfDiff.hasAnyChange, false)
  for (const meta of ARMORY_STAT_ORDER) {
    const key: ArmoryStatKey = meta.key
    assert.equal(selfDiff.stats[key].delta, 0, `Already-equipped ${key} delta must be 0`)
    assert.equal(selfDiff.stats[key].before, selfDiff.stats[key].after)
  }
})

test('computeEquipmentStatDiff preserves hero level and xp when computing hypothetical stats', () => {
  const state = createInitialState(777)
  const { campaign } = state
  const knight = campaign.heroes[0]
  knight.level = 13
  knight.xp = 42

  const sunsteel = addEquip(campaign, 'sunsteel_blade')
  const diff = assertExactEquipParity(state, knight.uid, sunsteel.uid)
  assert.equal(diff.stats.atk.delta > 0, true, 'Sunsteel Blade must show positive ATK delta on a Lv 13 hero')
  assert.equal(diff.stats.maxHp.delta, 0, 'Sunsteel Blade must not subtract hero level HP bonuses')
  assert.equal(diff.netPowerDelta > 0, true, 'Net power delta must be positive on a leveled hero')
})

test('computeEquipmentStatDiff identifies cross-hero ownership, class compatibility, and respects stat clamps', () => {
  const state = createInitialState(9001)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const archer = campaign.heroes[1] // Starts wearing Yew Longbow (hunter_bow)

  // Compatible cross-hero swap: Knight inspecting Paladin's Sunsteel Blade
  const paladin = {
    uid: 'hero_paladin_swap',
    heroId: 'paladin' as const,
    stars: 1 as const,
    weaponUid: null as string | null,
    armorUid: null as string | null,
    relicUid: null as string | null
  }
  campaign.heroes.push(paladin)
  const sunsteel = addEquip(campaign, 'sunsteel_blade')
  assert.equal(equipItem(state, paladin.uid, sunsteel.uid), true)

  const swapDiff = assertExactEquipParity(state, knight.uid, sunsteel.uid)
  assert.equal(swapDiff.compatible, true)
  assert.equal(swapDiff.incompatibilityReason, null)
  assert.equal(swapDiff.isAlreadyEquipped, false)
  assert.equal(swapDiff.currentOwnerUid, paladin.uid)
  assert.equal(swapDiff.currentOwnerName, HERO_SPECS.paladin.name)
  assert.equal(swapDiff.candidateName, 'Sunsteel Blade')
  assert.equal(swapDiff.currentItemName, 'Iron Broadsword')
  assert.equal(swapDiff.stats.atk.delta, 6)
  assert.equal(swapDiff.stats.speed.delta, 1)
  assert.equal(swapDiff.stats.crit.delta, 10)

  // Incompatible cross-family inspection: Knight inspecting Archer's Yew Longbow
  const lockedDiff = computeEquipmentStatDiff(campaign, knight.uid, archer.weaponUid!)!
  assert.equal(lockedDiff.compatible, false)
  assert.ok(lockedDiff.incompatibilityReason && lockedDiff.incompatibilityReason.includes('Bows/Light'))
  assert.equal(lockedDiff.currentOwnerUid, archer.uid)
  assert.equal(lockedDiff.currentOwnerName, HERO_SPECS.archer.name)
  assert.equal(lockedDiff.netPowerDelta, 0)

  // Invalid lookups return null safely
  assert.equal(computeEquipmentStatDiff(campaign, 'nonexistent_hero', archer.weaponUid!), null)
  assert.equal(computeEquipmentStatDiff(campaign, knight.uid, 'nonexistent_equip'), null)

  // Formatting helpers
  assert.equal(formatStatDelta(8, false), '▲ +8')
  assert.equal(formatStatDelta(-5, true), '▼ -5%')
  assert.equal(formatStatDelta(0, true), '0%')
  assert.equal(formatCompactStatDelta(12, false), '▲+12')
  assert.equal(formatCompactStatDelta(-4, true), '▼-4%')
})

test('drawArmoryStatDiffPanel and drawStatStrip render green ▲ +N and red ▼ -N arrows cleanly across all states', () => {
  const state = createInitialState(404)
  const { campaign } = state
  const knight = campaign.heroes[0]
  const archer = campaign.heroes[1]

  const crownblade = addEquip(campaign, 'solis_crownblade')
  const heart = addEquip(campaign, 'heart_of_solis')
  const skyhawk = addEquip(campaign, 'eagle_charm')
  const ironSwordUid = knight.weaponUid!

  // Case A: Pure upgrade on empty slot (green ▲ +N arrows + Empty Slot header)
  const upgradeDiff = computeEquipmentStatDiff(campaign, knight.uid, heart.uid)!
  {
    const canvas = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(canvas.ctx, { x: 20, y: 20, width: 740, height: 64 }, upgradeDiff)
    assert.ok(canvas.ops > 20, 'Expected substantial draw calls for upgrade diff panel')
    assert.ok(
      canvas.texts.some(t => t.text.includes('Heart of Solis') && t.text.includes('Empty Slot')),
      'Header should display candidate vs Empty Slot'
    )
    assert.ok(
      canvas.texts.some(t => t.text.includes('▲ +12') && t.fillStyle === '#52f598'),
      'Expected green ▲ +12 ATK arrow'
    )
    assert.ok(
      canvas.texts.some(t => t.text.includes('▲ +18%') && t.fillStyle === '#52f598'),
      'Expected green ▲ +18% CRIT arrow'
    )
    assert.ok(
      canvas.texts.some(t => t.text.includes(`▲ +${upgradeDiff.netPowerDelta} PWR`)),
      'Expected positive net power delta badge'
    )
  }

  // Case B: Pure downgrade (red ▼ -N arrows)
  assert.equal(equipItem(state, knight.uid, crownblade.uid), true)
  const downgradeDiff = computeEquipmentStatDiff(campaign, knight.uid, ironSwordUid)!
  {
    const { ctx, texts } = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(ctx, { x: 20, y: 20, width: 740, height: 64 }, downgradeDiff)
    assert.ok(
      texts.some(t => t.text.includes('▼ -17') && t.fillStyle === '#ff6b7a'),
      'Expected red ▼ -17 ATK arrow'
    )
    assert.ok(
      texts.some(t => t.text.includes('▼ -21%') && t.fillStyle === '#ff6b7a'),
      'Expected red ▼ -21% CRIT arrow'
    )
    assert.ok(
      texts.some(t => t.text.includes(`▼ ${downgradeDiff.netPowerDelta} PWR`)),
      'Expected negative net power delta badge'
    )
  }

  // Case C: Mixed trade-off + cross-hero swap + mobile narrow 2-row layout
  assert.equal(equipItem(state, knight.uid, heart.uid), true)
  assert.equal(equipItem(state, archer.uid, skyhawk.uid), true)
  const mixedSwapDiff = computeEquipmentStatDiff(campaign, knight.uid, skyhawk.uid)!
  {
    const { ctx, texts } = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(ctx, { x: 8, y: 8, width: 740, height: 64 }, mixedSwapDiff)
    assert.ok(
      texts.some(t => t.text.includes('▲ +1') && t.fillStyle === '#52f598'),
      'Mixed trade-off should render green ▲ +1 RANGE arrow'
    )
    assert.ok(
      texts.some(t => t.text.includes('▲ +2%') && t.fillStyle === '#52f598'),
      'Mixed trade-off should render green ▲ +2% CRIT arrow'
    )
    assert.ok(
      texts.some(t => t.text.includes('▼ -4') && t.fillStyle === '#ff6b7a'),
      'Mixed trade-off should render red ▼ -4 ATK arrow'
    )
    assert.ok(
      texts.some(t => t.text.includes(HERO_SPECS.archer.name)),
      'Cross-hero comparison should surface current owner name'
    )

    // Narrow mobile layout (triggers 2-row 4+3 wrap)
    const mobileCanvas = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(mobileCanvas.ctx, { x: 6, y: 6, width: 340, height: 78 }, mixedSwapDiff)
    assert.ok(mobileCanvas.ops > 20)
    assert.ok(mobileCanvas.texts.some(t => t.text.includes('▲ +1')))
    assert.ok(mobileCanvas.texts.some(t => t.text.includes('▼ -4')))
  }

  // Case D: Already-equipped item renders EQUIPPED badge without throwing
  const alreadyDiff = computeEquipmentStatDiff(campaign, knight.uid, crownblade.uid)!
  {
    const { ctx, texts } = fakeCanvas2dContext()
    drawArmoryStatDiffPanel(ctx, { x: 20, y: 20, width: 680, height: 60 }, alreadyDiff)
    assert.ok(texts.some(t => t.text === 'EQUIPPED'))
  }

  // Case E: drawStatStrip renders live green/red diff delta tags at wide & narrow widths
  const stripItems: StatStripItem[] = [
    { icon: 'heart', label: 'HP', value: '124', color: '#3ee07f', delta: -20, deltaText: '▼-20' },
    { icon: 'sword', label: 'ATK', value: '49', color: '#ffb36b', delta: -4, deltaText: '▼-4' },
    { icon: 'shield', label: 'DEF', value: '15', color: '#8fc8ff', delta: -3, deltaText: '▼-3' },
    { icon: 'bolt', label: 'SPD', value: '13', color: '#ffe27a', delta: -1, deltaText: '▼-1' },
    { icon: 'boot', label: 'MOV', value: '4', color: '#c4b5ff', delta: -1, deltaText: '▼-1' },
    { icon: 'target', label: 'RNG', value: '1', color: '#6dd9ff', delta: 1, deltaText: '▲+1' },
    { icon: 'crit', label: 'CRIT', value: '53%', color: '#ff8da1', delta: 2, deltaText: '▲+2%' }
  ]
  for (const width of [760, 480, 320]) {
    const { ctx, texts } = fakeCanvas2dContext()
    drawStatStrip(ctx, { x: 0, y: 0, width, height: 34 }, stripItems)
    assert.ok(texts.some(t => t.text === '▲+1' && t.fillStyle === '#52f598'), `Width ${width}: expected green ▲+1`)
    assert.ok(texts.some(t => t.text === '▼-20' && t.fillStyle === '#ff6b7a'), `Width ${width}: expected red ▼-20`)
  }
})
