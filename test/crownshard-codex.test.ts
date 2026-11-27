import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  ALL_ENEMY_IDS,
  ENEMY_CODEX_META,
  HERO_CODEX_META,
  backfillDiscoveredEnemiesFromStages,
  discoverBattleEnemiesInCodex,
  discoverEnemyInCodex,
  getBestiaryEntries,
  getBestiaryEntry,
  getCodexProgress,
  getEnemyEncounterStages,
  getEquipCodexEntries,
  getEquipCodexEntry,
  getEquipmentDropStages,
  getHeroCodexEntries,
  getHeroCodexEntry,
  getHeroRecruitmentStages,
  getPackSourcesForRarity,
  isEnemyDiscovered,
  isValidEnemyArchetypeId,
  normalizeDiscoveredEnemies
} from '../examples/crownshard/crownshard/codex.ts'
import {
  CHAPTERS,
  CHAPTER_BY_ID,
  ENEMY_SPECS,
  EQUIPMENT_LIST,
  HERO_LIST,
  PACK_LIST
} from '../examples/crownshard/crownshard/data.ts'
import { isSummonerArchetype } from '../examples/crownshard/crownshard/enemy-archetypes.ts'
import { getEquipCraftCost, getHeroCraftCost } from '../examples/crownshard/crownshard/forge.ts'
import { getEquipEffect, getHeroPassive } from '../examples/crownshard/crownshard/passives.ts'
import {
  SAVE_KEY,
  createInitialState,
  endPlayerTurn,
  getBestiaryEntries as simGetBestiaryEntries,
  getCodexProgress as simGetCodexProgress,
  getEquipCodexEntries as simGetEquipCodexEntries,
  getHeroCodexEntries as simGetHeroCodexEntries,
  discoverEnemyInCodex as simDiscoverEnemyInCodex,
  hydrateSave,
  loadSave,
  persistSave,
  serializeSave,
  startChapterBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import type { EnemyArchetypeId, SaveData } from '../examples/crownshard/crownshard/types.ts'
import {
  drawCodexEnemyDetail,
  drawCodexEntryCard,
  drawCodexEquipDetail,
  drawCodexHeader,
  drawCodexHeroDetail,
  drawCodexSilhouetteTile
} from '../examples/crownshard/crownshard/ui-art.ts'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null },
    setItem(key: string, value: string) { store.set(key, value) },
    removeItem(key: string) { store.delete(key) }
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

test('complete metadata coverage for all 24 enemies, 8 heroes, and 18 equipment items', () => {
  const allSpecEnemyIds = Object.keys(ENEMY_SPECS) as EnemyArchetypeId[]
  assert.equal(allSpecEnemyIds.length, 24)
  assert.equal(ALL_ENEMY_IDS.length, 24)
  assert.equal(new Set(ALL_ENEMY_IDS).size, 24)
  for (const id of allSpecEnemyIds) {
    assert.ok(ALL_ENEMY_IDS.includes(id), `ALL_ENEMY_IDS includes ${id}`)
    assert.equal(isValidEnemyArchetypeId(id), true)
    const meta = ENEMY_CODEX_META[id]
    assert.ok(meta, `ENEMY_CODEX_META has ${id}`)
    assert.equal(meta.id, id)
    assert.ok(meta.lore.trim().length > 20, `${id} has lore`)
    assert.ok(meta.signatureAbility.trim().length > 2, `${id} has signatureAbility`)
    assert.ok(meta.abilityDesc.trim().length > 10, `${id} has abilityDesc`)
    assert.ok(meta.tacticalTip.trim().length > 10, `${id} has tacticalTip`)
    assert.ok(meta.regionHint.trim().length > 4, `${id} has regionHint`)
    assert.ok(meta.biomeAffinity.length > 0, `${id} has biomeAffinity`)
  }

  assert.equal(HERO_LIST.length, 8)
  for (const hero of HERO_LIST) {
    const meta = HERO_CODEX_META[hero.id]
    assert.ok(meta, `HERO_CODEX_META has ${hero.id}`)
    assert.ok(meta.role.trim().length > 4, `${hero.id} has role`)
    assert.ok(meta.lore.trim().length > 15, `${hero.id} has lore`)
    assert.ok(meta.playStyleTip.trim().length > 15, `${hero.id} has playStyleTip`)
    assert.ok(getHeroPassive(hero.id), `${hero.id} has innate passive`)
    assert.equal(hero.skills.length, 3)
    assert.ok(getHeroCraftCost(hero.id) > 0, `${hero.id} has Forge Shard cost`)
  }

  assert.equal(EQUIPMENT_LIST.length, 18)
  const state = createInitialState(101)
  const gearEntries = getEquipCodexEntries(state.campaign)
  assert.equal(gearEntries.length, 18)
  for (const entry of gearEntries) {
    assert.ok(entry.spec.name.trim().length > 2)
    assert.ok(entry.spec.desc.trim().length > 4)
    assert.equal(entry.forgeDustCost, getEquipCraftCost(entry.id))
    assert.ok(entry.forgeDustCost > 0, `${entry.id} has Arcane Dust cost`)
    assert.ok(entry.packSources.length > 0, `${entry.id} has pack sources`)
    assert.equal(entry.effect, getEquipEffect(entry.id))
    // Every equipment item is obtainable via starter gear or at least one chapter drop
    assert.ok(
      entry.starterGear || entry.chapterSources.length > 0,
      `${entry.id} has starter or chapter drop source`
    )
  }

  // Verify simulation.ts re-exports public codex helpers
  assert.equal(simGetBestiaryEntries, getBestiaryEntries)
  assert.equal(simGetHeroCodexEntries, getHeroCodexEntries)
  assert.equal(simGetEquipCodexEntries, getEquipCodexEntries)
  assert.equal(simGetCodexProgress, getCodexProgress)
  assert.equal(simDiscoverEnemyInCodex, discoverEnemyInCodex)
})

test('undiscovered enemies are masked as ??? and live battle discovery unlocks enemies & summoned bone_thrall', () => {
  const state = createInitialState(202)
  assert.deepEqual(state.campaign.discoveredEnemies, [])

  // Initial progress: 0/24 enemies, 3/8 starter heroes, 3/18 starter equipment => 6/50 = 12%
  const initProg = getCodexProgress(state.campaign)
  assert.equal(initProg.enemiesDiscovered, 0)
  assert.equal(initProg.enemiesTotal, 24)
  assert.equal(initProg.heroesOwned, 3)
  assert.equal(initProg.heroesTotal, 8)
  assert.equal(initProg.equipmentOwned, 3)
  assert.equal(initProg.equipmentTotal, 18)
  assert.equal(initProg.overallPct, 12)

  // Before battle, all enemies are undiscovered mysteries
  const hiddenGoblin = getBestiaryEntry(state.campaign, 'goblin')
  assert.equal(hiddenGoblin.discovered, false)
  assert.equal(hiddenGoblin.displayName, '???')
  assert.equal(hiddenGoblin.signatureAbility, '???')
  assert.equal(hiddenGoblin.basicAttackStatus, null)
  assert.ok(hiddenGoblin.regionHint.includes('Solis Vale'))

  // Starting Border Watch automatically discovers goblin & bone_archer
  startChapterBattle(state, CHAPTER_BY_ID.border_watch.index, 0, { deployPhase: false })
  assert.equal(isEnemyDiscovered(state.campaign, 'goblin'), true)
  assert.equal(isEnemyDiscovered(state.campaign, 'bone_archer'), true)
  assert.equal(isEnemyDiscovered(state.campaign, 'bone_thrall'), false)
  assert.equal(isEnemyDiscovered(state.campaign, 'eclipse_archon'), false)

  const revealedGoblin = getBestiaryEntry(state.campaign, 'goblin')
  assert.equal(revealedGoblin.discovered, true)
  assert.equal(revealedGoblin.displayName, 'Ashen Goblin')
  assert.equal(revealedGoblin.spec.maxHp, ENEMY_SPECS.goblin.maxHp)
  assert.equal(revealedGoblin.hasZoc, true)
  assert.equal(revealedGoblin.lore, ENEMY_CODEX_META.goblin.lore)
  assert.equal(revealedGoblin.signatureAbility, ENEMY_CODEX_META.goblin.signatureAbility)

  // Live summon test: Lantern Crypt has a Bone Necromancer who summons Bone Thrall on its turn!
  startChapterBattle(state, CHAPTER_BY_ID.lantern_crypt.index, 0, { deployPhase: false })
  assert.equal(isEnemyDiscovered(state.campaign, 'bone_necromancer'), true)
  assert.equal(isEnemyDiscovered(state.campaign, 'crypt_knight'), true)
  assert.equal(isEnemyDiscovered(state.campaign, 'orc_brute'), true)
  assert.equal(isEnemyDiscovered(state.campaign, 'bone_thrall'), false, 'bone_thrall not discovered before being summoned')

  const battle = state.battle!
  // Make Bone Necromancer act immediately so it raises a Bone Thrall
  const necro = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'bone_necromancer')!
  assert.ok(necro)
  necro.cooldowns[0] = 0
  for (const u of battle.units) {
    u.ct = u.uid === necro.uid ? 100 : 0
  }
  battle.phase = 'enemy'
  battle.activeUnitUid = necro.uid
  battle.enemyDelay = 0.05
  battle.enemyActedThisTurn = false
  stepGame(state, 0.2)

  assert.ok(
    battle.units.some(u => u.enemyId === 'bone_thrall'),
    'Bone Necromancer summoned a Bone Thrall'
  )
  assert.equal(
    isEnemyDiscovered(state.campaign, 'bone_thrall'),
    true,
    'Summoning Bone Thrall immediately unlocks it in the Bestiary'
  )

  // Duplicate discovery returns false and does not duplicate array entries
  assert.equal(discoverEnemyInCodex(state.campaign, 'bone_thrall'), false)
  assert.equal(
    state.campaign.discoveredEnemies.filter(id => id === 'bone_thrall').length,
    1
  )

  // Direct helper discoverBattleEnemiesInCodex discovers new foes cleanly
  const newly = discoverBattleEnemiesInCodex(state.campaign, [
    { team: 'enemy', enemyId: 'frostwyrm_rimefang' },
    { team: 'enemy', enemyId: 'goblin' },
    { team: 'ally', enemyId: undefined }
  ])
  assert.deepEqual(newly, ['frostwyrm_rimefang'])
  assert.equal(isEnemyDiscovered(state.campaign, 'frostwyrm_rimefang'), true)
  const rimefang = getBestiaryEntry(state.campaign, 'frostwyrm_rimefang')
  assert.equal(rimefang.footprintSize, 2)
  assert.equal(rimefang.isBoss, true)
  assert.equal(rimefang.basicAttackStatus, 'Slow')

  // Suppress unused import check on endPlayerTurn if battle stays clean
  assert.equal(typeof endPlayerTurn, 'function')
})

test('dynamic stage-appearance and drop-source lookups match CHAPTERS exactly', () => {
  // 1. Enemy encounter stages match CHAPTERS
  for (const enemyId of ALL_ENEMY_IDS) {
    const expectedDirectIds = CHAPTERS
      .filter(ch => ch.enemies.some(sp => sp.id === enemyId))
      .map(ch => ch.id)
    const stages = getEnemyEncounterStages(enemyId)
    if (enemyId === 'bone_thrall') {
      const expectedSummonIds = CHAPTERS
        .filter(ch => ch.enemies.some(sp => sp.id === 'bone_thrall' || isSummonerArchetype(sp.id)))
        .map(ch => ch.id)
      assert.deepEqual(stages.map(s => s.stageId), expectedSummonIds)
      assert.ok(stages.length > 0)
      assert.ok(stages.every(s => s.viaSummon === true))
    } else {
      assert.deepEqual(
        stages.map(s => s.stageId),
        expectedDirectIds,
        `Enemy ${enemyId} encounter stages match CHAPTERS`
      )
      assert.ok(stages.length > 0, `Enemy ${enemyId} appears in at least one chapter`)
    }
  }

  // 2. Hero recruitment stages match CHAPTERS.rewardHeroId
  const state = createInitialState(303)
  for (const hero of HERO_LIST) {
    const expectedIds = CHAPTERS.filter(ch => ch.rewardHeroId === hero.id).map(ch => ch.id)
    const actualIds = getHeroRecruitmentStages(hero.id).map(s => s.stageId)
    assert.deepEqual(actualIds, expectedIds, `Hero ${hero.id} recruitment stages match CHAPTERS`)

    const entry = getHeroCodexEntry(state.campaign, hero.id)
    assert.equal(entry.forgeShardCost, getHeroCraftCost(hero.id))
    assert.deepEqual(entry.chapterSources.map(s => s.stageId), expectedIds)
  }

  // 3. Equipment drop stages match CHAPTERS.rewardEquipId & pack sources match PACK_LIST weights
  for (const eq of EQUIPMENT_LIST) {
    const expectedIds = CHAPTERS.filter(ch => ch.rewardEquipId === eq.id).map(ch => ch.id)
    const actualIds = getEquipmentDropStages(eq.id).map(s => s.stageId)
    assert.deepEqual(actualIds, expectedIds, `Equip ${eq.id} drop stages match CHAPTERS`)

    const expectedPacks = PACK_LIST
      .filter(p => (p.weights[eq.rarity] ?? 0) > 0 || (p.featuredWeights?.[eq.rarity] ?? 0) > 0)
      .map(p => p.name)
    assert.deepEqual(getPackSourcesForRarity(eq.rarity), expectedPacks)

    const entry = getEquipCodexEntry(state.campaign, eq.id)
    assert.deepEqual(entry.chapterSources.map(s => s.stageId), expectedIds)
  }
})

test('save/load round-trip preserves discoveredEnemies and legacy saves auto-backfill from clearedStageIds', () => {
  const storage = memoryStorage()
  const state = createInitialState(404)
  discoverEnemyInCodex(state.campaign, 'goblin')
  discoverEnemyInCodex(state.campaign, 'bone_thrall')
  discoverEnemyInCodex(state.campaign, 'unbroken_crown_boss')

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.deepEqual(loaded.campaign.discoveredEnemies, ['goblin', 'bone_thrall', 'unbroken_crown_boss'])

  const hydrated = createInitialState(404, loaded)
  assert.deepEqual(hydrated.campaign.discoveredEnemies, ['goblin', 'bone_thrall', 'unbroken_crown_boss'])

  // Legacy save missing `discoveredEnemies`, with 2 cleared chapters -> auto-backfills all enemies from those stages!
  const legacySave = serializeSave(createInitialState(505))
  legacySave.campaign.clearedStageIds = ['border_watch', 'sunken_bridge']
  legacySave.campaign.chaptersCleared = 2
  const rawLegacy = JSON.parse(JSON.stringify(legacySave)) as { version: 1; campaign: Record<string, unknown> }
  delete rawLegacy.campaign.discoveredEnemies

  const legacyStorage = memoryStorage({ [SAVE_KEY]: JSON.stringify(rawLegacy) })
  const loadedLegacy = loadSave(legacyStorage)
  assert.ok(loadedLegacy)

  const expectedBackfill = backfillDiscoveredEnemiesFromStages(['border_watch', 'sunken_bridge'])
  assert.deepEqual(expectedBackfill, ['goblin', 'bone_archer', 'river_troll', 'bog_shaman'])
  assert.deepEqual(loadedLegacy.campaign.discoveredEnemies, expectedBackfill)

  // Also test direct hydrateSave when passed a SaveData object without discoveredEnemies
  const directTarget = createInitialState(606)
  const legacyObj: SaveData = {
    version: 1,
    campaign: {
      ...legacySave.campaign,
      clearedStageIds: ['border_watch', 'eclipse_throne']
    }
  }
  delete legacyObj.campaign.discoveredEnemies
  assert.equal(hydrateSave(directTarget, legacyObj, 606), true)
  assert.equal(isEnemyDiscovered(directTarget.campaign, 'goblin'), true)
  assert.equal(isEnemyDiscovered(directTarget.campaign, 'eclipse_archon'), true)
  assert.equal(isEnemyDiscovered(directTarget.campaign, 'ember_pyromancer'), true)
  assert.equal(isEnemyDiscovered(directTarget.campaign, 'frostwyrm_rimefang'), false)

  // Normalization strips invalid strings and deduplicates
  const sanitized = normalizeDiscoveredEnemies(
    ['goblin', 'not_a_real_enemy', 42, 'goblin', 'ice_wraith'],
    ['border_watch']
  )
  assert.deepEqual(sanitized, ['goblin', 'ice_wraith', 'bone_archer'])
})

test('Canvas 2D draw smoke for Codex header, entry cards, silhouette tile, and detail panes', () => {
  const state = createInitialState(707)
  discoverEnemyInCodex(state.campaign, 'goblin')
  discoverEnemyInCodex(state.campaign, 'unbroken_crown_boss')

  const progress = getCodexProgress(state.campaign)
  const discoveredEnemy = getBestiaryEntry(state.campaign, 'unbroken_crown_boss')
  const hiddenEnemy = getBestiaryEntry(state.campaign, 'frostwyrm_rimefang')
  const heroEntry = getHeroCodexEntry(state.campaign, 'knight')
  const equipEntry = getEquipCodexEntry(state.campaign, 'solis_crownblade')

  const { ctx, texts, ops: _ops } = fakeCanvas2dContext()
  const baseState = { hovered: false, pressed: false, focused: false, disabled: false, selected: false }

  // Desktop + compact sizes
  drawCodexHeader(ctx, { x: 0, y: 0, width: 880, height: 48 }, progress, false)
  drawCodexHeader(ctx, { x: 0, y: 0, width: 260, height: 38 }, progress, true)
  drawCodexSilhouetteTile(ctx, 10, 10, 56)

  drawCodexEntryCard(ctx, { x: 0, y: 0, width: 320, height: 52 }, { kind: 'enemy', data: discoveredEnemy }, { ...baseState, selected: true }, undefined, false)
  drawCodexEntryCard(ctx, { x: 0, y: 60, width: 160, height: 44 }, { kind: 'enemy', data: hiddenEnemy }, baseState, undefined, true)
  drawCodexEntryCard(ctx, { x: 0, y: 120, width: 320, height: 52 }, { kind: 'hero', data: heroEntry }, baseState, undefined, false)
  drawCodexEntryCard(ctx, { x: 0, y: 180, width: 320, height: 52 }, { kind: 'gear', data: equipEntry }, baseState, undefined, false)

  drawCodexEnemyDetail(ctx, { x: 0, y: 0, width: 640, height: 520 }, discoveredEnemy, undefined, false)
  drawCodexEnemyDetail(ctx, { x: 0, y: 0, width: 340, height: 380 }, hiddenEnemy, undefined, true)
  drawCodexHeroDetail(ctx, { x: 0, y: 0, width: 640, height: 520 }, heroEntry, undefined, false)
  drawCodexHeroDetail(ctx, { x: 0, y: 0, width: 340, height: 380 }, heroEntry, undefined, true)
  drawCodexEquipDetail(ctx, { x: 0, y: 0, width: 640, height: 520 }, equipEntry, false)
  drawCodexEquipDetail(ctx, { x: 0, y: 0, width: 340, height: 380 }, equipEntry, true)

  const joined = texts.join(' | ')
  assert.ok(joined.includes(`Codex ${progress.overallPct}%`), 'Header draws Codex progress %')
  assert.ok(joined.includes('The Unbroken Crown'), 'Discovered enemy detail draws name')
  assert.ok(joined.includes('???'), 'Undiscovered enemy draws ???')
  assert.ok(joined.includes('Shield Wall'), 'Hero detail draws innate passive')
  assert.ok(joined.includes('Solis Crownblade'), 'Gear detail draws equipment name')
  assert.ok(joined.includes('1600 Dust'), 'Gear detail draws Arcane Dust Forge cost')
  assert.ok(joined.includes('Eclipse Throne'), 'Gear detail draws dynamic chapter drop source')
})

test('codex.ts is browser-global-free and compiles cleanly via compileTsToGd', () => {
  const source = readFileSync(
    new URL('../examples/crownshard/crownshard/codex.ts', import.meta.url),
    'utf8'
  )
  for (const forbidden of ['window.', 'document.', 'localStorage', 'navigator.', 'HTMLCanvasElement']) {
    assert.equal(source.includes(forbidden), false, `codex.ts must not reference ${forbidden}`)
  }

  const gd = compileTsToGd(source, 'codex.ts')
  assert.equal(typeof gd, 'string')
  assert.ok(gd.length > 500, 'compiled GDScript output is substantial')
  assert.ok(gd.includes('func discoverEnemyInCodex') || gd.includes('discoverEnemyInCodex'))
  assert.ok(gd.includes('func getCodexProgress') || gd.includes('getCodexProgress'))
})
