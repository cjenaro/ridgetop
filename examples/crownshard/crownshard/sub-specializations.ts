import { HERO_SPECS } from './data.ts'
import type {
  GameState,
  HeroClassId,
  HeroSubSpecId,
  OwnedHeroCard,
  SkillSpec
} from './types.ts'

export interface HeroSubSpecStatBonus {
  readonly hp?: number
  readonly atk?: number
  readonly def?: number
  readonly speed?: number
  readonly move?: number
  readonly range?: number
  readonly crit?: number
  readonly lifesteal?: number
}

export interface HeroSubSpec {
  readonly id: HeroSubSpecId
  readonly heroId: HeroClassId
  readonly title: string
  readonly roleTag: string
  readonly summary: string
  readonly statSummary: string
  readonly accentHex: string
  readonly bonuses: HeroSubSpecStatBonus
  readonly ultimate: SkillSpec
}

export const HERO_SUB_SPECS: Record<HeroClassId, readonly [HeroSubSpec, HeroSubSpec]> = {
  knight: [
    {
      id: 'knight_templar',
      heroId: 'knight',
      title: 'Templar',
      roleTag: 'Holy Vanguard',
      summary: 'Cross cleave, +22 Shield & heals self + adjacent allies 16 HP.',
      statSummary: '+12 HP · +2 DEF',
      accentHex: '#ffdf6e',
      bonuses: { hp: 12, def: 2 },
      ultimate: {
        id: 'aegis_judgment',
        name: 'Aegis Judgment',
        tier: 3,
        desc: 'Holy cross cleave (150% ATK), +22 Shield & heals self & adjacent allies 16 HP.',
        range: 1,
        cooldown: 3,
        target: 'enemy',
        pattern: 'cross',
        powerMul: 1.5,
        flatBonus: 8,
        healAmount: 16,
        shieldAmount: 22,
        allyAuraHeal: 16,
        ignoreArmor: 0.4,
        vfx: 'holy'
      }
    },
    {
      id: 'knight_juggernaut',
      heroId: 'knight',
      title: 'Juggernaut',
      roleTag: 'Line Breaker',
      summary: '165% ATK cross shatter + Stun + Push 1 tile.',
      statSummary: '+4 ATK · +16 HP',
      accentHex: '#ff9654',
      bonuses: { atk: 4, hp: 16 },
      ultimate: {
        id: 'solar_cleave',
        name: 'Crown Cleave',
        tier: 3,
        desc: 'Shatter nearby foes (165% ATK), Stun 1 turn & Push 1 tile.',
        range: 1,
        cooldown: 3,
        target: 'enemy',
        pattern: 'cross',
        powerMul: 1.65,
        flatBonus: 8,
        healAmount: 0,
        shieldAmount: 14,
        ignoreArmor: 0.35,
        status: 'stun',
        displacement: { kind: 'knockback', distance: 1 },
        vfx: 'holy'
      }
    }
  ],
  archer: [
    {
      id: 'archer_sharpshooter',
      heroId: 'archer',
      title: 'Sharpshooter',
      roleTag: 'Executioner',
      summary: 'Range 6 lethal snipe (210% ATK, ignores 100% DEF).',
      statSummary: '+3 ATK · +10% Crit · +1 RNG',
      accentHex: '#66e09e',
      bonuses: { atk: 3, crit: 0.10, range: 1 },
      ultimate: {
        id: 'hawks_snipe',
        name: 'Hawk Snipe',
        tier: 3,
        desc: 'Cross-field lethal shot (210% ATK, ignores all armor).',
        range: 6,
        cooldown: 3,
        target: 'enemy',
        pattern: 'single',
        powerMul: 2.1,
        flatBonus: 10,
        healAmount: 0,
        shieldAmount: 0,
        ignoreArmor: 1.0,
        vfx: 'arrow'
      }
    },
    {
      id: 'archer_stormwarden',
      heroId: 'archer',
      title: 'Stormwarden',
      roleTag: 'Controller',
      summary: '3x3 range 5 storm (155% ATK) + Slow + Push 1 tile.',
      statSummary: '+2 ATK · +2 SPD',
      accentHex: '#63d2ff',
      bonuses: { atk: 2, speed: 2 },
      ultimate: {
        id: 'tempest_barrage',
        name: 'Tempest Barrage',
        tier: 3,
        desc: '3x3 range 5 storm of arrows (155% ATK), Slow & Push 1 tile.',
        range: 5,
        cooldown: 3,
        target: 'tile',
        pattern: 'area3',
        powerMul: 1.55,
        flatBonus: 6,
        healAmount: 0,
        shieldAmount: 0,
        ignoreArmor: 0.45,
        status: 'slow',
        displacement: { kind: 'knockback', distance: 1 },
        vfx: 'arrow'
      }
    }
  ],
  mage: [
    {
      id: 'mage_pyromancer',
      heroId: 'mage',
      title: 'Pyromancer',
      roleTag: 'AoE Burner',
      summary: '3x3 meteor tempest (175% ATK, 80% pierce) + Burn.',
      statSummary: '+4 ATK · +6% Crit',
      accentHex: '#ff7d47',
      bonuses: { atk: 4, crit: 0.06 },
      ultimate: {
        id: 'starfall',
        name: 'Starfall Storm',
        tier: 3,
        desc: '3x3 meteor tempest (175% ATK, ignores 80% DEF, Burn).',
        range: 4,
        cooldown: 3,
        target: 'tile',
        pattern: 'area3',
        powerMul: 1.75,
        flatBonus: 8,
        healAmount: 0,
        shieldAmount: 0,
        ignoreArmor: 0.8,
        status: 'burn',
        vfx: 'fire'
      }
    },
    {
      id: 'mage_archmage',
      heroId: 'mage',
      title: 'Archmage',
      roleTag: 'Arcane Tactician',
      summary: 'Cross range 4 (185% ATK, 100% pierce) + Pull 1 + Empower.',
      statSummary: '+2 ATK · +3 SPD · +10 HP',
      accentHex: '#b983ff',
      bonuses: { atk: 2, speed: 3, hp: 10 },
      ultimate: {
        id: 'astral_singularity',
        name: 'Astral Singularity',
        tier: 3,
        desc: 'Arcane cross (185% ATK, ignores 100% DEF), Pull 1 tile & Empower self.',
        range: 4,
        cooldown: 3,
        target: 'tile',
        pattern: 'cross',
        powerMul: 1.85,
        flatBonus: 8,
        healAmount: 0,
        shieldAmount: 0,
        ignoreArmor: 1.0,
        selfStatus: 'empower',
        displacement: { kind: 'pull', distance: 1 },
        vfx: 'arcane'
      }
    }
  ],
  cleric: [
    {
      id: 'cleric_oracle',
      heroId: 'cleric',
      title: 'Radiant Oracle',
      roleTag: 'Master Healer',
      summary: '3x3 smite (155% ATK) + ally heal/revive & shield.',
      statSummary: '+16 HP · +2 DEF',
      accentHex: '#ffe17a',
      bonuses: { hp: 16, def: 2 },
      ultimate: {
        id: 'dawns_judgment',
        name: 'Dawn Judgment',
        tier: 3,
        desc: 'Smite 3x3 enemies (155% ATK) & heal or revive nearby allies.',
        range: 3,
        cooldown: 3,
        target: 'tile',
        pattern: 'area3',
        powerMul: 1.55,
        flatBonus: 8,
        healAmount: 22,
        shieldAmount: 10,
        ignoreArmor: 0.7,
        canRevive: true,
        reviveHpRatio: 0.55,
        vfx: 'holy'
      }
    },
    {
      id: 'cleric_inquisitor',
      heroId: 'cleric',
      title: 'Solar Inquisitor',
      roleTag: 'Smite Battlemage',
      summary: 'Range 4 cross (185% ATK, 85% pierce) + Burn + 14 Shield.',
      statSummary: '+5 ATK · +10% Crit',
      accentHex: '#ff9d47',
      bonuses: { atk: 5, crit: 0.10 },
      ultimate: {
        id: 'solar_lance',
        name: 'Solar Lance',
        tier: 3,
        desc: 'Range 4 radiant cross (185% ATK, ignores 85% DEF), Burn & +14 Shield.',
        range: 4,
        cooldown: 3,
        target: 'tile',
        pattern: 'cross',
        powerMul: 1.85,
        flatBonus: 10,
        healAmount: 0,
        shieldAmount: 14,
        ignoreArmor: 0.85,
        status: 'burn',
        vfx: 'holy'
      }
    }
  ],
  rogue: [
    {
      id: 'rogue_nightblade',
      heroId: 'rogue',
      title: 'Nightblade',
      roleTag: 'Crit Finisher',
      summary: '225% ATK lethal execution + Empower + 14 self-heal.',
      statSummary: '+4 ATK · +12% Crit',
      accentHex: '#d07bff',
      bonuses: { atk: 4, crit: 0.12 },
      ultimate: {
        id: 'phantom_exec',
        name: 'Phantom Finisher',
        tier: 3,
        desc: 'Devastating 225% ATK strike, +14 self-heal & gain Empower.',
        range: 3,
        cooldown: 3,
        target: 'enemy',
        pattern: 'single',
        powerMul: 2.25,
        flatBonus: 12,
        healAmount: 14,
        shieldAmount: 0,
        ignoreArmor: 0.85,
        status: 'empower',
        vfx: 'shadow'
      }
    },
    {
      id: 'rogue_shadowdancer',
      heroId: 'rogue',
      title: 'Shadow Dancer',
      roleTag: 'Venom Duelist',
      summary: 'Range 3 cross (165% ATK) + Poison x3 + Swap + Haste.',
      statSummary: '+2 SPD · +1 MOV · +10 HP',
      accentHex: '#5ef2b6',
      bonuses: { speed: 2, move: 1, hp: 10 },
      ultimate: {
        id: 'venom_waltz',
        name: 'Venom Waltz',
        tier: 3,
        desc: 'Range 3 shadow cross (165% ATK), Poison x3, Swap positions & gain Haste.',
        range: 3,
        cooldown: 3,
        target: 'enemy',
        pattern: 'cross',
        powerMul: 1.65,
        flatBonus: 8,
        healAmount: 0,
        shieldAmount: 10,
        ignoreArmor: 0.55,
        status: 'poison',
        statusStacks: 3,
        selfStatus: 'haste',
        displacement: { kind: 'swap', distance: 1 },
        vfx: 'shadow'
      }
    }
  ],
  paladin: [
    {
      id: 'paladin_crusader',
      heroId: 'paladin',
      title: 'Dawn Crusader',
      roleTag: 'Wrathful Striker',
      summary: '3x3 radiant wrath (190% ATK) + Stun + self heal/shield.',
      statSummary: '+5 ATK · +8% Crit',
      accentHex: '#ffbe55',
      bonuses: { atk: 5, crit: 0.08 },
      ultimate: {
        id: 'solar_verdict',
        name: 'Solar Verdict',
        tier: 3,
        desc: 'Unleash 3x3 radiant wrath (190% ATK) & stun foes.',
        range: 2,
        cooldown: 3,
        target: 'tile',
        pattern: 'area3',
        powerMul: 1.9,
        flatBonus: 10,
        healAmount: 16,
        shieldAmount: 16,
        ignoreArmor: 0.65,
        status: 'stun',
        vfx: 'holy'
      }
    },
    {
      id: 'paladin_sentinel',
      heroId: 'paladin',
      title: 'Bastion Sentinel',
      roleTag: 'Unbreakable Tank',
      summary: 'Self aura +42 Shield, +22 Heal, Taunt & Empower allies.',
      statSummary: '+24 HP · +3 DEF',
      accentHex: '#7cc4ff',
      bonuses: { hp: 24, def: 3 },
      ultimate: {
        id: 'immortal_bastion',
        name: 'Immortal Bastion',
        tier: 3,
        desc: 'Fortify self & adjacent allies (+42 Shield, +22 Heal, Empower) & Taunt foes.',
        range: 0,
        cooldown: 3,
        target: 'self',
        pattern: 'aura',
        powerMul: 0,
        flatBonus: 0,
        healAmount: 22,
        shieldAmount: 42,
        ignoreArmor: 0,
        status: 'empower',
        selfStatus: 'taunt',
        vfx: 'holy'
      }
    }
  ],
  cryomancer: [
    {
      id: 'cryomancer_frostweaver',
      heroId: 'cryomancer',
      title: 'Frostweaver',
      roleTag: 'Deep-Freeze Nuker',
      summary: '3x3 deep freeze (195% ATK, 85% pierce) + Stun.',
      statSummary: '+4 ATK · +8% Crit',
      accentHex: '#7ae8ff',
      bonuses: { atk: 4, crit: 0.08 },
      ultimate: {
        id: 'absolute_zero',
        name: 'Absolute Zero',
        tier: 3,
        desc: '3x3 deep freeze (195% ATK, Stuns all enemies!).',
        range: 4,
        cooldown: 3,
        target: 'tile',
        pattern: 'area3',
        powerMul: 1.95,
        flatBonus: 10,
        healAmount: 0,
        shieldAmount: 12,
        ignoreArmor: 0.85,
        status: 'stun',
        vfx: 'frost'
      }
    },
    {
      id: 'cryomancer_glacier_lord',
      heroId: 'cryomancer',
      title: 'Glacier Lord',
      roleTag: 'Frost Bulwark',
      summary: 'Range 3 cross (160% ATK) + Slow + 26 Shield to self & allies.',
      statSummary: '+20 HP · +3 DEF',
      accentHex: '#6ea8ff',
      bonuses: { hp: 20, def: 3 },
      ultimate: {
        id: 'glacial_fortress',
        name: 'Glacial Fortress',
        tier: 3,
        desc: 'Range 3 frost cross (160% ATK), Slow foes & +26 Shield to self & adjacent allies.',
        range: 3,
        cooldown: 3,
        target: 'tile',
        pattern: 'cross',
        powerMul: 1.6,
        flatBonus: 8,
        healAmount: 0,
        shieldAmount: 26,
        allyAuraShield: 26,
        ignoreArmor: 0.7,
        status: 'slow',
        vfx: 'frost'
      }
    }
  ],
  champion: [
    {
      id: 'champion_sunlord',
      heroId: 'champion',
      title: 'Sunlord',
      roleTag: 'Sovereign Obliterator',
      summary: '3x3 golden shockwave (240% ATK) + Stun + 28 Shield.',
      statSummary: '+5 ATK · +10% Crit',
      accentHex: '#ffe066',
      bonuses: { atk: 5, crit: 0.10 },
      ultimate: {
        id: 'crownbreaker',
        name: 'Crownbreaker',
        tier: 3,
        desc: 'Cataclysmic 3x3 golden shockwave (240% ATK, Stun).',
        range: 3,
        cooldown: 3,
        target: 'tile',
        pattern: 'area3',
        powerMul: 2.4,
        flatBonus: 16,
        healAmount: 20,
        shieldAmount: 28,
        ignoreArmor: 0.9,
        status: 'stun',
        vfx: 'holy'
      }
    },
    {
      id: 'champion_starforged',
      heroId: 'champion',
      title: 'Starforged',
      roleTag: 'Relentless Duelist',
      summary: 'Range 3 cross (210% ATK) + Burn + Haste + 30 Shield.',
      statSummary: '+22 HP · +2 SPD · +10% Drain',
      accentHex: '#ff7d54',
      bonuses: { hp: 22, speed: 2, lifesteal: 0.10 },
      ultimate: {
        id: 'radiant_tempest',
        name: 'Radiant Tempest',
        tier: 3,
        desc: 'Range 3 blazing cross (210% ATK), Burn, gain Haste & +30 Shield.',
        range: 3,
        cooldown: 3,
        target: 'tile',
        pattern: 'cross',
        powerMul: 2.1,
        flatBonus: 12,
        healAmount: 12,
        shieldAmount: 30,
        ignoreArmor: 0.75,
        status: 'burn',
        selfStatus: 'haste',
        vfx: 'fire'
      }
    }
  ]
}

const SUB_SPEC_BY_ID: ReadonlyMap<string, HeroSubSpec> = new Map(
  Object.values(HERO_SUB_SPECS)
    .flat()
    .map(spec => [spec.id, spec])
)

export const ALL_HERO_SUB_SPEC_IDS: readonly HeroSubSpecId[] = Object.values(HERO_SUB_SPECS)
  .flat()
  .map(spec => spec.id)

export function getHeroSubSpecOptions(heroId: HeroClassId): readonly [HeroSubSpec, HeroSubSpec] {
  return HERO_SUB_SPECS[heroId]
}

export function getHeroSubSpecById(subSpecId: HeroSubSpecId | undefined): HeroSubSpec | null {
  if (!subSpecId) return null
  return SUB_SPEC_BY_ID.get(subSpecId) ?? null
}

export function isValidSubSpecForHero(heroId: HeroClassId, subSpecId: unknown): subSpecId is HeroSubSpecId {
  if (typeof subSpecId !== 'string') return false
  const spec = SUB_SPEC_BY_ID.get(subSpecId)
  return spec !== undefined && spec.heroId === heroId
}

export function sanitizeHeroSubSpec(
  heroId: HeroClassId,
  stars: 1 | 2 | 3,
  subSpecId: unknown
): HeroSubSpecId | undefined {
  if (stars < 3) return undefined
  return isValidSubSpecForHero(heroId, subSpecId) ? subSpecId : undefined
}

export function getEffectiveHeroTitle(
  heroId: HeroClassId,
  stars: 1 | 2 | 3,
  subSpecId?: HeroSubSpecId
): string {
  if (stars >= 3 && isValidSubSpecForHero(heroId, subSpecId)) {
    const spec = getHeroSubSpecById(subSpecId)
    if (spec) return spec.title
  }
  return HERO_SPECS[heroId].title
}

export function getEffectiveHeroSkill(
  heroId: HeroClassId,
  skillIndex: number,
  subSpecId?: HeroSubSpecId
): SkillSpec | null {
  if (skillIndex < 0 || skillIndex > 2) return null
  if (skillIndex === 2 && isValidSubSpecForHero(heroId, subSpecId)) {
    const subSpec = getHeroSubSpecById(subSpecId)
    if (subSpec) return subSpec.ultimate
  }
  return HERO_SPECS[heroId].skills[skillIndex] ?? null
}

export function needsSubSpecChoice(hero: Pick<OwnedHeroCard, 'stars' | 'subSpecId'>): boolean {
  return hero.stars >= 3 && getHeroSubSpecById(hero.subSpecId) === null
}

export function selectHeroSubSpec(
  state: GameState,
  heroUid: string,
  subSpecId: HeroSubSpecId
): boolean {
  const hero = state.campaign.heroes.find(h => h.uid === heroUid)
  if (!hero || hero.stars < 3) return false
  if (!isValidSubSpecForHero(hero.heroId, subSpecId)) return false
  const changed = hero.subSpecId !== subSpecId
  hero.subSpecId = subSpecId
  if (changed) {
    state.sounds.push({ kind: 'equip' })
  }
  return true
}
