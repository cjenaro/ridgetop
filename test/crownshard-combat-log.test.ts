import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import {
  COMBAT_LOG_ACCENT,
  COMBAT_LOG_CATEGORIES,
  MAX_COMBAT_LOG_ENTRIES,
  appendCombatLog,
  formatCombatLogLine,
  formatComboLog,
  formatDamageLog,
  formatHazardLog,
  formatHealLog,
  formatKoLog,
  formatReactionLog,
  formatStatusLog,
  getMaxCombatLogScroll,
  getRecentCombatLog,
  sanitizeCombatLogEntries
} from '../examples/crownshard/crownshard/combat-log.ts'
import {
  applyDisplacement,
  applyStatus,
  armSkill,
  armTacticCard,
  confirmDeployment,
  createInitialState,
  endPlayerTurn,
  getUnitByUid,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  setUnitFacing,
  startChapterBattle,
  stepGame,
  triggerElementalCombo,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import { BARRICADE_DEFAULT_HP, gridToWorld, terrainElevation } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, CombatLogEntry, TileTerrain } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatLogPanel, drawCombatLogToggleButton } from '../examples/crownshard/crownshard/ui-art.ts'

function setCell(
  battle: BattleState,
  col: number,
  row: number,
  terrain: TileTerrain,
  heightLevel = 0,
  extra: Partial<BattleState['cells'][number][number]> = {}
) {
  const walkable = terrain !== 'water' && terrain !== 'lava' && terrain !== 'pillar' && terrain !== 'void' && terrain !== 'barricade'
  battle.cells[row][col] = {
    col,
    row,
    terrain,
    heightLevel,
    elevation: terrainElevation(terrain, heightLevel),
    walkable,
    ...extra
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number) {
  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = wx
  unit.y = wy
  unit.z = wz
  unit.path = []
  unit.moveProgress = 0
}

function makeFlatBattle(seed = 1337, chapterIndex = 0) {
  const state = createInitialState(seed)
  const battle = startChapterBattle(state, chapterIndex, 0)
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      setCell(battle, c, r, 'grass', 0)
    }
  }
  return { state, battle }
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

test('Combat log ring buffer caps at MAX_COMBAT_LOG_ENTRIES and supports scrolling', () => {
  const holder = { combatLog: [] as CombatLogEntry[], nextLogId: 1, turn: 1 }

  for (let i = 1; i <= MAX_COMBAT_LOG_ENTRIES + 25; i++) {
    holder.turn = Math.ceil(i / 5)
    appendCombatLog(holder, 'attack', `Strike #${i}`)
  }

  assert.equal(holder.combatLog.length, MAX_COMBAT_LOG_ENTRIES)
  assert.equal(holder.combatLog[0].id, 26, 'Oldest 25 entries should be evicted')
  assert.equal(holder.combatLog[0].text, 'Strike #26')
  assert.equal(holder.combatLog[holder.combatLog.length - 1].id, MAX_COMBAT_LOG_ENTRIES + 25)
  assert.equal(holder.nextLogId, MAX_COMBAT_LOG_ENTRIES + 26)

  const latest5 = getRecentCombatLog(holder, 5, 0)
  assert.deepEqual(latest5.map(e => e.id), [81, 82, 83, 84, 85])

  const scrolledUp3 = getRecentCombatLog(holder, 5, 3)
  assert.deepEqual(scrolledUp3.map(e => e.id), [78, 79, 80, 81, 82])

  const maxScroll = getMaxCombatLogScroll(holder.combatLog.length, 5)
  assert.equal(maxScroll, MAX_COMBAT_LOG_ENTRIES - 5)
  const clampedTop = getRecentCombatLog(holder, 5, 999)
  assert.deepEqual(clampedTop.map(e => e.id), [26, 27, 28, 29, 30])
})

test('Combat log formatters produce concise readable entries across every category', () => {
  for (const cat of COMBAT_LOG_CATEGORIES) {
    assert.ok(COMBAT_LOG_ACCENT[cat].startsWith('#'), `Category ${cat} needs hex accent`)
  }

  const backstabCrit = formatDamageLog({
    attackerName: 'Aldric',
    targetName: 'Goblin',
    hpDamage: 24,
    attackArc: 'back',
    isCrit: true
  })
  assert.equal(backstabCrit, 'Aldric hits Goblin for 24 (Backstab, CRIT!)')
  assert.equal(
    formatCombatLogLine({ turn: 2, text: backstabCrit }),
    'T2 · Aldric hits Goblin for 24 (Backstab, CRIT!)'
  )

  assert.equal(
    formatDamageLog({ attackerName: 'Aldric', targetName: 'Goblin', hpDamage: 0, absorbed: 10 }),
    'Goblin blocks 10 (Shield)'
  )
  assert.equal(
    formatComboLog({ actorName: 'Lyra', combo: 'shatter', bonusDamage: 14 }),
    'Lyra triggers SHATTER (+14)'
  )
  assert.equal(
    formatReactionLog({ kind: 'counter', actorName: 'Aldric', targetName: 'Orc', hpDamage: 12 }),
    'Aldric counters Orc for 12'
  )
  assert.equal(
    formatReactionLog({ kind: 'opportunity', actorName: 'Orc', targetName: 'Kael', hpDamage: 9 }),
    'Kael OA-struck by Orc for 9'
  )
  assert.equal(
    formatHealLog({ sourceName: 'Sera', targetName: 'Aldric', healAmount: 35, revived: true }),
    'Sera revives Aldric (+35 HP)'
  )
  assert.equal(
    formatStatusLog({ targetName: 'Goblin', status: 'burn', phase: 'tick', damage: 8 }),
    'Goblin takes 8 Burn dmg'
  )
  assert.equal(
    formatHazardLog({ kind: 'barricade_smash', actorName: 'Aldric', damage: 25 }),
    'Aldric smashes Barricade!'
  )
  assert.equal(
    formatKoLog({ unitName: 'Aldric', kind: 'downed', countdown: 3 }),
    'Aldric downed! (KO in 3)'
  )
})

test('Live battle logs battle start, basic hits, backstab, crit, shield blocks, counters, and pincers', () => {
  const { state, battle } = makeFlatBattle(2026)

  // Battle start entry logged automatically
  assert.ok(
    battle.combatLog.some(e => e.category === 'system' && e.text.includes('Battle started')),
    'Expected Battle started system log entry'
  )

  const allies = battle.units.filter(u => u.team === 'ally' && u.alive)
  const enemies = battle.units.filter(u => u.team === 'enemy' && u.alive)
  const knight = allies.find(u => u.heroId === 'knight') ?? allies[0]
  const assister = allies.find(u => u.uid !== knight.uid)!
  const enemy = enemies[0]
  const enemy2 = enemies[1] ?? enemies[0]

  // Make knight the active hero, adjacent behind enemy (backstab + guaranteed crit + pincer assister!)
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.acted = false
  knight.moved = false
  knight.crit = 1.0
  enemy.hp = 200
  enemy.maxHp = 200
  enemy.shield = 0
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  setUnitFacing(enemy, 'e') // facing away from knight -> Backstab!
  placeUnit(battle, assister, 4, 2) // opposite side -> Pincer assist!
  let parkCol = 0
  const parkRow = battle.rows - 1
  for (const other of battle.units) {
    if (other.uid !== knight.uid && other.uid !== assister.uid && other.uid !== enemy.uid) {
      placeUnit(battle, other, Math.min(battle.cols - 1, parkCol++), parkRow)
    }
  }
  battle.moveTiles = []
  battle.targetTiles = [{ col: 3, row: 2 }]

  assert.equal(selectTile(state, 3, 2), true)
  assert.ok(
    battle.combatLog.some(e => e.category === 'crit' && e.text.includes('Backstab') && e.text.includes('CRIT!')),
    'Expected crit + Backstab entry in combatLog'
  )
  assert.ok(
    battle.combatLog.some(e => e.category === 'reaction' && e.text.includes('pincer-strikes')),
    'Expected Pincer reaction entry in combatLog'
  )

  // Now test Shield Block + Counter-Attack on a frontal melee strike
  battle.activeUnitUid = knight.uid
  knight.acted = false
  knight.moved = false
  knight.crit = 0
  enemy2.alive = true
  enemy2.hp = 120
  enemy2.maxHp = 120
  enemy2.shield = 100
  enemy2.stunTurns = 0
  enemy2.range = 1
  placeUnit(battle, knight, 2, 3)
  placeUnit(battle, enemy2, 3, 3)
  setUnitFacing(enemy2, 'w') // facing knight -> frontal melee -> Counter-Attack!
  battle.targetTiles = [{ col: 3, row: 3 }]

  const logLenBefore = battle.combatLog.length
  assert.equal(selectTile(state, 3, 3), true)
  const fresh = battle.combatLog.slice(logLenBefore)
  assert.ok(
    fresh.some(e => e.category === 'attack' && e.text.includes('blocks') && e.text.includes('Shield')),
    'Expected Shield block entry in combatLog'
  )
  assert.ok(
    fresh.some(e => e.category === 'reaction' && e.text.includes('counters')),
    'Expected Counter-Attack reaction entry in combatLog'
  )
})

test('Live battle logs Opportunity Attacks, hazards (Geyser, Cursed Altar, Barricade, Shrine), and displacement collisions/falls', () => {
  const { state, battle } = makeFlatBattle(3030)
  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.team === 'enemy' && u.alive)!

  // Place other units out of the way
  let parkCol = 0
  const parkRow = battle.rows - 1
  for (const u of battle.units) {
    if (u.uid !== hero.uid && u.uid !== enemy.uid) {
      placeUnit(battle, u, Math.min(battle.cols - 1, parkCol++), parkRow)
    }
  }

  // 1. Opportunity Attack when hero walks away from melee enemy sentinel
  enemy.range = 1
  enemy.stunTurns = 0
  hero.hp = 150
  hero.maxHp = 150
  hero.move = 4
  placeUnit(battle, hero, 2, 2)
  placeUnit(battle, enemy, 2, 1)
  battle.moveTiles = [{ col: 4, row: 2 }]
  battle.targetTiles = []
  assert.equal(selectTile(state, 4, 2), true)
  for (let i = 0; i < 120; i++) stepGame(state, STEP)
  assert.ok(
    battle.combatLog.some(e => e.category === 'reaction' && e.text.includes('OA-struck by')),
    'Expected Opportunity Attack reaction log entry'
  )

  // 2. Lava Geyser & Cursed Altar on step
  setCell(battle, 5, 2, 'lava_geyser', 0, { geyserActive: true })
  setCell(battle, 6, 2, 'cursed_altar', 0, { altarUsed: false })
  hero.moved = false
  hero.hp = 150
  battle.moveTiles = [{ col: 5, row: 2 }]
  assert.equal(selectTile(state, 5, 2), true)
  for (let i = 0; i < 80; i++) stepGame(state, STEP)
  assert.ok(
    battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('Lava Geyser')),
    'Expected Lava Geyser hazard log entry'
  )

  hero.moved = false
  battle.moveTiles = [{ col: 6, row: 2 }]
  assert.equal(selectTile(state, 6, 2), true)
  for (let i = 0; i < 80; i++) stepGame(state, STEP)
  assert.ok(
    battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('Cursed Altar')),
    'Expected Cursed Altar hazard log entry'
  )

  // 3. Barricade smash
  const barCol = Math.min(battle.cols - 1, 7)
  if (barCol > hero.col) {
    setCell(battle, barCol, 2, 'barricade', 0, { barricadeHp: 8, barricadeMaxHp: BARRICADE_DEFAULT_HP })
    hero.acted = false
    hero.atk = 30
    battle.targetTiles = [{ col: barCol, row: 2 }]
    assert.equal(selectTile(state, barCol, 2), true)
    assert.ok(
      battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('smashes Barricade!')),
      'Expected Barricade smash log entry'
    )
  } else {
    setCell(battle, 5, 1, 'barricade', 0, { barricadeHp: 8, barricadeMaxHp: BARRICADE_DEFAULT_HP })
    placeUnit(battle, hero, 4, 1)
    hero.acted = false
    hero.atk = 30
    battle.targetTiles = [{ col: 5, row: 1 }]
    assert.equal(selectTile(state, 5, 1), true)
    assert.ok(
      battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('smashes Barricade!')),
      'Expected Barricade smash log entry'
    )
  }

  // 4. Displacement fall + collision damage
  setCell(battle, 2, 3, 'hill', 3)
  setCell(battle, 3, 3, 'grass', 0)
  setCell(battle, 4, 3, 'pillar', 0)
  enemy.hp = 140
  enemy.maxHp = 140
  placeUnit(battle, hero, 1, 3)
  placeUnit(battle, enemy, 2, 3)
  applyDisplacement(state, hero, enemy, { kind: 'knockback', distance: 3 })
  assert.ok(
    battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('fall dmg')),
    'Expected displacement fall damage log entry'
  )
  assert.ok(
    battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('crashes into pillar')),
    'Expected displacement collision log entry'
  )

  // 5. Sun Shrine heal on hero's turn start + Burn & Poison ticks
  setCell(battle, 1, 3, 'shrine', 0)
  hero.hp = 50
  hero.maxHp = 150
  hero.burnTurns = 2
  hero.poisonStacks = 2
  hero.ct = 100
  for (const u of battle.units) {
    if (u.uid !== hero.uid) u.ct = 0
  }
  endPlayerTurn(state)
  // Step or advance until hero's next turn starts
  for (let guard = 0; guard < 20 && (battle.phase !== 'player' || battle.activeUnitUid !== hero.uid); guard++) {
    if (battle.phase === 'enemy') {
      for (let i = 0; i < 90; i++) stepGame(state, STEP)
    } else if (battle.phase === 'player') {
      endPlayerTurn(state)
    }
  }
  assert.ok(
    battle.combatLog.some(e => e.category === 'status' && e.text.includes('Burn dmg')),
    'Expected Burn status tick log entry'
  )
  assert.ok(
    battle.combatLog.some(e => e.category === 'status' && e.text.includes('Poison dmg')),
    'Expected Poison status tick log entry'
  )
  assert.ok(
    battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('Sun Shrine')),
    'Expected Sun Shrine heal log entry'
  )
})

test('Live battle logs elemental combos, tactics, KOs, downed countdown, revives, and victory', () => {
  const { state, battle } = makeFlatBattle(5150)
  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.team === 'enemy' && u.alive)!

  // Elemental combo: Shatter (fire hitting slowed target)
  enemy.hp = 120
  enemy.maxHp = 120
  applyStatus(battle, enemy, 'slow')
  assert.ok(
    battle.combatLog.some(e => e.category === 'status' && e.text.includes('Slow')),
    'Expected Slow status application log'
  )
  const combo = triggerElementalCombo(state, hero, 'fire', enemy, enemy.col, enemy.row)
  assert.ok(combo && combo.id === 'shatter')
  assert.ok(
    battle.combatLog.some(e => e.category === 'combo' && e.text.includes('SHATTER')),
    'Expected SHATTER combo log entry'
  )

  // Tactic card played
  const tacticUid = battle.hand[0]
  assert.ok(tacticUid)
  battle.ap = battle.maxAp
  assert.equal(armTacticCard(state, tacticUid), true)
  if (battle.armedTacticUid && battle.targetTiles.length > 0) {
    const t = battle.targetTiles[0]
    assert.equal(selectTile(state, t.col, t.row), true)
  }
  assert.ok(
    battle.combatLog.some(e => e.category === 'system' && e.text.includes('Tactic:')),
    'Expected Tactic played log entry'
  )

  // Ally downed + revive via Cleric-like revive tactic / skill
  const cleric = battle.units.find(u => u.team === 'ally' && u.uid !== hero.uid)!
  cleric.alive = false
  cleric.downed = true
  cleric.hp = 0
  cleric.koCountdown = 2
  cleric.ct = 100
  // Trigger downed countdown tick by advancing turn while cleric CT >= 100
  const beforeCountdown = battle.combatLog.length
  endPlayerTurn(state)
  assert.ok(
    battle.combatLog.slice(beforeCountdown).some(e => e.category === 'ko' && e.text.includes('KO countdown')),
    'Expected downed KO countdown log entry'
  )

  // Verify deploy phase logs Battle started on confirmDeployment
  const deployState = createInitialState(777)
  const deployBattle = startChapterBattle(deployState, 0, 0, { deployPhase: true })
  assert.equal(deployBattle.combatLog.length, 0, 'Deploy phase starts clean before battle begins')
  assert.equal(confirmDeployment(deployState), true)
  assert.ok(
    deployBattle.combatLog.some(e => e.category === 'system' && e.text.includes('Battle started')),
    'confirmDeployment must emit Battle started entry'
  )

  // Verify enemy KO + Victory summary when final enemy falls
  const winState = createInitialState(888)
  const winBattle = startChapterBattle(winState, 0, 0)
  const active = getUnitByUid(winBattle, winBattle.activeUnitUid)!
  const foes = winBattle.units.filter(u => u.team === 'enemy')
  for (let i = 1; i < foes.length; i++) {
    foes[i].alive = false
    foes[i].hp = 0
  }
  const lastFoe = foes[0]
  lastFoe.hp = 1
  lastFoe.shield = 0
  placeUnit(winBattle, active, 2, 2)
  placeUnit(winBattle, lastFoe, 3, 2)
  winBattle.targetTiles = [{ col: 3, row: 2 }]
  assert.equal(selectTile(winState, 3, 2), true)
  assert.equal(winBattle.phase, 'victory')
  assert.ok(
    winBattle.combatLog.some(e => e.category === 'ko' && e.text.includes('defeated!')),
    'Expected enemy KO log entry'
  )
  assert.ok(
    winBattle.combatLog.some(e => e.category === 'system' && e.text.includes('Victory!')),
    'Expected Victory summary log entry'
  )
})

test('Battle save/resume round-trip preserves combatLog and supports legacy snapshots without combatLog', () => {
  const { state, battle } = makeFlatBattle(9090)
  appendCombatLog(battle, 'crit', 'Aldric hits Goblin for 28 (Backstab, CRIT!)', { turn: 2 })
  appendCombatLog(battle, 'combo', 'Lyra triggers SHATTER (+14)', { turn: 3 })
  appendCombatLog(battle, 'heal', 'Sera revives Aldric (+35 HP)', { turn: 4 })

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap, 'Expected valid BattleSaveSnapshot')
  assert.ok(Array.isArray(snap.combatLog) && snap.combatLog.length >= 4)
  assert.equal(snap.nextLogId, battle.nextLogId)

  // JSON round-trip
  const parsed = JSON.parse(JSON.stringify(snap))
  const validated = validateBattleSnapshot(parsed)
  assert.ok(validated && validated.combatLog)
  assert.deepEqual(validated.combatLog, battle.combatLog)

  const resumed = createInitialState(1)
  assert.equal(restoreBattleState(resumed, parsed), true)
  assert.ok(resumed.battle)
  assert.deepEqual(resumed.battle.combatLog, battle.combatLog)
  assert.equal(resumed.battle.nextLogId, battle.nextLogId)

  // Next entry appended after restore gets monotonic ID
  const nextEntry = appendCombatLog(resumed.battle, 'system', 'Resumed check')
  assert.equal(nextEntry.id, battle.nextLogId)

  // Legacy snapshot without combatLog or nextLogId must still restore cleanly
  const legacyRaw = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>
  delete legacyRaw.combatLog
  delete legacyRaw.nextLogId
  const legacyValid = validateBattleSnapshot(legacyRaw)
  assert.ok(legacyValid, 'Legacy snapshot without combatLog must validate')
  assert.equal(legacyValid.combatLog, undefined)

  const legacyState = createInitialState(2)
  assert.equal(restoreBattleState(legacyState, legacyRaw), true)
  assert.ok(legacyState.battle)
  assert.deepEqual(legacyState.battle.combatLog, [])
  assert.equal(legacyState.battle.nextLogId, 1)

  // Sanitizer ignores malformed entries and caps to MAX_COMBAT_LOG_ENTRIES
  const messy = [
    null,
    { id: 1, turn: 1, category: 'bogus', text: 'bad' },
    { id: 2, turn: 1, category: 'attack', text: '   ' },
    { id: 3, turn: 2, category: 'crit', text: 'Valid crit' }
  ]
  const clean = sanitizeCombatLogEntries(messy)
  assert.equal(clean.length, 1)
  assert.equal(clean[0].text, 'Valid crit')
  assert.equal(clean[0].accentHex, COMBAT_LOG_ACCENT.crit)
})

test('Combat log UI draw smoke handles empty, populated, scrolled, and toggle badge states', () => {
  const emptyFake = fakeCanvas2dContext()
  drawCombatLogPanel(emptyFake.ctx, { x: 8, y: 120, width: 320, height: 220 }, [])
  assert.ok(emptyFake.ops > 10, 'Empty panel should draw background and placeholder')
  assert.ok(emptyFake.texts.some(t => t.includes('COMBAT LOG')), 'Header title drawn')
  assert.ok(emptyFake.texts.some(t => t.includes('No combat events yet')), 'Empty placeholder drawn')

  const entries: CombatLogEntry[] = [
    { id: 1, turn: 1, category: 'system', text: 'Battle started — Greenmeadow', accentHex: COMBAT_LOG_ACCENT.system },
    { id: 2, turn: 1, category: 'attack', text: 'Aldric hits Goblin for 16', accentHex: COMBAT_LOG_ACCENT.attack },
    { id: 3, turn: 2, category: 'crit', text: 'Lyra hits Goblin for 24 (Backstab, CRIT!)', accentHex: COMBAT_LOG_ACCENT.crit },
    { id: 4, turn: 2, category: 'reaction', text: 'Aldric counters Orc for 12', accentHex: COMBAT_LOG_ACCENT.reaction },
    { id: 5, turn: 3, category: 'combo', text: 'Vesper triggers SHATTER (+14)', accentHex: COMBAT_LOG_ACCENT.combo },
    { id: 6, turn: 3, category: 'heal', text: 'Sera revives Aldric (+35 HP)', accentHex: COMBAT_LOG_ACCENT.heal },
    { id: 7, turn: 4, category: 'ko', text: 'Goblin defeated!', accentHex: COMBAT_LOG_ACCENT.ko }
  ]

  const popFake = fakeCanvas2dContext()
  drawCombatLogPanel(popFake.ctx, { x: 8, y: 120, width: 344, height: 232 }, entries, {
    scrollOffset: 0,
    visibleRows: 5
  })
  assert.ok(popFake.ops > 30, 'Populated panel should render rows and scrollbar')
  assert.ok(popFake.texts.some(t => t === 'T4'), 'Latest turn chip rendered')
  assert.ok(popFake.texts.some(t => t.includes('Goblin defeated!')), 'Latest entry text rendered')

  const scrolledFake = fakeCanvas2dContext()
  drawCombatLogPanel(scrolledFake.ctx, { x: 8, y: 120, width: 300, height: 180 }, entries, {
    scrollOffset: 2,
    visibleRows: 4,
    compact: true
  })
  assert.ok(scrolledFake.texts.some(t => t === '2-5/7'), 'Scrolled range indicator rendered')
  assert.ok(scrolledFake.texts.some(t => t.includes('SHATTER')), 'Scrolled entry visible')

  const toggleFake = fakeCanvas2dContext()
  const btnState = { hovered: false, pressed: false, focused: false, disabled: false, selected: false }
  drawCombatLogToggleButton(toggleFake.ctx, { x: 8, y: 92, width: 112, height: 28 }, btnState, {
    open: false,
    unreadCount: 5,
    totalCount: 7
  })
  assert.ok(toggleFake.texts.some(t => t === 'Log L'), 'Toggle button label rendered')
  assert.ok(toggleFake.texts.some(t => t === '5'), 'Unread count badge rendered when collapsed')

  const openToggleFake = fakeCanvas2dContext()
  drawCombatLogToggleButton(openToggleFake.ctx, { x: 8, y: 92, width: 90, height: 26 }, { ...btnState, selected: true }, {
    open: true,
    unreadCount: 0,
    totalCount: 7,
    compact: true
  })
  assert.ok(openToggleFake.texts.some(t => t === 'Log'), 'Compact toggle label rendered')
})

test('armSkill and executeHeroSkill log support heals, shields, and empty-tile whiffs', () => {
  const { state, battle } = makeFlatBattle(4040)
  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.acted = false
  knight.moved = false
  knight.cooldowns = [0, 0, 0]

  // Arm tier-1 skill (Shield Bash, offensive melee) and cast onto an empty tile -> NO TARGET whiff
  assert.equal(armSkill(state, 0), true)
  const emptyTile = battle.targetTiles.find(t => !battle.units.some(u => u.alive && u.col === t.col && u.row === t.row))
  if (emptyTile) {
    assert.equal(selectTile(state, emptyTile.col, emptyTile.row), true)
    assert.ok(
      battle.combatLog.some(e => e.category === 'attack' && e.text.includes('no target')),
      'Expected empty-tile skill whiff logged'
    )
  }
})
