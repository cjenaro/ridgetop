import { courses } from './level.ts'

export const GUILD_WORLD = 'wayfarers'
const regionOrder = Object.keys(courses)
const relics = [
  'Mossglass Compass', 'Amber Surveyor’s Seal', 'Frostwoven Cloak',
  'Stormworks Insulator', 'Emberstride Boots', 'Last Light Lantern'
]
export const expeditionLoot = Object.fromEntries(regionOrder.map((id, index) => [id, relics[index]]))

export function canEnterRegion(cleared: readonly string[], id: string) {
  const index = regionOrder.indexOf(id)
  return index >= 0 && (index === 0 || cleared.includes(regionOrder[index - 1]))
}

export interface Character { name: string; cleared: string[]; chips: string[]; guild: string[] }

export function createCharacter(name: string): Character {
  return { name, cleared: [], chips: [], guild: [] }
}

export function characterView(character: Character) {
  const { name, cleared, chips, guild } = character
  const xp = cleared.length * 100 + chips.length * 25 + guild.length * 60
  return { name, cleared, chips, guild, xp, level: 1 + Math.floor(xp / 125) }
}

export type CharacterView = ReturnType<typeof characterView>

export function rewardExpedition(character: Character, zone: string, { finished, signal, guild }: { finished: boolean; signal?: boolean; guild?: boolean }) {
  if (!finished || !Object.hasOwn(expeditionLoot, zone)) return character
  const cleared = character.cleared.includes(zone) ? character.cleared : [...character.cleared, zone]
  const chips = signal && !character.chips.includes(zone) ? [...character.chips, zone] : character.chips
  const contracts = guild && !character.guild.includes(zone) ? [...character.guild, zone] : character.guild
  if (cleared === character.cleared && chips === character.chips && contracts === character.guild) return character
  return { ...character, cleared, chips, guild: contracts }
}
