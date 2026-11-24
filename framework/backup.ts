import { resolveStorage } from './platform.ts'

export const BACKUP_FORMAT = 'ridgetop-backup' as const
export const BACKUP_SCHEMA_VERSION = 1 as const

export type SaveBackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface SaveBackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_SCHEMA_VERSION
  gameId: string
  gameVersion: number | string
  exportedAt: string
  checksum: string
  data: Record<string, string>
}

export interface SaveBackupOptions {
  /** Stable identifier for the game (e.g. `'lantern-grove'`). Backups with a different `gameId` are rejected. */
  gameId: string
  /** Game save schema or release version stored in backup metadata (defaults to `1`). */
  version?: number | string
  /** Storage backend to read/write (defaults to `resolveStorage()`). */
  storage?: SaveBackupStorage
  /** Exact list of storage keys included in backup export and atomic restore. */
  keys: readonly string[]
  /** Optional custom schema validator for backup data. Return `false`, return an error string, or throw to reject. */
  validate?: (data: Record<string, string>) => boolean | string | void
  /** Optional human-readable summary builder for previewing a backup before restoring. */
  summary?: (data: Record<string, string>) => string
}

export type SaveBackupInspectResult =
  | {
      ok: true
      format: typeof BACKUP_FORMAT
      version: typeof BACKUP_SCHEMA_VERSION
      gameId: string
      gameVersion: number | string
      exportedAt: string
      checksum: string
      keys: string[]
      data: Record<string, string>
      summary: string
    }
  | {
      ok: false
      error: string
    }

export type SaveBackupRestoreResult =
  | {
      ok: true
      keys: string[]
      exportedAt: string
      summary: string
    }
  | {
      ok: false
      error: string
    }

export interface SaveBackupManager {
  /** Read configured keys from storage and return a formatted JSON backup envelope with integrity checksum. */
  exportBackup(): string
  /** Validate a JSON backup string and return preview metadata without modifying storage. */
  inspectBackup(jsonText: string): SaveBackupInspectResult
  /** Validate and atomically restore backup keys into storage, rolling back if any write throws. */
  restoreBackup(jsonText: string): SaveBackupRestoreResult
  /** Trigger a `.ridgetop-save.json` file download in browser environments. Returns `false` when DOM APIs are unavailable. */
  downloadBackup(filename?: string): boolean
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

/** Pure synchronous SHA-256 over UTF-8 text (zero dependencies, browser + Node + Bun + Deno). */
function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const bitLenHi = Math.floor((bytes.length * 8) / 0x100000000)
  const bitLenLo = (bytes.length * 8) >>> 0
  const paddedLen = ((bytes.length + 9 + 63) >>> 6) << 6
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(paddedLen - 8, bitLenHi, false)
  dv.setUint32(paddedLen - 4, bitLenLo, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(v => v.toString(16).padStart(8, '0'))
    .join('')
}

function computeBackupChecksum(payload: Omit<SaveBackupEnvelope, 'checksum'>): string {
  const sortedData: Record<string, string> = {}
  for (const key of Object.keys(payload.data).sort()) {
    sortedData[key] = payload.data[key]
  }
  const canonical = JSON.stringify({
    format: payload.format,
    version: payload.version,
    gameId: payload.gameId,
    gameVersion: payload.gameVersion,
    exportedAt: payload.exportedAt,
    data: sortedData
  })
  return 'sha256:' + sha256Hex(canonical)
}

function slugifyGameId(gameId: string): string {
  return gameId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ridgetop-game'
}

function defaultSummary(keys: readonly string[]): string {
  if (keys.length === 0) return 'Empty backup (0 saved keys).'
  return `Contains ${keys.length} saved ${keys.length === 1 ? 'key' : 'keys'} (${keys.join(', ')}).`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Create a reusable, game-agnostic save backup and restore manager backed by any Web Storage-compatible store.
 * Produces versioned JSON envelopes with synchronous SHA-256 integrity checksums and atomic restore rollback.
 */
export function createSaveBackup(options: SaveBackupOptions): SaveBackupManager {
  const gameId = options?.gameId
  if (typeof gameId !== 'string' || !gameId.trim()) {
    throw new RangeError('createSaveBackup requires a non-empty gameId.')
  }
  if (!Array.isArray(options.keys)) {
    throw new TypeError('createSaveBackup requires a keys array.')
  }
  const configuredKeys: string[] = []
  const allowedKeys = new Set<string>()
  for (const rawKey of options.keys) {
    if (typeof rawKey !== 'string' || !rawKey || UNSAFE_KEYS.has(rawKey)) {
      throw new RangeError('Invalid save backup key: ' + String(rawKey))
    }
    if (!allowedKeys.has(rawKey)) {
      allowedKeys.add(rawKey)
      configuredKeys.push(rawKey)
    }
  }
  const gameVersion = options.version ?? 1
  if (typeof gameVersion !== 'number' && typeof gameVersion !== 'string') {
    throw new TypeError('createSaveBackup version must be a number or string.')
  }
  const getStorage = (): SaveBackupStorage | undefined => options.storage ?? resolveStorage()

  function exportBackup(): string {
    const store = getStorage()
    const data: Record<string, string> = {}
    if (store) {
      for (const key of configuredKeys) {
        const value = store.getItem(key)
        if (typeof value === 'string') data[key] = value
      }
    }
    const base: Omit<SaveBackupEnvelope, 'checksum'> = {
      format: BACKUP_FORMAT,
      version: BACKUP_SCHEMA_VERSION,
      gameId,
      gameVersion,
      exportedAt: new Date().toISOString(),
      data
    }
    const envelope: SaveBackupEnvelope = {
      ...base,
      checksum: computeBackupChecksum(base)
    }
    return JSON.stringify(envelope, null, 2)
  }

  function inspectBackup(jsonText: string): SaveBackupInspectResult {
    if (typeof jsonText !== 'string' || !jsonText.trim()) {
      return { ok: false, error: 'Backup file is empty or not a JSON string.' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return { ok: false, error: 'Backup file is not valid JSON.' }
    }
    if (!isPlainObject(parsed)) {
      return { ok: false, error: 'Backup file has an invalid top-level structure.' }
    }
    if (parsed.format !== BACKUP_FORMAT) {
      return { ok: false, error: 'Unrecognized backup format.' }
    }
    if (parsed.version !== BACKUP_SCHEMA_VERSION) {
      return { ok: false, error: `Unsupported backup format version (${String(parsed.version)}).` }
    }
    if (parsed.gameId !== gameId) {
      return {
        ok: false,
        error: `Backup belongs to "${String(parsed.gameId ?? 'unknown')}", expected "${gameId}".`
      }
    }
    if ((typeof parsed.gameVersion !== 'number' && typeof parsed.gameVersion !== 'string') ||
        (typeof parsed.gameVersion === 'number' && !Number.isFinite(parsed.gameVersion))) {
      return { ok: false, error: 'Backup is missing a valid gameVersion.' }
    }
    if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt.trim()) {
      return { ok: false, error: 'Backup is missing a valid exportedAt timestamp.' }
    }
    if (typeof parsed.checksum !== 'string' || !parsed.checksum.trim()) {
      return { ok: false, error: 'Backup is missing an integrity checksum.' }
    }
    if (!isPlainObject(parsed.data)) {
      return { ok: false, error: 'Backup data payload must be a plain object.' }
    }

    const cleanData: Record<string, string> = {}
    const dataKeys: string[] = []
    for (const [key, value] of Object.entries(parsed.data)) {
      if (UNSAFE_KEYS.has(key) || !allowedKeys.has(key)) {
        return { ok: false, error: `Backup contains unexpected storage key "${key}".` }
      }
      if (typeof value !== 'string') {
        return { ok: false, error: `Backup value for key "${key}" must be a string.` }
      }
      cleanData[key] = value
      dataKeys.push(key)
    }

    const expectedChecksum = computeBackupChecksum({
      format: BACKUP_FORMAT,
      version: BACKUP_SCHEMA_VERSION,
      gameId,
      gameVersion: parsed.gameVersion,
      exportedAt: parsed.exportedAt,
      data: cleanData
    })
    if (parsed.checksum !== expectedChecksum) {
      return { ok: false, error: 'Backup checksum mismatch; the file may be corrupted or modified.' }
    }

    if (options.validate) {
      try {
        const verdict = options.validate({ ...cleanData })
        if (verdict === false) {
          return { ok: false, error: 'Backup data failed schema validation.' }
        }
        if (typeof verdict === 'string' && verdict.trim()) {
          return { ok: false, error: verdict }
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    let summaryText = defaultSummary(dataKeys)
    if (options.summary) {
      try {
        const custom = options.summary({ ...cleanData })
        if (typeof custom === 'string' && custom.trim()) summaryText = custom
      } catch {
        // Keep default summary if caller summary helper throws.
      }
    }

    return {
      ok: true,
      format: BACKUP_FORMAT,
      version: BACKUP_SCHEMA_VERSION,
      gameId,
      gameVersion: parsed.gameVersion,
      exportedAt: parsed.exportedAt,
      checksum: parsed.checksum,
      keys: dataKeys,
      data: cleanData,
      summary: summaryText
    }
  }

  function restoreBackup(jsonText: string): SaveBackupRestoreResult {
    const inspected = inspectBackup(jsonText)
    if (!inspected.ok) return inspected

    const store = getStorage()
    if (!store) {
      return { ok: false, error: 'Save storage is not available.' }
    }

    const previous = new Map<string, string | null>()
    try {
      for (const key of configuredKeys) {
        previous.set(key, store.getItem(key))
      }
    } catch (error) {
      return {
        ok: false,
        error: 'Failed to snapshot current storage before restore: ' + (error instanceof Error ? error.message : String(error))
      }
    }

    try {
      for (const key of configuredKeys) {
        if (Object.hasOwn(inspected.data, key)) {
          store.setItem(key, inspected.data[key])
        } else if (previous.get(key) !== null) {
          store.removeItem(key)
        }
      }
    } catch (error) {
      for (const [key, prev] of previous) {
        try {
          if (prev === null) store.removeItem(key)
          else store.setItem(key, prev)
        } catch {
          // Best-effort rollback for remaining keys.
        }
      }
      return {
        ok: false,
        error: 'Failed to write restored save data: ' + (error instanceof Error ? error.message : String(error))
      }
    }

    return {
      ok: true,
      keys: inspected.keys,
      exportedAt: inspected.exportedAt,
      summary: inspected.summary
    }
  }

  function downloadBackup(filename?: string): boolean {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' ||
        typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return false
    }
    const json = exportBackup()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename && filename.trim() ? filename : `${slugifyGameId(gameId)}.ridgetop-save.json`
    const container = document.body ?? document.documentElement
    container?.append(link)
    link.click()
    link.remove()
    const schedule = typeof globalThis.setTimeout === 'function' ? globalThis.setTimeout : undefined
    if (schedule && typeof URL.revokeObjectURL === 'function') {
      schedule(() => URL.revokeObjectURL(url), 1000)
    } else if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
    return true
  }

  return {
    exportBackup,
    inspectBackup,
    restoreBackup,
    downloadBackup
  }
}
