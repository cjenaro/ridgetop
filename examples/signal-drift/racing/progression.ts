import { circuits } from './track.ts'
import type { Circuit } from './track.ts'

export const garage = {
  motor: { name: 'Motor', costs: [95, 190, 300] },
  tires: { name: 'Tires', costs: [85, 175, 270] },
  armor: { name: 'Shield', costs: [80, 165, 260] },
  capacitor: { name: 'Capacitor', costs: [90, 180, 285] }
}
export type Upgrade = keyof typeof garage
export type Build = Record<Upgrade, number>
export type Championship = {
  credits: number
  build: Build
  records: Record<string, { place: number; seconds: number }>
}
export const garageParts = Object.keys(garage) as Upgrade[]
export const stock: Readonly<Build> = Object.freeze({ motor: 0, tires: 0, armor: 0, capacitor: 0 })
export const raceSaveKey = 'ridgetop.signal-drift.v1'

export function vehicleStats(build: Readonly<Build>) {
  return {
    acceleration: 26 + build.motor * 3,
    maxSpeed: 23 + build.motor * 1.65,
    turnRate: 2.9 + build.tires * .14,
    grip: 6.5 + build.tires * .95,
    offroadGrip: .34 + build.tires * .07,
    maxShield: 100 + build.armor * 20,
    maxPulses: 4 + build.capacitor,
    pulseInterval: .68 - build.capacitor * .12,
    snareInterval: 1.55 - build.capacitor * .20
  }
}

function validCredits(value: number) { return Number.isSafeInteger(value) && value >= 0 }
function validTier(part: Upgrade, value: number) {
  return Number.isInteger(value) && value >= 0 && value <= garage[part].costs.length
}
function validRecord(value) {
  return Number.isInteger(value?.place) && value.place >= 1 && value.place <= 4 &&
    Number.isFinite(value.seconds) && value.seconds > 0
}

function readProgress(saved): Championship {
  const progress: Championship = { credits: 100, build: { ...stock }, records: {} }
  if (!saved) return progress
  if (validCredits(saved.credits)) progress.credits = saved.credits
  for (const part of garageParts) {
    const level = saved.build?.[part]
    if (validTier(part, level)) progress.build[part] = level
  }
  for (const { id } of circuits) {
    const record = saved.records?.[id]
    if (validRecord(record)) progress.records[id] = record
  }
  return progress
}

export function loadChampionship(storage?: Pick<Storage, 'getItem'>): Championship {
  try { return readProgress(JSON.parse(storage?.getItem(raceSaveKey) ?? 'null')) }
  catch { return readProgress(null) }
}

export function saveChampionship(storage: Pick<Storage, 'setItem'> | undefined, progress: Championship) {
  if (!storage) return false
  try { storage.setItem(raceSaveKey, JSON.stringify(progress)); return true }
  catch { return false }
}

export function championshipBackup(progress: Championship) {
  return JSON.stringify({ game: 'signal-drift', version: 1, progress }, null, 2)
}

export function readChampionshipBackup(text: string): Championship {
  let file
  try { file = JSON.parse(text) } catch { throw new Error('Choose a Signal Drift JSON backup.') }
  if (file?.game !== 'signal-drift') throw new Error('Choose a backup made by Signal Drift.')
  if (file.version !== 1) throw new Error('This version of Signal Drift cannot read that backup version.')
  const p = file.progress
  if (!validCredits(p?.credits) || !garageParts.every(part => validTier(part, p.build?.[part])) ||
      !p.records || typeof p.records !== 'object' || Array.isArray(p.records) ||
      !Object.entries(p.records).every(([id, record]) => circuits.some(c => c.id === id) && validRecord(record))) {
    throw new Error('The backup contains incomplete or invalid championship progress.')
  }
  return readProgress(p)
}

export function unlocked(progress: Championship, index: number) {
  return index >= 0 && index < circuits.length && circuits.slice(0, index).every(circuit =>
    (progress.records[circuit.id]?.place ?? Infinity) <= circuit.qualify)
}

export function leadingEvent(progress: Championship) {
  return circuits.findIndex((circuit, index) => unlocked(progress, index) &&
    (progress.records[circuit.id]?.place ?? Infinity) > circuit.qualify)
}

export function buyUpgrade(progress: Championship, part: Upgrade) {
  const level = progress.build[part]
  const cost = garage[part].costs[level]
  if (cost === undefined || progress.credits < cost) return false
  progress.credits -= cost
  progress.build[part]++
  return true
}

export function recordResult(progress: Championship, circuit: Circuit, place: number, seconds: number) {
  const payout = Math.round(circuit.purse * [1, .78, .62, .44][place - 1])
  progress.credits += payout
  const best = progress.records[circuit.id]
  if (!best || place < best.place || (place === best.place && seconds < best.seconds)) {
    progress.records[circuit.id] = { place, seconds }
  }
  return payout
}
