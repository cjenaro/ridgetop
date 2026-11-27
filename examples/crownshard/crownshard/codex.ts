import {
  CHAPTER_BY_ID,
  CHAPTERS,
  ENEMY_SPECS,
  EQUIPMENT_BY_ID,
  EQUIPMENT_LIST,
  HERO_LIST,
  HERO_SPECS,
  PACK_LIST,
  WORLD_REGIONS
} from './data.ts'
import {
  getEnemyBasicAttackStatus,
  getEnemyBiomeAffinity,
  isSummonerArchetype
} from './enemy-archetypes.ts'
import { getEquipCraftCost, getHeroCraftCost } from './forge.ts'
import { getEquipEffect, getHeroPassive } from './passives.ts'
import type { EquipEffectSpec, HeroPassiveSpec } from './passives.ts'
import type {
  BattleUnit,
  BiomeId,
  CampaignState,
  DifficultyLevel,
  EnemyArchetypeId,
  EnemySpec,
  EquipmentSpec,
  HeroClassId,
  HeroSpec,
  Rarity,
  SkillSpec,
  StageKind
} from './types.ts'

/**
 * Pure Codex / Bestiary catalog, dynamic stage/drop source lookup, and discovery tracking.
 * Zero browser globals; compiles cleanly to Godot GDScript via `compileTsToGd`.
 */

export type CodexTab = 'enemies' | 'heroes' | 'gear'

export type EnemyCodexCategory = 'troop' | 'elite' | 'miniboss' | 'boss'

export interface CodexStageRef {
  readonly stageId: string
  readonly title: string
  readonly regionName: string
  readonly difficulty: DifficultyLevel
  readonly kind: StageKind
  readonly viaSummon?: boolean
}

export interface EnemyCodexMeta {
  readonly id: EnemyArchetypeId
  readonly category: EnemyCodexCategory
  readonly lore: string
  readonly signatureAbility: string
  readonly abilityDesc: string
  readonly tacticalTip: string
  readonly biomeAffinity: BiomeId
  readonly regionHint: string
  readonly summonedBy?: readonly EnemyArchetypeId[]
}

export interface EnemyCodexEntry {
  readonly id: EnemyArchetypeId
  readonly discovered: boolean
  readonly displayName: string
  readonly spec: EnemySpec
  readonly category: EnemyCodexCategory
  readonly isBoss: boolean
  readonly hasZoc: boolean
  readonly evadesZoc: boolean
  readonly footprintSize: 1 | 2
  readonly biomeAffinity: BiomeId
  readonly regionHint: string
  readonly lore: string
  readonly signatureAbility: string
  readonly abilityDesc: string
  readonly tacticalTip: string
  readonly basicAttackStatus: string | null
  readonly stages: readonly CodexStageRef[]
}

export interface HeroCodexMeta {
  readonly id: HeroClassId
  readonly role: string
  readonly lore: string
  readonly playStyleTip: string
  readonly starterHero: boolean
}

export interface HeroCodexEntry {
  readonly id: HeroClassId
  readonly discovered: boolean
  readonly masked: boolean
  readonly displayName: string
  readonly spec: HeroSpec
  readonly role: string
  readonly lore: string
  readonly playStyleTip: string
  readonly starterHero: boolean
  readonly passive: HeroPassiveSpec | null
  readonly skills: readonly [SkillSpec, SkillSpec, SkillSpec]
  readonly forgeShardCost: number
  readonly packSources: readonly string[]
  readonly chapterSources: readonly CodexStageRef[]
  readonly owned: boolean
  readonly ownedCount: number
  readonly highestStars: 0 | 1 | 2 | 3
  readonly highestLevel: number
}

export interface EquipCodexEntry {
  readonly id: string
  readonly discovered: boolean
  readonly masked: boolean
  readonly displayName: string
  readonly spec: EquipmentSpec
  readonly effect: EquipEffectSpec | null
  readonly starterGear: boolean
  readonly forgeDustCost: number
  readonly packSources: readonly string[]
  readonly chapterSources: readonly CodexStageRef[]
  readonly owned: boolean
  readonly ownedCount: number
  readonly equippedCount: number
}

export interface CodexProgress {
  readonly enemiesDiscovered: number
  readonly enemiesTotal: number
  readonly heroesOwned: number
  readonly heroesTotal: number
  readonly equipmentOwned: number
  readonly equipmentTotal: number
  readonly overallPct: number
}

export const ALL_ENEMY_IDS: readonly EnemyArchetypeId[] = [
  'goblin',
  'bone_archer',
  'orc_brute',
  'bog_shaman',
  'river_troll',
  'crypt_knight',
  'bone_necromancer',
  'bone_thrall',
  'frost_golem',
  'ice_wraith',
  'ember_pyromancer',
  'abyssal_sentinel',
  'briar_warlord',
  'mire_matriarch',
  'ash_inquisitor',
  'frost_jarl',
  'magma_warden',
  'lich_vaelen',
  'frostwyrm_rimefang',
  'ignis_titan',
  'eclipse_archon',
  'dune_sovereign_boss',
  'astral_warden_boss',
  'unbroken_crown_boss'
]

export const ENEMY_CODEX_META: Record<EnemyArchetypeId, EnemyCodexMeta> = {
  goblin: {
    id: 'goblin',
    category: 'troop',
    lore: 'Nimble vanguard raiders driven from the scorched borderlands by the Eclipse banner. Individually brittle, yet dangerous when flanking unguarded archers.',
    signatureAbility: 'Pack Skirmisher',
    abilityDesc: 'Projects Zone of Control in melee with brisk 12 SPD and Jump 2 to crest low ridges.',
    tacticalTip: 'Bait them into Sir Aldric\'s Shield Wall and punish their exposed flanks with counter-attacks.',
    biomeAffinity: 'meadow',
    regionHint: 'Solis Vale · Meadow Outposts'
  },
  bone_archer: {
    id: 'bone_archer',
    category: 'troop',
    lore: 'Hollow-eyed marksmen animated from fallen border garrisons. They cling to battlements and hills where their black-fletched shafts rain unchecked.',
    signatureAbility: 'Highland Volley',
    abilityDesc: 'Fires long-range arrows (Range 3) that prioritize injured heroes within firing lanes.',
    tacticalTip: 'Break sightlines with stone pillars or vault Kael behind them—they lack Zone of Control.',
    biomeAffinity: 'crypt',
    regionHint: 'Solis Vale & Ashen Catacombs'
  },
  orc_brute: {
    id: 'orc_brute',
    category: 'troop',
    lore: 'Heavy shock troopers clad in riveted iron plates forged in the Emberwaste. Slow to advance, but brutal whenever they lock down a bridgehead.',
    signatureAbility: 'Iron Vanguard',
    abilityDesc: 'High DEF (5) frontline bruiser with Zone of Control that anchors narrow chokepoints.',
    tacticalTip: 'Bypass their heavy armor using Vesper\'s Arcane Bolt, Lyra\'s Piercing Shot, or backstab arcs.',
    biomeAffinity: 'meadow',
    regionHint: 'Solis Vale & Emberwaste Bridges'
  },
  bog_shaman: {
    id: 'bog_shaman',
    category: 'troop',
    lore: 'Marsh-bred ritualists who steep Eclipse curses in stagnant fen water. Their bone totems mend wounded allies while coating bolts in lingering venom.',
    signatureAbility: 'Totem Mend & Venom Bolt',
    abilityDesc: 'Heals injured allies (+22 HP, +6 Shield) from range and inflicts Poison x2 on basic attacks.',
    tacticalTip: 'Focus them early or provoke them with Taunt so they cannot channel Totem Mend.',
    biomeAffinity: 'river',
    regionHint: 'The Silverfen · River Marshes'
  },
  river_troll: {
    id: 'river_troll',
    category: 'elite',
    lore: 'Moss-backed giants awakened beneath the Silverfen sluices. Their matted hides knit closed with every breath unless seared by flame or venom.',
    signatureAbility: 'Regenerate & Tidal Slam',
    abilityDesc: 'Regenerates +8 HP each turn (suppressed by Burn or Poison) and smashes targets with 1-tile knockback.',
    tacticalTip: 'Keep Burn or Poison active to halt regeneration, and watch your footing near deep water.',
    biomeAffinity: 'river',
    regionHint: 'The Silverfen · Bridges & Deltas'
  },
  crypt_knight: {
    id: 'crypt_knight',
    category: 'elite',
    lore: 'Oath-bound cathedral sentinels cursed to eternal vigil in blackened plate. They march in disciplined formation, shielding casters behind unbroken steel.',
    signatureAbility: 'Dread Bulwark',
    abilityDesc: 'Formidable 7 DEF and 3 Move sentinel projecting Zone of Control across crypt corridors.',
    tacticalTip: 'Shred their armor with high-pierce skills or knock them into Cursed Altars and ledges.',
    biomeAffinity: 'crypt',
    regionHint: 'Ashen Catacombs & Eclipse Strongholds'
  },
  bone_necromancer: {
    id: 'bone_necromancer',
    category: 'elite',
    lore: 'Sepulchral choir-masters who bind restless ossuary shards into disposable infantry. Left unchallenged, a single summoner floods the nave with skeletons.',
    signatureAbility: 'Raise Skeleton',
    abilityDesc: 'Summons Bone Thralls onto open adjacent tiles (up to 2 active per summoner, 3-turn cooldown).',
    tacticalTip: 'Taunt or rush the Necromancer first—killing the summoner halts endless thrall waves.',
    biomeAffinity: 'crypt',
    regionHint: 'Ashen Catacombs · Crypt Vaults'
  },
  bone_thrall: {
    id: 'bone_thrall',
    category: 'troop',
    lore: 'Rattling skeletal footmen knitted together by necrotic chants. Fragile alone, yet stubborn enough to clog lanes and trigger Opportunity Attacks.',
    signatureAbility: 'Skeletal Swarm',
    abilityDesc: 'Summoned melee minion with Zone of Control that ties down advancing heroes.',
    tacticalTip: 'Clear clusters with cross/3x3 AoE skills or slip past their ZoC using Kael\'s Shadow Step.',
    biomeAffinity: 'crypt',
    regionHint: 'Ashen Catacombs (Raised in Battle)',
    summonedBy: ['bone_necromancer', 'ash_inquisitor', 'lich_vaelen']
  },
  frost_golem: {
    id: 'frost_golem',
    category: 'elite',
    lore: 'Living glacial monoliths carved from Frostspire\'s ancient ice walls. Almost impervious to glancing blows, they grind forward like a slow avalanche.',
    signatureAbility: 'Glacial Carapace',
    abilityDesc: 'Massive 96 HP and 8 DEF juggernaut that controls chokepoints with relentless melee power.',
    tacticalTip: 'Exploit their 6 SPD and 2 Move—kite from elevation and melt them with Fire/Arcane combos.',
    biomeAffinity: 'frost',
    regionHint: 'Frostspire Highlands · Alpine Passes'
  },
  ice_wraith: {
    id: 'ice_wraith',
    category: 'elite',
    lore: 'Shivering phantoms born where blizzards howl through empty watchtowers. They drift cleanly through shield walls to chill isolated mages and healers.',
    signatureAbility: 'Phase Chill & Shatter Hunt',
    abilityDesc: 'Evades Zone of Control, inflicts Slow on hit, and deals +30% bonus damage to Slowed targets.',
    tacticalTip: 'Protect backline casters and avoid letting Slow linger—cleanse or burst Wraiths before they chain hits.',
    biomeAffinity: 'frost',
    regionHint: 'Frostspire Highlands · Frozen Peaks'
  },
  ember_pyromancer: {
    id: 'ember_pyromancer',
    category: 'elite',
    lore: 'Cinder-robed zealots who draw volcanic fury from the Emberwaste rifts. Their staves ignite whole formations in searing cross-shaped blasts.',
    signatureAbility: 'Cinder Nova',
    abilityDesc: 'Basic attacks inflict Burn; Cinder Nova blasts a cross area (40% armor pierce) with Fire & Burn.',
    tacticalTip: 'Spread heroes out to deny multi-hit Cinder Novas and avoid triggering Combust against Poison.',
    biomeAffinity: 'volcano',
    regionHint: 'Emberwaste Caldera · Volcanic Gates'
  },
  abyssal_sentinel: {
    id: 'abyssal_sentinel',
    category: 'elite',
    lore: 'Trench-forged constructs patrolling the pitch-black vaults of the Crownless Deep. Their halberds sweep wide arcs heavy with abyssal chill.',
    signatureAbility: 'Abyssal Cleave',
    abilityDesc: 'Range 2 sentinel whose basic strikes Slow; Abyssal Cleave sweeps a cross area with 30% armor pierce.',
    tacticalTip: 'Respect its 2-tile reach and ZoC—flank from multiple angles with Empowered burst.',
    biomeAffinity: 'throne',
    regionHint: 'Crownless Deep & Starfall Atoll'
  },
  briar_warlord: {
    id: 'briar_warlord',
    category: 'miniboss',
    lore: 'Grom, scourge of the Silverfen timber roads, wears gnarled ironwood trophies from fallen patrols. His sweeping axe clears whole causeways in one swing.',
    signatureAbility: 'Briar Cleave',
    abilityDesc: 'Regional Mini-Boss wielding a cross-area cleave (125% ATK) that shoves struck heroes back 1 tile.',
    tacticalTip: 'Do not bunch up on the sunken road—hold the twin timber hills for elevation advantage.',
    biomeAffinity: 'meadow',
    regionHint: 'The Silverfen · Briar Hollow'
  },
  mire_matriarch: {
    id: 'mire_matriarch',
    category: 'miniboss',
    lore: 'Vex rules the drowned groves around Sunwell Glade, brewing caustic bog-blight to snuff out the Sun Order\'s healing shrines.',
    signatureAbility: 'Mire Miasma & Totem Mend',
    abilityDesc: 'Ranged Mini-Boss that heals injured allies, inflicts Poison x2, and unleashes cross-area Mire Miasma.',
    tacticalTip: 'Pair Sera\'s Sanctuary Wave with rapid flanks—prevent Vex from stalling beside her River Troll guard.',
    biomeAffinity: 'river',
    regionHint: 'The Silverfen · Sunwell Glade'
  },
  ash_inquisitor: {
    id: 'ash_inquisitor',
    category: 'miniboss',
    lore: 'Before ascending into full lichdom, Inquisitor Vaelen purged the catacombs in cinders and necromancy, commanding ossuary legions with ruthless zeal.',
    signatureAbility: 'Ashen Verdict & Necromancy',
    abilityDesc: 'Raises Bone Thralls onto open tiles and casts cross-area Ashen Verdict (40% pierce, Fire + Burn).',
    tacticalTip: 'Snipe Vaelen down swiftly before his thrall army and Burn damage compound in the narrow nave.',
    biomeAffinity: 'crypt',
    regionHint: 'Ashen Catacombs · Whispering Barrow'
  },
  frost_jarl: {
    id: 'frost_jarl',
    category: 'miniboss',
    lore: 'Jarl Skadi holds the twin bridges of Glacial Citadel with frost-forged mail and an icy warhorn that freezes attackers in mid-stride.',
    signatureAbility: 'Glacial Gale',
    abilityDesc: 'Basic attacks Slow (+30% DMG vs Slowed); Glacial Gale sweeps a cross area with Frost & Slow.',
    tacticalTip: 'Cross both bridges simultaneously to split her Frost Golems, then burst Skadi from high stairs.',
    biomeAffinity: 'frost',
    regionHint: 'Frostspire Highlands · Glacial Citadel'
  },
  magma_warden: {
    id: 'magma_warden',
    category: 'miniboss',
    lore: 'Ignar tends Malakor\'s obsidian war-forges, hammering molten slag into armor while hurling blazing shockwaves down the foundry walkways.',
    signatureAbility: 'Magma Slam',
    abilityDesc: 'Fiery Mini-Boss whose basic strikes Burn and whose cross-area Magma Slam knocks heroes back 1 tile.',
    tacticalTip: 'Watch lava edges and geysers—knockback into molten vents or walls adds brutal collision damage.',
    biomeAffinity: 'volcano',
    regionHint: 'Emberwaste Caldera · Ashfall Foundry'
  },
  lich_vaelen: {
    id: 'lich_vaelen',
    category: 'boss',
    lore: 'Bound to a fractured emerald phylactery atop Ash Cathedral, Lich Vaelen commands both toxic soulfire and tireless bone legions.',
    signatureAbility: 'Cursed-Soul Nova & Raise Dead',
    abilityDesc: 'Inflicts Poison on hit, raises Bone Thralls, and blasts a cross-area Cursed-Soul Nova.',
    tacticalTip: 'Climb the cathedral stairs quickly to assassinate Vaelen before his Dread Knights pin your squad.',
    biomeAffinity: 'crypt',
    regionHint: 'Ashen Catacombs · Ash Cathedral'
  },
  frostwyrm_rimefang: {
    id: 'frostwyrm_rimefang',
    category: 'boss',
    lore: 'An elder dragon of Frostspire whose wings span four battle tiles. Rimefang\'s frozen roar turns mountain ledges into deadly skating chutes.',
    signatureAbility: '2x2 Raid: Glacial Breath & Wing Buffet',
    abilityDesc: '2x2 multi-tile Raid Boss firing directional Glacial Breath cones and 2-tile knockback Wing Buffets.',
    tacticalTip: 'Shelter behind stone pillars against Glacial Breath and strike any tile of its 2x2 frame for pincers.',
    biomeAffinity: 'frost',
    regionHint: 'Frostspire Highlands · Frostwyrm Eyrie'
  },
  ignis_titan: {
    id: 'ignis_titan',
    category: 'boss',
    lore: 'A primordial furnace-colossus sleeping beneath Brimstone Maw. Every tectonic blow wakes dormant magma vents across the caldera floor.',
    signatureAbility: 'Cataclysm Slam (Ignites Geysers)',
    abilityDesc: 'Cross-area Fire slam (130% ATK, Burn, Knockback 1) that ignites dormant lava geysers within 2 tiles.',
    tacticalTip: 'Keep heroes off geyser tiles and focus down the Titan on the central dais to end the raid cleanly.',
    biomeAffinity: 'volcano',
    regionHint: 'Emberwaste Caldera · Brimstone Maw'
  },
  eclipse_archon: {
    id: 'eclipse_archon',
    category: 'boss',
    lore: 'Archon Malakor shattered the Sunstone Crown to shroud Solis in twilight. High atop the Eclipse Throne he rains volcanic starfire upon all challengers.',
    signatureAbility: 'Eclipse Nova',
    abilityDesc: 'Act III Boss with Range 3, Jump 3, and ZoC; unleashes cross-area Eclipse Nova (Fire + Burn) on even turns.',
    tacticalTip: 'Avoid clustering on even turns, leverage high-ground stairs, and finish Malakor directly to win the stage.',
    biomeAffinity: 'throne',
    regionHint: 'Eclipse Dominion · Eclipse Throne'
  },
  dune_sovereign_boss: {
    id: 'dune_sovereign_boss',
    category: 'boss',
    lore: 'A gilded pharaoh-construct awakened within Sunscar Pyramid. Immune to the howling desert gusts, it whips scouring vortices down the stepped stone.',
    signatureAbility: 'Sandstorm Vortex',
    abilityDesc: 'Immune to Sandstorm Gusts; unleashes cross-area Sandstorm Vortex (Slow + 1-tile knockback).',
    tacticalTip: 'End turns beside sandstone pillars or shrines on even rounds to shelter from desert sandstorms.',
    biomeAffinity: 'dunes',
    regionHint: 'Sunbleached Dunes · Sunscar Pyramid'
  },
  astral_warden_boss: {
    id: 'astral_warden_boss',
    category: 'boss',
    lore: 'Winged arbiter of Skybreak Bastion, forged from storm-glass and starlight. It glides across cloud chasms to hurl stunning tempest arcs.',
    signatureAbility: 'Tempest Surge',
    abilityDesc: 'Immune to Lightning Conduits; casts cross-area Tempest Surge (40% pierce, Stun, Knockback 1).',
    tacticalTip: 'Stay clear of void-edge sky-bridges and stun-prone clusters—push the Warden with ranged burst.',
    biomeAffinity: 'aether',
    regionHint: 'Aether Isles · Skybreak Bastion'
  },
  unbroken_crown_boss: {
    id: 'unbroken_crown_boss',
    category: 'boss',
    lore: 'The primordial sovereign that burned before Solis or the Eclipse existed. At half strength its Solar Eclipse awakens, summoning vanguard blades from starlight.',
    signatureAbility: '2-Phase: Solar Corona -> Solar Eclipse',
    abilityDesc: 'At <=50% HP cleanses, gains +60 Shield, +5 ATK, Empower, Haste, summons 2 guards, and upgrades to Eclipse Cataclysm.',
    tacticalTip: 'Hold burst skills and AP tactics for Phase 2 so you can punch through the 60 Shield before reinforcements swarm.',
    biomeAffinity: 'expanse',
    regionHint: 'Shattered Expanse · First Sun Sanctum'
  }
}

export const HERO_CODEX_META: Record<HeroClassId, HeroCodexMeta> = {
  knight: {
    id: 'knight',
    role: 'Vanguard Tank · ZoC Sentinel',
    lore: HERO_SPECS.knight.lore,
    playStyleTip: 'Park Sir Aldric beside allies to project +3 DEF Shield Wall and pull enemy casters off-script with Taunt.',
    starterHero: true
  },
  archer: {
    id: 'archer',
    role: 'High-Ground Marksman',
    lore: HERO_SPECS.archer.lore,
    playStyleTip: 'Claim H1+ hills to trigger Eagle Eyrie (+1 Range & Ignore Cover) and push foes off ledges with Piercing Shot.',
    starterHero: true
  },
  mage: {
    id: 'mage',
    role: 'Arcane & Fire Blaster',
    lore: HERO_SPECS.mage.lore,
    playStyleTip: 'Feed Vesper low-HP targets with skills to trigger Arcane Conduit (+1 AP refund & 20% splash damage).',
    starterHero: true
  },
  cleric: {
    id: 'cleric',
    role: 'Sun-Order Healer & Reviver',
    lore: HERO_SPECS.cleric.lore,
    playStyleTip: 'Cast Sunbeam Mend even on healthy tanks—Overflowing Grace turns excess healing into durable Shield.',
    starterHero: false
  },
  rogue: {
    id: 'rogue',
    role: 'Skirmisher & Backstab Assassin',
    lore: HERO_SPECS.rogue.lore,
    playStyleTip: 'Slip past enemy Zones of Control with Shadow Step and line up backstabs for massive +20% crit bursts.',
    starterHero: false
  },
  paladin: {
    id: 'paladin',
    role: 'Radiant Bruiser & Counter Tank',
    lore: HERO_SPECS.paladin.lore,
    playStyleTip: 'Keep Shield active facing melee enemies to fuel Vengeful Aegis (+30% Counter DMG & +4 Shield on block).',
    starterHero: false
  },
  cryomancer: {
    id: 'cryomancer',
    role: 'Glacial Controller & Puller',
    lore: HERO_SPECS.cryomancer.lore,
    playStyleTip: 'Yank priority foes off ridges with Frost Lance, glide over Snow for 1 Move, and shatter Slowed targets (+20% DMG).',
    starterHero: false
  },
  champion: {
    id: 'champion',
    role: 'Mythic Sunblade Sweeper',
    lore: HERO_SPECS.champion.lore,
    playStyleTip: 'Chain KOs to keep Relentless Momentum rolling—each kill grants Empower and surges +25 CT.',
    starterHero: false
  }
}

const STARTER_EQUIP_IDS: readonly string[] = ['iron_sword', 'hunter_bow', 'leather_jerkin', 'apprentice_staff']

const ENEMY_ID_SET: Record<string, EnemyArchetypeId> = {
  goblin: 'goblin',
  bone_archer: 'bone_archer',
  orc_brute: 'orc_brute',
  bog_shaman: 'bog_shaman',
  crypt_knight: 'crypt_knight',
  frost_golem: 'frost_golem',
  eclipse_archon: 'eclipse_archon',
  ember_pyromancer: 'ember_pyromancer',
  ice_wraith: 'ice_wraith',
  bone_necromancer: 'bone_necromancer',
  bone_thrall: 'bone_thrall',
  river_troll: 'river_troll',
  briar_warlord: 'briar_warlord',
  mire_matriarch: 'mire_matriarch',
  ash_inquisitor: 'ash_inquisitor',
  frost_jarl: 'frost_jarl',
  magma_warden: 'magma_warden',
  dune_sovereign_boss: 'dune_sovereign_boss',
  astral_warden_boss: 'astral_warden_boss',
  unbroken_crown_boss: 'unbroken_crown_boss',
  lich_vaelen: 'lich_vaelen',
  frostwyrm_rimefang: 'frostwyrm_rimefang',
  ignis_titan: 'ignis_titan',
  abyssal_sentinel: 'abyssal_sentinel'
}

export function isValidEnemyArchetypeId(id: string): id is EnemyArchetypeId {
  return ENEMY_ID_SET[id] !== undefined
}

/** Collect all unique enemy archetypes encountered across the given cleared stage IDs. */
export function backfillDiscoveredEnemiesFromStages(clearedStageIds: readonly string[]): EnemyArchetypeId[] {
  const out: EnemyArchetypeId[] = []
  const seen: Record<string, boolean> = {}
  for (const stageId of clearedStageIds) {
    const ch = CHAPTER_BY_ID[stageId]
    if (!ch) continue
    for (const spawn of ch.enemies) {
      if (!seen[spawn.id] && isValidEnemyArchetypeId(spawn.id)) {
        seen[spawn.id] = true
        out.push(spawn.id)
      }
    }
  }
  return out
}

/**
 * Normalize raw `discoveredEnemies` from save data: filter to valid EnemyArchetypeIds,
 * deduplicate preserving order, and backfill enemies from `clearedStageIds` for legacy saves.
 */
export function normalizeDiscoveredEnemies(
  raw: unknown,
  clearedStageIds?: readonly string[]
): EnemyArchetypeId[] {
  const out: EnemyArchetypeId[] = []
  const seen: Record<string, boolean> = {}
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string' && isValidEnemyArchetypeId(item) && !seen[item]) {
        seen[item] = true
        out.push(item)
      }
    }
  }
  if (clearedStageIds && clearedStageIds.length > 0) {
    const backfilled = backfillDiscoveredEnemiesFromStages(clearedStageIds)
    for (const id of backfilled) {
      if (!seen[id]) {
        seen[id] = true
        out.push(id)
      }
    }
  }
  return out
}

/** Mark an enemy archetype as discovered in the campaign's Bestiary. Returns true if newly unlocked. */
export function discoverEnemyInCodex(
  campaign: Pick<CampaignState, 'discoveredEnemies'>,
  enemyId: EnemyArchetypeId | undefined | null
): boolean {
  if (!enemyId || !isValidEnemyArchetypeId(enemyId)) return false
  if (!Array.isArray(campaign.discoveredEnemies)) {
    campaign.discoveredEnemies = []
  }
  if (campaign.discoveredEnemies.includes(enemyId)) return false
  campaign.discoveredEnemies.push(enemyId)
  return true
}

/** Mark all enemy units present in a battle as discovered in the Bestiary. Returns newly unlocked IDs. */
export function discoverBattleEnemiesInCodex(
  campaign: Pick<CampaignState, 'discoveredEnemies'>,
  units: readonly Pick<BattleUnit, 'team' | 'enemyId'>[]
): EnemyArchetypeId[] {
  const newlyDiscovered: EnemyArchetypeId[] = []
  for (const unit of units) {
    if (unit.team !== 'enemy' || !unit.enemyId) continue
    if (discoverEnemyInCodex(campaign, unit.enemyId)) {
      newlyDiscovered.push(unit.enemyId)
    }
  }
  return newlyDiscovered
}

/** True when `enemyId` has been discovered in the campaign Bestiary. */
export function isEnemyDiscovered(
  campaign: Pick<CampaignState, 'discoveredEnemies'>,
  enemyId: EnemyArchetypeId
): boolean {
  return Array.isArray(campaign.discoveredEnemies) && campaign.discoveredEnemies.includes(enemyId)
}

function makeStageRef(stageId: string, viaSummon = false): CodexStageRef | null {
  const ch = CHAPTER_BY_ID[stageId]
  if (!ch) return null
  const region = WORLD_REGIONS[ch.region]
  return {
    stageId: ch.id,
    title: ch.title,
    regionName: region ? region.name : ch.region,
    difficulty: ch.difficulty,
    kind: ch.kind,
    ...(viaSummon ? { viaSummon: true } : {})
  }
}

/**
 * Dynamically derive all World Map chapters where `enemyId` appears from `CHAPTERS`.
 * For summoned minions (`bone_thrall`), also lists chapters where summoner archetypes appear.
 */
export function getEnemyEncounterStages(enemyId: EnemyArchetypeId): CodexStageRef[] {
  const out: CodexStageRef[] = []
  const seen: Record<string, boolean> = {}
  for (const ch of CHAPTERS) {
    let directMatch = false
    let summonerMatch = false
    for (const sp of ch.enemies) {
      if (sp.id === enemyId) {
        directMatch = true
        break
      }
      if (enemyId === 'bone_thrall' && isSummonerArchetype(sp.id)) {
        summonerMatch = true
      }
    }
    if ((directMatch || summonerMatch) && !seen[ch.id]) {
      seen[ch.id] = true
      const ref = makeStageRef(ch.id, !directMatch && summonerMatch)
      if (ref) out.push(ref)
    }
  }
  return out
}

/** Dynamically derive all World Map chapters that award `heroId` on first clear from `CHAPTERS`. */
export function getHeroRecruitmentStages(heroId: HeroClassId): CodexStageRef[] {
  const out: CodexStageRef[] = []
  for (const ch of CHAPTERS) {
    if (ch.rewardHeroId === heroId) {
      const ref = makeStageRef(ch.id)
      if (ref) out.push(ref)
    }
  }
  return out
}

/** Dynamically derive all World Map chapters that drop `equipId` on first clear from `CHAPTERS`. */
export function getEquipmentDropStages(equipId: string): CodexStageRef[] {
  const out: CodexStageRef[] = []
  for (const ch of CHAPTERS) {
    if (ch.rewardEquipId === equipId) {
      const ref = makeStageRef(ch.id)
      if (ref) out.push(ref)
    }
  }
  return out
}

/** List Booster Pack names that can drop cards of the given rarity. */
export function getPackSourcesForRarity(rarity: Rarity): string[] {
  const out: string[] = []
  for (const pack of PACK_LIST) {
    const baseWeight = pack.weights[rarity] ?? 0
    const featWeight = pack.featuredWeights ? (pack.featuredWeights[rarity] ?? 0) : 0
    if (baseWeight > 0 || featWeight > 0) {
      out.push(pack.name)
    }
  }
  return out
}

function formatBasicAttackStatus(enemyId: EnemyArchetypeId): string | null {
  const st = getEnemyBasicAttackStatus(enemyId)
  if (!st) return null
  const label = st.status.charAt(0).toUpperCase() + st.status.slice(1)
  if (st.stacks && st.stacks > 1) return `${label} x${st.stacks}`
  return label
}

/** Resolve a full Bestiary entry for a single enemy archetype (masked if undiscovered). */
export function getBestiaryEntry(
  campaign: Pick<CampaignState, 'discoveredEnemies'>,
  enemyId: EnemyArchetypeId
): EnemyCodexEntry {
  const spec = ENEMY_SPECS[enemyId]
  const meta = ENEMY_CODEX_META[enemyId]
  const discovered = isEnemyDiscovered(campaign, enemyId)
  const hasZoc = spec.zoc !== undefined ? spec.zoc : spec.range <= 1
  const footprintSize: 1 | 2 = spec.footprintSize === 2 ? 2 : 1
  const biomeAffinity = getEnemyBiomeAffinity(enemyId)
  const stages = getEnemyEncounterStages(enemyId)

  return {
    id: enemyId,
    discovered,
    displayName: discovered ? spec.name : '???',
    spec,
    category: meta.category,
    isBoss: Boolean(spec.isBoss),
    hasZoc,
    evadesZoc: Boolean(spec.evadeZoc),
    footprintSize,
    biomeAffinity,
    regionHint: meta.regionHint,
    lore: discovered ? meta.lore : 'Encounter this foe in battle to uncover its dossier.',
    signatureAbility: discovered ? meta.signatureAbility : '???',
    abilityDesc: discovered ? meta.abilityDesc : 'Battle data locked until encountered.',
    tacticalTip: discovered ? meta.tacticalTip : 'Scout this region to learn counter-tactics.',
    basicAttackStatus: discovered ? formatBasicAttackStatus(enemyId) : null,
    stages
  }
}

/** Resolve all 24 Bestiary entries in canonical order. */
export function getBestiaryEntries(
  campaign: Pick<CampaignState, 'discoveredEnemies'>
): EnemyCodexEntry[] {
  const out: EnemyCodexEntry[] = []
  for (const id of ALL_ENEMY_IDS) {
    out.push(getBestiaryEntry(campaign, id))
  }
  return out
}

function isStageUnlockedForCodex(
  clearedStageIds: readonly string[],
  stageId: string
): boolean {
  const ch = CHAPTER_BY_ID[stageId]
  if (!ch || ch.comingSoon) return false
  if (ch.requires.length === 0) return true
  if (ch.unlockMode === 'any') {
    for (const reqId of ch.requires) {
      if (clearedStageIds.includes(reqId)) return true
    }
    return false
  }
  for (const reqId of ch.requires) {
    if (!clearedStageIds.includes(reqId)) return false
  }
  return true
}

function isRegionReachedInCodex(
  clearedStageIds: readonly string[],
  region: string
): boolean {
  for (const stageId of clearedStageIds) {
    const ch = CHAPTER_BY_ID[stageId]
    if (ch && ch.region === region) return true
  }
  return false
}

/**
 * True when `heroId` has been discovered in the Hero Archive:
 * starter hero, owned in `campaign.heroes`, recruitment chapter cleared,
 * or recruitment chapter / region already reached.
 */
export function isHeroDiscovered(
  campaign: Pick<CampaignState, 'heroes'> & Partial<Pick<CampaignState, 'clearedStageIds'>>,
  heroId: HeroClassId
): boolean {
  const meta = HERO_CODEX_META[heroId]
  if (meta && meta.starterHero) return true
  for (const h of campaign.heroes) {
    if (h.heroId === heroId) return true
  }
  const cleared = Array.isArray(campaign.clearedStageIds) ? campaign.clearedStageIds : []
  if (cleared.length === 0) return false
  for (const ch of CHAPTERS) {
    if (ch.rewardHeroId !== heroId) continue
    if (cleared.includes(ch.id)) return true
    if (isStageUnlockedForCodex(cleared, ch.id)) return true
    if (isRegionReachedInCodex(cleared, ch.region)) return true
  }
  return false
}

/**
 * True when `equipId` has been discovered in the Armory Compendium:
 * starter gear, owned in `campaign.equipment` (or equipped), or chapter drop source cleared.
 */
export function isEquipDiscovered(
  campaign: Pick<CampaignState, 'equipment' | 'heroes'> & Partial<Pick<CampaignState, 'clearedStageIds'>>,
  equipId: string
): boolean {
  if (STARTER_EQUIP_IDS.includes(equipId)) return true
  for (const e of campaign.equipment) {
    if (e.equipId === equipId) return true
  }
  const cleared = Array.isArray(campaign.clearedStageIds) ? campaign.clearedStageIds : []
  if (cleared.length === 0) return false
  for (const ch of CHAPTERS) {
    if (ch.rewardEquipId === equipId && cleared.includes(ch.id)) {
      return true
    }
  }
  return false
}

/** Resolve a full Hero Archive entry for `heroId`. */
export function getHeroCodexEntry(
  campaign: Pick<CampaignState, 'heroes'> & Partial<Pick<CampaignState, 'clearedStageIds'>>,
  heroId: HeroClassId
): HeroCodexEntry {
  const spec = HERO_SPECS[heroId]
  const meta = HERO_CODEX_META[heroId]
  let ownedCount = 0
  let highestStars: 0 | 1 | 2 | 3 = 0
  let highestLevel = 0
  for (const h of campaign.heroes) {
    if (h.heroId !== heroId) continue
    ownedCount += 1
    if (h.stars > highestStars) highestStars = h.stars
    const lvl = typeof h.level === 'number' && h.level > 0 ? Math.floor(h.level) : 1
    if (lvl > highestLevel) highestLevel = lvl
  }
  const discovered = isHeroDiscovered(campaign, heroId)

  return {
    id: heroId,
    discovered,
    masked: !discovered,
    displayName: discovered ? spec.name : '???',
    spec,
    role: meta.role,
    lore: meta.lore,
    playStyleTip: meta.playStyleTip,
    starterHero: meta.starterHero,
    passive: getHeroPassive(heroId),
    skills: spec.skills,
    forgeShardCost: getHeroCraftCost(heroId),
    packSources: getPackSourcesForRarity(spec.rarity),
    chapterSources: getHeroRecruitmentStages(heroId),
    owned: ownedCount > 0,
    ownedCount,
    highestStars,
    highestLevel
  }
}

/** Resolve all 8 Hero Archive entries in canonical order. */
export function getHeroCodexEntries(
  campaign: Pick<CampaignState, 'heroes'> & Partial<Pick<CampaignState, 'clearedStageIds'>>
): HeroCodexEntry[] {
  const out: HeroCodexEntry[] = []
  for (const spec of HERO_LIST) {
    out.push(getHeroCodexEntry(campaign, spec.id))
  }
  return out
}

/** Resolve a full Armory & Drop Compendium entry for `equipId`. */
export function getEquipCodexEntry(
  campaign: Pick<CampaignState, 'equipment' | 'heroes'> & Partial<Pick<CampaignState, 'clearedStageIds'>>,
  equipId: string
): EquipCodexEntry {
  const spec = EQUIPMENT_BY_ID[equipId] ?? EQUIPMENT_LIST[0]
  const equippedUidSet: Record<string, boolean> = {}
  for (const h of campaign.heroes) {
    if (h.weaponUid) equippedUidSet[h.weaponUid] = true
    if (h.armorUid) equippedUidSet[h.armorUid] = true
    if (h.relicUid) equippedUidSet[h.relicUid] = true
  }
  let ownedCount = 0
  let equippedCount = 0
  for (const e of campaign.equipment) {
    if (e.equipId !== spec.id) continue
    ownedCount += 1
    if (equippedUidSet[e.uid]) equippedCount += 1
  }
  const discovered = isEquipDiscovered(campaign, spec.id)

  return {
    id: spec.id,
    discovered,
    masked: !discovered,
    displayName: discovered ? spec.name : '???',
    spec,
    effect: getEquipEffect(spec.id),
    starterGear: STARTER_EQUIP_IDS.includes(spec.id),
    forgeDustCost: getEquipCraftCost(spec.id),
    packSources: getPackSourcesForRarity(spec.rarity),
    chapterSources: getEquipmentDropStages(spec.id),
    owned: ownedCount > 0,
    ownedCount,
    equippedCount
  }
}

/** Resolve all 18 Armory & Drop Compendium entries in canonical order. */
export function getEquipCodexEntries(
  campaign: Pick<CampaignState, 'equipment' | 'heroes'> & Partial<Pick<CampaignState, 'clearedStageIds'>>
): EquipCodexEntry[] {
  const out: EquipCodexEntry[] = []
  for (const spec of EQUIPMENT_LIST) {
    out.push(getEquipCodexEntry(campaign, spec.id))
  }
  return out
}

/** Compute overall Codex completion counts and percentage (0..100). */
export function getCodexProgress(
  campaign: Pick<CampaignState, 'discoveredEnemies' | 'heroes' | 'equipment'>
): CodexProgress {
  const enemiesTotal = ALL_ENEMY_IDS.length
  let enemiesDiscovered = 0
  for (const id of ALL_ENEMY_IDS) {
    if (isEnemyDiscovered(campaign, id)) enemiesDiscovered += 1
  }

  const heroesTotal = HERO_LIST.length
  const ownedHeroMap: Record<string, boolean> = {}
  for (const h of campaign.heroes) {
    ownedHeroMap[h.heroId] = true
  }
  let heroesOwned = 0
  for (const h of HERO_LIST) {
    if (ownedHeroMap[h.id]) heroesOwned += 1
  }

  const equipmentTotal = EQUIPMENT_LIST.length
  const ownedEquipMap: Record<string, boolean> = {}
  for (const e of campaign.equipment) {
    ownedEquipMap[e.equipId] = true
  }
  let equipmentOwned = 0
  for (const eq of EQUIPMENT_LIST) {
    if (ownedEquipMap[eq.id]) equipmentOwned += 1
  }

  const total = enemiesTotal + heroesTotal + equipmentTotal
  const completed = enemiesDiscovered + heroesOwned + equipmentOwned
  const overallPct = total > 0 ? Math.round((completed / total) * 100) : 0

  return {
    enemiesDiscovered,
    enemiesTotal,
    heroesOwned,
    heroesTotal,
    equipmentOwned,
    equipmentTotal,
    overallPct
  }
}
