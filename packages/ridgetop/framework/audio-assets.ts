export interface ParsedWav {
  readonly sampleRate: number
  readonly channels: number
  readonly bitsPerSample: number
  readonly format: 'pcm' | 'float'
  readonly duration: number
  /** Mono samples (for stereo/multi-channel WAVs, downmixed to mono; for mono, identical to `channelData[0]`). */
  readonly samples: Float32Array
  /** Per-channel floating-point PCM sample arrays in [-1, 1]. */
  readonly channelData: readonly Float32Array[]
}

export interface AudioBankOptions {
  context?: AudioContext
  destination?: AudioNode
  buses?: Partial<Record<string, AudioNode>>
  fetch?: typeof globalThis.fetch
}

export interface AudioPlayOptions {
  volume?: number
  rate?: number
  loop?: boolean
  detune?: number
  bus?: string | AudioNode
  offset?: number
  duration?: number
}

export interface AudioPlayHandle {
  stop(): void
  readonly playing: boolean
}

export interface AudioBank {
  load(name: string, source: string | URL | ArrayBuffer | Uint8Array): Promise<boolean>
  loadAll(
    entries:
      | Record<string, string | URL | ArrayBuffer | Uint8Array>
      | Iterable<readonly [string, string | URL | ArrayBuffer | Uint8Array]>
  ): Promise<Record<string, boolean>>
  play(name: string, options?: AudioPlayOptions): AudioPlayHandle
  stopAll(): void
  has(name: string): boolean
  names(): string[]
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  dispose(): void
}

function asciiAt(u8: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(u8[offset + i])
  return out
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  throw new TypeError('Expected a Uint8Array or ArrayBuffer')
}

/**
 * Parse a standard RIFF WAVE (`.wav`) buffer containing integer PCM (8/16/24/32-bit)
 * or IEEE float (32/64-bit) samples. Round-trips cleanly with Ridgetop's `encodeWav`.
 */
export function parseWav(bytes: Uint8Array | ArrayBuffer): ParsedWav {
  const u8 = toUint8Array(bytes)
  if (u8.byteLength < 12) {
    throw new RangeError('WAV buffer is too short to contain a valid RIFF header')
  }
  if (asciiAt(u8, 0, 4) !== 'RIFF' || asciiAt(u8, 8, 4) !== 'WAVE') {
    throw new RangeError('Invalid WAV header (expected RIFF/WAVE)')
  }

  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let formatTag = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let hasFmt = false
  let dataStart = -1
  let dataSize = 0

  let offset = 12
  while (offset + 8 <= u8.byteLength) {
    const id = asciiAt(u8, offset, 4)
    const size = dv.getUint32(offset + 4, true)
    const bodyStart = offset + 8
    if (bodyStart + size > u8.byteLength) {
      throw new RangeError(`WAV chunk "${id}" exceeds buffer length`)
    }

    if (id === 'fmt ') {
      if (size < 16) throw new RangeError('WAV fmt chunk is truncated')
      formatTag = dv.getUint16(bodyStart, true)
      channels = dv.getUint16(bodyStart + 2, true)
      sampleRate = dv.getUint32(bodyStart + 4, true)
      bitsPerSample = dv.getUint16(bodyStart + 14, true)
      if (formatTag === 0xfffe && size >= 40) {
        formatTag = dv.getUint16(bodyStart + 24, true)
      }
      hasFmt = true
    } else if (id === 'data') {
      dataStart = bodyStart
      dataSize = size
    }

    offset = bodyStart + size + (size % 2)
  }

  if (!hasFmt) throw new RangeError('WAV file is missing a fmt chunk')
  if (dataStart < 0) throw new RangeError('WAV file is missing a data chunk')
  if (channels < 1 || sampleRate < 1) {
    throw new RangeError(`Invalid WAV format parameters (channels=${channels}, sampleRate=${sampleRate})`)
  }
  if (formatTag !== 1 && formatTag !== 3) {
    throw new RangeError(`Unsupported WAV audio format tag ${formatTag} (expected PCM=1 or IEEE float=3)`)
  }

  const bytesPerSample = bitsPerSample / 8
  const validPcm = formatTag === 1 && (bitsPerSample === 8 || bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32)
  const validFloat = formatTag === 3 && (bitsPerSample === 32 || bitsPerSample === 64)
  if (!validPcm && !validFloat) {
    throw new RangeError(`Unsupported WAV bit depth ${bitsPerSample} for format ${formatTag}`)
  }

  const frameStride = channels * bytesPerSample
  if (dataSize % frameStride !== 0) {
    throw new RangeError('WAV data chunk length is not aligned to sample frames')
  }
  const frameCount = dataSize / frameStride
  const channelData: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frameCount))

  for (let frame = 0; frame < frameCount; frame++) {
    const frameOffset = dataStart + frame * frameStride
    for (let ch = 0; ch < channels; ch++) {
      const sampleOffset = frameOffset + ch * bytesPerSample
      let sample = 0
      if (formatTag === 1) {
        if (bitsPerSample === 8) {
          sample = (dv.getUint8(sampleOffset) - 128) / 128
        } else if (bitsPerSample === 16) {
          const raw = dv.getInt16(sampleOffset, true)
          sample = Math.max(-1, raw / 32767)
        } else if (bitsPerSample === 24) {
          const b0 = u8[sampleOffset]
          const b1 = u8[sampleOffset + 1]
          const b2 = u8[sampleOffset + 2]
          const raw = (b0 | (b1 << 8) | (b2 << 16))
          const signed = raw & 0x800000 ? raw | ~0xffffff : raw
          sample = Math.max(-1, signed / 8388607)
        } else {
          const raw = dv.getInt32(sampleOffset, true)
          sample = Math.max(-1, raw / 2147483647)
        }
      } else {
        sample = bitsPerSample === 32
          ? dv.getFloat32(sampleOffset, true)
          : dv.getFloat64(sampleOffset, true)
      }
      channelData[ch][frame] = sample
    }
  }

  let samples: Float32Array
  if (channels === 1) {
    samples = channelData[0]
  } else {
    samples = new Float32Array(frameCount)
    const inv = 1 / channels
    for (let i = 0; i < frameCount; i++) {
      let sum = 0
      for (let ch = 0; ch < channels; ch++) sum += channelData[ch][i]
      samples[i] = sum * inv
    }
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    format: formatTag === 3 ? 'float' : 'pcm',
    duration: frameCount / sampleRate,
    samples,
    channelData
  }
}

const NOOP_HANDLE: AudioPlayHandle = {
  stop() {},
  get playing() { return false }
}

function copyToArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength)
    copy.set(input)
    return copy.buffer
  }
  return input.slice(0)
}

function decodeAudio(ctx: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false
    const onResolve = (buf: AudioBuffer) => {
      if (!settled) {
        settled = true
        resolve(buf)
      }
    }
    const onReject = (err: unknown) => {
      if (!settled) {
        settled = true
        reject(err)
      }
    }
    try {
      const maybePromise = ctx.decodeAudioData(arrayBuffer, onResolve, onReject)
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(onResolve, onReject)
      }
    } catch (error) {
      onReject(error)
    }
  })
}

function isAudioNodeLike(value: unknown): value is AudioNode {
  return typeof value === 'object' && value !== null && 'connect' in value
}

/**
 * External `.wav`/`.ogg`/`.mp3` audio bank with Web Audio decoding, caching,
 * bus routing, looping, pitch/detune controls, and headless-safe fallbacks.
 */
export function createAudioBank(options: AudioBankOptions = {}): AudioBank {
  let ctx: AudioContext | null = options.context ?? null
  const ownsContext = !options.context
  let masterGain: GainNode | null = null
  let masterVolume = 1
  let muted = false
  let disposed = false

  const buffers = new Map<string, AudioBuffer>()
  const pending = new Map<string, Promise<boolean>>()
  const active = new Set<AudioPlayHandle>()
  const buses = options.buses ?? {}

  function ensureContext(): AudioContext | null {
    if (disposed) return null
    if (!ctx) {
      const AudioCtor = globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtor) return null
      try {
        ctx = new AudioCtor()
      } catch {
        return null
      }
    }
    if (!masterGain && typeof ctx.createGain === 'function') {
      try {
        masterGain = ctx.createGain()
        masterGain.gain.value = muted ? 0 : masterVolume
        const target = options.destination ?? ctx.destination
        if (target) masterGain.connect(target)
      } catch {
        masterGain = null
      }
    }
    return ctx
  }

  async function load(name: string, source: string | URL | ArrayBuffer | Uint8Array): Promise<boolean> {
    if (disposed) return false
    if (buffers.has(name)) return true
    const inFlight = pending.get(name)
    if (inFlight) return inFlight

    const audioCtx = ensureContext()
    if (!audioCtx || typeof audioCtx.decodeAudioData !== 'function') return false

    const task = (async () => {
      try {
        let rawBuffer: ArrayBuffer
        if (typeof source === 'string' || source instanceof URL) {
          const fetcher = options.fetch ?? globalThis.fetch
          if (typeof fetcher !== 'function') return false
          const response = await fetcher(source)
          if (!response.ok) return false
          rawBuffer = await response.arrayBuffer()
        } else {
          rawBuffer = copyToArrayBuffer(source)
        }
        if (disposed) return false
        const decoded = await decodeAudio(audioCtx, copyToArrayBuffer(rawBuffer))
        if (disposed || !decoded) return false
        buffers.set(name, decoded)
        return true
      } catch {
        return false
      } finally {
        pending.delete(name)
      }
    })()

    pending.set(name, task)
    return task
  }

  async function loadAll(
    entries:
      | Record<string, string | URL | ArrayBuffer | Uint8Array>
      | Iterable<readonly [string, string | URL | ArrayBuffer | Uint8Array]>
  ): Promise<Record<string, boolean>> {
    const pairs: [string, string | URL | ArrayBuffer | Uint8Array][] =
      Symbol.iterator in Object(entries)
        ? Array.from(entries as Iterable<readonly [string, string | URL | ArrayBuffer | Uint8Array]>).map(([k, v]) => [k, v])
        : Object.entries(entries as Record<string, string | URL | ArrayBuffer | Uint8Array>)

    const results: Record<string, boolean> = {}
    await Promise.all(pairs.map(async ([name, source]) => {
      results[name] = await load(name, source)
    }))
    return results
  }

  function play(name: string, playOptions: AudioPlayOptions = {}): AudioPlayHandle {
    if (disposed) return NOOP_HANDLE
    const buffer = buffers.get(name)
    const audioCtx = ensureContext()
    if (!buffer || !audioCtx || typeof audioCtx.createBufferSource !== 'function') {
      return NOOP_HANDLE
    }

    try {
      if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
        audioCtx.resume().catch(() => {})
      }

      const source = audioCtx.createBufferSource()
      source.buffer = buffer
      source.loop = Boolean(playOptions.loop)

      const rate = playOptions.rate ?? 1
      if (source.playbackRate && Number.isFinite(rate) && rate > 0) {
        source.playbackRate.value = rate
      }
      const detune = playOptions.detune ?? 0
      if (source.detune && Number.isFinite(detune) && detune !== 0) {
        source.detune.value = detune
      }

      const volume = playOptions.volume ?? 1
      const gain = typeof audioCtx.createGain === 'function' ? audioCtx.createGain() : null
      if (gain) {
        gain.gain.value = Number.isFinite(volume) ? Math.max(0, volume) : 1
      }

      let dest: AudioNode | null = null
      if (isAudioNodeLike(playOptions.bus)) {
        dest = playOptions.bus
      } else if (typeof playOptions.bus === 'string' && buses[playOptions.bus]) {
        dest = buses[playOptions.bus] ?? null
      } else {
        dest = masterGain ?? options.destination ?? audioCtx.destination ?? null
      }

      if (gain && dest) {
        source.connect(gain)
        gain.connect(dest)
      } else if (dest) {
        source.connect(dest)
      }

      let isPlaying = true
      const cleanup = () => {
        if (!isPlaying) return
        isPlaying = false
        active.delete(handle)
        try { source.disconnect() } catch { /* ignore */ }
        try { gain?.disconnect() } catch { /* ignore */ }
      }

      const handle: AudioPlayHandle = {
        stop() {
          if (!isPlaying) return
          cleanup()
          try { source.stop() } catch { /* already stopped */ }
        },
        get playing() { return isPlaying }
      }

      source.onended = cleanup
      active.add(handle)

      const offset = playOptions.offset !== undefined && Number.isFinite(playOptions.offset)
        ? Math.max(0, playOptions.offset)
        : 0
      try {
        if (playOptions.duration !== undefined && Number.isFinite(playOptions.duration) && playOptions.duration >= 0) {
          source.start(0, offset, playOptions.duration)
        } else if (offset > 0) {
          source.start(0, offset)
        } else {
          source.start(0)
        }
      } catch {
        cleanup()
        return NOOP_HANDLE
      }

      return handle
    } catch {
      return NOOP_HANDLE
    }
  }

  function stopAll() {
    for (const handle of [...active]) {
      handle.stop()
    }
    active.clear()
  }

  function setVolume(volume: number) {
    masterVolume = Number.isFinite(volume) ? Math.max(0, volume) : 1
    if (masterGain) masterGain.gain.value = muted ? 0 : masterVolume
  }

  function setMuted(value: boolean) {
    muted = Boolean(value)
    if (masterGain) masterGain.gain.value = muted ? 0 : masterVolume
  }

  function dispose() {
    if (disposed) return
    disposed = true
    stopAll()
    buffers.clear()
    pending.clear()
    try { masterGain?.disconnect() } catch { /* ignore */ }
    masterGain = null
    if (ownsContext && ctx && typeof ctx.close === 'function') {
      try {
        const res = ctx.close()
        if (res && typeof res.catch === 'function') res.catch(() => {})
      } catch { /* ignore */ }
    }
    ctx = null
  }

  return {
    load,
    loadAll,
    play,
    stopAll,
    has(name: string) { return buffers.has(name) },
    names() { return [...buffers.keys()] },
    setVolume,
    setMuted,
    dispose
  }
}
