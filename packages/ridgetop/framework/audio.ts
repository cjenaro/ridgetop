export function createSynthAudio<Name extends string>(motifs: Record<Name, readonly (readonly [number, number, number, number?])[]>,
  { volume = .22, waveform = {} }: { volume?: number; waveform?: Partial<Record<Name, OscillatorType>> } = {}) {
  let muted = false
  let context: AudioContext | undefined
  let output: GainNode | undefined
  return {
    unlock() {
      const Audio = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Audio) return
      try {
        if (!context) {
          context = new Audio()
          output = context.createGain()
          output.gain.value = muted ? 0 : volume
          output.connect(context.destination)
        }
        if (context.state !== 'running') context.resume().catch(() => {})
      } catch { /* Sound is optional. */ }
    },
    play(name: Name) {
      if (muted || !context || !output || context.state !== 'running') return
      for (const [frequency, duration, delay, endFrequency] of motifs[name] ?? []) {
        if (!(duration > 0)) continue
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        const at = context.currentTime + delay
        const attack = Math.min(.015, duration * .5)
        oscillator.type = waveform[name] ?? 'sine'
        oscillator.frequency.setValueAtTime(frequency, at)
        if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration)
        envelope.gain.setValueAtTime(.001, at)
        envelope.gain.exponentialRampToValueAtTime(.25, at + attack)
        envelope.gain.exponentialRampToValueAtTime(.001, at + duration)
        oscillator.connect(envelope)
        envelope.connect(output)
        oscillator.start(at)
        oscillator.stop(at + duration)
        oscillator.onended = () => {
          oscillator.disconnect()
          envelope.disconnect()
        }
      }
    },
    mute(value: boolean) {
      muted = value
      if (output) output.gain.value = muted ? 0 : volume
    },
    suspend() { context?.suspend?.().catch(() => {}) },
    resume() {
      if (!muted && context?.state === 'suspended') context.resume().catch(() => {})
    },
    close() {
      const active = context
      context = undefined
      output = undefined
      active?.close().catch(() => {})
    }
  }
}

export type AudioBus = 'music' | 'sfx' | 'ambience'

export interface NoiseBedSpec {
  readonly type: BiquadFilterType
  readonly frequency: number
  readonly q?: number
  readonly gain?: number
}

/**
 * Multi-bus Web Audio soundscape & procedural music/SFX mixer (master, music, sfx, ambience)
 * with built-in pink-noise ambience beds, filtered noise bursts, and a step-sequencer primitive.
 */
export function createSoundscape({
  master = 0.72,
  music = 0.16,
  sfx = 0.28,
  musicCutoff = 1800,
  beds = {}
}: {
  master?: number
  music?: number
  sfx?: number
  musicCutoff?: number
  beds?: Record<string, NoiseBedSpec>
} = {}) {
  let ctx: AudioContext | null = null
  let masterGain: GainNode | null = null
  let musicGain: GainNode | null = null
  let musicFilter: BiquadFilterNode | null = null
  let sfxGain: GainNode | null = null
  let ambienceGain: GainNode | null = null
  const bedNodes = new Map<string, { filter: BiquadFilterNode; gain: GainNode }>()
  let muted = false
  let musicEnabled = true
  let musicVolume = music

  function createNoiseBuffer(audioCtx: AudioContext, seconds = 2): AudioBuffer {
    const length = Math.max(1, Math.floor(audioCtx.sampleRate * seconds))
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate)
    const data = buffer.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1
      b0 = 0.997 * b0 + white * 0.029
      b1 = 0.985 * b1 + white * 0.032
      b2 = 0.950 * b2 + white * 0.048
      data[i] = (b0 + b1 + b2 + white * 0.18) * 0.65
    }
    return buffer
  }

  function busNode(bus: AudioBus): AudioNode | null {
    if (bus === 'music') return musicFilter
    if (bus === 'ambience') return ambienceGain
    return sfxGain
  }

  return {
    get running() { return ctx?.state === 'running' },
    unlock() {
      const AudioCtor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtor) return
      try {
        if (!ctx) {
          ctx = new AudioCtor()
          masterGain = ctx.createGain()
          masterGain.gain.value = muted ? 0 : master
          masterGain.connect(ctx.destination)

          musicFilter = ctx.createBiquadFilter()
          musicFilter.type = 'lowpass'
          musicFilter.frequency.value = musicCutoff
          musicGain = ctx.createGain()
          musicGain.gain.value = musicEnabled && !muted ? musicVolume : 0
          musicFilter.connect(musicGain)
          musicGain.connect(masterGain)

          sfxGain = ctx.createGain()
          sfxGain.gain.value = sfx
          sfxGain.connect(masterGain)

          ambienceGain = ctx.createGain()
          ambienceGain.gain.value = 1
          ambienceGain.connect(masterGain)

          const entries = Object.entries(beds)
          if (entries.length) {
            const sharedNoise = createNoiseBuffer(ctx, 2)
            for (const [id, spec] of entries) {
              const src = ctx.createBufferSource()
              src.buffer = sharedNoise
              src.loop = true
              const filter = ctx.createBiquadFilter()
              filter.type = spec.type
              filter.frequency.value = spec.frequency
              filter.Q.value = spec.q ?? 0.7
              const gain = ctx.createGain()
              gain.gain.value = spec.gain ?? 0
              src.connect(filter)
              filter.connect(gain)
              gain.connect(ambienceGain)
              src.start()
              bedNodes.set(id, { filter, gain })
            }
          }
        }
        if (ctx.state !== 'running') ctx.resume().catch(() => {})
      } catch { /* Sound is optional in headless or restricted environments. */ }
    },
    tone({
      frequency,
      duration,
      type = 'triangle',
      volume = 0.28,
      delay = 0,
      endFrequency,
      bus = 'sfx'
    }: {
      frequency: number
      duration: number
      type?: OscillatorType
      volume?: number
      delay?: number
      endFrequency?: number
      bus?: AudioBus
    }) {
      if (muted || !ctx || ctx.state !== 'running' || !(frequency > 0) || !(duration > 0)) return
      if (bus === 'music' && !musicEnabled) return
      const dest = busNode(bus)
      if (!dest) return
      const now = ctx.currentTime + delay
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(frequency, now)
      if (endFrequency && endFrequency > 0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration)
      }
      const attack = Math.min(0.025, duration * 0.25)
      env.gain.setValueAtTime(0.0008, now)
      env.gain.exponentialRampToValueAtTime(Math.max(0.002, volume), now + attack)
      env.gain.exponentialRampToValueAtTime(0.0008, now + duration)
      osc.connect(env)
      env.connect(dest)
      osc.start(now)
      osc.stop(now + duration + 0.02)
      osc.onended = () => { osc.disconnect(); env.disconnect() }
    },
    noiseBurst({
      duration,
      frequency = 800,
      type = 'bandpass',
      volume = 0.2,
      bus = 'sfx'
    }: {
      duration: number
      frequency?: number
      type?: BiquadFilterType
      volume?: number
      bus?: AudioBus
    }) {
      if (muted || !ctx || ctx.state !== 'running' || !(duration > 0)) return
      const dest = busNode(bus)
      if (!dest) return
      const length = Math.max(1, Math.floor(ctx.sampleRate * duration))
      const buf = ctx.createBuffer(1, length, ctx.sampleRate)
      const ch = buf.getChannelData(0)
      for (let i = 0; i < length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / length)
      const src = ctx.createBufferSource()
      src.buffer = buf
      const filter = ctx.createBiquadFilter()
      filter.type = type
      filter.frequency.value = frequency
      const env = ctx.createGain()
      const now = ctx.currentTime
      env.gain.setValueAtTime(Math.max(0.002, volume), now)
      env.gain.exponentialRampToValueAtTime(0.001, now + duration)
      src.connect(filter)
      filter.connect(env)
      env.connect(dest)
      src.start(now)
      src.onended = () => { src.disconnect(); filter.disconnect(); env.disconnect() }
    },
    setBed(id: string, { gain, frequency, ramp = 0.2 }: { gain?: number; frequency?: number; ramp?: number }) {
      const node = bedNodes.get(id)
      if (!node || !ctx || ctx.state !== 'running') return
      const now = ctx.currentTime
      if (gain !== undefined) node.gain.gain.setTargetAtTime(Math.max(0, gain), now, ramp)
      if (frequency !== undefined) node.filter.frequency.setTargetAtTime(Math.max(20, frequency), now, ramp)
    },
    setMusicFilter(frequency: number, ramp = 0.3) {
      if (musicFilter && ctx && ctx.state === 'running') {
        musicFilter.frequency.setTargetAtTime(Math.max(60, frequency), ctx.currentTime, ramp)
      }
    },
    setMusicVolume(value: number, ramp = 0.15) {
      musicVolume = Math.max(0, value)
      if (musicGain && ctx) {
        musicGain.gain.setTargetAtTime(musicEnabled && !muted ? musicVolume : 0, ctx.currentTime, ramp)
      }
    },
    setMuted(value: boolean) {
      muted = value
      if (masterGain && ctx) masterGain.gain.setTargetAtTime(muted ? 0 : master, ctx.currentTime, 0.05)
    },
    isMuted: () => muted,
    setMusicEnabled(value: boolean) {
      musicEnabled = value
      if (musicGain && ctx) musicGain.gain.setTargetAtTime(musicEnabled && !muted ? musicVolume : 0, ctx.currentTime, 0.08)
    },
    isMusicEnabled: () => musicEnabled,
    suspend() { ctx?.suspend().catch(() => {}) },
    resume() { if (!muted && ctx?.state === 'suspended') ctx.resume().catch(() => {}) },
    close() {
      const active = ctx
      ctx = null
      masterGain = musicGain = sfxGain = ambienceGain = null
      musicFilter = null
      bedNodes.clear()
      active?.close().catch(() => {})
    }
  }
}
