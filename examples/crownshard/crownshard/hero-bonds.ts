import { appendCombatLog } from './combat-log.ts'
import type {
  ActiveBattleBondPair,
  BanterTriggerKind,
  BattleBanterEntry,
  BattleState,
  BattleUnit,
  BondRankUp,
  CampaignState,
  HeroBondRank,
  HeroClassId
} from './types.ts'

export const BOND_ASSIST_RANGE = 2
export const BOND_ATK_MUL = 1.05
export const BOND_DEF_MUL = 1.05
export const BOND_CRIT_BONUS = 0.05
export const BOND_PINCER_MUL = 1.1
export const BANTER_DURATION_SECONDS = 3.8
export const BANTER_COOLDOWN_SECONDS = 4.5
export const MAX_BANTER_TEXT_LENGTH = 56

export const BOND_RANK_THRESHOLDS: Readonly<Record<HeroBondRank, number>> = {
  0: 0,
  1: 1,
  2: 3,
  3: 6
}

export const BOND_RANK_TITLES: Readonly<Record<HeroBondRank, string>> = {
  0: 'Unbonded',
  1: 'Comrades',
  2: 'Sworn Allies',
  3: 'Unbroken Bond'
}

export const HERO_CLASS_IDS: readonly HeroClassId[] = [
  'knight',
  'archer',
  'mage',
  'cleric',
  'rogue',
  'paladin',
  'cryomancer',
  'champion'
]

const HERO_CLASS_LOOKUP: ReadonlyMap<string, HeroClassId> = new Map<string, HeroClassId>(
  HERO_CLASS_IDS.map(id => [id, id])
)

export const HERO_SHORT_NAMES: Readonly<Record<HeroClassId, string>> = {
  knight: 'Aldric',
  archer: 'Lyra',
  mage: 'Vesper',
  cleric: 'Sera',
  rogue: 'Kael',
  paladin: 'Isolde',
  cryomancer: 'Freya',
  champion: 'Aurelius'
}

export const HERO_DISPLAY_NAMES: Readonly<Record<HeroClassId, string>> = {
  knight: 'Sir Aldric',
  archer: 'Lyra',
  mage: 'Vesper',
  cleric: 'Sera',
  rogue: 'Kael',
  paladin: 'Dame Isolde',
  cryomancer: 'Freya',
  champion: 'Aurelius'
}

export interface BondAssistPartner {
  readonly uid: string
  readonly heroId: HeroClassId
  readonly name: string
  readonly rank: 1 | 2 | 3
  readonly distance: number
}

export interface UnitBondAssistResult {
  readonly active: boolean
  readonly highestRank: HeroBondRank
  readonly atkMul: number
  readonly defMul: number
  readonly critBonus: number
  readonly pincerMul: number
  readonly partners: readonly BondAssistPartner[]
}

export interface TriggerBattleBanterOptions {
  readonly speakerUnit?: BattleUnit | null
  readonly partnerUnit?: BattleUnit | null
  readonly allyDowned?: boolean
  readonly force?: boolean
  readonly seed?: number
}

interface PairQuipEntry {
  readonly speaker: HeroClassId
  readonly text: string
  readonly minRank?: 1 | 2 | 3
}

type PairQuipMap = Readonly<Partial<Record<BanterTriggerKind, readonly PairQuipEntry[]>>>

const PAIR_QUIPS: Readonly<Record<string, PairQuipMap>> = {
  'archer+knight': {
    battle_start: [
      { speaker: 'knight', text: 'Hold the ridge, Lyra—my shield holds the road.' },
      { speaker: 'archer', text: 'Keep them busy, Aldric. I will pick them off.' },
      { speaker: 'archer', text: 'Shield and bow, unbroken. Ready when you are!', minRank: 3 }
    ],
    crit: [
      { speaker: 'archer', text: 'Saw that opening, Aldric? Right through the helm!' },
      { speaker: 'knight', text: 'Splendid strike, Lyra! Their line is cracking!' },
      { speaker: 'knight', text: 'My steel opens the path—your arrows seal it!', minRank: 3 }
    ],
    pincer: [
      { speaker: 'knight', text: 'Boxed in! Finish them with me, Lyra!' },
      { speaker: 'archer', text: 'Crossfire locked—nowhere left to hide!' }
    ],
    ko: [
      { speaker: 'archer', text: 'That is one more on my tally, Sir Aldric!' },
      { speaker: 'knight', text: 'Clean finish, Lyra. Press the vanguard!' }
    ],
    boss_phase: [
      { speaker: 'knight', text: 'Stay behind my shield, Lyra—brace for the surge!' },
      { speaker: 'archer', text: 'Big target just got louder. Watch my flank!' }
    ]
  },
  'knight+paladin': {
    battle_start: [
      { speaker: 'paladin', text: 'Shields locked, Aldric. No shadow breaks us.' },
      { speaker: 'knight', text: 'Honored to hold the front beside you, Dame Isolde.' },
      { speaker: 'paladin', text: 'Two oaths, one wall of dawn. Forward!', minRank: 3 }
    ],
    crit: [
      { speaker: 'paladin', text: 'Solis guides our steel, Aldric!' },
      { speaker: 'knight', text: 'By the Vanguard! Witness true knighthood!' }
    ],
    pincer: [
      { speaker: 'paladin', text: 'Anvil and hammer—strike as one, Aldric!' },
      { speaker: 'knight', text: 'Nowhere to run between two shields!' },
      { speaker: 'paladin', text: 'Unbroken oath! Crush them between us!', minRank: 3 }
    ],
    heal: [
      { speaker: 'paladin', text: 'Stand firm, Aldric—light mends the vanguard.' }
    ],
    ko: [
      { speaker: 'knight', text: 'Another foe felled beneath our banner, Isolde!' },
      { speaker: 'paladin', text: 'Well struck, Sir Aldric. Hold formation.' }
    ],
    boss_phase: [
      { speaker: 'paladin', text: 'Their wrath rises—lock shields and endure!' }
    ]
  },
  'archer+rogue': {
    battle_start: [
      { speaker: 'rogue', text: 'Bet I drop the first foe before your bow sings.' },
      { speaker: 'archer', text: 'Careful, Kael—my arrow travels faster than you.' },
      { speaker: 'rogue', text: 'High ground and shadows. They never had a chance.', minRank: 3 }
    ],
    crit: [
      { speaker: 'rogue', text: 'Blink and you missed it! Beat that, Lyra!' },
      { speaker: 'archer', text: 'Dead center! Still keeping score, Kael?' },
      { speaker: 'rogue', text: 'Precision like ours ought to be outlawed!', minRank: 3 }
    ],
    pincer: [
      { speaker: 'rogue', text: 'Caught in our snare—say goodnight!' },
      { speaker: 'archer', text: 'Flushed straight into my sights, Kael!' }
    ],
    ko: [
      { speaker: 'rogue', text: 'Too slow! One down—your turn, Lyra.' },
      { speaker: 'archer', text: 'Clean drop. Try keeping up, shadow!' }
    ],
    boss_phase: [
      { speaker: 'rogue', text: 'Whoa—big temper. Let us dance around it!' }
    ]
  },
  'cleric+mage': {
    battle_start: [
      { speaker: 'mage', text: 'Keep me standing, Sera, and I will light the sky.' },
      { speaker: 'cleric', text: 'Just do not singe your own robes again, Vesper.' },
      { speaker: 'cleric', text: 'Starfire and sunlight in harmony. Begin!', minRank: 3 }
    ],
    crit: [
      { speaker: 'mage', text: 'Textbook starfire! Did you see that arc, Sera?' },
      { speaker: 'cleric', text: 'Radiant! Even the dawn applauds that cast!' }
    ],
    heal: [
      { speaker: 'cleric', text: 'Breathe, Vesper—the Sun has your back.' },
      { speaker: 'cleric', text: 'Woven in light! Now unleash your storm, Vesper.', minRank: 3 }
    ],
    revive: [
      { speaker: 'cleric', text: 'Up you get, Vesper! Your lantern still burns!' }
    ],
    ko: [
      { speaker: 'mage', text: 'Reduced to stardust. Efficient as always.' }
    ],
    boss_phase: [
      { speaker: 'cleric', text: 'Stay close, Vesper—I have wards ready!' }
    ]
  },
  'cryomancer+mage': {
    battle_start: [
      { speaker: 'cryomancer', text: 'Ice first, Vesper—then bring the fire.' },
      { speaker: 'mage', text: 'Frost and flame together? Pure artistry, Freya.' },
      { speaker: 'cryomancer', text: 'Winter locks them down; starfire shatters all.', minRank: 3 }
    ],
    crit: [
      { speaker: 'cryomancer', text: 'Brittle as glass! Your turn, Vesper.' },
      { speaker: 'mage', text: 'Thermal shock at its finest, Freya!' }
    ],
    ko: [
      { speaker: 'cryomancer', text: 'Frozen solid. Next specimen, Vesper?' },
      { speaker: 'mage', text: 'Fire and frost—no defense survives us!' }
    ],
    boss_phase: [
      { speaker: 'cryomancer', text: 'Let them rage. Cold patience breaks every titan.' }
    ]
  },
  'cleric+knight': {
    battle_start: [
      { speaker: 'knight', text: 'Stay behind my tower shield, Sera.' },
      { speaker: 'cleric', text: 'You take the blows, Aldric—I will mend every dent.' },
      { speaker: 'knight', text: 'With your blessing, Sera, this shield never yields!', minRank: 3 }
    ],
    crit: [
      { speaker: 'knight', text: 'Dawn blesses this blade! Forward, Sera!' }
    ],
    heal: [
      { speaker: 'cleric', text: 'Hold the line, Aldric—fresh light for you!' },
      { speaker: 'cleric', text: 'Not a scratch left! Stand tall, Sir Aldric!', minRank: 3 }
    ],
    revive: [
      { speaker: 'cleric', text: 'Rise, Sir Aldric! The line still needs you!' }
    ],
    ko: [
      { speaker: 'knight', text: 'Another threat cleared from your path, Sera!' }
    ],
    boss_phase: [
      { speaker: 'cleric', text: 'Steel your shield, Aldric—I am channeling now!' }
    ]
  },
  'champion+knight': {
    battle_start: [
      { speaker: 'champion', text: 'Walk beside me, Aldric. We break their vanguard.' },
      { speaker: 'knight', text: 'To fight beside the Sunblade is my highest honor!' },
      { speaker: 'champion', text: 'Crown and shield united—charge into legend!', minRank: 3 }
    ],
    crit: [
      { speaker: 'champion', text: 'Watch how the First Crown cleaves, Aldric!' },
      { speaker: 'knight', text: 'Blinding strike, Aurelius! Pressing forward!' }
    ],
    pincer: [
      { speaker: 'champion', text: 'Caught between starlight and steel!' },
      { speaker: 'knight', text: 'Side by side with the Sunblade—strike!' }
    ],
    ko: [
      { speaker: 'champion', text: 'Fallen! None can weather our advance, Aldric.' }
    ],
    boss_phase: [
      { speaker: 'champion', text: 'At last, a worthy duel! Hold the flank, Aldric!' }
    ]
  },
  'champion+mage': {
    battle_start: [
      { speaker: 'champion', text: 'Channel the stars, Vesper—I will carve the opening.' },
      { speaker: 'mage', text: 'Starlight blades and arcane fire. Unstoppable.' },
      { speaker: 'champion', text: 'Two flames of Solis—burn away the Eclipse!', minRank: 3 }
    ],
    crit: [
      { speaker: 'mage', text: 'Even the Sunblade must admire that burst!' },
      { speaker: 'champion', text: 'Dazzling work, Vesper! Keep the sky ablaze!' }
    ],
    ko: [
      { speaker: 'champion', text: 'Ashes before the dawn. Well cast, Vesper!' }
    ],
    boss_phase: [
      { speaker: 'mage', text: 'Power spike detected! Unleash everything, Aurelius!' }
    ]
  },
  'knight+mage': {
    battle_start: [
      { speaker: 'knight', text: 'I will hold the choke point—light them up, Vesper!' },
      { speaker: 'mage', text: 'Mind the blast radius, Aldric. Here comes starfire.' },
      { speaker: 'mage', text: 'Iron front, starfire rear. Classic perfection!', minRank: 3 }
    ],
    crit: [
      { speaker: 'mage', text: 'Direct hit! Keep them pinned there, Aldric!' },
      { speaker: 'knight', text: 'Ha! Your magic shakes the whole field, Vesper!' }
    ],
    ko: [
      { speaker: 'knight', text: 'One less foe near our arcanist!' },
      { speaker: 'mage', text: 'Target neutralized. Nice screen, Sir Aldric.' }
    ],
    boss_phase: [
      { speaker: 'knight', text: 'Fall back a step, Vesper—I will take the brunt!' }
    ]
  },
  'archer+mage': {
    battle_start: [
      { speaker: 'archer', text: 'Arrows and fireballs—they will never get close.' },
      { speaker: 'mage', text: 'Spot the high-value foes, Lyra. I will ignite them.' },
      { speaker: 'archer', text: 'Rain of steel and starfire! Watch the skies!', minRank: 3 }
    ],
    crit: [
      { speaker: 'archer', text: 'Pinned them right inside your blast zone, Vesper!' },
      { speaker: 'mage', text: 'Surgical precision, Lyra. I am impressed!' }
    ],
    ko: [
      { speaker: 'archer', text: 'Dropped before they could even swing!' }
    ],
    boss_phase: [
      { speaker: 'mage', text: 'Keep our range, Lyra—do not let it close in!' }
    ]
  },
  'cleric+paladin': {
    battle_start: [
      { speaker: 'paladin', text: 'With your prayers, Sera, dawn cannot fail.' },
      { speaker: 'cleric', text: 'Light shields your plate, Dame Isolde. March on!' }
    ],
    heal: [
      { speaker: 'cleric', text: 'Solis restores her finest champion!' }
    ],
    revive: [
      { speaker: 'cleric', text: 'Rise in golden light, Dame Isolde!' }
    ],
    pincer: [
      { speaker: 'paladin', text: 'Judgment strikes from both sides!' }
    ]
  },
  'cryomancer+rogue': {
    battle_start: [
      { speaker: 'rogue', text: 'Freeze their boots, Freya—I will take their backs.' },
      { speaker: 'cryomancer', text: 'Slowed targets for a quick blade. Neat arrangement.' }
    ],
    crit: [
      { speaker: 'rogue', text: 'Shattered! Cold setup, Freya!' },
      { speaker: 'cryomancer', text: 'Clean cut, Kael. Not a drop wasted.' }
    ],
    pincer: [
      { speaker: 'rogue', text: 'Frostbite from the front, steel from behind!' }
    ]
  },
  'champion+paladin': {
    battle_start: [
      { speaker: 'champion', text: 'Side by side, Isolde—let the golden host shine!' },
      { speaker: 'paladin', text: 'For Solis and the First Crown! Advance!' }
    ],
    pincer: [
      { speaker: 'champion', text: 'Twin sunblades—nowhere left to flee!' },
      { speaker: 'paladin', text: 'Radiant pincer! Break their ranks!' }
    ]
  }
}

const CLASS_FALLBACK_QUIPS: Readonly<Record<HeroClassId, Readonly<Record<BanterTriggerKind, readonly string[]>>>> = {
  knight: {
    battle_start: ['Stand behind my shield—we hold this ground!', 'Together, Vanguard! Formation tight!'],
    crit: ['A true Vanguard strike! Press the breach!', 'My steel rings true—follow my lead!'],
    pincer: ['Flanked and trapped! Strike together!', 'Anvil meets steel—hold them down!'],
    heal: ['Gratitude! My shield stands stronger still!', 'Restored and ready to hold the line!'],
    revive: ['Back on my feet! Thank you, comrade!', 'I will not fall while you stand beside me!'],
    ko: ['Another foe falls before our unity!', 'The line holds—onward, friends!'],
    boss_phase: ['Brace yourselves! Rally behind my shield!', 'Their fury peaks—stand unbroken!']
  },
  archer: {
    battle_start: ['Eyes on the ridge—I have got your cover!', 'Mark your targets; I will loose on cue!'],
    crit: ['Bullseye! Right through the weak point!', 'Clean shot—did everyone see that?'],
    pincer: ['Pinning them down! Take the opening!', 'Crossfire locked—nowhere to run!'],
    heal: ['Whew, good timing! Back to the bow!', 'Thanks for the patch-up—still sharp!'],
    revive: ['Hah, not out of arrows yet! Thanks!', 'Back in the fight—watch the skyline!'],
    ko: ['Scratch one more off the board!', 'Target down—next one is mine too!'],
    boss_phase: ['Ooh, it is furious now! Keep moving!', 'Watch the big wind-up—stay sharp!']
  },
  mage: {
    battle_start: ['Arcane matrix aligned. Let us begin.', 'Stay clear of the blast zone—engaging!'],
    crit: ['Pure starfire resonance! Devastating!', 'Calculated to the last spark!'],
    pincer: ['Tactical convergence—brilliant execution!', 'Pinned in the crossfire—just as planned!'],
    heal: ['Much appreciated. My focus holds steady.', 'Mana and vigor restored. Continuing barrage.'],
    revive: ['Back from the brink—now they pay!', 'A timely rescue. Let me return the favor!'],
    ko: ['Threat vaporized. Next calculation!', 'Reduced to ash. Efficient teamwork!'],
    boss_phase: ['Massive arcane surge—prepare defenses!', 'Phase shift! Adjust formation at once!']
  },
  cleric: {
    battle_start: ['May the Sun guard every step we take!', 'Stay close—my light watches over you all!'],
    crit: ['Dawn pierces even the deepest shadow!', 'Radiant strike! Light guide us!'],
    pincer: ['Together in light—strike as one!', 'Nowhere for shadow to hide between us!'],
    heal: ['Warmth of Solis, mend my comrade!', 'Stand strong—the light restores you!'],
    revive: ['Rise again! Your dawn is not over!', 'By Solis, breathe and fight once more!'],
    ko: ['Peace to the field—one less shadow!', 'Light prevails when we fight as one!'],
    boss_phase: ['Darkness swells—stay near my wards!', 'Hold faith! The Sun will not yield!']
  },
  rogue: {
    battle_start: ['Keep their eyes busy—I will take their backs.', 'Quick and quiet? Or loud and flashy?'],
    crit: ['Right between the plates! Too easy!', 'Blink and you missed it!'],
    pincer: ['Caught in the cross-slash! Game over!', 'Front and back—my favorite trick!'],
    heal: ['Nice save! Owe you a drink after this.', 'Patched up and still faster than them!'],
    revive: ['Ha! Takes more than that to keep me down!', 'Round two—and now I am mad!'],
    ko: ['One less problem. Who is next?', 'Dropped clean! Keep the tempo up!'],
    boss_phase: ['Uh-oh, it is glowing! Stay light on your feet!', 'Big swing incoming—time to dodge!']
  },
  paladin: {
    battle_start: ['Oath sworn! None shall breach our line!', 'Stand with me in golden light!'],
    crit: ['Solis judges the wicked! Smite!', 'Golden wrath—press the advantage!'],
    pincer: ['Hammer of dawn from both flanks!', 'United in oath—break their guard!'],
    heal: ['Light fortifies our vanguard! Stand tall!', 'Renewed in valor—hold the line!'],
    revive: ['By the Bastion, I rise anew!', 'Your faith lifts my blade once more!'],
    ko: ['Justice delivered! Advance together!', 'Shadow banished! Hold formation!'],
    boss_phase: ['Let the titan roar—our resolve is iron!', 'Shields high! Face the storm together!']
  },
  cryomancer: {
    battle_start: ['Frost settles over the field. Stay sharp.', 'Chill the front—then shatter them all.'],
    crit: ['Crystallized and shattered! Flawless.', 'Sub-zero precision. Satisfying.'],
    pincer: ['Trapped in frost and steel—no escape!', 'Cold lock—finish them cleanly!'],
    heal: ['Warmth received. My focus stays ice-cold.', 'Restored. Returning to the freeze.'],
    revive: ['Ice does not break so easily. Thank you.', 'Back in action—now let them freeze!'],
    ko: ['Frozen out of the fight. Next?', 'Another sculpture for the glacier.'],
    boss_phase: ['Their heat rises—my frost will answer.', 'Brace! Time to cool this monster down!']
  },
  champion: {
    battle_start: ['Starlight blades drawn—follow my charge!', 'Together we reclaim the First Crown!'],
    crit: ['Witness the blazing dawn!', 'Starlight cleaves all before us!'],
    pincer: ['Crown and vanguard strike as one!', 'Boxed by starlight—break them now!'],
    heal: ['My flame burns brighter still! Thank you!', 'Restored! Now let us finish this!'],
    revive: ['The Sunblade rises unbroken!', 'Not even eclipse can snuff our dawn!'],
    ko: ['Victory draws near! Press the charge!', 'Felled by starlight—onward, allies!'],
    boss_phase: ['Show us your full fury—we will surpass it!', 'Stand proud! This is our finest hour!']
  }
}

const ALLY_DOWNED_QUIPS: Readonly<Record<HeroClassId, readonly string[]>> = {
  knight: ['Hold on, {partner}! I will guard you!', 'Do not fade, {partner}—help is coming!'],
  archer: ['Hang tough, {partner}! Clearing the lane!', 'Stay with us, {partner}—they will pay!'],
  mage: ['Endure, {partner}! Covering your tile!', 'Hold steady, {partner}—we will lift you!'],
  cleric: ['Hold fast, {partner}—my light is coming!', 'Stay with me, {partner}! Do not let go!'],
  rogue: ['Hey, {partner}, no napping! I got them!', 'Nobody drops {partner} on my watch!'],
  paladin: ['Courage, {partner}! My shield is yours!', 'Hold on, {partner}—dawn will lift you!'],
  cryomancer: ['Stay awake, {partner}. Freezing their push.', 'Hold out, {partner}—they will regret that.'],
  champion: ['Stand fast in spirit, {partner}—we rally!', 'For {partner}! Break their line now!']
}

const RANK3_SIGNATURE_QUIPS: Readonly<Record<HeroClassId, readonly string[]>> = {
  knight: ['Unbroken bond! With {partner}, none pass!'],
  archer: ['{partner} and I never miss a beat!'],
  mage: ['Perfect synergy with {partner}—unstoppable!'],
  cleric: ['Our bond shines brighter than the noon sun!'],
  rogue: ['Me and {partner}? Best duo in the realm!'],
  paladin: ['Sworn with {partner}—dawn stands eternal!'],
  cryomancer: ['With {partner}, victory is crystal clear.'],
  champion: ['Bound with {partner}—legend is forged today!']
}

function manhattanDist(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

/** Canonical sorted key for a pair of distinct hero classes, e.g. `"archer+knight"`. */
export function bondPairKey(a: HeroClassId, b: HeroClassId): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`
}

/** Parse and validate a canonical hero bond pair key; returns null for invalid or self-pairs. */
export function parseBondPairKey(key: string): readonly [HeroClassId, HeroClassId] | null {
  const parts = key.split('+')
  if (parts.length !== 2) return null
  const a = HERO_CLASS_LOOKUP.get(parts[0])
  const b = HERO_CLASS_LOOKUP.get(parts[1])
  if (!a || !b || a === b) return null
  return a < b ? [a, b] : [b, a]
}

/** Map battles fought together to Bond Rank (0, 1, 2, or 3). */
export function getBondRankFromBattles(battles: number): HeroBondRank {
  if (!Number.isFinite(battles) || battles < 1) return 0
  if (battles >= BOND_RANK_THRESHOLDS[3]) return 3
  if (battles >= BOND_RANK_THRESHOLDS[2]) return 2
  return 1
}

export function getBondRankTitle(rank: HeroBondRank): string {
  return BOND_RANK_TITLES[rank]
}

export function getNextBondThreshold(rank: HeroBondRank): number | null {
  if (rank === 0) return BOND_RANK_THRESHOLDS[1]
  if (rank === 1) return BOND_RANK_THRESHOLDS[2]
  if (rank === 2) return BOND_RANK_THRESHOLDS[3]
  return null
}

/** Sanitize a persisted `heroBonds` map into canonical sorted keys with positive integer battle counts. */
export function sanitizeHeroBonds(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    const parsed = parseBondPairKey(k)
    if (!parsed) continue
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) continue
    const canonical = bondPairKey(parsed[0], parsed[1])
    const count = Math.floor(v)
    out[canonical] = Math.max(out[canonical] ?? 0, count)
  }
  return out
}

export function getBondBattles(
  bonds: Readonly<Record<string, number>> | null | undefined,
  a: HeroClassId,
  b: HeroClassId
): number {
  if (!bonds || a === b) return 0
  const val = bonds[bondPairKey(a, b)]
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? Math.floor(val) : 0
}

export function getBondRank(
  bonds: Readonly<Record<string, number>> | null | undefined,
  a: HeroClassId,
  b: HeroClassId
): HeroBondRank {
  return getBondRankFromBattles(getBondBattles(bonds, a, b))
}

/** Total sum of bond ranks across all hero pairs in the campaign. */
export function getTotalBondRanks(bonds: Readonly<Record<string, number>> | null | undefined): number {
  if (!bonds) return 0
  let total = 0
  for (const [k, v] of Object.entries(bonds)) {
    if (!parseBondPairKey(k)) continue
    total += getBondRankFromBattles(v)
  }
  return total
}

/** Return all active Rank 1+ bond pairs among a set of deployed hero classes. */
export function getActiveBattleBondPairs(
  heroBonds: Readonly<Record<string, number>> | null | undefined,
  deployedHeroIds: readonly HeroClassId[]
): ActiveBattleBondPair[] {
  if (!heroBonds) return []
  const unique = Array.from(new Set(deployedHeroIds))
  const pairs: ActiveBattleBondPair[] = []
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]
      const b = unique[j]
      const battles = getBondBattles(heroBonds, a, b)
      const rank = getBondRankFromBattles(battles)
      if (rank === 0) continue
      const [heroA, heroB] = a < b ? [a, b] : [b, a]
      pairs.push({
        key: bondPairKey(heroA, heroB),
        heroA,
        heroB,
        battles,
        rank
      })
    }
  }
  pairs.sort((p1, p2) => {
    if (p2.rank !== p1.rank) return p2.rank - p1.rank
    if (p2.battles !== p1.battles) return p2.battles - p1.battles
    return p1.key.localeCompare(p2.key)
  })
  return pairs
}

/** Sanitize persisted `bondPairsActive` from a battle snapshot. */
export function sanitizeActiveBattleBondPairs(raw: unknown): ActiveBattleBondPair[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: ActiveBattleBondPair[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item
    const rawKey = 'key' in rec && typeof rec.key === 'string' ? rec.key : ''
    const parsed = parseBondPairKey(rawKey)
    if (!parsed) continue
    const canonical = bondPairKey(parsed[0], parsed[1])
    if (seen.has(canonical)) continue
    const rawBattles = 'battles' in rec && typeof rec.battles === 'number' && Number.isFinite(rec.battles)
      ? Math.floor(rec.battles)
      : 0
    const rank = getBondRankFromBattles(rawBattles)
    if (rank === 0) continue
    seen.add(canonical)
    out.push({
      key: canonical,
      heroA: parsed[0],
      heroB: parsed[1],
      battles: rawBattles,
      rank
    })
  }
  return out
}

/** Active Rank 1+ bond pairs in the campaign's current Camp Squad. */
export function getSquadBondSummary(
  campaign: Pick<CampaignState, 'heroBonds' | 'heroes' | 'squadUids'>
): ActiveBattleBondPair[] {
  const heroIds: HeroClassId[] = []
  for (const uid of campaign.squadUids) {
    const hero = campaign.heroes.find(h => h.uid === uid)
    if (hero) heroIds.push(hero.heroId)
  }
  return getActiveBattleBondPairs(campaign.heroBonds, heroIds)
}

/**
 * Increment battles fought together for every unique hero class pair deployed in a victorious battle.
 * Returns any pairs that reached a new Bond Rank (1, 2, or 3).
 */
export function recordSquadBattleBonds(
  campaign: Pick<CampaignState, 'heroBonds'>,
  deployedHeroIds: readonly HeroClassId[]
): BondRankUp[] {
  const unique = Array.from(new Set(deployedHeroIds))
  const rankUps: BondRankUp[] = []
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const rawA = unique[i]
      const rawB = unique[j]
      if (rawA === rawB) continue
      const [heroA, heroB] = rawA < rawB ? [rawA, rawB] : [rawB, rawA]
      const key = bondPairKey(heroA, heroB)
      const oldBattles = getBondBattles(campaign.heroBonds, heroA, heroB)
      const oldRank = getBondRankFromBattles(oldBattles)
      const newBattles = oldBattles + 1
      campaign.heroBonds[key] = newBattles
      const newRank = getBondRankFromBattles(newBattles)
      if (newRank > oldRank && newRank !== 0) {
        rankUps.push({
          key,
          heroA,
          heroB,
          nameA: HERO_SHORT_NAMES[heroA],
          nameB: HERO_SHORT_NAMES[heroB],
          oldRank,
          newRank,
          rankTitle: BOND_RANK_TITLES[newRank],
          battles: newBattles
        })
      }
    }
  }
  return rankUps
}

function lookupBattlePairRank(
  battle: Partial<Pick<BattleState, 'bondPairsActive'>>,
  a: HeroClassId,
  b: HeroClassId,
  campaignBonds?: Readonly<Record<string, number>>
): HeroBondRank {
  if (a === b) return 0
  const key = bondPairKey(a, b)
  if (battle.bondPairsActive && battle.bondPairsActive.length > 0) {
    const found = battle.bondPairsActive.find(p => p.key === key)
    if (found) return found.rank
  }
  if (campaignBonds) {
    return getBondRank(campaignBonds, a, b)
  }
  return 0
}

/**
 * Compute active Bond Assist bonuses for a living ally unit based on living, non-downed bonded
 * partners within Manhattan distance <= 2.
 */
export function computeUnitBondAssist(
  battle: Pick<BattleState, 'units'> & Partial<Pick<BattleState, 'bondPairsActive'>>,
  unit: Pick<BattleUnit, 'uid' | 'team' | 'col' | 'row' | 'alive'> & Partial<Pick<BattleUnit, 'heroId' | 'downed'>>,
  opts?: {
    readonly col?: number
    readonly row?: number
    readonly campaignBonds?: Readonly<Record<string, number>>
  }
): UnitBondAssistResult {
  const empty: UnitBondAssistResult = {
    active: false,
    highestRank: 0,
    atkMul: 1,
    defMul: 1,
    critBonus: 0,
    pincerMul: 1,
    partners: []
  }
  if (unit.team !== 'ally' || !unit.alive || unit.downed || !unit.heroId) return empty
  const hasBattlePairs = Boolean(battle.bondPairsActive && battle.bondPairsActive.length > 0)
  if (!hasBattlePairs && !opts?.campaignBonds) return empty

  const col = opts?.col ?? unit.col
  const row = opts?.row ?? unit.row
  const partners: BondAssistPartner[] = []
  let highestRank: HeroBondRank = 0

  for (const other of battle.units) {
    if (other.uid === unit.uid || other.team !== 'ally' || !other.alive || other.downed || !other.heroId) continue
    if (other.heroId === unit.heroId) continue
    const dist = manhattanDist(col, row, other.col, other.row)
    if (dist > BOND_ASSIST_RANGE) continue
    const rank = lookupBattlePairRank(battle, unit.heroId, other.heroId, opts?.campaignBonds)
    if (rank === 0) continue
    partners.push({
      uid: other.uid,
      heroId: other.heroId,
      name: other.name,
      rank,
      distance: dist
    })
    if (rank > highestRank) highestRank = rank
  }

  if (partners.length === 0 || highestRank === 0) return empty
  partners.sort((p1, p2) => {
    if (p2.rank !== p1.rank) return p2.rank - p1.rank
    return p1.distance - p2.distance
  })

  return {
    active: true,
    highestRank,
    atkMul: BOND_ATK_MUL,
    defMul: BOND_DEF_MUL,
    critBonus: highestRank >= 2 ? BOND_CRIT_BONUS : 0,
    pincerMul: highestRank >= 3 ? BOND_PINCER_MUL : 1,
    partners
  }
}

/**
 * Returns `1.10` (`+10%` Pincer follow-up damage) when `attacker` and `assister` are living allies
 * sharing a Rank 3 Unbroken Bond; returns `1.0` otherwise.
 */
export function computePincerPairBondMultiplier(
  battle: Partial<Pick<BattleState, 'bondPairsActive'>>,
  attacker: (Pick<BattleUnit, 'team'> & Partial<Pick<BattleUnit, 'heroId'>>) | null | undefined,
  assister: (Pick<BattleUnit, 'team'> & Partial<Pick<BattleUnit, 'heroId'>>) | null | undefined,
  campaignBonds?: Readonly<Record<string, number>>
): number {
  if (!attacker || !assister) return 1
  if (attacker.team !== 'ally' || assister.team !== 'ally') return 1
  if (!attacker.heroId || !assister.heroId || attacker.heroId === assister.heroId) return 1
  const rank = lookupBattlePairRank(battle, attacker.heroId, assister.heroId, campaignBonds)
  return rank >= 3 ? BOND_PINCER_MUL : 1
}

function minRankForTrigger(trigger: BanterTriggerKind): 1 | 2 {
  if (trigger === 'battle_start' || trigger === 'crit' || trigger === 'ko') return 1
  return 2
}

function clampBanterText(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length <= MAX_BANTER_TEXT_LENGTH) return trimmed
  return trimmed.slice(0, MAX_BANTER_TEXT_LENGTH - 1).trimEnd() + '…'
}

function selectBanterLine(
  speakerHeroId: HeroClassId,
  partnerHeroId: HeroClassId,
  bondRank: 1 | 2 | 3,
  trigger: BanterTriggerKind,
  allyDowned: boolean,
  pickSeed: number
): string {
  const partnerShort = HERO_SHORT_NAMES[partnerHeroId]
  if (trigger === 'ko' && allyDowned) {
    const lines = ALLY_DOWNED_QUIPS[speakerHeroId]
    const chosen = lines[Math.abs(pickSeed) % lines.length] ?? lines[0]
    return clampBanterText(chosen.replace('{partner}', partnerShort))
  }

  const key = bondPairKey(speakerHeroId, partnerHeroId)
  const pairSet = PAIR_QUIPS[key]?.[trigger]
  if (pairSet && pairSet.length > 0) {
    const eligible = pairSet.filter(q => (q.minRank ?? 1) <= bondRank)
    const speakerMatches = eligible.filter(q => q.speaker === speakerHeroId)
    const rank3Speaker = bondRank >= 3 ? speakerMatches.filter(q => q.minRank === 3) : []
    const pool = rank3Speaker.length > 0 ? rank3Speaker : speakerMatches
    if (pool.length > 0) {
      return clampBanterText(pool[Math.abs(pickSeed) % pool.length].text)
    }
  }

  if (bondRank >= 3 && (trigger === 'crit' || trigger === 'pincer' || trigger === 'battle_start')) {
    const sigLines = RANK3_SIGNATURE_QUIPS[speakerHeroId]
    if (sigLines.length > 0 && Math.abs(pickSeed) % 2 === 0) {
      return clampBanterText(sigLines[Math.abs(pickSeed) % sigLines.length].replace('{partner}', partnerShort))
    }
  }

  const fallbackPool = CLASS_FALLBACK_QUIPS[speakerHeroId][trigger]
  return clampBanterText(fallbackPool[Math.abs(pickSeed) % fallbackPool.length] ?? fallbackPool[0])
}

/**
 * Trigger a short character-voiced Battle Banter quip for a bonded hero pair, respecting rank gates
 * and cooldown throttling. Returns the created `BattleBanterEntry`, or `null` if suppressed.
 */
export function triggerBattleBanter(
  battle: Pick<
    BattleState,
    'units' | 'bondPairsActive' | 'activeBanter' | 'banterCooldown' | 'nextBanterId' | 'combatLog' | 'nextLogId' | 'turn'
  >,
  trigger: BanterTriggerKind,
  opts?: TriggerBattleBanterOptions
): BattleBanterEntry | null {
  if (battle.bondPairsActive.length === 0) return null
  if (!opts?.force && battle.banterCooldown > 0) return null

  const requiredRank = minRankForTrigger(trigger)
  const livingAllies = battle.units.filter(u => u.team === 'ally' && u.alive && !u.downed && Boolean(u.heroId))
  if (livingAllies.length === 0) return null

  const allyDowned = Boolean(opts?.allyDowned || (trigger === 'ko' && opts?.partnerUnit && (!opts.partnerUnit.alive || opts.partnerUnit.downed)))

  let speaker: BattleUnit | null = null
  let partner: BattleUnit | null = null
  let pairRank: 1 | 2 | 3 | null = null

  const pickPairRank = (uA: BattleUnit, uB: BattleUnit): 1 | 2 | 3 | null => {
    if (!uA.heroId || !uB.heroId || uA.heroId === uB.heroId) return null
    const r = lookupBattlePairRank(battle, uA.heroId, uB.heroId)
    if (r === 0 || r < requiredRank) return null
    return r
  }

  if (allyDowned && opts?.partnerUnit && opts.partnerUnit.team === 'ally' && opts.partnerUnit.heroId) {
    // A bonded living ally reacts to the downed partner
    const fallen = opts.partnerUnit
    let bestRank: 0 | 1 | 2 | 3 = 0
    for (const ally of livingAllies) {
      if (ally.uid === fallen.uid) continue
      const r = pickPairRank(ally, fallen)
      if (r && r > bestRank) {
        bestRank = r
        speaker = ally
        partner = fallen
        pairRank = r
      }
    }
  } else if (opts?.speakerUnit && opts.speakerUnit.team === 'ally' && opts.speakerUnit.alive && !opts.speakerUnit.downed && opts.speakerUnit.heroId) {
    const candidateSpeaker = opts.speakerUnit
    if (opts.partnerUnit && opts.partnerUnit.team === 'ally' && opts.partnerUnit.uid !== candidateSpeaker.uid && opts.partnerUnit.heroId) {
      const r = pickPairRank(candidateSpeaker, opts.partnerUnit)
      if (r) {
        speaker = candidateSpeaker
        partner = opts.partnerUnit
        pairRank = r
      }
    }
    if (!speaker) {
      let bestRank: 0 | 1 | 2 | 3 = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (const ally of livingAllies) {
        if (ally.uid === candidateSpeaker.uid) continue
        const r = pickPairRank(candidateSpeaker, ally)
        if (!r) continue
        const d = manhattanDist(candidateSpeaker.col, candidateSpeaker.row, ally.col, ally.row)
        if (r > bestRank || (r === bestRank && d < bestDist)) {
          bestRank = r
          bestDist = d
          speaker = candidateSpeaker
          partner = ally
          pairRank = r
        }
      }
    }
  } else {
    // Pick highest-rank living bonded pair (e.g. battle_start, boss_phase)
    const eligiblePairs = battle.bondPairsActive.filter(p => p.rank >= requiredRank)
    for (const p of eligiblePairs) {
      const unitA = livingAllies.find(u => u.heroId === p.heroA)
      const unitB = livingAllies.find(u => u.heroId === p.heroB)
      if (!unitA || !unitB) continue
      const pairQuips = PAIR_QUIPS[p.key]?.[trigger]?.filter(q => (q.minRank ?? 1) <= p.rank) ?? []
      if (pairQuips.length > 0) {
        const chosenQ = pairQuips[Math.abs((opts?.seed ?? 0) + battle.nextBanterId + battle.turn) % pairQuips.length]
        if (chosenQ.speaker === unitA.heroId) {
          speaker = unitA
          partner = unitB
        } else {
          speaker = unitB
          partner = unitA
        }
      } else {
        const flip = (battle.nextBanterId + battle.turn) % 2 === 1
        speaker = flip ? unitB : unitA
        partner = flip ? unitA : unitB
      }
      pairRank = p.rank
      break
    }
  }

  if (!speaker || !partner || !pairRank || !speaker.heroId || !partner.heroId) return null

  const pickSeed = (opts?.seed ?? 0) + battle.nextBanterId * 7 + battle.turn * 3
  const text = selectBanterLine(speaker.heroId, partner.heroId, pairRank, trigger, allyDowned, pickSeed)
  const id = Math.max(1, Math.floor(battle.nextBanterId || 1))
  battle.nextBanterId = id + 1

  const entry: BattleBanterEntry = {
    id,
    speakerUid: speaker.uid,
    speakerHeroId: speaker.heroId,
    speakerName: speaker.name,
    partnerHeroId: partner.heroId,
    partnerName: partner.name,
    text,
    bondRank: pairRank,
    trigger,
    age: 0,
    duration: BANTER_DURATION_SECONDS
  }
  battle.activeBanter = entry
  battle.banterCooldown = BANTER_COOLDOWN_SECONDS

  const shortSpeaker = HERO_SHORT_NAMES[speaker.heroId]
  const logCat = trigger === 'battle_start' || trigger === 'boss_phase' ? 'system' : 'reaction'
  appendCombatLog(
    battle,
    logCat,
    `${shortSpeaker} (♥R${pairRank}): "${text}"`,
    { accentHex: '#ff96c5' }
  )

  return entry
}

/** Advance active battle banter lifetime & throttle cooldown. */
export function stepBattleBanter(
  battle: Pick<BattleState, 'activeBanter' | 'banterCooldown'>,
  dt: number
): void {
  if (!Number.isFinite(dt) || dt <= 0) return
  if (battle.banterCooldown > 0) {
    battle.banterCooldown = Math.max(0, battle.banterCooldown - dt)
  }
  if (battle.activeBanter) {
    battle.activeBanter.age += dt
    if (battle.activeBanter.age >= battle.activeBanter.duration) {
      battle.activeBanter = null
    }
  }
}

/** Compact label for a bond pair chip, e.g. `"Aldric ♥ Lyra R1 (+5%)"`. */
export function formatSquadBondChip(pair: Pick<ActiveBattleBondPair, 'heroA' | 'heroB' | 'rank'>): string {
  const a = HERO_SHORT_NAMES[pair.heroA]
  const b = HERO_SHORT_NAMES[pair.heroB]
  const bonus = pair.rank >= 3 ? '+5% · +10% Pincer' : pair.rank >= 2 ? '+5% · +5% Crit' : '+5%'
  return `${a} ♥ ${b} R${pair.rank} (${bonus})`
}

/** Compact single-line summary for a bond pair on narrow mobile viewports. */
export function formatCompactBondChip(pair: Pick<ActiveBattleBondPair, 'heroA' | 'heroB' | 'rank'>): string {
  const a = HERO_SHORT_NAMES[pair.heroA]
  const b = HERO_SHORT_NAMES[pair.heroB]
  return `${a} ♥ ${b} R${pair.rank}`
}
