import type {
  ChapterSpec, DifficultyLevel, EnemyArchetypeId, EnemySpec, EquipmentSpec, HeroClassId, HeroSpec,
  PackId, PackSpec, Rarity, TacticCardSpec, TileTerrain
} from './types.ts'

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
  5: { label: 'Brutal Boss', short: 'V', hex: '#ff5266', bgHex: '#421622' }
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
    range: 1,
    crit: 0.10,
    lore: 'Sworn shieldbearer of the Solis Vanguard who holds the line against the Eclipse.',
    skills: [
      {
        id: 'shield_bash', name: 'Shield Bash', tier: 1,
        desc: 'Strike adjacent foe (125% ATK) & gain +12 Shield.',
        range: 1, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.25, flatBonus: 4, healAmount: 0, shieldAmount: 12, ignoreArmor: 0.2,
        vfx: 'slash'
      },
      {
        id: 'bulwark_aura', name: 'Bulwark Aura', tier: 2,
        desc: 'Grant +20 Shield to self & adjacent allies.',
        range: 0, cooldown: 3, target: 'self', pattern: 'aura',
        powerMul: 0, flatBonus: 0, healAmount: 6, shieldAmount: 20, ignoreArmor: 0,
        vfx: 'holy'
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
    range: 3,
    crit: 0.22,
    lore: 'Highland scout whose fletched arrows strike true from every ridge and tower.',
    skills: [
      {
        id: 'piercing_arrow', name: 'Piercing Shot', tier: 1,
        desc: 'Long shot (135% ATK) ignoring 60% enemy armor.',
        range: 4, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.35, flatBonus: 4, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.6,
        vfx: 'arrow'
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
    range: 3,
    crit: 0.16,
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
    range: 3,
    crit: 0.12,
    lore: 'Sun-order healer who mends shattered bones and burns shadow creatures.',
    skills: [
      {
        id: 'sun_mend', name: 'Sunbeam Mend', tier: 1,
        desc: 'Heal an ally for 28 HP & grant +8 Shield.',
        range: 3, cooldown: 2, target: 'ally', pattern: 'single',
        powerMul: 0, flatBonus: 0, healAmount: 28, shieldAmount: 8, ignoreArmor: 0,
        vfx: 'holy'
      },
      {
        id: 'sanctuary_wave', name: 'Sanctuary Wave', tier: 2,
        desc: 'Heal self & adjacent allies for 24 HP + 14 Shield.',
        range: 0, cooldown: 3, target: 'self', pattern: 'aura',
        powerMul: 0, flatBonus: 0, healAmount: 24, shieldAmount: 14, ignoreArmor: 0,
        vfx: 'holy'
      },
      {
        id: 'dawns_judgment', name: 'Dawn Judgment', tier: 3,
        desc: 'Smite 3x3 enemies (155% ATK) & heal nearby allies.',
        range: 3, cooldown: 3, target: 'tile', pattern: 'area3',
        powerMul: 1.55, flatBonus: 8, healAmount: 22, shieldAmount: 10, ignoreArmor: 0.7,
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
    range: 1,
    crit: 0.32,
    lore: 'Swift twilight duelist who vaults across battle lines to sever enemy casters.',
    skills: [
      {
        id: 'shadowstep', name: 'Shadow Strike', tier: 1,
        desc: 'Leap up to 3 tiles to ambush foe (145% ATK).',
        range: 3, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.45, flatBonus: 5, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.4,
        vfx: 'shadow'
      },
      {
        id: 'fan_blades', name: 'Fan of Blades', tier: 2,
        desc: 'Slash all enemies in a cross around you (135% ATK).',
        range: 1, cooldown: 2, target: 'enemy', pattern: 'cross',
        powerMul: 1.35, flatBonus: 4, healAmount: 0, shieldAmount: 10, ignoreArmor: 0.35,
        vfx: 'shadow'
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
    range: 1,
    crit: 0.15,
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
        desc: 'Fortify self & nearby allies with +30 Shield & Empower.',
        range: 0, cooldown: 3, target: 'self', pattern: 'aura',
        powerMul: 0, flatBonus: 0, healAmount: 14, shieldAmount: 30, ignoreArmor: 0,
        status: 'empower', vfx: 'holy'
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
    range: 3,
    crit: 0.18,
    lore: 'Glacial arcanist from Frostspire who locks entire enemy flanks in crystal ice.',
    skills: [
      {
        id: 'frost_lance', name: 'Frost Lance', tier: 1,
        desc: 'Pierce enemy (140% ATK, ignores 70% DEF) & Slow.',
        range: 4, cooldown: 2, target: 'enemy', pattern: 'single',
        powerMul: 1.4, flatBonus: 6, healAmount: 0, shieldAmount: 0, ignoreArmor: 0.7,
        status: 'slow', vfx: 'frost'
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
    range: 2,
    crit: 0.26,
    lore: 'Mythic heir of the First Crown, wielding twin blades of living starlight.',
    skills: [
      {
        id: 'solar_slash', name: 'Solar Arc', tier: 1,
        desc: 'Sweeping fire arc (155% ATK, ignores 50% DEF, Burn).',
        range: 2, cooldown: 2, target: 'enemy', pattern: 'cross',
        powerMul: 1.55, flatBonus: 8, healAmount: 0, shieldAmount: 14, ignoreArmor: 0.5,
        status: 'burn', vfx: 'fire'
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
    desc: '+15 ATK, +1 Range, +15% Lifesteal.',
    atk: 15, def: 2, hp: 10, speed: 1, move: 0, range: 1, crit: 0.12, lifesteal: 0.15, shieldStart: 0, accentHex: '#d66bff'
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
    desc: '+62 HP, +11 DEF, +2 SPD, +32 Shield.',
    atk: 4, def: 11, hp: 62, speed: 2, move: 0, range: 0, crit: 0, lifesteal: 0, shieldStart: 32, accentHex: '#ffd15c'
  },

  // Relics
  {
    id: 'copper_signet', name: 'Copper Signet', slot: 'relic', rarity: 'common',
    desc: '+3 ATK, +8 HP, +1 SPD.',
    atk: 3, def: 1, hp: 8, speed: 1, move: 0, range: 0, crit: 0.05, lifesteal: 0, shieldStart: 0, accentHex: '#c9885b'
  },
  {
    id: 'swift_boots', name: 'Gale Striders', slot: 'relic', rarity: 'uncommon',
    desc: '+3 SPD, +1 Move, +10 HP.',
    atk: 2, def: 1, hp: 10, speed: 3, move: 1, range: 0, crit: 0.08, lifesteal: 0, shieldStart: 0, accentHex: '#5cd99e'
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
    desc: 'Restore 26 HP to target hero.',
    damage: 0, heal: 26, shield: 0, apGain: 0, vfx: 'holy'
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
    desc: 'Refresh ally Movement & grant +8 Shield.',
    damage: 0, heal: 0, shield: 8, apGain: 0, refreshMove: true, vfx: 'arcane'
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
    desc: 'Heal ALL heroes 30 HP, +22 Shield & Empower!',
    damage: 0, heal: 30, shield: 22, apGain: 0, status: 'empower', vfx: 'holy'
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
    id: 'goblin', name: 'Ashen Goblin', maxHp: 38, atk: 12, def: 2, speed: 12, move: 3, range: 1, ai: 'melee'
  },
  bone_archer: {
    id: 'bone_archer', name: 'Bone Archer', maxHp: 34, atk: 14, def: 1, speed: 11, move: 2, range: 3, ai: 'ranged'
  },
  orc_brute: {
    id: 'orc_brute', name: 'Ironclad Orc', maxHp: 64, atk: 17, def: 5, speed: 7, move: 2, range: 1, ai: 'melee'
  },
  bog_shaman: {
    id: 'bog_shaman', name: 'Eclipse Shaman', maxHp: 46, atk: 14, def: 2, speed: 10, move: 2, range: 3, ai: 'support'
  },
  crypt_knight: {
    id: 'crypt_knight', name: 'Dread Knight', maxHp: 78, atk: 20, def: 7, speed: 9, move: 3, range: 1, ai: 'melee'
  },
  frost_golem: {
    id: 'frost_golem', name: 'Frost Golem', maxHp: 96, atk: 22, def: 8, speed: 6, move: 2, range: 1, ai: 'melee'
  },
  eclipse_archon: {
    id: 'eclipse_archon', name: 'Archon Malakor', maxHp: 190, atk: 26, def: 7, speed: 11, move: 3, range: 3, ai: 'boss', isBoss: true
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

export const CHAPTERS: readonly ChapterSpec[] = [
  {
    id: 'border_watch',
    index: 0,
    kind: 'story',
    difficulty: 1,
    recommendedPower: 420,
    mapX: 0.08,
    mapY: 0.50,
    requires: [],
    title: 'Border Watch',
    subtitle: 'Sunlit Meadow Outpost',
    biome: 'meadow',
    introSpeaker: 'Sir Aldric',
    introText: 'The Eclipse raiders seized the Watchtower road! Hold the high hill, let Lyra loose from cover, and reclaim our first Crownshard.',
    outroSpeaker: 'Lyra',
    outroText: 'The road is clear! Visit the World Map to chart our next march, or gear up in Vanguard Camp.',
    rewardGold: 85,
    replayGold: 45,
    rewardEquipId: 'iron_plate',
    rewardHeroId: 'knight',
    grid: [
      [G, G, H, H, G, G, G],
      [G, S, G, G, P, G, G],
      [G, S, R, G, G, H, G],
      [G, H, G, P, G, S, G],
      [G, G, G, W, W, G, G]
    ],
    heroSpawns: [[0, 1], [1, 2], [0, 3], [1, 1]],
    enemies: [
      { id: 'goblin', col: 4, row: 2 },
      { id: 'goblin', col: 5, row: 3 },
      { id: 'bone_archer', col: 6, row: 1 }
    ]
  },
  {
    id: 'sunken_bridge',
    index: 1,
    kind: 'story',
    difficulty: 2,
    recommendedPower: 520,
    mapX: 0.24,
    mapY: 0.50,
    requires: ['border_watch'],
    unlocksSlot4: true,
    title: 'Sunken Bridge',
    subtitle: 'Misty River Crossing',
    biome: 'river',
    introSpeaker: 'Vesper',
    introText: 'Ironclad Orcs hold the old stone arches while their Shaman channels from the far bank. Control the bridges or blast across the water!',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The crossing is ours! Reinforcements joined our banner — you can now deploy 4 Heroes, and two routes open ahead.',
    rewardGold: 110,
    replayGold: 60,
    rewardEquipId: 'ember_wand',
    rewardHeroId: 'archer',
    grid: [
      [G, G, W, W, G, H, G, G],
      [G, H, B, B, S, G, G, G],
      [G, G, W, W, G, P, G, G],
      [G, R, W, W, G, G, G, G],
      [G, G, B, B, S, G, H, G],
      [G, G, W, W, G, G, G, G]
    ],
    heroSpawns: [[0, 1], [1, 2], [0, 4], [1, 3]],
    enemies: [
      { id: 'orc_brute', col: 4, row: 1 },
      { id: 'goblin', col: 4, row: 4 },
      { id: 'bone_archer', col: 6, row: 0 },
      { id: 'bog_shaman', col: 7, row: 3 }
    ]
  },
  {
    id: 'sunwell_glade',
    index: 2,
    kind: 'special',
    difficulty: 2,
    recommendedPower: 620,
    mapX: 0.42,
    mapY: 0.24,
    requires: ['sunken_bridge'],
    specialTag: 'Shrine Trial',
    modifierDesc: '7x7 Sacred Grove · 3 Sun Shrines · Flanking Archers',
    title: 'Sunwell Glade',
    subtitle: 'Special: Sacred Shrine Trial',
    biome: 'meadow',
    introSpeaker: 'Lyra',
    introText: 'Raiders are desecrating the Sunwell shrines! Hold the healing altars on this square ridge and Sera of the Sun Order will pledge to our banner.',
    outroSpeaker: 'Lyra',
    outroText: 'The shrines glow again and Sera rides with us! The high trail now leads straight to Frostspire Pass.',
    rewardGold: 120,
    replayGold: 68,
    rewardEquipId: 'swift_boots',
    rewardHeroId: 'cleric',
    grid: [
      [G, H, G, R, G, H, G],
      [G, G, P, G, P, G, G],
      [G, S, G, H, G, S, G],
      [G, R, G, G, G, R, G],
      [G, S, G, H, G, S, G],
      [G, G, P, G, P, G, G],
      [G, H, G, W, G, H, G]
    ],
    heroSpawns: [[0, 2], [1, 3], [0, 4], [1, 2]],
    enemies: [
      { id: 'goblin', col: 5, row: 2 },
      { id: 'goblin', col: 5, row: 4 },
      { id: 'bone_archer', col: 5, row: 0 },
      { id: 'bone_archer', col: 5, row: 6 },
      { id: 'bog_shaman', col: 6, row: 3 }
    ]
  },
  {
    id: 'lantern_crypt',
    index: 3,
    kind: 'story',
    difficulty: 2,
    recommendedPower: 660,
    mapX: 0.42,
    mapY: 0.76,
    requires: ['sunken_bridge'],
    title: 'Lantern Crypt',
    subtitle: 'Torchlit Catacomb Vault',
    biome: 'crypt',
    introSpeaker: 'Vesper',
    introText: 'Ancient Dread Knights awaken in the blue lantern mist. Use the stone pillars to break archer sightlines and focus down their Shaman.',
    outroSpeaker: 'Vesper',
    outroText: 'The catacombs are silent! Beyond these halls lie both the northern mountain pass and a sealed Cursed Vault.',
    rewardGold: 130,
    replayGold: 72,
    rewardEquipId: 'ranger_cloak',
    rewardHeroId: 'mage',
    grid: [
      [D, S, S, D, D, S, S, D],
      [S, S, P, S, S, P, S, S],
      [S, H, S, R, S, S, H, S],
      [S, S, S, S, S, S, S, S],
      [S, S, P, S, S, P, S, S],
      [D, S, S, D, D, S, S, D]
    ],
    heroSpawns: [[1, 1], [1, 2], [1, 3], [1, 4]],
    enemies: [
      { id: 'crypt_knight', col: 5, row: 2 },
      { id: 'orc_brute', col: 5, row: 3 },
      { id: 'bone_archer', col: 7, row: 1 },
      { id: 'bog_shaman', col: 7, row: 4 }
    ]
  },
  {
    id: 'frostspire_pass',
    index: 4,
    kind: 'story',
    difficulty: 3,
    recommendedPower: 790,
    mapX: 0.60,
    mapY: 0.28,
    requires: ['sunwell_glade', 'lantern_crypt'],
    unlockMode: 'any',
    title: 'Frostspire Pass',
    subtitle: 'Glacial Alpine Ridge',
    biome: 'frost',
    introSpeaker: 'Lyra',
    introText: 'Massive Frost Golems guard the broad mountain stairs. Armor-piercing skills and magic cut right through their icy hide!',
    outroSpeaker: 'Sir Aldric',
    outroText: 'The ridge is ours! From here we can assault the Obsidian Gate, or detour to the Glacial Citadel for an elite relic.',
    rewardGold: 165,
    replayGold: 90,
    rewardEquipId: 'runed_mail',
    rewardHeroId: 'rogue',
    grid: [
      [N, N, H, H, N, N, H, N, N],
      [N, S, N, P, N, H, N, S, N],
      [N, S, R, N, N, N, S, N, N],
      [W, W, N, N, P, N, S, N, N],
      [N, N, H, N, N, H, N, S, N],
      [N, N, N, N, W, W, N, N, N]
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
    id: 'cursed_vault',
    index: 5,
    kind: 'treasure',
    difficulty: 3,
    recommendedPower: 830,
    mapX: 0.60,
    mapY: 0.76,
    requires: ['lantern_crypt'],
    specialTag: 'Treasure Vault',
    modifierDesc: '6x6 Close-Quarters Ambush · War-Chest Bounty',
    title: 'Cursed Vault',
    subtitle: 'Special: Sealed Reliquary',
    biome: 'crypt',
    introSpeaker: 'Vesper',
    introText: 'A cramped obsidian reliquary overflowing with stolen Solis gold! Two Dread Knights guard the tight floor — strike fast before they box us in.',
    outroSpeaker: 'Vesper',
    outroText: 'The war-chest is cracked open and Sunsteel steel gleams inside! A tunnel here also climbs straight to the Obsidian Gate.',
    rewardGold: 220,
    replayGold: 95,
    rewardEquipId: 'sunsteel_blade',
    rewardHeroId: null,
    grid: [
      [D, S, D, D, S, D],
      [S, P, S, S, P, S],
      [S, S, R, H, S, S],
      [S, S, H, S, S, S],
      [S, P, S, S, P, S],
      [D, S, D, D, S, D]
    ],
    heroSpawns: [[0, 2], [0, 3], [1, 2], [1, 3]],
    enemies: [
      { id: 'crypt_knight', col: 4, row: 2, levelScale: 1.08 },
      { id: 'crypt_knight', col: 4, row: 3, levelScale: 1.08 },
      { id: 'bone_archer', col: 5, row: 1, levelScale: 1.1 },
      { id: 'bone_archer', col: 5, row: 4, levelScale: 1.1 }
    ]
  },
  {
    id: 'obsidian_gate',
    index: 6,
    kind: 'story',
    difficulty: 4,
    recommendedPower: 960,
    mapX: 0.77,
    mapY: 0.66,
    requires: ['frostspire_pass', 'cursed_vault'],
    unlockMode: 'any',
    title: 'Obsidian Gate',
    subtitle: 'Volcanic Ember Bastion',
    biome: 'volcano',
    introSpeaker: 'Sir Aldric',
    introText: 'Molten rifts split the wide basalt causeway. Cross the ember bridges together and shatter Malakor\'s royal guard!',
    outroSpeaker: 'Vesper',
    outroText: 'The outer bastion falls and Dame Isolde joins our vanguard! Only the Eclipse Throne stands beyond these doors.',
    rewardGold: 210,
    replayGold: 115,
    rewardEquipId: 'blood_amulet',
    rewardHeroId: 'paladin',
    grid: [
      [D, D, L, L, D, H, D, D, D],
      [D, S, B, B, S, D, D, H, D],
      [D, R, L, P, D, D, H, D, D],
      [D, S, B, B, S, D, D, D, D],
      [D, D, L, L, D, P, D, H, D],
      [D, H, D, D, D, D, D, D, D]
    ],
    heroSpawns: [[0, 1], [1, 1], [0, 3], [1, 3]],
    enemies: [
      { id: 'crypt_knight', col: 4, row: 1, levelScale: 1.15 },
      { id: 'frost_golem', col: 4, row: 3, levelScale: 1.15 },
      { id: 'orc_brute', col: 6, row: 2, levelScale: 1.2 },
      { id: 'bog_shaman', col: 8, row: 1, levelScale: 1.2 },
      { id: 'bone_archer', col: 8, row: 4, levelScale: 1.2 }
    ]
  },
  {
    id: 'glacial_citadel',
    index: 7,
    kind: 'elite',
    difficulty: 4,
    recommendedPower: 1080,
    mapX: 0.77,
    mapY: 0.22,
    requires: ['frostspire_pass'],
    specialTag: 'Elite Siege',
    modifierDesc: '10x6 Twin-Bridge Siege · Epic Halberd Bounty',
    title: 'Glacial Citadel',
    subtitle: 'Special: Elite Ice Stronghold',
    biome: 'frost',
    introSpeaker: 'Sir Aldric',
    introText: 'An optional elite stronghold perched over twin ice chasms. Breaking this garrison will claim the rare Dragonfang Halberd!',
    outroSpeaker: 'Lyra',
    outroText: 'The Glacial Citadel yields its Dragonfang Halberd! Our champions are truly forged for the Throne.',
    rewardGold: 240,
    replayGold: 130,
    rewardEquipId: 'dragonfang_spear',
    rewardHeroId: null,
    grid: [
      [N, H, N, W, W, N, N, H, N, N],
      [N, S, S, B, B, S, P, N, S, N],
      [N, R, N, W, W, N, N, H, N, N],
      [N, N, N, W, W, N, H, N, S, N],
      [N, S, S, B, B, S, P, N, S, N],
      [N, H, N, W, W, N, N, H, N, N]
    ],
    heroSpawns: [[0, 1], [1, 1], [0, 4], [1, 4]],
    enemies: [
      { id: 'frost_golem', col: 5, row: 1, levelScale: 1.2 },
      { id: 'frost_golem', col: 5, row: 4, levelScale: 1.2 },
      { id: 'crypt_knight', col: 7, row: 2, levelScale: 1.2 },
      { id: 'bone_archer', col: 9, row: 1, levelScale: 1.25 },
      { id: 'bog_shaman', col: 9, row: 4, levelScale: 1.25 }
    ]
  },
  {
    id: 'eclipse_throne',
    index: 8,
    kind: 'boss',
    difficulty: 5,
    recommendedPower: 1240,
    mapX: 0.93,
    mapY: 0.50,
    requires: ['obsidian_gate'],
    specialTag: 'Final Boss',
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
      [D, D, S, H, H, H, S, D, D, D],
      [D, S, P, S, S, S, P, S, D, D],
      [D, R, S, S, H, S, S, H, S, D],
      [D, S, S, S, S, S, S, H, S, D],
      [D, S, S, S, H, S, S, H, S, D],
      [D, S, P, S, S, S, P, S, D, D],
      [D, D, S, L, L, L, S, D, D, D]
    ],
    heroSpawns: [[0, 2], [1, 2], [0, 4], [1, 4]],
    enemies: [
      { id: 'eclipse_archon', col: 7, row: 3 },
      { id: 'crypt_knight', col: 6, row: 2 },
      { id: 'crypt_knight', col: 6, row: 4 },
      { id: 'bog_shaman', col: 8, row: 2, levelScale: 1.2 },
      { id: 'bone_archer', col: 8, row: 4, levelScale: 1.2 }
    ]
  }
]

export const CHAPTER_BY_ID: Readonly<Record<string, ChapterSpec>> = Object.fromEntries(
  CHAPTERS.map(ch => [ch.id, ch])
)
