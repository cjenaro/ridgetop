import type { Records } from 'ridgetop/server'
import type { Character } from './expedition.ts'
import { createIdentity, createRecords, openRecords } from 'ridgetop/server'
import { canEnterRegion, createCharacter, rewardExpedition } from './expedition.ts'

function characterStore(records: Records<Character>) {
  function award(id: string, zone: string, outcome: { finished: boolean; signal?: boolean; guild?: boolean }) {
    const before = records.get(id)
    if (!before || !canEnterRegion(before.cleared, zone)) return false
    const after = rewardExpedition(before, zone, outcome)
    if (after === before) return false
    records.set(id, after)
    return true
  }
  return {
    get: records.get,
    create() {
      const id = createIdentity()
      records.set(id, createCharacter('Scout ' + id.slice(0, 6).toUpperCase()))
      return id
    },
    award,
    awardGuild(zone: string, ids: Iterable<string>) {
      const finishers = new Set(Array.from(ids).filter(id => records.get(id)?.cleared.includes(zone)))
      if (finishers.size < 2) return false
      let awarded = false
      for (const id of finishers) {
        const added = award(id, zone, { finished: true, guild: true })
        awarded ||= added
      }
      return awarded
    },
    save: records.save
  }
}

export function createCharacterStore(file?: string, saved?: Iterable<readonly [string, Character]>) {
  return characterStore(createRecords<Character>(file, saved))
}

export async function openCharacterStore(file: string) {
  return characterStore(await openRecords<Character>(file))
}
