import type {
  ChapterSpec, DifficultyLevel, EnemyArchetypeId, EnemySpec, EquipmentSpec, HeroClassId, HeroSpec,
  PackId, PackSpec, Rarity, TacticCardSpec, TileTerrain, WorldRegionId
} from './types.ts'

export const WORLD_REGIONS: Record<WorldRegionId, {
  readonly name: string
  readonly subtitle: string
  readonly tierRange: string
  readonly tintHex: string
  readonly accentHex: string
  readonly futureFrontier?: boolean
}> = {
  solis_vale: { name: 'Solis Vale', subtitle: 'Western Sunlit Heartlands', tierRange: 'Tier I–II', tintHex: '#93b868', accentHex: '#6ea858' },
  silverfen: { name: 'The Silverfen', subtitle: 'Twin-River Marshes & Shrines', tierRange: 'Tier II–III', tintHex: '#7cb5a0', accentHex: '#4fa89b' },
  ashen_catacombs: { name: 'Ashen Catacombs', subtitle: 'Haunted Timberlands & Vaults', tierRange: 'Tier II–IV', tintHex: '#8d7ea8', accentHex: '#8b72cf' },
  frostspire: { name: 'Frostspire Highlands', subtitle: 'Glacial Peaks & Ice Citadels', tierRange: 'Tier III–V', tintHex: '#9bc4db', accentHex: '#6fc3eb' },
  emberwaste: { name: 'Emberwaste Caldera', subtitle: 'Basalt Forges & Lava Rifts', tierRange: 'Tier IV–V', tintHex: '#c78262', accentHex: '#eb7544' },
  eclipse_dominion: { name: 'Eclipse Dominion', subtitle: 'Obsidian Headland & Throne', tierRange: 'Tier V', tintHex: '#9e6f9e', accentHex: '#d95ecc' },
  sunbleached_dunes: {
    name: 'Sunbleached Dunes', subtitle: 'Southern Desert Reach (Future)', tierRange: 'Tier V–VI',
    tintHex: '#dbb26b', accentHex: '#f0b84f', futureFrontier: true
  },
  aether_isles: {
    name: 'Aether Isles', subtitle: 'Sky-Struck Archipelago (Future)', tierRange: 'Tier VI–VII',
    tintHex: '#7da6d9', accentHex: '#7ad4ff', futureFrontier: true
  },
  shattered_expanse: {
    name: 'Shattered Expanse', subtitle: 'Outer Void Rim (Future)', tierRange: 'Tier VI–VIII',
    tintHex: '#8c5678', accentHex: '#ff69b4', futureFrontier: true
  }
}

export const DIFFICULTY_META: Record<DifficultyLevel, {
  readonly label: string
  readonly short: string
  readonly hex: string
  readonly bgHex: string
}> = {
  1: { label: 'Skirmish', short: 'I', hex: '#4cd48c', bgHex: '#153828' },
  2: { label: 'Standard', short: 'II', hex: '#5ca8ff', bgHex: '#172c4d' },
  3: { label: 'Challenging', short: 'III', hex: '#ffcb57', bgHex: '#3b2c12' },
  4: { label: 'Hard', short: 'IV', hex: '#ff8a47', bgHex: '#422214' },
  5: { label: 'Boss', short: 'V', hex: '#ff5266', bgHex: '#421622' },
  6: { label: 'Mythic', short: 'VI', hex: '#d77dff', bgHex: '#331647' },
  7: { label: 'Cataclysm', short: 'VII', hex: '#ff69b4', bgHex: '#451232' },
  8: { label: 'Apex', short: 'VIII', hex: '#ffe878', bgHex: '#472210' }
}

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export const RARITY_META: Record<Rarity, {
  readonly label: string
  readonly short: string
  readonly hex: string
  readonly bgHex: string
  readonly value: number
  readonly salvage: number
}> = {
  common: { label: 'Common', short: 'COM', hex: '#9fb4c2', bgHex: '#1b2836e8', value: 40, salvage: 15 },
  uncommon: { label: 'Uncommon', short: 'UNC', hex: '#4cd48c', bgHex: '#152e2be8', value: 90, salvage: 35 },
  rare: { label: 'Rare', short: 'RARE', hex: '#5ca8ff', bgHex: '#152742e8', value: 185, salvage: 80 },
  epic: { label: 'Epic', short: 'EPIC', hex: '#c87dff', bgHex: '#291b3ee8', value: 360, salvage: 175 },
  legendary: { label: 'Legendary', short: 'LEG', hex: '#ffcb57', bgHex: '#382a14e8', value: 720, salvage: 350 }
}

export const MERGE_COPIES_REQUIRED: Record<1 | 2, number> = {
  1: 3, // 3 identical 1* heroes -> 2* hero (unlocks Skill 2!)
  2: 2  // 2 identical 2* heroes -> 3* hero (unlocks Skill 3!)
}

export const HERO_SPECS: Record<HeroClassId, HeroSpec> = {
  knight: {
    id: 'knight',
    name: 'Sir Aldric',
    title: 'Knight',
    rarity: 'common',
    maxHp: 74,
    atk: 15,
    def: 6,
    speed: 8,
    move: 3,
    jump: 1,
    range: 1,
    crit: 0.10,
    zoc: true,
    lore: 'Sworn shieldbearer of the Solis Vanguard who holds the line against the Eclipse.',
    skills: [
      {
        id: 'shield_bash', name: 'Shield Bash', tier: 1,
        desc: 'Strike adjacent foe (125% ATK), Push 1 tile, +12 Shield & Taunt 2 turns.',
        range: 1, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.25, flatBonus: 4, healAmount: 0, shieldAmount: 12, ignoreArmor: 0.2,
        selfStatus: 'taunt', displacement: { kind: 'knockback', distance: 1 }, vfx: 'slash'
      },
      {
        id: 'bulwark_aura', name: 'Bulwark Aura', tier: 2,
        desc: 'Grant +20 Shield to self & adjacent allies, & Taunt nearby foes.',
        range: 0, cooldown: 3, target: 'self', pattern: 'aura',
        powerMul: 0, flatBonus: 0, healAmount: 6, shieldAmount: 20, ignoreArmor: 0,
        selfStatus: 'taunt', vfx: 'holy'
      },
      {
        id: 'solar_cleave', name: 'Crown Cleave', tier: 3,
        desc: 'Shatter all nearby enemies (165% ATK) & stun 1 turn.',
        range: 1, cooldown: 3, target: 'enemy', pattern: 'cross',
        powerMul: 1.65, flatBonus: 8, healAmount: 0, shieldAmount: 14, ignoreArmor: 0.35,
        status: 'stun', vfx: 'holy'
      }
    ]
  },
  archer: {
    id: 'archer',
    name: 'Lyra',
    title: 'Archer',
    rarity: 'common',
    maxHp: 50,
    atk: 16,
    def: 3,
    speed: 13,
    move: 3,
    jump: 2,
    range: 3,
    crit: 0.22,
    zoc: false,
    lore: 'Highland scout whose fletched arrows strike true from every ridge and tower.',
    skills: [
      {
        id: 'piercing_arrow', name: 'Piercing Shot', tier: 1,
        desc: 'Long shot (135% ATK, ignores 60% DEF) & Push 1 tile.',
        range: 4, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.35, flatBonus: 4, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.6,
        displacement: { kind: 'knockback', distance: 1 }, vfx: 'arrow'
      },
      {
        id: 'volley_rain', name: 'Volley Rain', tier: 2,
        desc: 'Rain arrows in a 3x3 area (115% ATK to all foes).',
        range: 4, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.15, flatBonus: 3, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.25,
        vfx: 'arrow'
      },
      {
        id: 'hawks_snipe', name: 'Hawk Snipe', tier: 3,
        desc: 'Cross-field lethal shot (210% ATK, ignores all armor).',
        range: 6, cooldown: 3, target: 'enemy', pattern: 'single',
        powerMul: 2.1, flatBonus: 10, healAmount: 0, shieldAmount: 0, ignoreArmor: 1.0,
        vfx: 'arrow'
      }
    ]
  },
  mage: {
    id: 'mage',
    name: 'Vesper',
    title: 'Mage',
    rarity: 'common',
    maxHp: 46,
    atk: 18,
    def: 2,
    speed: 11,
    move: 3,
    jump: 2,
    range: 3,
    crit: 0.16,
    zoc: false,
    lore: 'Keeper of the Solis Lantern who channels raw starfire into tactical bursts.',
    skills: [
      {
        id: 'arcane_bolt', name: 'Arcane Bolt', tier: 1,
        desc: 'Unerring arcane lance (130% ATK, ignores 75% DEF).',
        range: 3, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.3, flatBonus: 5, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.75,
        vfx: 'arcane'
      },
      {
        id: 'ember_nova', name: 'Ember Nova', tier: 2,
        desc: 'Cross-shaped flame blast (125% ATK) & inflicts Burn.',
        range: 3, cooldown: 3, target: 'tile', pattern: 'cross',
        powerMul: 1.25, flatBonus: 5, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.5,
        status: 'burn', vfx: 'fire'
      },
      {
        id: 'starfall', name: 'Starfall Storm', tier: 3,
        desc: '3x3 meteor tempest (175% ATK, ignores 80% DEF, Burn).',
        range: 4, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.75, flatBonus: 8, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.8,
        status: 'burn', vfx: 'fire'
      }
    ]
  },
  cleric: {
    id: 'cleric',
    name: 'Sera',
    title: 'Cleric',
    rarity: 'uncommon',
    maxHp: 56,
    atk: 14,
    def: 4,
    speed: 10,
    move: 3,
    jump: 2,
    range: 3,
    crit: 0.12,
    zoc: false,
    lore: 'Sun-order healer who mends shattered bones and burns shadow creatures.',
    skills: [
      {
        id: 'sun_mend', name: 'Sunbeam Mend', tier: 1,
        desc: 'Heal an ally 28 HP (+8 Shield & Haste), or Revive a downed hero (50% HP).',
        range: 3, cooldown: 2, target: 'ally', pattern: 'single',
        powerMul: 0, flatBonus: 0, healAmount: 28, shieldAmount: 8, ignoreArmor: 0,
        canRevive: true, reviveHpRatio: 0.5, status: 'haste',
        vfx: 'holy'
      },
      {
        id: 'sanctuary_wave', name: 'Sanctuary Wave', tier: 2,
        desc: 'Heal self & adjacent allies 24 HP + 14 Shield; revives adjacent downed allies.',
        range: 0, cooldown: 3, target: 'self', pattern: 'aura',
        powerMul: 0, flatBonus: 0, healAmount: 24, shieldAmount: 14, ignoreArmor: 0,
        canRevive: true, reviveHpRatio: 0.45,
        vfx: 'holy'
      },
      {
        id: 'dawns_judgment', name: 'Dawn Judgment', tier: 3,
        desc: 'Smite 3x3 enemies (155% ATK) & heal or revive nearby allies.',
        range: 3, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.55, flatBonus: 8, healAmount: 22, shieldAmount: 10, ignoreArmor: 0.7,
        canRevive: true, reviveHpRatio: 0.55,
        vfx: 'holy'
      }
    ]
  },
  rogue: {
    id: 'rogue',
    name: 'Kael',
    title: 'Rogue',
    rarity: 'uncommon',
    maxHp: 54,
    atk: 19,
    def: 3,
    speed: 15,
    move: 4,
    jump: 3,
    range: 1,
    crit: 0.32,
    zoc: true,
    evadeZoc: true,
    lore: 'Swift twilight duelist who vaults across battle lines to sever enemy casters.',
    skills: [
      {
        id: 'shadowstep', name: 'Shadow Strike', tier: 1,
        desc: 'Vault up to 3 tiles to ambush foe (145% ATK), Swap positions & inflict Poison x2.',
        range: 3, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.45, flatBonus: 5, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.4,
        status: 'poison', statusStacks: 2, displacement: { kind: 'swap', distance: 1 }, vfx: 'shadow'
      },
      {
        id: 'fan_blades', name: 'Fan of Blades', tier: 2,
        desc: 'Slash all enemies in a cross (135% ATK) & inflict Poison.',
        range: 1, cooldown: 2, target: 'enemy', pattern: 'cross',
        powerMul: 1.35, flatBonus: 4, healAmount: 0, shieldAmount: 10, ignoreArmor: 0.35,
        status: 'poison', statusStacks: 1, vfx: 'shadow'
      },
      {
        id: 'phantom_exec', name: 'Phantom Finisher', tier: 3,
        desc: 'Devastating 225% ATK strike & gain Empower.',
        range: 3, cooldown: 3, target: 'enemy', pattern: 'single',
        powerMul: 2.25, flatBonus: 12, healAmount: 14, shieldAmount: 0, ignoreArmor: 0.85,
        status: 'empower', vfx: 'shadow'
      }
    ]
  },
  paladin: {
    id: 'paladin',
    name: 'Dame Isolde',
    title: 'Paladin',
    rarity: 'rare',
    maxHp: 88,
    atk: 18,
    def: 8,
    speed: 9,
    move: 3,
    jump: 1,
    range: 1,
    crit: 0.15,
    zoc: true,
    lore: 'Gilded champion of the High Bastion, armored in sun-forged plate.',
    skills: [
      {
        id: 'radiant_cleave', name: 'Radiant Smite', tier: 1,
        desc: 'Strike enemy (145% ATK) & heal self for 16 HP.',
        range: 1, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.45, flatBonus: 6, healAmount: 16, shieldAmount: 8, ignoreArmor: 0.35,
        vfx: 'holy'
      },
      {
        id: 'aegis_vow', name: 'Aegis Vow', tier: 2,
        desc: 'Fortify self & allies (+30 Shield, Empower) & Taunt nearby foes.',
        range: 0, cooldown: 3, target: 'self', pattern: 'aura',
        powerMul: 0, flatBonus: 0, healAmount: 14, shieldAmount: 30, ignoreArmor: 0,
        status: 'empower', selfStatus: 'taunt', vfx: 'holy'
      },
      {
        id: 'solar_verdict', name: 'Solar Verdict', tier: 3,
        desc: 'Unleash 3x3 radiant wrath (190% ATK) & stun foes.',
        range: 2, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.9, flatBonus: 10, healAmount: 16, shieldAmount: 16, ignoreArmor: 0.65,
        status: 'stun', vfx: 'holy'
      }
    ]
  },
  cryomancer: {
    id: 'cryomancer',
    name: 'Freya',
    title: 'Cryomancer',
    rarity: 'epic',
    maxHp: 56,
    atk: 21,
    def: 4,
    speed: 11,
    move: 3,
    jump: 2,
    range: 3,
    crit: 0.18,
    zoc: false,
    lore: 'Glacial arcanist from Frostspire who locks entire enemy flanks in crystal ice.',
    skills: [
      {
        id: 'frost_lance', name: 'Frost Lance', tier: 1,
        desc: 'Pierce enemy (140% ATK, ignores 70% DEF), Pull 2 tiles & Slow.',
        range: 4, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.4, flatBonus: 6, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.7,
        status: 'slow', displacement: { kind: 'pull', distance: 2 }, vfx: 'frost'
      },
      {
        id: 'glacial_ring', name: 'Glacial Ring', tier: 2,
        desc: 'Freeze a cross area (135% ATK) & Slow all struck.',
        range: 3, cooldown: 3, target: 'tile', pattern: 'cross',
        powerMul: 1.35, flatBonus: 6, healAmount: 0, shieldAmount: 10, ignoreArmor: 0.6,
        status: 'slow', vfx: 'frost'
      },
      {
        id: 'absolute_zero', name: 'Absolute Zero', tier: 3,
        desc: '3x3 deep freeze (195% ATK, Stuns all enemies!).',
        range: 4, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.95, flatBonus: 10, healAmount: 0, shieldAmount: 12, ignoreArmor: 0.85,
        status: 'stun', vfx: 'frost'
      }
    ]
  },
  champion: {
    id: 'champion',
    name: 'Aurelius',
    title: 'Sunblade',
    rarity: 'legendary',
    maxHp: 96,
    atk: 25,
    def: 9,
    speed: 12,
    move: 4,
    jump: 2,
    range: 2,
    crit: 0.26,
    zoc: true,
    lore: 'Mythic heir of the First Crown, wielding twin blades of living starlight.',
    skills: [
      {
        id: 'solar_slash', name: 'Solar Arc', tier: 1,
        desc: 'Sweeping fire arc (155% ATK, ignores 50% DEF, Burn) & Push 1 tile.',
        range: 2, cooldown: 2, target: 'enemy', pattern: 'cross',
        powerMul: 1.55, flatBonus: 8, healAmount: 0, shieldAmount: 14, ignoreArmor: 0.5,
        status: 'burn', displacement: { kind: 'knockback', distance: 1 }, vfx: 'fire'
      },
      {
        id: 'phoenix_charge', name: 'Phoenix Surge', tier: 2,
        desc: 'Blazing 3x3 detonation (170% ATK) & +24 Shield.',
        range: 3, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.7, flatBonus: 10, healAmount: 14, shieldAmount: 24, ignoreArmor: 0.65,
        status: 'burn', vfx: 'fire'
      },
      {
        id: 'crownbreaker', name: 'Crownbreaker', tier: 3,
        desc: 'Cataclysmic 3x3 golden shockwave (240% ATK, Stun).',
        range: 3, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 2.4, flatBonus: 16, healAmount: 20, shieldAmount: 28, ignoreArmor: 0.9,
        status: 'stun', vfx: 'holy'
      }
    ]
  }
}

export const HERO_LIST: readonly HeroSpec[] = Object.values(HERO_SPECS)

export const EQUIPMENT_LIST: readonly EquipmentSpec[] = [
  // Weapons
  {
    id: 'iron_sword', name: 'Iron Broadsword', slot: 'weapon', rarity: 'common',
    desc: '+5 ATK. Reliable Vanguard steel.',
    atk: 5, def: 0, hp: 0, speed: 0, move: 0, range: 0, crit: 0.04, lifesteal: 0, shieldStart: 0, accentHex: '#c2cfd8'
  },
  {
    id: 'hunter_bow', name: 'Yew Longbow', slot: 'weapon', rarity: 'common',
    desc: '+4 ATK, +1 SPD, +10% Crit.',
    atk: 4, def: 0, hp: 0, speed: 1, move: 0, range: 0, crit: 0.10, lifesteal: 0, shieldStart: 0, accentHex: '#b8834d'
  },
  {
    id: 'ember_wand', name: 'Ember Scepter', slot: 'weapon', rarity: 'uncommon',
    desc: '+8 ATK, +6 HP, +1 SPD.',
    atk: 8, def: 0, hp: 6, speed: 1, move: 0, range: 0, crit: 0.06, lifesteal: 0, shieldStart: 0, accentHex: '#f08742'
  },
  {
    id: 'sunsteel_blade', name: 'Sunsteel Blade', slot: 'weapon', rarity: 'rare',
    desc: '+11 ATK, +1 SPD, +14% Crit.',
    atk: 11, def: 1, hp: 0, speed: 1, move: 0, range: 0, crit: 0.14, lifesteal: 0, shieldStart: 0, accentHex: '#f0c44d'
  },
  {
    id: 'frostbite_staff', name: 'Frostbite Staff', slot: 'weapon', rarity: 'rare',
    desc: '+10 ATK, +1 Range, +1 SPD.',
    atk: 10, def: 0, hp: 8, speed: 1, move: 0, range: 1, crit: 0.08, lifesteal: 0, shieldStart: 0, accentHex: '#6dd9ff'
  },
  {
    id: 'dragonfang_spear', name: 'Dragonfang Halberd', slot: 'weapon', rarity: 'epic',
    desc: '+15 ATK, +1 Range, +15% Lifesteal, Venom.',
    atk: 15, def: 2, hp: 10, speed: 1, move: 0, range: 1, crit: 0.12, lifesteal: 0.15, shieldStart: 0, onHitStatus: 'poison', accentHex: '#d66bff'
  },
  {
    id: 'solis_crownblade', name: 'Solis Crownblade', slot: 'weapon', rarity: 'legendary',
    desc: '+22 ATK, +2 SPD, +25% Crit, Lifesteal.',
    atk: 22, def: 3, hp: 16, speed: 2, move: 0, range: 0, crit: 0.25, lifesteal: 0.25, shieldStart: 0, accentHex: '#ffe066'
  },

  // Armor
  {
    id: 'leather_jerkin', name: 'Scout Brigandine', slot: 'armor', rarity: 'common',
    desc: '+14 HP, +2 DEF.',
    atk: 0, def: 2, hp: 14, speed: 0, move: 0, range: 0, crit: 0, lifesteal: 0, shieldStart: 0, accentHex: '#8c6543'
  },
  {
    id: 'iron_plate', name: 'Watchman Plate', slot: 'armor', rarity: 'common',
    desc: '+22 HP, +4 DEF, +6 Start Shield.',
    atk: 0, def: 4, hp: 22, speed: 0, move: 0, range: 0, crit: 0, lifesteal: 0, shieldStart: 6, accentHex: '#8d9ca6'
  },
  {
    id: 'ranger_cloak', name: 'Windrunner Cloak', slot: 'armor', rarity: 'uncommon',
    desc: '+16 HP, +2 SPD, +1 Move.',
    atk: 0, def: 2, hp: 16, speed: 2, move: 1, range: 0, crit: 0.06, lifesteal: 0, shieldStart: 0, accentHex: '#43a87b'
  },
  {
    id: 'runed_mail', name: 'Runed Chainmail', slot: 'armor', rarity: 'rare',
    desc: '+32 HP, +6 DEF, +12 Start Shield.',
    atk: 0, def: 6, hp: 32, speed: 1, move: 0, range: 0, crit: 0, lifesteal: 0, shieldStart: 12, accentHex: '#5a9cf2'
  },
  {
    id: 'frostguard_plate', name: 'Frostguard Plate', slot: 'armor', rarity: 'epic',
    desc: '+44 HP, +8 DEF, +20 Start Shield.',
    atk: 2, def: 8, hp: 44, speed: 1, move: 0, range: 0, crit: 0, lifesteal: 0, shieldStart: 20, accentHex: '#9d7bff'
  },
  {
    id: 'aegis_of_dawn', name: 'Aegis of Dawn', slot: 'armor', rarity: 'legendary',
    desc: '+62 HP, +11 DEF, +2 SPD, +32 Shield, Start Taunt.',
    atk: 4, def: 11, hp: 62, speed: 2, move: 0, range: 0, crit: 0, lifesteal: 0, shieldStart: 32, startStatus: 'taunt', accentHex: '#ffd15c'
  },

  // Relics
  {
    id: 'copper_signet', name: 'Copper Signet', slot: 'relic', rarity: 'common',
    desc: '+3 ATK, +8 HP, +1 SPD.',
    atk: 3, def: 1, hp: 8, speed: 1, move: 0, range: 0, crit: 0.05, lifesteal: 0, shieldStart: 0, accentHex: '#c9885b'
  },
  {
    id: 'swift_boots', name: 'Gale Striders', slot: 'relic', rarity: 'uncommon',
    desc: '+3 SPD, +1 Move, +10 HP, Start Haste.',
    atk: 2, def: 1, hp: 10, speed: 3, move: 1, range: 0, crit: 0.08, lifesteal: 0, shieldStart: 0, startStatus: 'haste', accentHex: '#5cd99e'
  },
  {
    id: 'blood_amulet', name: 'Crimson Pendant', slot: 'relic', rarity: 'rare',
    desc: '+6 ATK, +28% Lifesteal, +1 SPD.',
    atk: 6, def: 0, hp: 12, speed: 1, move: 0, range: 0, crit: 0.08, lifesteal: 0.28, shieldStart: 0, accentHex: '#e85a6f'
  },
  {
    id: 'eagle_charm', name: 'Skyhawk Crest', slot: 'relic', rarity: 'epic',
    desc: '+1 Range, +2 SPD, +8 ATK, +20% Crit.',
    atk: 8, def: 1, hp: 14, speed: 2, move: 0, range: 1, crit: 0.20, lifesteal: 0, shieldStart: 0, accentHex: '#be7dff'
  },
  {
    id: 'heart_of_solis', name: 'Heart of Solis', slot: 'relic', rarity: 'legendary',
    desc: '+34 HP, +12 ATK, +3 SPD, +1 Move.',
    atk: 12, def: 4, hp: 34, speed: 3, move: 1, range: 0, crit: 0.18, lifesteal: 0.15, shieldStart: 15, accentHex: '#ffdb6e'
  }
]

export const EQUIPMENT_BY_ID: Record<string, EquipmentSpec> = Object.fromEntries(
  EQUIPMENT_LIST.map(item => [item.id, item])
)

export const TACTIC_LIST: readonly TacticCardSpec[] = [
  {
    id: 'rally_banner', name: 'Rally Banner', rarity: 'common', cost: 1,
    target: 'ally', pattern: 'single',
    desc: 'Empower ally (+35% DMG) & +10 Shield.',
    damage: 0, heal: 0, shield: 10, apGain: 0, status: 'empower', vfx: 'holy'
  },
  {
    id: 'healing_draught', name: 'Sunleaf Tonic', rarity: 'common', cost: 1,
    target: 'ally', pattern: 'single',
    desc: 'Restore 26 HP or Revive a downed hero (45% HP).',
    damage: 0, heal: 26, shield: 0, apGain: 0, canRevive: true, reviveHpRatio: 0.45, vfx: 'holy'
  },
  {
    id: 'phoenix_sigil', name: 'Phoenix Sigil', rarity: 'uncommon', cost: 1,
    target: 'ally', pattern: 'single',
    desc: 'Revive a downed hero (60% HP) or heal 30 HP + 12 Shield.',
    damage: 0, heal: 30, shield: 12, apGain: 0, canRevive: true, reviveHpRatio: 0.6, vfx: 'holy'
  },
  {
    id: 'iron_ward', name: 'Iron Ward', rarity: 'common', cost: 1,
    target: 'ally', pattern: 'single',
    desc: 'Grant +24 Shield to target hero.',
    damage: 0, heal: 0, shield: 24, apGain: 0, vfx: 'holy'
  },
  {
    id: 'flame_scroll', name: 'Cinder Scroll', rarity: 'uncommon', cost: 1,
    target: 'enemy', pattern: 'single',
    desc: 'Deal 20 Fire DMG & inflict Burn.',
    damage: 20, heal: 0, shield: 0, apGain: 0, status: 'burn', vfx: 'fire'
  },
  {
    id: 'wind_step', name: 'Gale Step', rarity: 'uncommon', cost: 1,
    target: 'ally', pattern: 'single',
    desc: 'Refresh ally Movement, +8 Shield & grant Haste.',
    damage: 0, heal: 0, shield: 8, apGain: 0, status: 'haste', refreshMove: true, vfx: 'arcane'
  },
  {
    id: 'gale_gust', name: 'Gale Gust', rarity: 'uncommon', cost: 1,
    target: 'enemy', pattern: 'single',
    desc: 'Blast an enemy 2 tiles back (8 DMG) with roaring wind.',
    damage: 8, heal: 0, shield: 0, apGain: 0,
    displacement: { kind: 'knockback', distance: 2 },
    vfx: 'arcane'
  },
  {
    id: 'taunt_banner', name: 'Vanguard Challenge', rarity: 'common', cost: 1,
    target: 'ally', pattern: 'single',
    desc: 'Grant +16 Shield & Taunt nearby foes for 2 turns.',
    damage: 0, heal: 0, shield: 16, apGain: 0, status: 'taunt', vfx: 'holy'
  },
  {
    id: 'venom_vial', name: 'Venom Flask', rarity: 'uncommon', cost: 1,
    target: 'enemy', pattern: 'single',
    desc: 'Deal 14 Venom DMG & inflict Poison x2.',
    damage: 14, heal: 0, shield: 0, apGain: 0, status: 'poison', statusStacks: 2, vfx: 'shadow'
  },
  {
    id: 'frost_nova_scroll', name: 'Rime Seal', rarity: 'rare', cost: 2,
    target: 'tile', pattern: 'cross',
    desc: 'Deal 24 Frost DMG in cross & Slow foes.',
    damage: 24, heal: 0, shield: 0, apGain: 0, status: 'slow', vfx: 'frost'
  },
  {
    id: 'arcane_surge', name: 'Crown Surge', rarity: 'rare', cost: 0,
    target: 'ally', pattern: 'single',
    desc: 'Gain +2 AP immediately & +10 Shield.',
    damage: 0, heal: 0, shield: 10, apGain: 2, vfx: 'arcane'
  },
  {
    id: 'lightning_chain', name: 'Storm Decree', rarity: 'epic', cost: 2,
    target: 'tile', pattern: 'area3',
    desc: '3x3 Tempest dealing 32 DMG & Stun!',
    damage: 32, heal: 0, shield: 0, apGain: 0, status: 'stun', vfx: 'arcane'
  },
  {
    id: 'solar_blessing', name: 'Solar Blessing', rarity: 'legendary', cost: 2,
    target: 'any', pattern: 'all_allies',
    desc: 'Heal or Revive ALL heroes (30 HP), +22 Shield & Empower!',
    damage: 0, heal: 30, shield: 22, apGain: 0, canRevive: true, reviveHpRatio: 0.6, status: 'empower', vfx: 'holy'
  }
]

export const TACTIC_BY_ID: Record<string, TacticCardSpec> = Object.fromEntries(
  TACTIC_LIST.map(card => [card.id, card])
)

export const PACK_LIST: readonly PackSpec[] = [
  {
    id: 'recruit',
    name: 'Recruit Deck',
    subtitle: '3 Cards · Hero Copies & Starter Gear',
    cost: 75,
    cardsPerPack: 3,
    guaranteedMinRarity: 'common',
    weights: { common: 75, uncommon: 20, rare: 4.5, epic: 0.45, legendary: 0.05 },
    accentHex: '#7fb5cf'
  },
  {
    id: 'vanguard',
    name: 'Vanguard Deck',
    subtitle: '4 Cards · 1+ Rare, Slim Epic Odds',
    cost: 190,
    cardsPerPack: 4,
    guaranteedMinRarity: 'rare',
    weights: { common: 56, uncommon: 31, rare: 11.4, epic: 1.45, legendary: 0.15 },
    featuredWeights: { common: 0, uncommon: 0, rare: 91, epic: 8.2, legendary: 0.8 },
    accentHex: '#5ca8ff'
  },
  {
    id: 'sovereign',
    name: 'Sovereign Deck',
    subtitle: '4 Cards · 1+ Rare, Best Epic/Leg Odds',
    cost: 520,
    cardsPerPack: 4,
    guaranteedMinRarity: 'rare',
    weights: { common: 32, uncommon: 36, rare: 26, epic: 5.2, legendary: 0.8 },
    featuredWeights: { common: 0, uncommon: 0, rare: 82, epic: 15.5, legendary: 2.5 },
    accentHex: '#ffcb57'
  }
]

export const PACK_BY_ID: Record<PackId, PackSpec> = {
  recruit: PACK_LIST[0],
  vanguard: PACK_LIST[1],
  sovereign: PACK_LIST[2]
}

export const ENEMY_SPECS: Record<EnemyArchetypeId, EnemySpec> = {
  goblin: {
    id: 'goblin', name: 'Ashen Goblin', maxHp: 38, atk: 12, def: 2, speed: 12, move: 3, jump: 2, range: 1, ai: 'melee', zoc: true
  },
  bone_archer: {
    id: 'bone_archer', name: 'Bone Archer', maxHp: 34, atk: 14, def: 1, speed: 11, move: 2, jump: 2, range: 3, ai: 'ranged', zoc: false
  },
  orc_brute: {
    id: 'orc_brute', name: 'Ironclad Orc', maxHp: 64, atk: 17, def: 5, speed: 7, move: 2, jump: 1, range: 1, ai: 'melee', zoc: true
  },
  bog_shaman: {
    id: 'bog_shaman', name: 'Eclipse Shaman', maxHp: 46, atk: 14, def: 2, speed: 10, move: 2, jump: 2, range: 3, ai: 'support', zoc: false
  },
  crypt_knight: {
    id: 'crypt_knight', name: 'Dread Knight', maxHp: 78, atk: 20, def: 7, speed: 9, move: 3, jump: 1, range: 1, ai: 'melee', zoc: true
  },
  frost_golem: {
    id: 'frost_golem', name: 'Frost Golem', maxHp: 96, atk: 22, def: 8, speed: 6, move: 2, jump: 1, range: 1, ai: 'melee', zoc: true
  },
  eclipse_archon: {
    id: 'eclipse_archon', name: 'Archon Malakor', maxHp: 190, atk: 26, def: 7, speed: 11, move: 3, jump: 3, range: 3, ai: 'boss', isBoss: true, zoc: true
  }
}

const G: TileTerrain = 'grass'
const S: TileTerrain = 'stone'
const H: TileTerrain = 'hill'
const B: TileTerrain = 'bridge'
const W: TileTerrain = 'water'
const R: TileTerrain = 'shrine'
const P: TileTerrain = 'pillar'
const L: TileTerrain = 'lava'
const N: TileTerrain = 'snow'
const D: TileTerrain = 'darkstone'
const T: TileTerrain = 'stairs'
const V: TileTerrain = 'void'
const M: TileTerrain = 'lava_geyser'
const I: TileTerrain = 'ice'
const A: TileTerrain = 'cursed_altar'
const F: TileTerrain = 'tall_grass'
const K: TileTerrain = 'barricade'

// Compact placeholder grid for upcoming ("SOON...") expansion nodes
const SOON_GRID: readonly (readonly TileTerrain[])[] = [
  [G, G, G, G, G, G],
  [G, S, S, S, S, G],
  [G, S, R, H, S, G],
  [G, S, S, S, S, G],
  [G, G, G, G, G, G]
]

export const CHAPTERS: readonly ChapterSpec[] = [
  // =========================================================================
  // ACT I: SOLIS VALE & THE SILVERFEN
  // =========================================================================
  {
    id: 'border_watch',
    index: 0,
    region: 'solis_vale',
    landmark: 'watchtower',
    kind: 'story',
    difficulty: 1,
    recommendedPower: 420,
    mapX: 0.10,
    mapY: 0.39,
    requires: [],
    title: 'Border Watch',
    subtitle: 'Sunlit Meadow Outpost',
    biome: 'meadow',
    introSpeaker: 'Sir Aldric',
    introText: 'The Eclipse raiders seized the Watchtower road! Hold the high hill, let Lyra loose from cover, and reclaim our first Crownshard.',
    outroSpeaker: 'Lyra',
    outroText: 'The road is clear! Chart our next march on the World Map — cross Millers\' Ford or push directly toward Sunken Bridge.',
    rewardGold: 85,
    replayGold: 45,
    rewardEquipId: 'iron_plate',
    rewardHeroId: 'knight',
    grid: [
      [V, G, H, H, T, G, G],
      [G, S, T, G, K, S, H],
      [G, S, R, G, G, H, G],
      [G, H, F, P, F, S, G],
      [V, G, G, W, W, G, V]
    ],
    heights: [
      [0, 0, 2, 2, 1, 1, 1],
      [0, 0, 1, 1, 1, 1, 2],
      [0, 0, 0, 0, 0, 1, 1],
      [0, 1, 0, 0, 0, 1, 1],
      [0, 0, 0, 0, 0, 0, 0]
    ],
    heroSpawns: [[0, 1], [1, 2], [0, 3], [1, 1]],
    objective: {
      kind: 'rout',
      label: 'Rout All Enemies',
      description: 'Defeat all Eclipse raiders holding the Watchtower road.'
    },
    enemies: [
      { id: 'goblin', col: 4, row: 2 },
      { id: 'goblin', col: 5, row: 3 },
      { id: 'bone_archer', col: 6, row: 1 }
    ]
  },
  {
    id: 'miller_ford',
    index: 1,
    region: 'solis_vale',
    landmark: 'bridge',
    kind: 'special',
    difficulty: 1,
    recommendedPower: 460,
    mapX: 0.17,
    mapY: 0.54,
    requires: ['border_watch'],
    specialTag: 'Ford Ambush',
    modifierDesc: '6x5 Tight Creek Crossing · Seize 2 Supply Chests',
    title: 'Millers\' Ford',
    subtitle: 'Special: Twin Creek Crossing',
    biome: 'meadow',
    introSpeaker: 'Lyra',
    introText: 'Raiders are looting the grain wagons at Millers\' Ford! Two narrow footbridges span the creek — strike quickly and seize their supply chests.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The villagers are safe and their supply chests are ours! The southern road now links cleanly toward Sunken Bridge.',
    rewardGold: 95,
    replayGold: 50,
    rewardEquipId: 'copper_signet',
    rewardHeroId: 'archer',
    grid: [
      [V, G, W, F, H, H],
      [G, S, B, S, T, G],
      [G, H, W, G, K, G],
      [G, S, B, S, T, G],
      [V, G, W, F, H, V]
    ],
    heights: [
      [0, 0, 0, 0, 2, 2],
      [0, 0, 0, 0, 1, 1],
      [0, 1, 0, 0, 1, 1],
      [0, 0, 0, 0, 1, 1],
      [0, 0, 0, 0, 2, 0]
    ],
    heroSpawns: [[0, 1], [0, 3], [1, 1], [1, 3]],
    objective: {
      kind: 'seize',
      label: 'Seize Supply Chests',
      description: 'Claim both raided supply chests within 10 turns (or rout all foes).',
      chestTiles: [{ col: 3, row: 2 }, { col: 5, row: 3 }],
      requiredChests: 2,
      turnLimit: 10
    },
    enemies: [
      { id: 'goblin', col: 3, row: 1 },
      { id: 'goblin', col: 3, row: 3 },
      { id: 'bone_archer', col: 4, row: 0 },
      { id: 'goblin', col: 5, row: 2 }
    ]
  },
  {
    id: 'sunken_bridge',
    index: 2,
    region: 'silverfen',
    landmark: 'bridge',
    kind: 'story',
    difficulty: 2,
    recommendedPower: 520,
    mapX: 0.26,
    mapY: 0.41,
    requires: ['border_watch', 'miller_ford'],
    unlockMode: 'any',
    unlocksSlot4: true,
    title: 'Sunken Bridge',
    subtitle: 'Misty River Crossing',
    biome: 'river',
    introSpeaker: 'Vesper',
    introText: 'Ironclad Orcs surge across the old stone arches toward our River Shrine! Hold the ward for 6 turns or break their line.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The crossing is ours! Reinforcements joined our banner — you can now deploy 4 Heroes, and multiple roads branch across Solis.',
    rewardGold: 110,
    replayGold: 60,
    rewardEquipId: 'ember_wand',
    rewardHeroId: 'archer',
    grid: [
      [V, G, W, W, G, H, H, V],
      [G, H, B, B, S, T, G, G],
      [G, T, W, W, F, K, G, G],
      [G, R, W, W, G, F, S, H],
      [G, T, B, B, S, T, H, G],
      [V, G, W, W, G, G, G, V]
    ],
    heights: [
      [0, 0, 0, 0, 1, 2, 2, 0],
      [0, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1, 1, 1, 1],
      [0, 0, 0, 0, 1, 1, 1, 2],
      [0, 1, 1, 1, 1, 1, 2, 1],
      [0, 0, 0, 0, 1, 1, 1, 0]
    ],
    heroSpawns: [[0, 1], [1, 2], [0, 4], [1, 3]],
    objective: {
      kind: 'defend',
      label: 'Defend River Shrine',
      description: 'Keep enemies off the River Shrine for 6 turns (or defeat all foes).',
      targetTurns: 6,
      protectTile: { col: 1, row: 3 },
      protectLabel: 'River Shrine'
    },
    enemies: [
      { id: 'orc_brute', col: 4, row: 1 },
      { id: 'goblin', col: 4, row: 4 },
      { id: 'bone_archer', col: 6, row: 0 },
      { id: 'bog_shaman', col: 7, row: 3 }
    ]
  },
  {
    id: 'briar_hollow',
    index: 3,
    region: 'silverfen',
    landmark: 'forest',
    kind: 'special',
    difficulty: 2,
    recommendedPower: 580,
    mapX: 0.32,
    mapY: 0.28,
    requires: ['sunken_bridge'],
    specialTag: 'Forest Ambush',
    modifierDesc: '8x5 Sunken Timber Road · High Ridge Snipers',
    title: 'Briar Hollow',
    subtitle: 'Special: Woodland Ambush',
    biome: 'meadow',
    introSpeaker: 'Lyra',
    introText: 'Eclipse scouts are perched along the timber ridges of Briar Hollow. Push down the sunken road and flush their archers off the high ground!',
    outroSpeaker: 'Lyra',
    outroText: 'The timber road is ours! Ahead through the sunlit oaks lies the sacred Sunwell Glade.',
    rewardGold: 115,
    replayGold: 64,
    rewardEquipId: 'hunter_bow',
    rewardHeroId: 'mage',
    grid: [
      [V, H, H, P, T, H, H, V],
      [G, T, F, F, G, G, T, G],
      [G, S, R, K, G, P, S, G],
      [G, T, F, F, G, G, T, G],
      [V, H, H, P, T, H, H, V]
    ],
    heights: [
      [0, 2, 2, 2, 1, 2, 3, 0],
      [0, 1, 0, 0, 0, 1, 2, 1],
      [0, 0, 0, 0, 0, 1, 1, 1],
      [0, 1, 0, 0, 0, 1, 2, 1],
      [0, 2, 2, 2, 1, 2, 3, 0]
    ],
    heroSpawns: [[0, 1], [1, 2], [0, 3], [1, 1]],
    enemies: [
      { id: 'goblin', col: 5, row: 1 },
      { id: 'orc_brute', col: 5, row: 3 },
      { id: 'bone_archer', col: 5, row: 0 },
      { id: 'bone_archer', col: 5, row: 4 }
    ]
  },
  {
    id: 'sunwell_glade',
    index: 4,
    region: 'silverfen',
    landmark: 'shrine',
    kind: 'special',
    difficulty: 2,
    recommendedPower: 620,
    mapX: 0.40,
    mapY: 0.23,
    requires: ['briar_hollow', 'sunken_bridge'],
    unlockMode: 'any',
    specialTag: 'Shrine Trial',
    modifierDesc: '7x7 Sacred Grove · 3 Sun Shrines · Recruits Sera',
    title: 'Sunwell Glade',
    subtitle: 'Special: Sacred Shrine Trial',
    biome: 'meadow',
    introSpeaker: 'Lyra',
    introText: 'Raiders are desecrating the Sunwell shrines! Hold the healing altars on this square ridge and Sera of the Sun Order will pledge to our banner.',
    outroSpeaker: 'Lyra',
    outroText: 'The shrines glow again and Sera rides with us! The mountain trail now climbs north into Frostspire Highlands.',
    rewardGold: 120,
    replayGold: 68,
    rewardEquipId: 'swift_boots',
    rewardHeroId: 'cleric',
    grid: [
      [V, H, T, R, T, H, V],
      [G, F, P, G, P, F, G],
      [G, S, T, H, T, S, G],
      [G, R, G, H, G, R, S],
      [G, S, T, H, T, S, G],
      [G, F, P, G, P, F, G],
      [V, H, T, W, T, H, V]
    ],
    heights: [
      [0, 2, 1, 2, 1, 2, 0],
      [0, 1, 1, 1, 1, 1, 1],
      [0, 0, 1, 2, 1, 1, 1],
      [0, 1, 1, 2, 1, 1, 2],
      [0, 0, 1, 2, 1, 1, 1],
      [0, 1, 1, 1, 1, 1, 1],
      [0, 2, 1, 0, 1, 2, 0]
    ],
    heroSpawns: [[0, 2], [1, 3], [0, 4], [1, 2]],
    objective: {
      kind: 'defend',
      label: 'Defend Sunwell Altar',
      description: 'Protect the Sunwell Altar for 6 turns or defeat all raiders.',
      targetTurns: 6,
      protectTile: { col: 1, row: 3 },
      protectLabel: 'Sunwell Altar'
    },
    enemies: [
      { id: 'goblin', col: 5, row: 2 },
      { id: 'goblin', col: 5, row: 4 },
      { id: 'bone_archer', col: 5, row: 0 },
      { id: 'bone_archer', col: 5, row: 6 },
      { id: 'bog_shaman', col: 6, row: 3 }
    ]
  },

  // =========================================================================
  // ACT II: ASHEN CATACOMBS & FROSTSPIRE HIGHLANDS
  // =========================================================================
  {
    id: 'lantern_crypt',
    index: 5,
    region: 'ashen_catacombs',
    landmark: 'crypt',
    kind: 'story',
    difficulty: 2,
    recommendedPower: 660,
    mapX: 0.35,
    mapY: 0.56,
    requires: ['sunken_bridge'],
    title: 'Lantern Crypt',
    subtitle: 'Torchlit Catacomb Vault',
    biome: 'crypt',
    introSpeaker: 'Vesper',
    introText: 'The Crypt Warden awakens in the blue lantern mist! Use the stone pillars to break archer sightlines and cut down their commander.',
    outroSpeaker: 'Vesper',
    outroText: 'The catacombs are silent! Beyond these halls lie Whispering Barrow, the Cursed Vault, and the northern pass.',
    rewardGold: 130,
    replayGold: 72,
    rewardEquipId: 'ranger_cloak',
    rewardHeroId: 'mage',
    grid: [
      [V, D, S, T, D, S, H, V],
      [S, S, P, S, S, P, S, H],
      [S, T, S, R, A, S, T, S],
      [S, S, S, S, S, S, S, S],
      [S, S, K, S, S, P, S, H],
      [V, D, S, T, D, S, H, V]
    ],
    heights: [
      [0, 2, 2, 1, 2, 2, 2, 0],
      [0, 1, 1, 1, 1, 1, 1, 2],
      [0, 1, 0, 1, 0, 1, 2, 2],
      [0, 0, 0, 0, 0, 1, 1, 1],
      [0, 1, 1, 1, 1, 1, 1, 2],
      [0, 2, 2, 1, 2, 2, 2, 0]
    ],
    heroSpawns: [[1, 1], [1, 2], [1, 3], [1, 4]],
    objective: {
      kind: 'assassinate',
      label: 'Slay Crypt Warden',
      description: 'Defeat the Crypt Warden leading the catacomb garrison.',
      targetEnemyIndex: 0,
      targetEnemyId: 'crypt_knight',
      targetName: 'Crypt Warden'
    },
    enemies: [
      { id: 'crypt_knight', col: 5, row: 2, name: 'Crypt Warden' },
      { id: 'orc_brute', col: 5, row: 3 },
      { id: 'bone_archer', col: 7, row: 1 },
      { id: 'bog_shaman', col: 7, row: 4 }
    ]
  },
  {
    id: 'whispering_barrow',
    index: 6,
    region: 'ashen_catacombs',
    landmark: 'ruins',
    kind: 'special',
    difficulty: 3,
    recommendedPower: 740,
    mapX: 0.31,
    mapY: 0.70,
    requires: ['lantern_crypt'],
    specialTag: 'Barrow Raid',
    modifierDesc: '7x6 Sunken Crypt Gallery · Twin Elevation Flanks',
    title: 'Whispering Barrow',
    subtitle: 'Special: Sunken Archer Gallery',
    biome: 'crypt',
    introSpeaker: 'Vesper',
    introText: 'Bone Archers hold both elevated ledges of the Whispering Barrow while a Dread Knight seals the center lane. Break their crossfire!',
    outroSpeaker: 'Vesper',
    outroText: 'The barrow bells fall silent — and we recovered a gleaming Frostbite Staff from the crypt reliquary!',
    rewardGold: 155,
    replayGold: 84,
    rewardEquipId: 'frostbite_staff',
    rewardHeroId: null,
    grid: [
      [V, D, H, D, H, H, V],
      [S, T, P, T, P, T, S],
      [S, R, S, A, S, H, S],
      [S, S, S, P, S, S, S],
      [S, T, P, T, P, T, S],
      [V, D, H, D, H, H, V]
    ],
    heights: [
      [0, 2, 3, 3, 3, 3, 0],
      [0, 1, 2, 2, 2, 2, 1],
      [0, 0, 0, 1, 1, 2, 1],
      [0, 0, 0, 1, 1, 1, 1],
      [0, 1, 2, 2, 2, 2, 1],
      [0, 2, 3, 3, 3, 3, 0]
    ],
    heroSpawns: [[0, 2], [1, 2], [0, 3], [1, 3]],
    enemies: [
      { id: 'crypt_knight', col: 4, row: 2 },
      { id: 'bone_archer', col: 5, row: 0, levelScale: 1.12 },
      { id: 'bone_archer', col: 5, row: 5, levelScale: 1.12 },
      { id: 'bog_shaman', col: 6, row: 3 }
    ]
  },
  {
    id: 'cursed_vault',
    index: 7,
    region: 'ashen_catacombs',
    landmark: 'vault',
    kind: 'treasure',
    difficulty: 3,
    recommendedPower: 830,
    mapX: 0.45,
    mapY: 0.64,
    requires: ['lantern_crypt'],
    specialTag: 'Treasure Vault',
    modifierDesc: '6x6 Close-Quarters Ambush · War-Chest Bounty',
    title: 'Cursed Vault',
    subtitle: 'Special: Sealed Reliquary',
    biome: 'crypt',
    introSpeaker: 'Vesper',
    introText: 'A cramped obsidian reliquary overflowing with stolen Solis gold! Two Dread Knights guard the tight floor — strike fast before they box us in.',
    outroSpeaker: 'Vesper',
    outroText: 'The war-chest is cracked open and Sunsteel steel gleams inside! A tunnel here climbs straight toward Emberwaste.',
    rewardGold: 220,
    replayGold: 95,
    rewardEquipId: 'sunsteel_blade',
    rewardHeroId: null,
    grid: [
      [V, S, D, D, S, V],
      [S, P, T, T, P, S],
      [S, T, R, H, S, S],
      [S, T, H, A, S, S],
      [S, P, T, T, P, S],
      [V, S, D, D, S, V]
    ],
    heights: [
      [0, 1, 2, 2, 1, 0],
      [0, 1, 1, 1, 1, 1],
      [0, 1, 2, 2, 1, 1],
      [0, 1, 2, 1, 1, 1],
      [0, 1, 1, 1, 1, 1],
      [0, 1, 2, 2, 1, 0]
    ],
    heroSpawns: [[0, 2], [0, 3], [1, 2], [1, 3]],
    objective: {
      kind: 'seize',
      label: 'Seize Reliquary Seal',
      description: 'Reach the Reliquary Seal within 10 turns. Optional chests hold bonus gold!',
      goalTile: { col: 5, row: 2 },
      goalLabel: 'Reliquary Seal',
      chestTiles: [{ col: 2, row: 2 }, { col: 5, row: 3 }],
      requiredChests: 0,
      turnLimit: 10
    },
    enemies: [
      { id: 'crypt_knight', col: 4, row: 2, levelScale: 1.08 },
      { id: 'crypt_knight', col: 4, row: 3, levelScale: 1.08 },
      { id: 'bone_archer', col: 5, row: 1, levelScale: 1.1 },
      { id: 'bone_archer', col: 5, row: 4, levelScale: 1.1 }
    ]
  },
  {
    id: 'frostspire_pass',
    index: 8,
    region: 'frostspire',
    landmark: 'pass',
    kind: 'story',
    difficulty: 3,
    recommendedPower: 790,
    mapX: 0.48,
    mapY: 0.31,
    requires: ['sunwell_glade', 'lantern_crypt'],
    unlockMode: 'any',
    title: 'Frostspire Pass',
    subtitle: 'Glacial Alpine Ridge',
    biome: 'frost',
    introSpeaker: 'Lyra',
    introText: 'Massive Frost Golems guard the broad mountain stairs. Armor-piercing skills and magic cut right through their icy hide!',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The pass is ours and Kael joins our banner! Explore Mirror Tarn and Glacial Citadel, or march east to Obsidian Gate.',
    rewardGold: 165,
    replayGold: 90,
    rewardEquipId: 'runed_mail',
    rewardHeroId: 'rogue',
    grid: [
      [V, V, H, H, N, T, H, H, V],
      [N, S, T, P, N, H, T, S, H],
      [N, S, R, I, T, S, I, T, N],
      [W, W, N, I, P, I, S, S, H],
      [N, S, T, N, N, H, T, S, N],
      [V, N, N, V, W, W, N, V, V]
    ],
    heights: [
      [0, 0, 2, 2, 2, 3, 4, 4, 0],
      [0, 0, 1, 2, 2, 3, 3, 3, 4],
      [0, 0, 1, 1, 2, 2, 2, 3, 3],
      [0, 0, 1, 1, 2, 2, 2, 3, 3],
      [0, 0, 1, 1, 2, 2, 2, 3, 3],
      [0, 0, 1, 0, 0, 0, 2, 0, 0]
    ],
    heroSpawns: [[0, 1], [1, 2], [0, 4], [1, 4]],
    enemies: [
      { id: 'frost_golem', col: 5, row: 2 },
      { id: 'frost_golem', col: 6, row: 4 },
      { id: 'bone_archer', col: 8, row: 1, levelScale: 1.15 },
      { id: 'bog_shaman', col: 8, row: 3, levelScale: 1.15 }
    ]
  },
  {
    id: 'frozen_lake',
    index: 9,
    region: 'frostspire',
    landmark: 'lake',
    kind: 'special',
    difficulty: 3,
    recommendedPower: 880,
    mapX: 0.55,
    mapY: 0.19,
    requires: ['frostspire_pass'],
    specialTag: 'Frozen Island',
    modifierDesc: '8x7 Ice-Ringed Shrine Island · Twin Bridges',
    title: 'Mirror Tarn',
    subtitle: 'Special: Frozen Shrine Island',
    biome: 'frost',
    introSpeaker: 'Lyra',
    introText: 'An icy moat encircles a lone highland shrine! Seize the bridges and push the Frost Golem off the central crown.',
    outroSpeaker: 'Lyra',
    outroText: 'Mirror Tarn gleams beneath the snow! Skyhawk Crest is ours — giving our ranged scouts unmatched reach.',
    rewardGold: 185,
    replayGold: 100,
    rewardEquipId: 'eagle_charm',
    rewardHeroId: null,
    grid: [
      [V, N, H, I, I, H, N, V],
      [N, S, W, B, B, W, S, N],
      [N, W, W, T, T, W, W, N],
      [N, B, T, R, H, T, B, H],
      [N, W, W, T, T, W, W, N],
      [N, S, W, B, B, W, S, N],
      [V, N, H, I, I, H, N, V]
    ],
    heights: [
      [0, 0, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 0, 1, 1],
      [0, 0, 0, 1, 1, 0, 0, 1],
      [0, 0, 1, 2, 3, 2, 1, 2],
      [0, 0, 0, 1, 1, 0, 0, 1],
      [0, 0, 0, 1, 1, 0, 1, 1],
      [0, 0, 1, 1, 1, 1, 1, 0]
    ],
    heroSpawns: [[0, 2], [0, 3], [0, 4], [1, 3]],
    objective: {
      kind: 'seize',
      label: 'Seize Mirror Shrine',
      description: 'Claim the central Mirror Shrine within 9 turns (or rout all foes).',
      goalTile: { col: 3, row: 3 },
      goalLabel: 'Mirror Shrine',
      turnLimit: 9
    },
    enemies: [
      { id: 'frost_golem', col: 4, row: 3, levelScale: 1.12 },
      { id: 'crypt_knight', col: 6, row: 1, levelScale: 1.08 },
      { id: 'bone_archer', col: 6, row: 5, levelScale: 1.15 },
      { id: 'bog_shaman', col: 7, row: 3, levelScale: 1.15 }
    ]
  },
  {
    id: 'glacial_citadel',
    index: 10,
    region: 'frostspire',
    landmark: 'citadel',
    kind: 'elite',
    difficulty: 4,
    recommendedPower: 1080,
    mapX: 0.64,
    mapY: 0.24,
    requires: ['frostspire_pass', 'frozen_lake'],
    unlockMode: 'any',
    specialTag: 'Elite Siege',
    modifierDesc: '10x6 Twin-Bridge Siege · Epic Halberd Bounty',
    title: 'Glacial Citadel',
    subtitle: 'Special: Elite Ice Stronghold',
    biome: 'frost',
    introSpeaker: 'Sir Aldric',
    introText: 'An optional elite stronghold perched over twin ice chasms. Strike down the Citadel Marshal to break this garrison and claim the Dragonfang Halberd!',
    outroSpeaker: 'Lyra',
    outroText: 'The Glacial Citadel yields its Dragonfang Halberd! Our champions are truly forged for the Throne.',
    rewardGold: 240,
    replayGold: 130,
    rewardEquipId: 'dragonfang_spear',
    rewardHeroId: null,
    grid: [
      [V, H, N, V, V, N, H, H, N, V],
      [N, S, S, B, B, S, K, T, S, H],
      [N, R, I, V, V, I, T, H, S, N],
      [N, N, I, V, V, I, H, T, S, N],
      [N, S, S, B, B, S, P, T, S, H],
      [V, H, N, V, V, N, H, H, N, V]
    ],
    heights: [
      [0, 1, 1, 0, 0, 1, 2, 3, 3, 0],
      [0, 0, 1, 1, 1, 1, 2, 2, 3, 4],
      [0, 0, 1, 0, 0, 1, 2, 3, 3, 3],
      [0, 0, 1, 0, 0, 1, 2, 2, 3, 3],
      [0, 0, 1, 1, 1, 1, 2, 2, 3, 4],
      [0, 1, 1, 0, 0, 1, 2, 3, 3, 0]
    ],
    heroSpawns: [[0, 1], [1, 1], [0, 4], [1, 4]],
    objective: {
      kind: 'assassinate',
      label: 'Slay Citadel Marshal',
      description: 'Defeat the Citadel Marshal commanding the ice stronghold.',
      targetEnemyIndex: 2,
      targetEnemyId: 'crypt_knight',
      targetName: 'Citadel Marshal'
    },
    enemies: [
      { id: 'frost_golem', col: 5, row: 1, levelScale: 1.2 },
      { id: 'frost_golem', col: 5, row: 4, levelScale: 1.2 },
      { id: 'crypt_knight', col: 7, row: 2, levelScale: 1.2, name: 'Citadel Marshal' },
      { id: 'bone_archer', col: 9, row: 1, levelScale: 1.25 },
      { id: 'bog_shaman', col: 9, row: 4, levelScale: 1.25 }
    ]
  },

  // =========================================================================
  // ACT III: EMBERWASTE CALDERA & ECLIPSE DOMINION
  // =========================================================================
  {
    id: 'obsidian_gate',
    index: 11,
    region: 'emberwaste',
    landmark: 'gate',
    kind: 'story',
    difficulty: 4,
    recommendedPower: 960,
    mapX: 0.58,
    mapY: 0.49,
    requires: ['frostspire_pass', 'cursed_vault'],
    unlockMode: 'any',
    title: 'Obsidian Gate',
    subtitle: 'Volcanic Ember Bastion',
    biome: 'volcano',
    introSpeaker: 'Sir Aldric',
    introText: 'Molten rifts split the basalt causeway! Hold the Ember Ward for 6 turns against Malakor\'s royal guard or shatter their line.',
    outroSpeaker: 'Vesper',
    outroText: 'The outer bastion falls and Dame Isolde joins our vanguard! Raid Ashfall Foundry or storm the Eclipse Throne!',
    rewardGold: 210,
    replayGold: 115,
    rewardEquipId: 'blood_amulet',
    rewardHeroId: 'paladin',
    grid: [
      [V, D, L, L, D, H, H, D, V],
      [D, S, B, B, S, T, D, H, H],
      [D, R, L, P, M, D, H, T, D],
      [D, S, B, B, S, T, M, D, D],
      [D, D, L, L, M, P, T, H, H],
      [V, H, D, V, V, D, D, D, V]
    ],
    heights: [
      [0, 1, 0, 0, 1, 2, 3, 3, 0],
      [0, 1, 1, 1, 1, 2, 2, 3, 4],
      [0, 1, 0, 1, 1, 2, 3, 3, 3],
      [0, 1, 1, 1, 1, 2, 2, 3, 3],
      [0, 1, 0, 0, 1, 2, 2, 3, 4],
      [0, 2, 1, 0, 0, 1, 2, 2, 0]
    ],
    heroSpawns: [[0, 1], [1, 1], [0, 3], [1, 3]],
    objective: {
      kind: 'defend',
      label: 'Defend Ember Ward',
      description: 'Protect the Ember Ward for 6 turns or defeat all foes.',
      targetTurns: 6,
      protectTile: { col: 1, row: 2 },
      protectLabel: 'Ember Ward'
    },
    enemies: [
      { id: 'crypt_knight', col: 4, row: 1, levelScale: 1.15 },
      { id: 'frost_golem', col: 4, row: 3, levelScale: 1.15 },
      { id: 'orc_brute', col: 6, row: 2, levelScale: 1.2 },
      { id: 'bog_shaman', col: 8, row: 1, levelScale: 1.2 },
      { id: 'bone_archer', col: 8, row: 4, levelScale: 1.2 }
    ]
  },
  {
    id: 'ashfall_foundry',
    index: 12,
    region: 'emberwaste',
    landmark: 'foundry',
    kind: 'treasure',
    difficulty: 4,
    recommendedPower: 1120,
    mapX: 0.65,
    mapY: 0.63,
    requires: ['obsidian_gate'],
    specialTag: 'Magma Vault',
    modifierDesc: '7x7 Magma Forge · Epic Frostguard Plate Bounty',
    title: 'Ashfall Foundry',
    subtitle: 'Special: Volcanic Armories',
    biome: 'volcano',
    introSpeaker: 'Sir Aldric',
    introText: 'Malakor\'s war-forges churn inside Ashfall Foundry! Seize the central anvil shrine and claim their masterwork plate armor.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The foundries go cold and Frostguard Plate gleams in our hands — we are ready for Archon Malakor!',
    rewardGold: 270,
    replayGold: 140,
    rewardEquipId: 'frostguard_plate',
    rewardHeroId: null,
    grid: [
      [V, D, L, B, L, D, V],
      [D, S, T, M, T, H, D],
      [L, T, P, T, P, T, L],
      [B, S, T, R, T, S, B],
      [L, T, P, T, P, T, L],
      [D, S, T, M, T, H, D],
      [V, D, L, B, L, D, V]
    ],
    heights: [
      [0, 1, 0, 1, 0, 1, 0],
      [0, 1, 1, 2, 2, 3, 2],
      [0, 1, 2, 2, 2, 2, 0],
      [0, 1, 2, 3, 2, 2, 2],
      [0, 1, 2, 2, 2, 2, 0],
      [0, 1, 1, 2, 2, 3, 2],
      [0, 1, 0, 1, 0, 1, 0]
    ],
    heroSpawns: [[0, 3], [1, 1], [1, 3], [1, 5]],
    objective: {
      kind: 'seize',
      label: 'Seize Anvil Shrine',
      description: 'Claim the central Anvil Shrine within 10 turns. Armory chests grant bonus gold!',
      goalTile: { col: 3, row: 3 },
      goalLabel: 'Anvil Shrine',
      chestTiles: [{ col: 3, row: 1 }, { col: 3, row: 5 }],
      requiredChests: 0,
      turnLimit: 10
    },
    enemies: [
      { id: 'crypt_knight', col: 4, row: 3, levelScale: 1.2 },
      { id: 'frost_golem', col: 5, row: 1, levelScale: 1.2 },
      { id: 'orc_brute', col: 5, row: 5, levelScale: 1.25 },
      { id: 'bog_shaman', col: 6, row: 3, levelScale: 1.25 },
      { id: 'bone_archer', col: 5, row: 2, levelScale: 1.2 }
    ]
  },
  {
    id: 'eclipse_throne',
    index: 13,
    region: 'eclipse_dominion',
    landmark: 'throne',
    kind: 'boss',
    difficulty: 5,
    recommendedPower: 1240,
    mapX: 0.70,
    mapY: 0.40,
    requires: ['obsidian_gate'],
    specialTag: 'Act III Boss',
    modifierDesc: '10x7 Grand Cathedral · Boss: Archon Malakor',
    unlocksEndless: true,
    title: 'Eclipse Throne',
    subtitle: 'Boss: Archon Malakor',
    biome: 'throne',
    introSpeaker: 'Archon Malakor',
    introText: 'Fools of Solis! Your fragile vanguard dares challenge the Eclipse? Watch your precious Crown turn to cinders!',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The Sunstone Crown is reforged and the Ashen Rift seals at last! Solis stands free — and Endless Arena skirmishes now await your champions.',
    rewardGold: 360,
    replayGold: 175,
    rewardEquipId: 'solis_crownblade',
    rewardHeroId: 'champion',
    grid: [
      [V, V, S, H, H, H, S, V, V, V],
      [V, S, P, A, T, S, P, S, H, V],
      [D, R, S, T, H, M, T, H, S, D],
      [D, S, S, S, T, S, T, H, H, D],
      [D, S, S, T, H, M, T, H, S, D],
      [V, S, P, A, T, S, P, S, H, V],
      [V, V, S, L, L, L, S, V, V, V]
    ],
    heights: [
      [0, 0, 1, 2, 2, 2, 2, 0, 0, 0],
      [0, 1, 1, 1, 2, 2, 2, 3, 3, 0],
      [0, 1, 1, 1, 2, 2, 3, 4, 3, 3],
      [0, 0, 1, 1, 2, 2, 3, 4, 4, 3],
      [0, 1, 1, 1, 2, 2, 3, 4, 3, 3],
      [0, 1, 1, 1, 2, 2, 2, 3, 3, 0],
      [0, 0, 1, 0, 0, 0, 2, 0, 0, 0]
    ],
    heroSpawns: [[0, 2], [1, 2], [0, 4], [1, 4]],
    objective: {
      kind: 'assassinate',
      label: 'Slay Archon Malakor',
      description: 'Defeat Archon Malakor to shatter the Eclipse Vanguard!',
      targetEnemyIndex: 0,
      targetEnemyId: 'eclipse_archon',
      targetName: 'Archon Malakor'
    },
    enemies: [
      { id: 'eclipse_archon', col: 7, row: 3 },
      { id: 'crypt_knight', col: 6, row: 2 },
      { id: 'crypt_knight', col: 6, row: 4 },
      { id: 'bog_shaman', col: 8, row: 2, levelScale: 1.2 },
      { id: 'bone_archer', col: 8, row: 4, levelScale: 1.2 }
    ]
  },

  // =========================================================================
  // UPCOMING EXPANSION LOCATIONS ("SOON...") — FUTURE ACTS, RAIDS & FRONTIERS
  // =========================================================================
  {
    id: 'oakhaven_market',
    index: 14,
    region: 'solis_vale',
    landmark: 'town',
    kind: 'town',
    difficulty: 1,
    recommendedPower: 400,
    mapX: 0.15,
    mapY: 0.24,
    requires: ['border_watch'],
    comingSoon: true,
    soonNote: 'Soon... Traveling Relic Caravan, Bounty Board & Forge Crafting',
    specialTag: 'Soon...',
    title: 'Oakhaven City',
    subtitle: 'Free Trade Hub & Guild Hall',
    biome: 'meadow',
    introSpeaker: 'Sir Aldric',
    introText: 'Merchants and relic smiths gather behind Oakhaven\'s walls.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'Trade routes restored.',
    rewardGold: 100,
    replayGold: 50,
    rewardEquipId: null,
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'goblin', col: 5, row: 2 }, { id: 'goblin', col: 5, row: 1 }, { id: 'goblin', col: 5, row: 3 }]
  },
  {
    id: 'galewind_windmill',
    index: 15,
    region: 'solis_vale',
    landmark: 'watchtower',
    kind: 'special',
    difficulty: 2,
    recommendedPower: 560,
    mapX: 0.22,
    mapY: 0.17,
    requires: ['oakhaven_market', 'briar_hollow'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Stepped Windmill Ridge with Gust-Push Tiles',
    specialTag: 'Soon...',
    title: 'Galewind Ridge',
    subtitle: 'Vertical Windmill Siege',
    biome: 'meadow',
    introSpeaker: 'Lyra',
    introText: 'Highland winds howl across the terraced windmills.',
    outroSpeaker: 'Lyra',
    outroText: 'The highland ridges are ours.',
    rewardGold: 135,
    replayGold: 70,
    rewardEquipId: 'swift_boots',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'goblin', col: 5, row: 2 }, { id: 'bone_archer', col: 5, row: 1 }, { id: 'bone_archer', col: 5, row: 3 }]
  },
  {
    id: 'emerald_delta',
    index: 16,
    region: 'silverfen',
    landmark: 'lake',
    kind: 'special',
    difficulty: 3,
    recommendedPower: 720,
    mapX: 0.25,
    mapY: 0.62,
    requires: ['miller_ford', 'sunken_bridge'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Tidal Floodplains with Shifting Water Bridges & River Trolls',
    specialTag: 'Soon...',
    title: 'Emerald Delta',
    subtitle: 'Flooded Marsh Raid',
    biome: 'river',
    introSpeaker: 'Vesper',
    introText: 'Tides rise and fall every two turns across the sunken causeways.',
    outroSpeaker: 'Vesper',
    outroText: 'The marsh tide subsides.',
    rewardGold: 160,
    replayGold: 85,
    rewardEquipId: 'runed_mail',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'orc_brute', col: 5, row: 2 }, { id: 'bog_shaman', col: 5, row: 1 }, { id: 'goblin', col: 5, row: 3 }]
  },
  {
    id: 'sunken_monastery',
    index: 17,
    region: 'silverfen',
    landmark: 'shrine',
    kind: 'elite',
    difficulty: 3,
    recommendedPower: 780,
    mapX: 0.38,
    mapY: 0.41,
    requires: ['sunwell_glade', 'lantern_crypt'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Defend the Relic Altar for 6 Waves against Eclipse Zealots',
    specialTag: 'Soon...',
    title: 'Solis Monastery',
    subtitle: 'Wave-Defense Sanctum',
    biome: 'river',
    introSpeaker: 'Sir Aldric',
    introText: 'Hold the abbey courtyard while the bells rally the realm!',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The abbey stands unbroken.',
    rewardGold: 190,
    replayGold: 95,
    rewardEquipId: 'aegis_of_dawn',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'crypt_knight', col: 5, row: 2 }, { id: 'bog_shaman', col: 5, row: 1 }, { id: 'bone_archer', col: 5, row: 3 }]
  },
  {
    id: 'gloomwood_heart',
    index: 18,
    region: 'ashen_catacombs',
    landmark: 'forest',
    kind: 'special',
    difficulty: 3,
    recommendedPower: 810,
    mapX: 0.20,
    mapY: 0.73,
    requires: ['whispering_barrow', 'emerald_delta'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Fog-of-War Ambush inside the Haunted Timberlands',
    specialTag: 'Soon...',
    title: 'Gloomwood',
    subtitle: 'Fog-of-War Stalker Hunt',
    biome: 'crypt',
    introSpeaker: 'Lyra',
    introText: 'Shadow stalkers lurk beyond lantern light.',
    outroSpeaker: 'Lyra',
    outroText: 'The woods breathe easy again.',
    rewardGold: 175,
    replayGold: 92,
    rewardEquipId: 'eagle_charm',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'goblin', col: 5, row: 2 }, { id: 'bone_archer', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'bone_cathedral',
    index: 19,
    region: 'ashen_catacombs',
    landmark: 'crypt',
    kind: 'boss',
    difficulty: 4,
    recommendedPower: 1020,
    mapX: 0.42,
    mapY: 0.77,
    requires: ['whispering_barrow', 'cursed_vault'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Regional Boss: Bone Necromancer summoning Skeleton waves',
    specialTag: 'Soon...',
    title: 'Ash Cathedral',
    subtitle: 'Mini-Boss: Lich Vaelen',
    biome: 'crypt',
    introSpeaker: 'Vesper',
    introText: 'A fallen archmage raises legions beneath the shattered nave.',
    outroSpeaker: 'Vesper',
    outroText: 'The necromancer\'s phylactery is shattered.',
    rewardGold: 260,
    replayGold: 130,
    rewardEquipId: 'frostbite_staff',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'crypt_knight', col: 5, row: 2 }, { id: 'bog_shaman', col: 5, row: 1 }, { id: 'bone_archer', col: 5, row: 3 }]
  },
  {
    id: 'runeforge_peak',
    index: 20,
    region: 'frostspire',
    landmark: 'peak',
    kind: 'treasure',
    difficulty: 4,
    recommendedPower: 1050,
    mapX: 0.46,
    mapY: 0.14,
    requires: ['frozen_lake'],
    comingSoon: true,
    soonNote: 'Soon... Glacial Anvil Shrine & Cryomancer Trial',
    specialTag: 'Soon...',
    title: 'Runeforge Peak',
    subtitle: 'Frozen Artifact Spire',
    biome: 'frost',
    introSpeaker: 'Lyra',
    introText: 'Ancient dwarven runeforges still hum atop the glacier.',
    outroSpeaker: 'Lyra',
    outroText: 'The spire runes awaken.',
    rewardGold: 245,
    replayGold: 125,
    rewardEquipId: 'frostguard_plate',
    rewardHeroId: 'cryomancer',
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'frost_golem', col: 5, row: 2 }, { id: 'frost_golem', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'wyrm_eyrie',
    index: 21,
    region: 'frostspire',
    landmark: 'peak',
    kind: 'boss',
    difficulty: 5,
    recommendedPower: 1320,
    mapX: 0.69,
    mapY: 0.13,
    requires: ['glacial_citadel'],
    comingSoon: true,
    soonNote: 'Soon... Multi-Tile Boss Raid: Glacial Frostwyrm',
    specialTag: 'Soon...',
    title: 'Frostwyrm Eyrie',
    subtitle: 'Raid Boss: Rimefang',
    biome: 'frost',
    introSpeaker: 'Sir Aldric',
    introText: 'At the roof of the world sleeps an elder ice drake.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The skies over Frostspire clear.',
    rewardGold: 400,
    replayGold: 185,
    rewardEquipId: 'aegis_of_dawn',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'frost_golem', col: 5, row: 2 }, { id: 'frost_golem', col: 5, row: 1 }, { id: 'crypt_knight', col: 5, row: 3 }]
  },
  {
    id: 'cinder_colosseum',
    index: 22,
    region: 'emberwaste',
    landmark: 'arena',
    kind: 'elite',
    difficulty: 4,
    recommendedPower: 1160,
    mapX: 0.54,
    mapY: 0.68,
    requires: ['cursed_vault', 'obsidian_gate'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... 3-Round Gladiator Gauntlet with Escalating Modifiers',
    specialTag: 'Soon...',
    title: 'Cinder Arena',
    subtitle: 'Gladiator Trial Pit',
    biome: 'volcano',
    introSpeaker: 'Sir Aldric',
    introText: 'Prove your vanguard across three relentless arena rounds.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The arena roars your name.',
    rewardGold: 290,
    replayGold: 145,
    rewardEquipId: 'dragonfang_spear',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'orc_brute', col: 5, row: 2 }, { id: 'crypt_knight', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'molten_core',
    index: 23,
    region: 'emberwaste',
    landmark: 'foundry',
    kind: 'boss',
    difficulty: 5,
    recommendedPower: 1360,
    mapX: 0.72,
    mapY: 0.59,
    requires: ['ashfall_foundry'],
    comingSoon: true,
    soonNote: 'Soon... Erupting Magma Geysers & Obsidian Titan Boss',
    specialTag: 'Soon...',
    title: 'Brimstone Maw',
    subtitle: 'Raid Boss: Ignis Titan',
    biome: 'volcano',
    introSpeaker: 'Vesper',
    introText: 'The caldera cracks open around an ancient fire colossus.',
    outroSpeaker: 'Vesper',
    outroText: 'The caldera settles.',
    rewardGold: 420,
    replayGold: 195,
    rewardEquipId: 'heart_of_solis',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'frost_golem', col: 5, row: 2 }, { id: 'crypt_knight', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },

  // =========================================================================
  // ACT IV+ FUTURE FRONTIER REGIONS (TIERS VI–VIII — BEYOND TODAY'S ENDGAME)
  // =========================================================================
  {
    id: 'mirage_oasis',
    index: 24,
    region: 'sunbleached_dunes',
    landmark: 'town',
    kind: 'special',
    difficulty: 5,
    recommendedPower: 1420,
    mapX: 0.14,
    mapY: 0.86,
    requires: ['gloomwood_heart', 'emerald_delta'],
    unlockMode: 'any',
    seaRoute: true,
    comingSoon: true,
    soonNote: 'Soon... Act IV Desert Frontier · Shifting Sandstorms & Nomad Outpost',
    specialTag: 'Act IV Soon',
    title: 'Mirage Oasis',
    subtitle: 'Desert Strait Landing',
    biome: 'meadow',
    introSpeaker: 'Lyra',
    introText: 'Across the southern strait lie sun-baked ruins older than Solis.',
    outroSpeaker: 'Lyra',
    outroText: 'The desert caravan welcomes our banner.',
    rewardGold: 440,
    replayGold: 205,
    rewardEquipId: 'swift_boots',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'crypt_knight', col: 5, row: 2 }, { id: 'bone_archer', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'sunken_obelisk',
    index: 25,
    region: 'sunbleached_dunes',
    landmark: 'ruins',
    kind: 'treasure',
    difficulty: 6,
    recommendedPower: 1620,
    mapX: 0.25,
    mapY: 0.90,
    requires: ['mirage_oasis'],
    comingSoon: true,
    soonNote: 'Soon... Tier VI Mythic Vault · Quicksand Traps & Solar Constructs',
    specialTag: 'Tier VI Soon',
    title: 'Sunken Obelisk',
    subtitle: 'Mythic Desert Reliquary',
    biome: 'volcano',
    introSpeaker: 'Vesper',
    introText: 'An ancient sun-prism sleeps half-buried beneath golden dunes.',
    outroSpeaker: 'Vesper',
    outroText: 'The sun-prism awakens.',
    rewardGold: 520,
    replayGold: 230,
    rewardEquipId: 'heart_of_solis',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'frost_golem', col: 5, row: 2 }, { id: 'crypt_knight', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'dune_sovereign',
    index: 26,
    region: 'sunbleached_dunes',
    landmark: 'citadel',
    kind: 'boss',
    difficulty: 6,
    recommendedPower: 1780,
    mapX: 0.37,
    mapY: 0.91,
    requires: ['sunken_obelisk', 'bone_cathedral'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Act IV Mythic Boss: Sandstorm Pharaoh & Twin Sphinxes',
    specialTag: 'Tier VI Boss',
    title: 'Sunscar Pyramid',
    subtitle: 'Mythic Boss: Dune Sovereign',
    biome: 'volcano',
    introSpeaker: 'Sir Aldric',
    introText: 'A towering sandstone citadel guards the forgotten crown-vault.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The desert throne yields.',
    rewardGold: 620,
    replayGold: 260,
    rewardEquipId: 'solis_crownblade',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'eclipse_archon', col: 5, row: 2 }, { id: 'frost_golem', col: 5, row: 1 }, { id: 'crypt_knight', col: 5, row: 3 }]
  },
  {
    id: 'starfall_atoll',
    index: 27,
    region: 'aether_isles',
    landmark: 'atoll',
    kind: 'special',
    difficulty: 6,
    recommendedPower: 1680,
    mapX: 0.81,
    mapY: 0.28,
    requires: ['eclipse_throne', 'glacial_citadel'],
    unlockMode: 'any',
    seaRoute: true,
    comingSoon: true,
    soonNote: 'Soon... Act V Sea Expedition · Floating Starlight Reefs & Mythic Relics',
    specialTag: 'Tier VI Soon',
    title: 'Starfall Atoll',
    subtitle: 'Mythic Sea Expedition',
    biome: 'throne',
    introSpeaker: 'Vesper',
    introText: 'A fallen star shattered this outer island into floating crystal reefs.',
    outroSpeaker: 'Vesper',
    outroText: 'Starlight relics recovered.',
    rewardGold: 560,
    replayGold: 245,
    rewardEquipId: 'heart_of_solis',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'crypt_knight', col: 5, row: 2 }, { id: 'frost_golem', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'tempest_spire',
    index: 28,
    region: 'aether_isles',
    landmark: 'peak',
    kind: 'elite',
    difficulty: 7,
    recommendedPower: 1960,
    mapX: 0.88,
    mapY: 0.16,
    requires: ['starfall_atoll', 'wyrm_eyrie'],
    unlockMode: 'any',
    seaRoute: true,
    comingSoon: true,
    soonNote: 'Soon... Tier VII Cataclysm Spire · Lightning Conduit Tiles & Storm Knights',
    specialTag: 'Tier VII Soon',
    title: 'Tempest Spire',
    subtitle: 'Cataclysm Storm Tower',
    biome: 'frost',
    introSpeaker: 'Lyra',
    introText: 'Eternal thunder arcs between floating basalt obelisks.',
    outroSpeaker: 'Lyra',
    outroText: 'The storm spire falls quiet.',
    rewardGold: 680,
    replayGold: 290,
    rewardEquipId: 'aegis_of_dawn',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'frost_golem', col: 5, row: 2 }, { id: 'eclipse_archon', col: 5, row: 1 }, { id: 'bog_shaman', col: 5, row: 3 }]
  },
  {
    id: 'skybreak_bastion',
    index: 29,
    region: 'aether_isles',
    landmark: 'citadel',
    kind: 'boss',
    difficulty: 7,
    recommendedPower: 2150,
    mapX: 0.93,
    mapY: 0.32,
    requires: ['starfall_atoll', 'tempest_spire'],
    unlockMode: 'any',
    comingSoon: true,
    soonNote: 'Soon... Act V Cataclysm Boss: Astral Warden atop Shattered Sky-Bridges',
    specialTag: 'Tier VII Boss',
    title: 'Skybreak Bastion',
    subtitle: 'Cataclysm Boss: Astral Warden',
    biome: 'throne',
    introSpeaker: 'Sir Aldric',
    introText: 'Beyond Solis, the Astral Warden commands legions of star-forged knights.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The sky-bridges hold.',
    rewardGold: 780,
    replayGold: 320,
    rewardEquipId: 'solis_crownblade',
    rewardHeroId: 'champion',
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'eclipse_archon', col: 5, row: 2 }, { id: 'frost_golem', col: 5, row: 1 }, { id: 'crypt_knight', col: 5, row: 3 }]
  },
  {
    id: 'abyssal_deep',
    index: 30,
    region: 'shattered_expanse',
    landmark: 'abyss',
    kind: 'boss',
    difficulty: 6,
    recommendedPower: 1850,
    mapX: 0.65,
    mapY: 0.86,
    requires: ['bone_cathedral', 'cinder_colosseum'],
    unlockMode: 'any',
    seaRoute: true,
    comingSoon: true,
    soonNote: 'Soon... Secret 10-Floor Pitch-Black Abyssal Dungeon',
    specialTag: 'Tier VI Abyss',
    title: 'Crownless Deep',
    subtitle: 'Secret 10-Floor Abyss',
    biome: 'throne',
    introSpeaker: 'Archon Malakor',
    introText: 'Descend into the sunken sea-trench where forgotten crowns sleep.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'Light reaches the deepest trench.',
    rewardGold: 640,
    replayGold: 270,
    rewardEquipId: 'solis_crownblade',
    rewardHeroId: 'champion',
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'eclipse_archon', col: 5, row: 2 }, { id: 'crypt_knight', col: 5, row: 1 }, { id: 'crypt_knight', col: 5, row: 3 }]
  },
  {
    id: 'obsidian_rift',
    index: 31,
    region: 'shattered_expanse',
    landmark: 'gate',
    kind: 'elite',
    difficulty: 7,
    recommendedPower: 2240,
    mapX: 0.81,
    mapY: 0.74,
    requires: ['eclipse_throne', 'molten_core'],
    unlockMode: 'any',
    seaRoute: true,
    comingSoon: true,
    soonNote: 'Soon... Tier VII Outer Void Rift · Dual-Boss Vanguard Gauntlet',
    specialTag: 'Tier VII Soon',
    title: 'Obsidian Rift',
    subtitle: 'Outer Void Crossing',
    biome: 'throne',
    introSpeaker: 'Vesper',
    introText: 'Where the ocean ends, shattered islands float over an endless eclipse.',
    outroSpeaker: 'Vesper',
    outroText: 'The outer rift stabilizes.',
    rewardGold: 820,
    replayGold: 340,
    rewardEquipId: 'heart_of_solis',
    rewardHeroId: null,
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'eclipse_archon', col: 5, row: 2 }, { id: 'crypt_knight', col: 5, row: 1 }, { id: 'frost_golem', col: 5, row: 3 }]
  },
  {
    id: 'first_sun_sanctum',
    index: 32,
    region: 'shattered_expanse',
    landmark: 'throne',
    kind: 'boss',
    difficulty: 8,
    recommendedPower: 2600,
    mapX: 0.91,
    mapY: 0.86,
    requires: ['obsidian_rift', 'abyssal_deep', 'skybreak_bastion'],
    unlockMode: 'any',
    seaRoute: true,
    comingSoon: true,
    soonNote: 'Soon... Tier VIII Apex Endgame Raid · Beyond Act VI (Multi-Phase Sovereign)',
    specialTag: 'Tier VIII Apex',
    title: 'First Sun Sanctum',
    subtitle: 'Apex Raid: Unbroken Crown',
    biome: 'throne',
    introSpeaker: 'Sir Aldric',
    introText: 'At the edge of all charts waits the primordial citadel of the First Sun.',
    outroSpeaker: 'Sir Aldric',
    outroText: 'A new age dawns beyond the horizon.',
    rewardGold: 1200,
    replayGold: 450,
    rewardEquipId: 'solis_crownblade',
    rewardHeroId: 'champion',
    grid: SOON_GRID,
    heroSpawns: [[0, 1], [0, 2], [0, 3], [1, 2]],
    enemies: [{ id: 'eclipse_archon', col: 5, row: 2 }, { id: 'eclipse_archon', col: 5, row: 1 }, { id: 'frost_golem', col: 5, row: 3 }]
  }
]

export const PLAYABLE_CHAPTERS: readonly ChapterSpec[] = CHAPTERS.filter(ch => !ch.comingSoon)

export const CHAPTER_BY_ID: Readonly<Record<string, ChapterSpec>> = Object.fromEntries(
  CHAPTERS.map(ch => [ch.id, ch])
)
