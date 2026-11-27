import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAPTER_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import {
  DISCOVERY_TIPS,
  DISCOVERY_TIP_BY_ID,
  DISCOVERY_TIP_IDS,
  areDiscoveryTipsEnabled,
  checkDiscoveryTipForBattle,
  checkDiscoveryTipForCamp,
  checkDiscoveryTipForCodex,
  checkDiscoveryTipForWorldMap,
  detectBattleDiscoveryTips,
  dismissDiscoveryTip,
  dismissScreenDiscoveryTip,
  enqueueDiscoveryTip,
  getActiveDiscoveryTip,
  getActiveScreenDiscoveryTip,
  getDiscoveryTipBody,
  getDiscoveryTipHotkey,
  getDiscoveryTipSpec,
  hasSeenDiscoveryTip,
  isDiscoveryTipId,
  normalizeSeenTips,
  resetDiscoveryTips,
  setDiscoveryTipsEnabled,
  skipAllDiscoveryTips,
  triggerDiscoveryTip
} from '../examples/crownshard/crownshard/discovery-tips.ts'
import {
  SAVE_KEY,
  armTacticCard,
  beginWaitFacingPicker,
  confirmDeployment,
  createInitialState,
  loadSave,
  persistSave,
  restoreBattleState,
  serializeBattleState,
  serializeSave,
  startChapterBattle,
  checkDiscoveryTipForBattle as simCheckDiscoveryTipForBattle,
  dismissDiscoveryTip as simDismissDiscoveryTip,
  skipAllDiscoveryTips as simSkipAllDiscoveryTips
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type {
  CombatForecast,
  DiscoveryTipId,
  GameState,
  PathOpportunityPreview,
  SaveData,
  TileTerrain
} from '../examples/crownshard/crownshard/types.ts'
import { drawDiscoveryTipCard } from '../examples/crownshard/crownshard/ui-art.ts'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null },
    setItem(key: string, value: string) { store.set(key, value) },
    removeItem(key: string) { store.delete(key) }
  }
}

function markSeenExcept(state: GameState, ...keepUnseen: DiscoveryTipId[]): void {
  const keep = new Set<DiscoveryTipId>(keepUnseen)
  state.campaign.seenTips = DISCOVERY_TIP_IDS.filter(id => !keep.has(id))
  if (state.battle) {
    state.battle.activeTipId = null
    state.battle.tipQueue = []
  }
}

function flattenBoardToGrass(state: GameState): void {
  const battle = state.battle!
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = {
        col: c,
        row: r,
        terrain: 'grass',
        elevation: 0,
        walkable: true,
        heightLevel: 0
      }
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

test('catalog covers all 37 cross-screen mechanics/terrains and simulation re-exports helpers', () => {
  const expected: DiscoveryTipId[] = [
    // Original 11 battle tips
    'deploy',
    'move_attack',
    'high_ground',
    'facing_backstab',
    'shrine',
    'hazards',
    'zoc',
    'tactic_cards',
    'status_combos',
    'ko_revive',
    'objective_special',
    // Expanded 9 battle tips
    'pincer',
    'forced_movement',
    'destructible_cover',
    'counter_attack',
    'ct_timeline',
    'weather',
    'boss_telegraph',
    'stage_mechanic',
    'bond_assist',
    // 8 World Map tips
    'map_overview',
    'map_mastery',
    'map_oakhaven',
    'map_world_event',
    'map_challenge_tiers',
    'map_boss_rematch',
    'map_crownless_deep',
    'map_endless',
    // 8 Camp tips
    'camp_squad_merge',
    'camp_subspec',
    'camp_armory_diff',
    'camp_temper_sets',
    'camp_forge',
    'camp_tactic_deck',
    'camp_packs_pity',
    'camp_bonds',
    // 1 Codex tip
    'codex_overview'
  ]
  assert.deepEqual(DISCOVERY_TIP_IDS, expected)
  assert.equal(DISCOVERY_TIPS.length, expected.length)

  for (const id of expected) {
    assert.equal(isDiscoveryTipId(id), true)
    const spec = DISCOVERY_TIP_BY_ID[id]
    assert.ok(spec, `Missing tip spec for ${id}`)
    assert.equal(getDiscoveryTipSpec(id)?.id, id)
    assert.ok(['battle', 'world_map', 'camp', 'codex'].includes(spec.screen), `Invalid screen for ${id}`)
    assert.ok(spec.title.length >= 4)
    assert.ok(spec.body.length >= 20 && spec.body.length <= 180)
    assert.ok(spec.touchBody && spec.touchBody.length >= 20 && spec.touchBody.length <= 180, `Missing/bad touchBody for ${id}`)
    assert.match(spec.accentHex, /^#[0-9a-fA-F]{6}$/)
  }

  assert.equal(isDiscoveryTipId('unknown_tip'), false)
  assert.equal(getDiscoveryTipSpec('unknown_tip'), null)
  assert.equal(simCheckDiscoveryTipForBattle, checkDiscoveryTipForBattle)
  assert.equal(simDismissDiscoveryTip, dismissDiscoveryTip)
  assert.equal(simSkipAllDiscoveryTips, skipAllDiscoveryTips)
})

test('first-time triggers fire for deploy and move_attack and never repeat once dismissed', () => {
  const state = createInitialState(1337)
  assert.deepEqual(state.campaign.seenTips, [])
  assert.equal(areDiscoveryTipsEnabled(state.campaign), true)

  // Deploy phase fires `deploy` immediately
  startChapterBattle(state, 0, 0, { deployPhase: true })
  assert.equal(getActiveDiscoveryTip(state)?.id, 'deploy')
  assert.equal(hasSeenDiscoveryTip(state.campaign, 'deploy'), false)

  // Confirming deployment marks `deploy` seen and transitions to `move_attack`
  assert.equal(confirmDeployment(state), true)
  assert.equal(hasSeenDiscoveryTip(state.campaign, 'deploy'), true)
  assert.equal(getActiveDiscoveryTip(state)?.id, 'move_attack')

  // Dismissing `move_attack` marks it seen and clears the active tip
  assert.equal(dismissDiscoveryTip(state), 'move_attack')
  assert.equal(hasSeenDiscoveryTip(state.campaign, 'move_attack'), true)
  assert.equal(getActiveDiscoveryTip(state), null)

  // Starting a brand-new battle with deployPhase will NEVER show `deploy` or `move_attack` again
  startChapterBattle(state, 0, 0, { deployPhase: true })
  assert.equal(getActiveDiscoveryTip(state), null)
  assert.equal(confirmDeployment(state), true)
  assert.notEqual(getActiveDiscoveryTip(state)?.id, 'move_attack')
  assert.notEqual(getActiveDiscoveryTip(state)?.id, 'deploy')
})

test('every mechanic & terrain category triggers on first encounter', () => {
  // 1. high_ground (map elevation & hover/forecast)
  {
    const state = createInitialState(101)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'high_ground')
    assert.equal(checkDiscoveryTipForBattle(state), null, 'flat grass map should not trigger high_ground')

    state.battle!.cells[1][2] = { col: 2, row: 1, terrain: 'hill', elevation: 0.45, walkable: true, heightLevel: 1 }
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'high_ground')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 2. facing_backstab (Wait-to-Face picker and flank/backstab forecast)
  {
    const state = createInitialState(102)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'facing_backstab')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    const flankForecast = { attackArc: 'back', highGround: false } as unknown as CombatForecast
    assert.equal(checkDiscoveryTipForBattle(state, { forecast: flankForecast })?.id, 'facing_backstab')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state, { forecast: flankForecast }), null)

    // Also fires via Wait-to-Face picker when unseen
    const state2 = createInitialState(102)
    startChapterBattle(state2, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state2)
    markSeenExcept(state2, 'facing_backstab')
    assert.equal(beginWaitFacingPicker(state2), true)
    assert.equal(checkDiscoveryTipForBattle(state2)?.id, 'facing_backstab')
  }

  // 3. shrine (map presence & hover)
  {
    const state = createInitialState(103)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'shrine')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    state.battle!.cells[2][2] = { col: 2, row: 2, terrain: 'shrine', elevation: 0.16, walkable: true, heightLevel: 0 }
    assert.equal(checkDiscoveryTipForBattle(state, { hoveredCell: { col: 2, row: 2 } })?.id, 'shrine')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 4. hazards (each interactive hazard terrain: lava_geyser, ice, cursed_altar, tall_grass, barricade)
  const hazardKinds: TileTerrain[] = ['lava_geyser', 'ice', 'cursed_altar', 'tall_grass', 'barricade']
  for (const kind of hazardKinds) {
    const state = createInitialState(104)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'hazards')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    state.battle!.cells[2][3] = {
      col: 3,
      row: 2,
      terrain: kind,
      elevation: 0,
      walkable: kind !== 'barricade',
      heightLevel: 0
    }
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'hazards', `Expected hazards tip for terrain ${kind}`)
  }

  // 5. zoc (path OA preview & ally adjacent to enemy melee ZoC sentinel)
  {
    const state = createInitialState(105)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'zoc')
    // Move enemies far away from allies first
    const ally = state.battle!.units.find(u => u.team === 'ally' && u.alive)!
    ally.col = 0
    ally.row = 0
    for (const u of state.battle!.units) {
      if (u.team === 'enemy') {
        u.col = state.battle!.cols - 1
        u.row = state.battle!.rows - 1
      }
    }
    assert.equal(checkDiscoveryTipForBattle(state), null)

    const fakeOa: PathOpportunityPreview = {
      triggers: [{
        stepIndex: 0,
        fromCol: 0,
        fromRow: 0,
        toCol: 1,
        toRow: 0,
        attackerUid: 'enemy_0',
        attackerName: 'Goblin',
        attackerCol: 0,
        attackerRow: 1,
        projectedDamage: 8,
        projectedHpLoss: 8,
        attackArc: 'front',
        lethal: false
      }],
      totalDamage: 8,
      totalHpLoss: 8,
      lethal: false
    }
    assert.equal(checkDiscoveryTipForBattle(state, { pathOa: fakeOa })?.id, 'zoc')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state, { pathOa: fakeOa }), null)

    // Also fires when an ally stands orthogonally adjacent to an enemy melee sentinel
    const state2 = createInitialState(105)
    startChapterBattle(state2, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state2)
    markSeenExcept(state2, 'zoc')
    const ally2 = state2.battle!.units.find(u => u.team === 'ally' && u.alive)!
    const goblin = state2.battle!.units.find(u => u.team === 'enemy' && u.enemyId === 'goblin')!
    ally2.col = 2
    ally2.row = 2
    goblin.col = 3
    goblin.row = 2
    assert.equal(checkDiscoveryTipForBattle(state2)?.id, 'zoc')
  }

  // 6. tactic_cards (playable cards in hand / arming tactic card)
  {
    const state = createInitialState(106)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'tactic_cards')
    state.battle!.ap = 0
    assert.equal(checkDiscoveryTipForBattle(state), null, '0 AP and unarmed should wait for playable AP')

    state.battle!.ap = 2
    assert.ok(state.battle!.hand.length > 0)
    armTacticCard(state, state.battle!.hand[0])
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'tactic_cards')
  }

  // 7. status_combos (unit has status OR elemental combo forecast)
  {
    const state = createInitialState(107)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'status_combos')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    const enemy = state.battle!.units.find(u => u.team === 'enemy' && u.alive)!
    enemy.poisonStacks = 2
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'status_combos')
  }

  // 8. ko_revive (downed ally takes highest priority in player phase!)
  {
    const state = createInitialState(108)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    // Even if move_attack & others are unseen, downed ally triggers ko_revive first!
    state.battle!.activeTipId = null
    state.battle!.tipQueue = []
    const ally = state.battle!.units.find(u => u.team === 'ally' && u.uid !== state.battle!.activeUnitUid)!
    ally.alive = false
    ally.hp = 0
    ally.downed = true
    ally.koCountdown = 3
    const candidates = detectBattleDiscoveryTips(state.battle!)
    assert.equal(candidates[0], 'ko_revive')
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'ko_revive')
  }

  // 9. objective_special (non-rout missions: Seize, Defend, Assassinate; NOT Rout)
  {
    const state = createInitialState(109)
    // Chapter 0 (Border Watch) is Rout -> should NOT trigger objective_special
    startChapterBattle(state, CHAPTER_BY_ID.border_watch.index, 0, { deployPhase: true })
    markSeenExcept(state, 'objective_special')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    // Millers' Ford is Seize -> triggers objective_special!
    assert.equal(CHAPTER_BY_ID.miller_ford.objective?.kind, 'seize')
    startChapterBattle(state, CHAPTER_BY_ID.miller_ford.index, 0, { deployPhase: true })
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'objective_special')

    // Sunken Bridge is Defend -> triggers objective_special when unseen
    const stateDefend = createInitialState(110)
    startChapterBattle(stateDefend, CHAPTER_BY_ID.sunken_bridge.index, 0, { deployPhase: true })
    markSeenExcept(stateDefend, 'objective_special')
    assert.equal(CHAPTER_BY_ID.sunken_bridge.objective?.kind, 'defend')
    assert.equal(checkDiscoveryTipForBattle(stateDefend)?.id, 'objective_special')
  }
})

test('queue shows at most 1 tip at a time, deduplicates, and promotes next tip on dismiss', () => {
  const state = createInitialState(2026)
  startChapterBattle(state, 0, 0, { deployPhase: false })
  state.battle!.activeTipId = null
  state.battle!.tipQueue = []

  assert.equal(triggerDiscoveryTip(state, 'high_ground'), true)
  assert.equal(enqueueDiscoveryTip(state, 'shrine'), true)
  assert.equal(enqueueDiscoveryTip(state, 'shrine'), false, 'duplicate queue entry ignored')
  assert.equal(enqueueDiscoveryTip(state, 'high_ground'), false, 'already active tip ignored')
  assert.equal(enqueueDiscoveryTip(state, 'zoc'), true)

  assert.equal(getActiveDiscoveryTip(state)?.id, 'high_ground')
  assert.deepEqual(state.battle!.tipQueue, ['shrine', 'zoc'])

  // Dismiss 1st -> promotes 2nd
  assert.equal(dismissDiscoveryTip(state), 'high_ground')
  assert.equal(hasSeenDiscoveryTip(state.campaign, 'high_ground'), true)
  assert.equal(getActiveDiscoveryTip(state)?.id, 'shrine')
  assert.deepEqual(state.battle!.tipQueue, ['zoc'])

  // Dismiss 2nd -> promotes 3rd
  assert.equal(dismissDiscoveryTip(state), 'shrine')
  assert.equal(getActiveDiscoveryTip(state)?.id, 'zoc')
  assert.deepEqual(state.battle!.tipQueue, [])

  // Dismiss 3rd -> empty
  assert.equal(dismissDiscoveryTip(state), 'zoc')
  assert.equal(getActiveDiscoveryTip(state), null)
  assert.equal(dismissDiscoveryTip(state), null)

  // Re-triggering any dismissed tip fails
  assert.equal(enqueueDiscoveryTip(state, 'high_ground'), false)
  assert.equal(enqueueDiscoveryTip(state, 'shrine'), false)
  assert.equal(enqueueDiscoveryTip(state, 'zoc'), false)
})

test('skipAllDiscoveryTips suppresses all remaining tips and setDiscoveryTipsEnabled / resetDiscoveryTips restore cleanly', () => {
  const state = createInitialState(303)
  startChapterBattle(state, 0, 0, { deployPhase: true })
  enqueueDiscoveryTip(state, 'high_ground')
  assert.equal(getActiveDiscoveryTip(state)?.id, 'deploy')

  skipAllDiscoveryTips(state)
  assert.equal(state.campaign.tipsDisabled, true)
  assert.equal(areDiscoveryTipsEnabled(state.campaign), false)
  assert.equal(getActiveDiscoveryTip(state), null)
  assert.deepEqual(state.battle!.tipQueue, [])

  // No new tips fire while disabled
  assert.equal(enqueueDiscoveryTip(state, 'ko_revive'), false)
  assert.equal(checkDiscoveryTipForBattle(state), null)
  startChapterBattle(state, 1, 0, { deployPhase: true })
  assert.equal(getActiveDiscoveryTip(state), null)
  assert.equal(confirmDeployment(state), true)
  assert.equal(getActiveDiscoveryTip(state), null)

  // Re-enabling without reset preserves previously seen tips and allows unseen tips again
  state.campaign.seenTips = ['deploy']
  setDiscoveryTipsEnabled(state, true)
  assert.equal(areDiscoveryTipsEnabled(state.campaign), true)
  assert.equal(checkDiscoveryTipForBattle(state)?.id, 'move_attack')

  // Resetting clears both `tipsDisabled` and `seenTips`
  skipAllDiscoveryTips(state)
  resetDiscoveryTips(state)
  assert.equal(areDiscoveryTipsEnabled(state.campaign), true)
  assert.deepEqual(state.campaign.seenTips, [])
})

test('campaign save/load round-trip preserves seenTips & tipsDisabled and handles legacy saves safely', () => {
  const storage = memoryStorage()
  const state = createInitialState(404)
  startChapterBattle(state, 0, 0, { deployPhase: true })
  dismissDiscoveryTip(state) // marks 'deploy'
  confirmDeployment(state)
  dismissDiscoveryTip(state) // marks 'move_attack'
  enqueueDiscoveryTip(state, 'shrine')
  dismissDiscoveryTip(state) // marks 'shrine'
  skipAllDiscoveryTips(state)

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.deepEqual(loaded.campaign.seenTips, ['deploy', 'move_attack', 'shrine'])
  assert.equal(loaded.campaign.tipsDisabled, true)

  const hydrated = createInitialState(999, loaded)
  assert.deepEqual(hydrated.campaign.seenTips, ['deploy', 'move_attack', 'shrine'])
  assert.equal(hydrated.campaign.tipsDisabled, true)
  assert.equal(getActiveDiscoveryTip(hydrated), null)

  // Re-enabled save round-trip preserves seenTips and respects them on restored battle
  setDiscoveryTipsEnabled(hydrated, true)
  const snap = serializeBattleState(state.battle, state.campaign.seed)
  assert.ok(snap)
  assert.equal(restoreBattleState(hydrated, snap), true)
  assert.notEqual(getActiveDiscoveryTip(hydrated)?.id, 'deploy')
  assert.notEqual(getActiveDiscoveryTip(hydrated)?.id, 'move_attack')
  assert.notEqual(getActiveDiscoveryTip(hydrated)?.id, 'shrine')

  // Legacy save missing `seenTips` and `tipsDisabled` defaults safely to [] and false
  const fullSave: SaveData = serializeSave(createInitialState(505))
  const legacyRaw = JSON.parse(JSON.stringify(fullSave)) as {
    version: 1
    campaign: Record<string, unknown>
    activeBattle: null
  }
  delete legacyRaw.campaign.seenTips
  delete legacyRaw.campaign.tipsDisabled
  const legacyStorage = memoryStorage({ [SAVE_KEY]: JSON.stringify(legacyRaw) })

  const loadedLegacy = loadSave(legacyStorage)
  assert.ok(loadedLegacy)
  assert.deepEqual(loadedLegacy.campaign.seenTips, [])
  assert.equal(loadedLegacy.campaign.tipsDisabled, false)

  const fromLegacy = createInitialState(505, loadedLegacy)
  assert.deepEqual(fromLegacy.campaign.seenTips, [])
  assert.equal(fromLegacy.campaign.tipsDisabled, false)
  assert.equal(areDiscoveryTipsEnabled(fromLegacy.campaign), true)

  // Normalization strips unknown/duplicate/non-string entries cleanly
  assert.deepEqual(
    normalizeSeenTips(['deploy', 'invalid_id', 'deploy', 42, null, 'zoc', 'shrine', 'zoc']),
    ['deploy', 'zoc', 'shrine']
  )
})

test('drawDiscoveryTipCard renders every tip cleanly on a Canvas 2D context (full and compact)', () => {
  for (const tip of DISCOVERY_TIPS) {
    const full = fakeCanvas2dContext()
    drawDiscoveryTipCard(full.ctx, { x: 8, y: 94, width: 326, height: 126 }, tip, {
      compact: false,
      queuedCount: 2
    })
    assert.ok(full.ops > 10, `Expected draw ops for full tip card ${tip.id}`)
    assert.ok(
      full.texts.some(t => t.includes(tip.title)),
      `Expected title "${tip.title}" drawn for ${tip.id}`
    )
    assert.ok(
      full.texts.some(t => t.includes(tip.category.toUpperCase()) && t.includes('+2')),
      `Expected category kicker with queue badge for ${tip.id}`
    )

    const compact = fakeCanvas2dContext()
    drawDiscoveryTipCard(compact.ctx, { x: 6, y: 80, width: 286, height: 112 }, tip, {
      compact: true,
      queuedCount: 0
    })
    assert.ok(compact.ops > 10, `Expected draw ops for compact tip card ${tip.id}`)
    assert.ok(
      compact.texts.some(t => t.includes(tip.title)),
      `Expected compact title "${tip.title}" drawn for ${tip.id}`
    )
  }

  // Tiny rect guard should no-op safely without throwing
  const tiny = fakeCanvas2dContext()
  drawDiscoveryTipCard(tiny.ctx, { x: 0, y: 0, width: 10, height: 10 }, DISCOVERY_TIPS[0])
  assert.equal(tiny.ops, 0)
})

test('expanded 9 battle tips trigger on first encounter and do not repeat', () => {
  // 1. pincer (forecast pincerDmg / pincerAssisterUid OR board bracket)
  {
    const state = createInitialState(701)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'pincer')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    const pincerForecast = { pincerAssisterUid: 'ally_1', pincerDmg: 9, highGround: false, attackArc: 'front' } as unknown as CombatForecast
    assert.equal(checkDiscoveryTipForBattle(state, { forecast: pincerForecast })?.id, 'pincer')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state, { forecast: pincerForecast }), null)
  }

  // 2. forced_movement (forecast displacementPreview OR active unit with push/pull/swap skill)
  {
    const state = createInitialState(702)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'forced_movement')
    // Active unit on Border Watch is a starter hero (Archer or Knight) with a Tier 1 displacement skill
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'forced_movement')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 3. destructible_cover (barricade / cracked_pillar on map or forecast coverDamage)
  {
    const state = createInitialState(703)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'destructible_cover')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    state.battle!.cells[2][3] = { col: 3, row: 2, terrain: 'cracked_pillar', elevation: 0, walkable: false, heightLevel: 0 }
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'destructible_cover')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 4. counter_attack (forecast canCounter / counterDmg > 0)
  {
    const state = createInitialState(704)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'counter_attack')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    const counterForecast = { canCounter: true, counterDmg: 11, highGround: false, attackArc: 'front' } as unknown as CombatForecast
    assert.equal(checkDiscoveryTipForBattle(state, { forecast: counterForecast })?.id, 'counter_attack')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state, { forecast: counterForecast }), null)
  }

  // 5. ct_timeline (turn >= 2)
  {
    const state = createInitialState(705)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'ct_timeline')
    state.battle!.turn = 1
    assert.equal(checkDiscoveryTipForBattle(state), null)

    state.battle!.turn = 2
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'ct_timeline')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 6. weather (non-clear weather or non-day timeOfDay)
  {
    const state = createInitialState(706)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'weather')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    ;(state.battle as { weather: string }).weather = 'rain'
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'weather')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 7. boss_telegraph (bossTelegraphs non-empty)
  {
    const state = createInitialState(707)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'boss_telegraph')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    state.battle!.bossTelegraphs.push({
      id: 'tele_1',
      casterUid: 'boss_1',
      casterName: 'Frostwyrm',
      moveId: 'frostwyrm_breath',
      label: 'Glacial Breath',
      element: 'frost',
      cells: [{ col: 2, row: 2 }],
      damageMul: 1.5,
      flatDamage: 10,
      turnsRemaining: 1,
      phase: 1
    })
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'boss_telegraph')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 8. stage_mechanic (stageMechanic active on battle)
  {
    const state = createInitialState(708)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'stage_mechanic')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    state.battle!.stageMechanic = { tideHigh: true }
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'stage_mechanic')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }

  // 9. bond_assist (active bond pair within 2 tiles)
  {
    const state = createInitialState(709)
    startChapterBattle(state, 0, 0, { deployPhase: false })
    flattenBoardToGrass(state)
    markSeenExcept(state, 'bond_assist')
    assert.equal(checkDiscoveryTipForBattle(state), null)

    const allies = state.battle!.units.filter(u => u.team === 'ally' && u.alive && u.heroId)
    assert.ok(allies.length >= 2)
    allies[0].col = 1
    allies[0].row = 1
    allies[1].col = 2
    allies[1].row = 1
    state.battle!.bondPairsActive = [
      { key: `${allies[0].heroId}:${allies[1].heroId}`, heroA: allies[0].heroId!, heroB: allies[1].heroId!, battles: 5, rank: 1 }
    ]
    assert.equal(checkDiscoveryTipForBattle(state)?.id, 'bond_assist')
    dismissDiscoveryTip(state)
    assert.equal(checkDiscoveryTipForBattle(state), null)
  }
})

test('cross-screen tips (World Map, Camp, Codex) trigger once, persist in seenTips, respect tipsDisabled, and dismiss cleanly', () => {
  const state = createInitialState(808)
  const campaign = state.campaign

  // World Map: map_overview fires first, then contextual tips as unlocked
  assert.equal(checkDiscoveryTipForWorldMap(campaign)?.id, 'map_overview')
  assert.equal(getActiveScreenDiscoveryTip(campaign, 'world_map')?.id, 'map_overview')
  assert.equal(getActiveScreenDiscoveryTip(campaign, 'camp'), null, 'world_map tip must not show on camp screen')
  assert.equal(dismissScreenDiscoveryTip(campaign, 'world_map'), 'map_overview')
  assert.equal(hasSeenDiscoveryTip(campaign, 'map_overview'), true)
  assert.equal(getActiveScreenDiscoveryTip(campaign, 'world_map'), null)

  // Contextual world map tips
  const mapChecks: Array<[Parameters<typeof checkDiscoveryTipForWorldMap>[1], DiscoveryTipId]> = [
    [{ hasWorldEvent: true }, 'map_world_event'],
    [{ oakhavenUnlocked: true }, 'map_oakhaven'],
    [{ masteryUnlocked: true }, 'map_mastery'],
    [{ challengeUnlocked: true }, 'map_challenge_tiers'],
    [{ isBossRematch: true }, 'map_boss_rematch'],
    [{ crownlessDeepUnlocked: true }, 'map_crownless_deep'],
    [{ endlessUnlocked: true }, 'map_endless']
  ]
  for (const [ctx, expectedId] of mapChecks) {
    assert.equal(checkDiscoveryTipForWorldMap(campaign, ctx)?.id, expectedId)
    assert.equal(dismissScreenDiscoveryTip(campaign, 'world_map'), expectedId)
    assert.equal(hasSeenDiscoveryTip(campaign, expectedId), true)
    assert.equal(checkDiscoveryTipForWorldMap(campaign, ctx), null)
  }

  // Camp tips across all 5 tabs
  const campChecks: Array<[Parameters<typeof checkDiscoveryTipForCamp>[1], DiscoveryTipId]> = [
    [{ activeTab: 'squad' }, 'camp_squad_merge'],
    [{ activeTab: 'squad', has3StarHero: true }, 'camp_subspec'],
    [{ activeTab: 'squad', bondsUnlocked: true }, 'camp_bonds'],
    [{ activeTab: 'armory' }, 'camp_armory_diff'],
    [{ activeTab: 'armory', temperingUnlocked: true }, 'camp_temper_sets'],
    [{ activeTab: 'forge' }, 'camp_forge'],
    [{ activeTab: 'deck' }, 'camp_tactic_deck'],
    [{ activeTab: 'packs' }, 'camp_packs_pity']
  ]
  for (const [ctx, expectedId] of campChecks) {
    assert.equal(checkDiscoveryTipForCamp(campaign, ctx)?.id, expectedId)
    assert.equal(getActiveScreenDiscoveryTip(campaign, 'camp')?.id, expectedId)
    assert.equal(dismissScreenDiscoveryTip(campaign, 'camp'), expectedId)
    assert.equal(hasSeenDiscoveryTip(campaign, expectedId), true)
  }

  // Codex tip
  assert.equal(checkDiscoveryTipForCodex(campaign)?.id, 'codex_overview')
  assert.equal(getActiveScreenDiscoveryTip(campaign, 'codex')?.id, 'codex_overview')
  assert.equal(dismissScreenDiscoveryTip(campaign, 'codex'), 'codex_overview')
  assert.equal(checkDiscoveryTipForCodex(campaign), null)

  // Queue promotion & skipAllDiscoveryTips / resetDiscoveryTips clear screen tips too
  resetDiscoveryTips(state)
  assert.equal(campaign.activeScreenTipId, null)
  assert.deepEqual(campaign.screenTipQueue, [])

  assert.equal(checkDiscoveryTipForWorldMap(campaign)?.id, 'map_overview')
  campaign.screenTipQueue = ['map_mastery']
  assert.equal(dismissScreenDiscoveryTip(campaign, 'world_map'), 'map_overview')
  assert.equal(getActiveScreenDiscoveryTip(campaign, 'world_map')?.id, 'map_mastery')

  skipAllDiscoveryTips(state)
  assert.equal(campaign.activeScreenTipId, null)
  assert.deepEqual(campaign.screenTipQueue, [])
  assert.equal(checkDiscoveryTipForWorldMap(campaign, { hasWorldEvent: true }), null)
  assert.equal(checkDiscoveryTipForCamp(campaign, { activeTab: 'squad' }), null)
  assert.equal(checkDiscoveryTipForCodex(campaign), null)
})

test('modality-aware tip helpers return touch-clean copy and omit hotkeys on touch', () => {
  for (const spec of DISCOVERY_TIPS) {
    const desktopBody = getDiscoveryTipBody(spec, false)
    const touchBody = getDiscoveryTipBody(spec, true)

    assert.equal(desktopBody, spec.body)
    assert.ok(touchBody.length >= 20, `Expected non-empty touchBody for ${spec.id}`)
    assert.equal(
      /click/i.test(touchBody),
      false,
      `Touch body for ${spec.id} must not mention "Click": ${touchBody}`
    )
    assert.equal(
      /\bpress\s/i.test(touchBody),
      false,
      `Touch body for ${spec.id} must not mention "Press ": ${touchBody}`
    )
    assert.equal(
      /\(space\)/i.test(touchBody),
      false,
      `Touch body for ${spec.id} must not mention "(Space)": ${touchBody}`
    )

    assert.equal(getDiscoveryTipHotkey(spec, true), undefined, `Touch hotkey for ${spec.id} must be undefined`)
    assert.equal(getDiscoveryTipHotkey(spec, false), spec.hotkeyHint)
  }

  // Verify specific desktop tips retain their hotkeys on desktop
  assert.ok(getDiscoveryTipHotkey(DISCOVERY_TIP_BY_ID.deploy, false))
  assert.ok(getDiscoveryTipHotkey(DISCOVERY_TIP_BY_ID.move_attack, false))
})
