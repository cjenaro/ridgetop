import assert from 'node:assert/strict'
import test from 'node:test'
import { boxNode, column, overlay, resolveLayout, row, spacerNode } from '../packages/ridgetop/framework/ui.ts'
import type { CanvasWidgetDrawState, LayoutRect } from '../packages/ridgetop/framework/ui.ts'
import { HERO_LIST, HERO_SPECS } from '../examples/crownshard/crownshard/data.ts'
import {
  ALL_HERO_SUB_SPEC_IDS,
  HERO_SUB_SPECS,
  getEffectiveHeroSkill,
  getEffectiveHeroTitle,
  getHeroSubSpecById,
  getHeroSubSpecOptions,
  isValidSubSpecForHero,
  needsSubSpecChoice,
  sanitizeHeroSubSpec,
  selectHeroSubSpec
} from '../examples/crownshard/crownshard/sub-specializations.ts'
import {
  SAVE_KEY,
  armSkill,
  computeHeroStats,
  confirmDeployment,
  createInitialState,
  getHeroSkill,
  loadSave,
  mergeHero,
  persistSave,
  planAutoBattleAction,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  serializeSave,
  startChapterBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type { HeroClassId, HeroSubSpecId, OwnedHeroCard, SaveData } from '../examples/crownshard/crownshard/types.ts'
import {
  drawHeroHeader,
  drawHeroRosterCard,
  drawSubSpecCard,
  drawSubSpecHeader
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
    strokeRect() { ops++ },
    clearRect() {},
    fillText(t: string) { texts.push(t); ops++ },
    strokeText(t: string) { texts.push(t); ops++ },
    measureText(t: string) { return { width: t.length * 6.5 } },
    drawImage() { ops++ },
    setLineDash() {},
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, getOps: () => ops, texts }
}

const IDLE_WIDGET_STATE: CanvasWidgetDrawState = {
  hovered: false,
  pressed: false,
  focused: false,
  disabled: false,
  selected: false
}

test('all 8 hero classes define exactly 2 unique, valid 3-star mastery paths with distinct skills and stat bonuses', () => {
  assert.equal(HERO_LIST.length, 8)
  assert.equal(ALL_HERO_SUB_SPEC_IDS.length, 16)
  assert.equal(new Set(ALL_HERO_SUB_SPEC_IDS).size, 16)

  const seenSkillIds = new Set<string>()
  const seenTitles = new Set<string>()

  for (const heroSpec of HERO_LIST) {
    const options = getHeroSubSpecOptions(heroSpec.id)
    assert.equal(options.length, 2, `${heroSpec.id} should have exactly 2 mastery paths`)
    const [a, b] = options

    assert.notEqual(a.id, b.id)
    assert.equal(a.heroId, heroSpec.id)
    assert.equal(b.heroId, heroSpec.id)
    assert.notEqual(a.title, b.title)
    assert.notEqual(a.ultimate.id, b.ultimate.id)
    assert.notEqual(a.ultimate.name, b.ultimate.name)
    assert.notEqual(JSON.stringify(a.bonuses), JSON.stringify(b.bonuses))

    for (const opt of options) {
      assert.equal(getHeroSubSpecById(opt.id)?.id, opt.id)
      assert.equal(isValidSubSpecForHero(heroSpec.id, opt.id), true)
      assert.equal(opt.ultimate.tier, 3)
      assert.ok(opt.statSummary.length > 0)
      assert.ok(opt.summary.length > 0)
      assert.ok(opt.ultimate.desc.length > 0)
      assert.equal(seenSkillIds.has(opt.ultimate.id), false, `duplicate ultimate id ${opt.ultimate.id}`)
      seenSkillIds.add(opt.ultimate.id)
      assert.equal(seenTitles.has(opt.title), false, `duplicate title ${opt.title}`)
      seenTitles.add(opt.title)
    }

    // Cross-class validation must reject another class's sub-spec
    const otherHero = HERO_LIST.find(h => h.id !== heroSpec.id)!
    const [otherPath] = HERO_SUB_SPECS[otherHero.id]
    assert.equal(isValidSubSpecForHero(heroSpec.id, otherPath.id), false)
  }
})

test('selectHeroSubSpec rejects 1-star, 2-star, unknown UID, and mismatched class IDs', () => {
  const state = createInitialState(101)
  const knight = state.campaign.heroes.find(h => h.heroId === 'knight')!
  assert.equal(knight.stars, 1)
  assert.equal(needsSubSpecChoice(knight), false)

  // 1-star cannot pick
  assert.equal(selectHeroSubSpec(state, knight.uid, 'knight_templar'), false)
  assert.equal(knight.subSpecId, undefined)

  // 2-star cannot pick
  knight.stars = 2
  assert.equal(needsSubSpecChoice(knight), false)
  assert.equal(selectHeroSubSpec(state, knight.uid, 'knight_templar'), false)
  assert.equal(knight.subSpecId, undefined)

  // 3-star rejects wrong class and unknown UID
  knight.stars = 3
  assert.equal(needsSubSpecChoice(knight), true)
  assert.equal(selectHeroSubSpec(state, knight.uid, 'archer_sharpshooter'), false)
  assert.equal(selectHeroSubSpec(state, 'missing_hero_uid', 'knight_templar'), false)
  assert.equal(knight.subSpecId, undefined)
})

test('ascending to 3-star via mergeHero keeps legacy baseline until chosen, then updates stats, title, and Skill 3', () => {
  const state = createInitialState(202)
  const knight = state.campaign.heroes.find(h => h.heroId === 'knight')!
  knight.weaponUid = null
  knight.armorUid = null
  knight.relicUid = null
  knight.stars = 2

  // Add second 2-star knight copy for 2★ -> 3★ ascension
  const fodder: OwnedHeroCard = {
    uid: 'hero_fodder_knight_2s',
    heroId: 'knight',
    stars: 2,
    level: 1,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  state.campaign.heroes.push(fodder)

  assert.equal(mergeHero(state, knight.uid), true)
  assert.equal(knight.stars, 3)
  assert.equal(knight.subSpecId, undefined)
  assert.equal(needsSubSpecChoice(knight), true)
  assert.equal(getEffectiveHeroTitle('knight', 3, knight.subSpecId), HERO_SPECS.knight.title)

  const base3StarStats = computeHeroStats(state.campaign, knight)

  // Pick Templar (+12 HP, +2 DEF, Aegis Judgment)
  assert.equal(selectHeroSubSpec(state, knight.uid, 'knight_templar'), true)
  assert.equal(needsSubSpecChoice(knight), false)
  assert.equal(getEffectiveHeroTitle('knight', 3, knight.subSpecId), 'Templar')
  const templarStats = computeHeroStats(state.campaign, knight)
  assert.equal(templarStats.maxHp, base3StarStats.maxHp + 12)
  assert.equal(templarStats.def, base3StarStats.def + 2)
  assert.equal(templarStats.atk, base3StarStats.atk)
  assert.equal(getEffectiveHeroSkill('knight', 2, knight.subSpecId)?.id, 'aegis_judgment')

  // Switch to Juggernaut (+4 ATK, +16 HP, Crown Cleave w/ knockback)
  assert.equal(selectHeroSubSpec(state, knight.uid, 'knight_juggernaut'), true)
  assert.equal(getEffectiveHeroTitle('knight', 3, knight.subSpecId), 'Juggernaut')
  const juggernautStats = computeHeroStats(state.campaign, knight)
  assert.equal(juggernautStats.maxHp, base3StarStats.maxHp + 16)
  assert.equal(juggernautStats.atk, base3StarStats.atk + 4)
  assert.equal(juggernautStats.def, base3StarStats.def)
  const jugUlt = getEffectiveHeroSkill('knight', 2, knight.subSpecId)
  assert.equal(jugUlt?.id, 'solar_cleave')
  assert.deepEqual(jugUlt?.displacement, { kind: 'knockback', distance: 1 })
})

test('switching between Path A and Path B updates stats and battle Skill 3 across all 8 classes', () => {
  const classes: readonly HeroClassId[] = [
    'knight', 'archer', 'mage', 'cleric', 'rogue', 'paladin', 'cryomancer', 'champion'
  ]
  for (const heroId of classes) {
    const state = createInitialState(303)
    const hero: OwnedHeroCard = {
      uid: `hero_test_${heroId}`,
      heroId,
      stars: 3,
      level: 1,
      xp: 0,
      weaponUid: null,
      armorUid: null,
      relicUid: null
    }
    state.campaign.heroes = [hero]
    state.campaign.squadUids = [hero.uid]

    const baseStats = computeHeroStats(state.campaign, hero)
    const [pathA, pathB] = getHeroSubSpecOptions(heroId)

    for (const path of [pathA, pathB]) {
      assert.equal(selectHeroSubSpec(state, hero.uid, path.id), true)
      const stats = computeHeroStats(state.campaign, hero)
      assert.equal(stats.maxHp, baseStats.maxHp + (path.bonuses.hp ?? 0), `${path.id} HP`)
      assert.equal(stats.atk, baseStats.atk + (path.bonuses.atk ?? 0), `${path.id} ATK`)
      assert.equal(stats.def, baseStats.def + (path.bonuses.def ?? 0), `${path.id} DEF`)
      assert.equal(stats.speed, baseStats.speed + (path.bonuses.speed ?? 0), `${path.id} SPD`)
      assert.equal(stats.move, baseStats.move + (path.bonuses.move ?? 0), `${path.id} MOV`)
      assert.equal(stats.range, baseStats.range + (path.bonuses.range ?? 0), `${path.id} RNG`)
      assert.ok(Math.abs(stats.crit - (baseStats.crit + (path.bonuses.crit ?? 0))) < 1e-9, `${path.id} CRIT`)
      assert.ok(Math.abs(stats.lifesteal - (baseStats.lifesteal + (path.bonuses.lifesteal ?? 0))) < 1e-9, `${path.id} Lifesteal`)

      assert.ok(startChapterBattle(state, 0))
      if (state.battle!.phase === 'deploy') confirmDeployment(state)
      const battleUnit = state.battle!.units.find(u => u.uid === hero.uid)!
      assert.equal(battleUnit.subSpecId, path.id)
      const battleUlt = getHeroSkill(battleUnit, 2)
      assert.equal(battleUlt?.id, path.ultimate.id)
      assert.equal(battleUlt?.name, path.ultimate.name)
    }
  }
})

test('casting every alternate 3-star ultimate in battle executes cleanly with expected combat effects', () => {
  const altPaths: readonly {
    heroId: HeroClassId
    subSpecId: HeroSubSpecId
    verify: (caster: NonNullable<ReturnType<typeof createInitialState>['battle']>['units'][number], ally: NonNullable<ReturnType<typeof createInitialState>['battle']>['units'][number], enemy: NonNullable<ReturnType<typeof createInitialState>['battle']>['units'][number]) => void
  }[] = [
    {
      heroId: 'knight',
      subSpecId: 'knight_templar',
      verify: (caster, ally, enemy) => {
        assert.ok(caster.shield >= 22, 'Templar gains +22 shield')
        assert.ok(caster.hp > 20, 'Templar heals self')
        assert.ok(ally.hp > 20, 'Templar heals adjacent ally')
        assert.ok(enemy.hp < enemy.maxHp, 'Templar damages enemy')
      }
    },
    {
      heroId: 'knight',
      subSpecId: 'knight_juggernaut',
      verify: (_caster, _ally, enemy) => {
        assert.ok(enemy.hp < enemy.maxHp, 'Juggernaut damages enemy')
        if (enemy.alive) {
          assert.ok(enemy.stunTurns >= 1, 'Juggernaut stuns enemy')
          assert.ok(enemy.col > 3, 'Juggernaut knocks enemy back 1 tile')
        }
      }
    },
    {
      heroId: 'archer',
      subSpecId: 'archer_stormwarden',
      verify: (_caster, _ally, enemy) => {
        assert.ok(enemy.hp < enemy.maxHp, 'Stormwarden damages enemy')
        if (enemy.alive) {
          assert.ok(enemy.slowTurns >= 1, 'Stormwarden slows enemy')
          assert.ok(enemy.col > 3, 'Stormwarden knocks enemy back')
        }
      }
    },
    {
      heroId: 'mage',
      subSpecId: 'mage_archmage',
      verify: (caster, _ally, enemy) => {
        assert.ok(caster.empowerTurns >= 1, 'Archmage empowers self')
        assert.ok(enemy.hp < enemy.maxHp, 'Archmage damages enemy')
        if (enemy.alive) {
          assert.ok(enemy.col < 4, 'Archmage pulls enemy 1 tile')
        }
      }
    },
    {
      heroId: 'cleric',
      subSpecId: 'cleric_inquisitor',
      verify: (caster, _ally, enemy) => {
        assert.ok(caster.shield >= 14, 'Solar Inquisitor gains +14 shield')
        assert.ok(enemy.hp < enemy.maxHp, 'Solar Inquisitor damages enemy')
        if (enemy.alive) assert.ok(enemy.burnTurns >= 1, 'Solar Inquisitor applies Burn')
      }
    },
    {
      heroId: 'rogue',
      subSpecId: 'rogue_shadowdancer',
      verify: (caster, _ally, enemy) => {
        assert.ok(caster.hasteTurns >= 1, 'Shadow Dancer gains Haste')
        assert.ok(enemy.hp < enemy.maxHp, 'Shadow Dancer damages enemy')
        if (enemy.alive) {
          assert.ok(enemy.poisonStacks >= 3, 'Shadow Dancer inflicts Poison x3')
          assert.equal(caster.col, 3, 'Shadow Dancer swaps with target')
        }
      }
    },
    {
      heroId: 'paladin',
      subSpecId: 'paladin_sentinel',
      verify: (caster, ally) => {
        assert.ok(caster.shield >= 42, 'Bastion Sentinel gains +42 shield')
        assert.ok(caster.tauntTurns >= 1, 'Bastion Sentinel gains Taunt')
        assert.ok(caster.empowerTurns >= 1, 'Bastion Sentinel gains Empower')
        assert.ok(ally.shield >= 42, 'Bastion Sentinel shields adjacent ally')
        assert.ok(ally.hp > 20, 'Bastion Sentinel heals adjacent ally')
        assert.ok(ally.empowerTurns >= 1, 'Bastion Sentinel empowers adjacent ally')
      }
    },
    {
      heroId: 'cryomancer',
      subSpecId: 'cryomancer_glacier_lord',
      verify: (caster, ally, enemy) => {
        assert.ok(caster.shield >= 26, 'Glacier Lord gains +26 shield')
        assert.ok(ally.shield >= 26, 'Glacier Lord shields adjacent ally')
        assert.ok(enemy.hp < enemy.maxHp, 'Glacier Lord damages enemy')
        if (enemy.alive) assert.ok(enemy.slowTurns >= 1, 'Glacier Lord slows enemy')
      }
    },
    {
      heroId: 'champion',
      subSpecId: 'champion_starforged',
      verify: (caster, _ally, enemy) => {
        assert.ok(caster.shield >= 30, 'Starforged gains +30 shield')
        assert.ok(caster.hasteTurns >= 1, 'Starforged gains Haste')
        assert.ok(enemy.hp < enemy.maxHp, 'Starforged damages enemy')
        if (enemy.alive) assert.ok(enemy.burnTurns >= 1, 'Starforged applies Burn')
      }
    }
  ]

  for (const tc of altPaths) {
    const state = createInitialState(404)
    const casterCard: OwnedHeroCard = {
      uid: `hero_caster_${tc.subSpecId}`,
      heroId: tc.heroId,
      stars: 3,
      subSpecId: tc.subSpecId,
      level: 1,
      xp: 0,
      weaponUid: null,
      armorUid: null,
      relicUid: null
    }
    const allyCard: OwnedHeroCard = {
      uid: `hero_ally_${tc.subSpecId}`,
      heroId: 'archer',
      stars: 1,
      level: 1,
      xp: 0,
      weaponUid: null,
      armorUid: null,
      relicUid: null
    }
    state.campaign.heroes = [casterCard, allyCard]
    state.campaign.squadUids = [casterCard.uid, allyCard.uid]

    assert.ok(startChapterBattle(state, 0))
    if (state.battle!.phase === 'deploy') confirmDeployment(state)
    const battle = state.battle!

    // Normalize flat walkable grass board for deterministic positioning & displacement checks
    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        battle.cells[r][c].terrain = 'grass'
        battle.cells[r][c].walkable = true
        battle.cells[r][c].elevation = 0
      }
    }

    const caster = battle.units.find(u => u.uid === casterCard.uid)!
    const ally = battle.units.find(u => u.uid === allyCard.uid)!
    const enemy = battle.units.find(u => u.team === 'enemy' && u.alive)!

    // Move any extra enemies out of the way
    for (const u of battle.units) {
      if (u.team === 'enemy' && u.uid !== enemy.uid) {
        u.col = 7
        u.row = 5
      }
    }

    // Position caster at (2,2), adjacent ally at (1,2), enemy at (3,2) or (4,2) for pull test
    caster.col = 2
    caster.row = 2
    caster.hp = 20
    caster.shield = 0
    caster.acted = false
    caster.moved = false
    caster.stunTurns = 0
    caster.cooldowns = [0, 0, 0]

    ally.col = 1
    ally.row = 2
    ally.hp = 20
    ally.shield = 0

    const enemyCol = tc.subSpecId === 'mage_archmage' ? 4 : 3
    enemy.col = enemyCol
    enemy.row = 2
    enemy.maxHp = 500
    enemy.hp = 500
    enemy.shield = 0

    battle.phase = 'player'
    battle.activeUnitUid = caster.uid
    battle.selectedUnitUid = caster.uid

    const ult = getHeroSkill(caster, 2)!
    assert.equal(ult.id, getHeroSubSpecById(tc.subSpecId)!.ultimate.id)

    assert.equal(armSkill(state, 2), true, `arming ${ult.name} should succeed`)
    if (ult.target !== 'self') {
      // First click creates pending forecast/confirmation or executes; handle confirm flow cleanly
      assert.equal(selectTile(state, enemy.col, enemy.row), true, `targeting (${enemy.col},${enemy.row}) for ${ult.name}`)
      if (!caster.acted) {
        assert.equal(selectTile(state, enemy.col, enemy.row), true, `confirming ${ult.name}`)
      }
    }
    assert.equal(caster.acted, true, `${ult.name} should execute`)
    assert.equal(caster.cooldowns[2], ult.cooldown, `${ult.name} should set cooldown`)
    tc.verify(caster, ally, enemy)
  }
})

test('auto-battle plans using the chosen 3-star mastery ultimate skill', () => {
  const state = createInitialState(505)
  const paladinCard: OwnedHeroCard = {
    uid: 'hero_paladin_sentinel',
    heroId: 'paladin',
    stars: 3,
    subSpecId: 'paladin_sentinel',
    level: 1,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  state.campaign.heroes = [paladinCard]
  state.campaign.squadUids = [paladinCard.uid]

  assert.ok(startChapterBattle(state, 0))
  if (state.battle!.phase === 'deploy') confirmDeployment(state)
  const battle = state.battle!
  const paladin = battle.units.find(u => u.uid === paladinCard.uid)!
  battle.phase = 'player'
  battle.activeUnitUid = paladin.uid
  paladin.hp = Math.round(paladin.maxHp * 0.4)
  paladin.cooldowns = [2, 2, 0]

  const plan = planAutoBattleAction(state)
  assert.ok(plan !== null)
  // Verify auto-battle sees Immortal Bastion (self aura heal+shield) cleanly without throwing
  assert.equal(getHeroSkill(paladin, 2)?.id, 'immortal_bastion')
})

test('SaveData and BattleSaveSnapshot round-trip preserves subSpecId and handles legacy/corrupted saves gracefully', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(606)
  const knight = state.campaign.heroes.find(h => h.heroId === 'knight')!
  const archer = state.campaign.heroes.find(h => h.heroId === 'archer')!

  // Legacy 3-star archer without subSpecId + specialized 3-star knight
  knight.stars = 3
  archer.stars = 3
  assert.equal(selectHeroSubSpec(state, knight.uid, 'knight_templar'), true)
  assert.equal(archer.subSpecId, undefined)

  // Start battle so BattleSaveSnapshot is also populated
  assert.ok(startChapterBattle(state, 0))
  if (state.battle!.phase === 'deploy') confirmDeployment(state)

  const battleSnap = serializeBattleState(state.battle, state.campaign.seed)
  assert.ok(battleSnap !== null)
  assert.equal(battleSnap.units.find(u => u.uid === knight.uid)?.subSpecId, 'knight_templar')
  assert.equal(battleSnap.units.find(u => u.uid === archer.uid)?.subSpecId, undefined)

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded !== null)

  const restored = createInitialState(999, loaded)
  const restoredKnight = restored.campaign.heroes.find(h => h.uid === knight.uid)!
  const restoredArcher = restored.campaign.heroes.find(h => h.uid === archer.uid)!
  assert.equal(restoredKnight.subSpecId, 'knight_templar')
  assert.equal(restoredArcher.subSpecId, undefined)
  assert.equal(needsSubSpecChoice(restoredKnight), false)
  assert.equal(needsSubSpecChoice(restoredArcher), true)

  // Battle state also restored with subSpecId intact
  assert.ok(restored.battle !== null)
  const battleKnight = restored.battle.units.find(u => u.uid === knight.uid)!
  const battleArcher = restored.battle.units.find(u => u.uid === archer.uid)!
  assert.equal(battleKnight.subSpecId, 'knight_templar')
  assert.equal(getHeroSkill(battleKnight, 2)?.id, 'aegis_judgment')
  assert.equal(battleArcher.subSpecId, undefined)
  assert.equal(getHeroSkill(battleArcher, 2)?.id, 'hawks_snipe')

  // Corrupted save: wrong class subSpecId or subSpecId on 1-star hero is sanitized away safely
  const rawSave: SaveData = serializeSave(state)
  const mutatedSave = JSON.parse(JSON.stringify(rawSave))
  mutatedSave.campaign.heroes[0].subSpecId = 'archer_sharpshooter' // wrong class for knight
  mutatedSave.campaign.heroes[1].stars = 1
  mutatedSave.campaign.heroes[1].subSpecId = 'archer_sharpshooter' // < 3 stars
  mutatedSave.activeBattle.units[0].subSpecId = 'mage_archmage' // wrong class in battle snapshot
  storage.setItem(SAVE_KEY, JSON.stringify(mutatedSave))

  const sanitized = loadSave(storage)
  assert.ok(sanitized !== null)
  assert.equal(sanitized.campaign.heroes[0].subSpecId, undefined)
  assert.equal(sanitized.campaign.heroes[1].subSpecId, undefined)
  assert.equal(sanitizeHeroSubSpec('knight', 3, 'not_a_real_id'), undefined)

  const battleState = createInitialState(707)
  assert.equal(restoreBattleState(battleState, mutatedSave.activeBattle), true)
  assert.equal(battleState.battle!.units[0].subSpecId, undefined)
})

test('Camp 3-star mastery UI drawers render cleanly across mobile portrait, landscape phone, and desktop card sizes', () => {
  const state = createInitialState(808)
  const knight = state.campaign.heroes.find(h => h.heroId === 'knight')!
  knight.stars = 3
  const [templar, juggernaut] = getHeroSubSpecOptions('knight')

  // Test across mobile portrait (375x667 -> card ~158x66), landscape phone (844x390 -> card ~282x58), desktop (1280x720 -> card ~180x68)
  const cardSizes = [
    { width: 158, height: 66 },
    { width: 282, height: 58 },
    { width: 180, height: 68 }
  ]

  for (const sz of cardSizes) {
    const fake = fakeCanvas2dContext()
    drawSubSpecHeader(fake.ctx, { x: 0, y: 0, width: sz.width * 2 + 6, height: 15 }, {
      needsChoice: true,
      animTime: 1.2
    })
    drawSubSpecCard(fake.ctx, { x: 0, y: 18, width: sz.width, height: sz.height }, templar, IDLE_WIDGET_STATE, {
      active: false,
      needsChoice: true,
      animTime: 1.2
    })
    drawSubSpecCard(fake.ctx, { x: sz.width + 6, y: 18, width: sz.width, height: sz.height }, juggernaut, {
      ...IDLE_WIDGET_STATE,
      selected: true
    }, {
      active: true,
      needsChoice: false,
      animTime: 1.2
    })
    assert.ok(fake.getOps() > 10)
    assert.ok(fake.texts.some(t => t.includes('Templar')))
    assert.ok(fake.texts.some(t => t.includes('Juggernaut')))
  }

  // Hero header & roster card with active mastery title and pending mastery badge
  const fake2 = fakeCanvas2dContext()
  drawHeroHeader(fake2.ctx, { x: 0, y: 0, width: 340, height: 44 }, {
    name: HERO_SPECS.knight.name,
    title: 'Templar',
    stars: 3,
    rarity: HERO_SPECS.knight.rarity,
    power: 420,
    inSquad: true,
    hasSubSpec: true,
    needsSubSpec: false
  })
  drawHeroRosterCard(fake2.ctx, { x: 0, y: 50, width: 220, height: 48 }, {
    hero: knight,
    spec: HERO_SPECS.knight,
    inSquad: true,
    copies: 1,
    need: 0,
    readyMerge: false,
    token: false,
    needsSubSpec: true
  }, IDLE_WIDGET_STATE)
  assert.ok(fake2.texts.includes('Templar'))
  assert.ok(fake2.texts.includes('3★ PICK!'))
})

function rectsOverlap(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function rectInside(inner: LayoutRect, outer: LayoutRect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  )
}

test('Camp 3-star mastery picker layout has zero clipping/overlap and generous touch targets at 375x667, 390x844, 844x390, and 1280x720', () => {
  const viewports = [
    { name: 'mobile-se-portrait', w: 375, h: 667, withPager: true },
    { name: 'mobile-iphone14-portrait', w: 390, h: 844, withPager: true },
    { name: 'mobile-landscape', w: 844, h: 390, withPager: true },
    { name: 'desktop-720p', w: 1280, h: 720, withPager: false }
  ] as const

  for (const vp of viewports) {
    const { w, h } = vp
    const mobile = w < 720
    const shortH = !mobile && h < 480
    const isPhone = mobile || shortH
    const wide = w >= 980 && !shortH
    const sheetW = Math.min(w - (isPhone ? 12 : 24), 1120)
    const sheetH = mobile
      ? Math.min(h - 112, 576)
      : shortH
        ? Math.min(h - 56, 326)
        : wide
          ? Math.min(Math.max(326, Math.round(h * 0.49)), 376)
          : Math.min(h - 90, Math.max(368, Math.round(h * 0.52)))

    const headerH = shortH ? 38 : mobile ? 44 : 50
    const statsH = shortH ? 28 : mobile ? 30 : 38
    const actRowH = shortH ? 30 : mobile ? 32 : 36
    const gearHeaderH = shortH || mobile ? 20 : 24
    const gearH = shortH ? 36 : mobile ? 40 : 48
    const passiveH = wide ? 32 : 24
    const subSpecHeaderH = 15
    const subSpecCardH = wide ? 68 : shortH ? 58 : mobile ? 66 : 62
    const skillRowH = wide ? 34 : 24

    const subSpecPicker = column({ id: 'sq-subspec-wrap', style: { height: subSpecHeaderH + 3 + subSpecCardH, gap: 3 } }, [
      boxNode({ id: 'sq-subspec-hdr', style: { height: subSpecHeaderH } }),
      row({ id: 'sq-subspec-row', style: { height: subSpecCardH, gap: 6 } }, [
        boxNode({ id: 'sq-subspec-0', style: { grow: 1, height: subSpecCardH } }),
        boxNode({ id: 'sq-subspec-1', style: { grow: 1, height: subSpecCardH } })
      ])
    ])

    const actions = row({ id: 'ins-actions', style: { height: actRowH, gap: 8 } }, [
      boxNode({ id: 'cs-merge-hero', style: { grow: 1.4, height: actRowH } }),
      boxNode({ id: 'cs-toggle-squad', style: { grow: 1.1, height: actRowH } }),
      boxNode({ id: 'cs-lock-hero', style: { width: mobile ? 36 : 40, height: actRowH } }),
      boxNode({ id: 'cs-salvage-hero', style: { width: mobile ? 86 : 104, height: actRowH } })
    ])

    const pager = row({ id: 'cr-pager', hidden: !vp.withPager, style: { height: 26, gap: 6 } }, [
      boxNode({ id: 'cr-prev', style: { grow: 1, height: 26 } }),
      boxNode({ id: 'cr-next', style: { grow: 1, height: 26 } })
    ])

    const skills = [0, 1, 2].map(i => boxNode({ id: `ins-sk-${i}`, style: { height: skillRowH } }))
    const body = mobile
      ? column({ id: 'camp-squad-body', style: { grow: 1, gap: 5 } }, [
          row({ id: 'camp-roster-row', style: { height: 56, gap: 6 } }, [
            boxNode({ id: 'camp-hero-0', style: { grow: 1, height: 56 } }),
            boxNode({ id: 'camp-hero-1', style: { grow: 1, height: 56 } })
          ]),
          pager,
          column({ id: 'camp-inspector-col', style: { grow: 1, gap: 4, padding: 8 } }, [
            boxNode({ id: 'ins-head', style: { height: headerH } }),
            boxNode({ id: 'ins-stats', style: { height: statsH } }),
            boxNode({ id: 'ins-passive', style: { height: passiveH } }),
            actions,
            boxNode({ id: 'ins-eq-head', style: { height: gearHeaderH } }),
            boxNode({ id: 'ins-eq-row', style: { height: gearH } }),
            subSpecPicker,
            ...skills.slice(0, h >= 760 ? 3 : 2)
          ])
        ])
      : wide
        ? row({ id: 'camp-squad-body', style: { grow: 1, gap: 10 } }, [
            column({ id: 'camp-roster-col', style: { width: 228, gap: 6 } }, [
              boxNode({ id: 'camp-hero-0', style: { height: 48 } }),
              spacerNode(1),
              pager
            ]),
            column({ id: 'camp-inspector-col', style: { grow: 1.25, gap: 7, padding: 11 } }, [
              boxNode({ id: 'ins-head', style: { height: headerH } }),
              boxNode({ id: 'ins-stats', style: { height: statsH } }),
              actions,
              boxNode({ id: 'ins-eq-head', style: { height: gearHeaderH } }),
              boxNode({ id: 'ins-eq-row', style: { height: gearH } })
            ]),
            column({ id: 'camp-skills-col', style: { grow: 0.95, gap: 4, padding: 10 } }, [
              boxNode({ id: 'ins-passive', style: { height: passiveH } }),
              subSpecPicker,
              boxNode({ id: 'ins-sk-lbl', style: { height: 13 } }),
              ...skills
            ])
          ])
        : row({ id: 'camp-squad-body', style: { grow: 1, gap: 10 } }, [
            column({ id: 'camp-roster-col', style: { width: 214, gap: 6 } }, [
              boxNode({ id: 'camp-hero-0', style: { height: 48 } }),
              spacerNode(1),
              pager
            ]),
            column({ id: 'camp-inspector-col', style: { grow: 1, gap: 4, padding: shortH ? 7 : 9 } }, [
              boxNode({ id: 'ins-head', style: { height: headerH } }),
              boxNode({ id: 'ins-stats', style: { height: statsH } }),
              actions,
              boxNode({ id: 'ins-eq-head', style: { height: gearHeaderH } }),
              boxNode({ id: 'ins-eq-row', style: { height: gearH } }),
              subSpecPicker
            ])
          ])

    const tree = overlay({ id: 'root' }, [
      column({
        id: 'camp-modal',
        style: {
          anchor: 'bottom',
          width: sheetW,
          height: sheetH,
          inset: isPhone ? 6 : 12,
          padding: shortH ? [10, 12, 8, 12] : [16, 14, 12, 14],
          gap: shortH ? 6 : 10
        }
      }, [
        boxNode({ id: 'camp-tabs-row', style: { height: shortH ? 34 : 38 } }),
        body
      ])
    ])

    const rects = resolveLayout(tree, { width: w, height: h })
    const modalRect = rects.get('camp-modal')!
    const c0 = rects.get('sq-subspec-0')!
    const c1 = rects.get('sq-subspec-1')!
    const mergeBtn = rects.get('cs-merge-hero')!
    const deployBtn = rects.get('cs-toggle-squad')!
    const rosterRect = rects.get(mobile ? 'camp-roster-row' : 'camp-roster-col')!
    const parentCol = rects.get(wide ? 'camp-skills-col' : 'camp-inspector-col')!

    assert.ok(c0.width >= 140 && c0.height >= 54, `${vp.name} sq-subspec-0 touch target too small: ${c0.width}x${c0.height}`)
    assert.ok(c1.width >= 140 && c1.height >= 54, `${vp.name} sq-subspec-1 touch target too small: ${c1.width}x${c1.height}`)
    assert.equal(rectsOverlap(c0, c1), false, `${vp.name} mastery cards overlap each other`)
    assert.equal(rectsOverlap(c0, mergeBtn), false, `${vp.name} sq-subspec-0 overlaps Ascend button`)
    assert.equal(rectsOverlap(c0, deployBtn), false, `${vp.name} sq-subspec-0 overlaps Deploy button`)
    assert.equal(rectsOverlap(c0, rosterRect), false, `${vp.name} sq-subspec-0 overlaps roster`)
    assert.equal(rectsOverlap(c1, rosterRect), false, `${vp.name} sq-subspec-1 overlaps roster`)
    assert.equal(rectInside(c0, parentCol), true, `${vp.name} sq-subspec-0 clips outside container`)
    assert.equal(rectInside(c1, parentCol), true, `${vp.name} sq-subspec-1 clips outside container`)
    assert.equal(rectInside(c0, modalRect), true, `${vp.name} sq-subspec-0 clips outside camp-modal`)
    assert.equal(rectInside(c1, modalRect), true, `${vp.name} sq-subspec-1 clips outside camp-modal`)
    // Also verify bottom-most skill row fits inside modal on mobile & desktop
    const lastSkill = rects.get(mobile ? (h >= 760 ? 'ins-sk-2' : 'ins-sk-1') : wide ? 'ins-sk-2' : 'sq-subspec-1')!
    assert.equal(rectInside(lastSkill, parentCol), true, `${vp.name} bottom item clips outside container`)
  }
})
