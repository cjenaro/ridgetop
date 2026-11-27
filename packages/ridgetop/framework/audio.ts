import {
  createAudioBank,
  NOOP_PLAY_HANDLE
} from './audio-assets.ts'
import type {
  AudioBank,
  AudioBankOptions,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioPlayHandle,
  AudioPlayOptions,
  AudioSampleSource,
  BiquadFilterNodeLike,
  GainNodeLike
} from './audio-assets.ts'

export type {
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioSampleSource,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike
} from './audio-assets.ts'

declare global {
  var webkitAudioContext: typeof AudioContext | undefined
  interface Navigator {
    audioSession?: { type: string }
  }
}

export type AudioBus = 'music' | 'sfx' | 'ambience'
export type SoundscapeBus = AudioBus | 'master'

export type SynthWaveform = 'sine' | 'triangle' | 'square' | 'sawtooth'

/**
 * Single synth note tuple compatible with `bakeMotifWav`:
 * `[frequencyHz, durationSec, delaySec, endFrequencyHz?]`.
 */
export type MotifNote = readonly [number, number, number, number?]

/**
 * Declarative synth motif shared between runtime playback (`createSoundscape`, `createSynthAudio`)
 * and build-time WAV baking (`bakeMotifWav` / `ResolvedGameAssets['audio']`).
 */
export interface AudioMotif {
  readonly notes: readonly MotifNote[]
  readonly waveform?: SynthWaveform
  readonly volume?: number
  /** Alias for `volume` when authoring gain-style specs. */
  readonly gain?: number
  readonly bus?: AudioBus
}

export type MotifInput = readonly MotifNote[] | AudioMotif

export interface PlayMotifOptions {
  /** Pitch multiplier applied to every note's frequency and endFrequency (default `1`). */
  pitch?: number
  /** Explicit base volume override (replaces the motif's `volume`/`gain`). */
  volume?: number
  /** Multiplier applied on top of the resolved volume (default `1`). */
  volumeScale?: number
  /** Override waveform for this playback. */
  waveform?: OscillatorType
  /** Override output bus (`'sfx' | 'music' | 'ambience'`). */
  bus?: AudioBus
  /** Extra delay in seconds added to every note's delay (default `0`). */
  delay?: number
}

export interface ToneOptions {
  frequency: number
  duration: number
  type?: OscillatorType
  volume?: number
  delay?: number
  endFrequency?: number
  bus?: AudioBus
}

export interface NoiseBurstOptions {
  duration: number
  frequency?: number
  type?: BiquadFilterType
  volume?: number
  delay?: number
  bus?: AudioBus
}

export interface NoiseBedSpec {
  readonly type: BiquadFilterType
  readonly frequency: number
  readonly q?: number
  readonly gain?: number
}

export interface SynthAudioOptions<Name extends string = string> {
  volume?: number
  waveform?: Partial<Record<Name, OscillatorType>>
  /** Optional injectable `AudioContext` factory for Node tests or custom Web Audio adapters. */
  createContext?: () => AudioContextLike
  /** Optional externally owned `AudioContext` to attach to instead of creating one. */
  context?: AudioContextLike
}

export interface SynthAudio<Name extends string = string> {
  unlock(): void
  play(name: Name, options?: PlayMotifOptions): void
  mute(value: boolean): void
  suspend(): void
  resume(): void
  close(): void
}

export interface SequencerTrack {
  /** Note frequencies in Hz (`0` or `null` = rest). */
  readonly notes: readonly (number | null)[]
  /** Play once every `divide` sequencer steps (default `1`). E.g. `2` for half-time bass. */
  readonly divide?: number
  /** Step offset within `divide` (default `0`). */
  readonly phase?: number
  /** Oscillator waveform (default `'triangle'`). */
  readonly waveform?: OscillatorType
  /** Note volume (default `0.25`). */
  readonly volume?: number
  /** Note duration as a multiple of `stepDuration` (default `1.15`). */
  readonly gate?: number
  /** Output bus (default `'music'`). */
  readonly bus?: AudioBus
}

export interface StepSequencerStepEvent {
  readonly stepIndex: number
  readonly stepDuration: number
  readonly melodyNote: number
  readonly bassNote: number
}

export interface StepSequencerOptions {
  /** Duration of one step in seconds (default `0.3`). Alternatively specify `bpm` + `stepsPerBeat`. */
  stepDuration?: number
  /** Optional tempo in beats per minute (used when `stepDuration` is omitted). */
  bpm?: number
  /** Steps per beat when using `bpm` (default `2`, i.e. eighth notes). */
  stepsPerBeat?: number
  /** Primary melody track (array of Hz where 0/null is a rest, or a full `SequencerTrack`). */
  melody?: readonly (number | null)[] | SequencerTrack
  /** Secondary bass track (defaults to `divide: 2`, `gate: 1.75`, `waveform: 'triangle'`, `volume: 0.26`). */
  bass?: readonly (number | null)[] | SequencerTrack
  /** Additional arbitrary tracks (harmony, arpeggio, percussion, etc.). */
  tracks?: readonly SequencerTrack[]
  /** Optional total pattern step wrap length (defaults to natural LCM of track lengths). */
  length?: number
  /** Default output bus for tracks that don't specify one (default `'music'`). */
  bus?: AudioBus
  /** Maximum steps triggered in a single `step(dt)` call to prevent tab-switch bursts (default `4`). */
  maxStepsPerTick?: number
  /** Optional hook invoked on each fired step (e.g. for harmonies or percussive hits). */
  onStep?: (event: StepSequencerStepEvent) => void
}

export interface StepSequencerStepOverrides {
  stepDuration?: number
  bpm?: number
  stepsPerBeat?: number
  melody?: readonly (number | null)[] | SequencerTrack
  bass?: readonly (number | null)[] | SequencerTrack
  tracks?: readonly SequencerTrack[]
  melodyWaveform?: OscillatorType
  bassWaveform?: OscillatorType
  onStep?: (event: StepSequencerStepEvent) => void
}

export interface StepSequencerTarget {
  readonly running: boolean
  isMuted(): boolean
  isMusicEnabled(): boolean
  tone(options: ToneOptions): void
}

export interface StepSequencer {
  /** Advance sequencer time by `dt` seconds. Returns how many steps fired. */
  step(dt: number, overrides?: StepSequencerStepOverrides): number
  /** Reset step index and accumulated time to `0`. */
  reset(): void
  readonly stepIndex: number
  readonly elapsed: number
}

export type SoundscapeBuses = {
  readonly master: GainNodeLike
  readonly music: BiquadFilterNodeLike
  readonly sfx: GainNodeLike
  readonly ambience: GainNodeLike
}

export interface SoundscapeSamplePlayOptions extends Omit<AudioPlayOptions, 'bus'> {
  bus?: SoundscapeBus | AudioNodeLike
}

export interface SoundscapeOptions<MotifName extends string = string> {
  master?: number
  music?: number
  sfx?: number
  ambience?: number
  musicCutoff?: number
  beds?: Record<string, NoiseBedSpec>
  /** Optional declarative synth motifs playable by name via `playMotif(name, opts?)`. */
  motifs?: Readonly<Record<MotifName, MotifInput>>
  /** Optional injectable `AudioContext` factory for Node tests or custom Web Audio adapters. */
  createContext?: () => AudioContextLike
  /** Optional externally owned `AudioContext` to attach to instead of creating one. */
  context?: AudioContextLike
  /** Optional injectable `fetch` implementation used when loading audio samples from URLs. */
  fetch?: typeof globalThis.fetch
}

export interface Soundscape<MotifName extends string = string> extends StepSequencerTarget {
  readonly running: boolean
  readonly context: AudioContextLike | null
  readonly buses: SoundscapeBuses | null
  unlock(): void
  tone(options: ToneOptions): void
  playMotif(motif: MotifName | MotifInput, options?: PlayMotifOptions): void
  noiseBurst(options: NoiseBurstOptions): void
  setBed(id: string, options: { gain?: number; frequency?: number; ramp?: number }): void
  setMusicFilter(frequency: number, ramp?: number): void
  setMusicVolume(value: number, ramp?: number): void
  setSfxVolume(value: number, ramp?: number): void
  setAmbienceVolume(value: number, ramp?: number): void
  setMuted(value: boolean): void
  isMuted(): boolean
  setMusicEnabled(value: boolean): void
  isMusicEnabled(): boolean
  createSequencer(options?: StepSequencerOptions): StepSequencer
  createBank(options?: Omit<AudioBankOptions, 'context' | 'getContext' | 'destination' | 'getDestination' | 'buses' | 'getBuses'>): AudioBank
  loadSample(name: string, source: AudioSampleSource): Promise<boolean>
  loadSamples(
    entries:
      | Record<string, AudioSampleSource>
      | Iterable<readonly [string, AudioSampleSource]>
  ): Promise<Record<string, boolean>>
  playSample(name: string, options?: SoundscapeSamplePlayOptions): AudioPlayHandle
  hasSample(name: string): boolean
  stopSamples(): void
  suspend(): void
  resume(): void
  close(): void
}

function configurePlaybackAudioSession() {
  try {
    const audioSession = globalThis.navigator?.audioSession
    if (audioSession && audioSession.type !== 'playback') {
      audioSession.type = 'playback'
    }
  } catch { /* Audio Session API is optional or may be read-only in some environments. */ }
}

function resolveAudioContext(createContext?: () => AudioContextLike): AudioContextLike | null {
  if (createContext) return createContext()
  const AudioCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext
  return AudioCtor ? new AudioCtor() : null
}

function isMotifObject(input: MotifInput): input is AudioMotif {
  return !Array.isArray(input)
}

function normalizeMotif(input: MotifInput): AudioMotif {
  return isMotifObject(input) ? input : { notes: input }
}

function setAudioParam(param: AudioParamLike, value: number, time: number, ramp = 0) {
  if (ramp > 0 && typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, ramp)
  } else if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(value, time)
  } else {
    param.value = value
  }
}

interface ScheduledToneParams {
  frequency: number
  duration: number
  type: OscillatorType
  volume: number
  delay: number
  endFrequency?: number
  attackCap: number
  attackRatio: number
  floor: number
  minPeak: number
  minEndFrequency: number
  stopTail: number
}

function scheduleTone(ctx: AudioContextLike, dest: AudioNodeLike, params: ScheduledToneParams) {
  if (typeof ctx.createOscillator !== 'function') return
  if (!(params.frequency > 0) || !Number.isFinite(params.frequency)) return
  if (!(params.duration > 0) || !Number.isFinite(params.duration)) return
  const delay = Number.isFinite(params.delay) ? Math.max(0, params.delay) : 0
  const at = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  const attack = Math.min(params.attackCap, params.duration * params.attackRatio)

  osc.type = params.type
  if (typeof osc.frequency.setValueAtTime === 'function') {
    osc.frequency.setValueAtTime(params.frequency, at)
  } else {
    osc.frequency.value = params.frequency
  }
  if (params.endFrequency !== undefined && Number.isFinite(params.endFrequency) && params.endFrequency > 0) {
    const targetFreq = Math.max(params.minEndFrequency, params.endFrequency)
    if (typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      osc.frequency.exponentialRampToValueAtTime(targetFreq, at + params.duration)
    }
  }

  const peak = Math.max(params.minPeak, params.volume)
  if (typeof env.gain.setValueAtTime === 'function') {
    env.gain.setValueAtTime(params.floor, at)
  } else {
    env.gain.value = peak
  }
  if (typeof env.gain.exponentialRampToValueAtTime === 'function') {
    env.gain.exponentialRampToValueAtTime(peak, at + attack)
    env.gain.exponentialRampToValueAtTime(params.floor, at + params.duration)
  }

  osc.connect(env)
  env.connect(dest)
  osc.start(at)
  osc.stop(at + params.duration + params.stopTail)
  osc.onended = () => {
    osc.disconnect?.()
    env.disconnect?.()
  }
}

export function createSynthAudio<Name extends string>(
  motifs: Record<Name, MotifInput>,
  { volume = 0.22, waveform = {}, createContext, context: externalContext }: SynthAudioOptions<Name> = {}
): SynthAudio<Name> {
  let muted = false
  let context: AudioContextLike | undefined = externalContext
  const ownsContext = !externalContext
  let output: GainNodeLike | undefined

  function ensureOutput() {
    if (!context) {
      const created = resolveAudioContext(createContext)
      if (!created) return
      context = created
    }
    if (!output) {
      output = context.createGain()
      output.gain.value = muted ? 0 : volume
      output.connect(context.destination)
    }
  }

  return {
    unlock() {
      try {
        configurePlaybackAudioSession()
        ensureOutput()
        if (context && context.state !== 'running' && context.state !== 'closed') {
          context.resume?.().catch(() => {})
        }
      } catch { /* Sound is optional. */ }
    },
    play(name: Name, options: PlayMotifOptions = {}) {
      if (muted || !context || !output || context.state !== 'running') return
      const raw = motifs[name]
      if (!raw) return
      const motif = normalizeMotif(raw)
      const pitch = options.pitch ?? 1
      if (!(pitch > 0) || !Number.isFinite(pitch)) return
      const baseVol = options.volume ?? motif.volume ?? motif.gain ?? 0.25
      const finalVol = baseVol * (options.volumeScale ?? 1)
      const type = options.waveform ?? waveform[name] ?? motif.waveform ?? 'sine'
      const extraDelay = options.delay ?? 0

      for (const [frequency, duration, delay, endFrequency] of motif.notes) {
        scheduleTone(context, output, {
          frequency: frequency * pitch,
          duration,
          type,
          volume: finalVol,
          delay: Math.max(0, delay) + extraDelay,
          endFrequency: endFrequency !== undefined ? endFrequency * pitch : undefined,
          attackCap: 0.015,
          attackRatio: 0.5,
          floor: 0.001,
          minPeak: 0.002,
          minEndFrequency: 1,
          stopTail: 0
        })
      }
    },
    mute(value: boolean) {
      muted = Boolean(value)
      if (output) output.gain.value = muted ? 0 : volume
    },
    suspend() { context?.suspend?.().catch(() => {}) },
    resume() {
      if (!muted && context && context.state !== 'running' && context.state !== 'closed') {
        configurePlaybackAudioSession()
        context.resume?.().catch(() => {})
      }
    },
    close() {
      const active = context
      try { output?.disconnect?.() } catch { /* ignore */ }
      output = undefined
      if (ownsContext) {
        context = undefined
        active?.close?.().catch(() => {})
      }
    }
  }
}

function isSequencerTrack(value: readonly (number | null)[] | SequencerTrack): value is SequencerTrack {
  return !Array.isArray(value)
}

function normalizeTrack(
  input: readonly (number | null)[] | SequencerTrack | undefined,
  defaults: Required<Omit<SequencerTrack, 'notes'>>
): SequencerTrack | null {
  if (!input) return null
  if (isSequencerTrack(input)) {
    return {
      notes: input.notes,
      divide: Math.max(1, Math.floor(input.divide ?? defaults.divide)),
      phase: Math.max(0, Math.floor(input.phase ?? defaults.phase)),
      waveform: input.waveform ?? defaults.waveform,
      volume: input.volume ?? defaults.volume,
      gate: input.gate ?? defaults.gate,
      bus: input.bus ?? defaults.bus
    }
  }
  return { ...defaults, notes: input }
}

function mergeTrackOverride(
  base: SequencerTrack | null,
  override: readonly (number | null)[] | SequencerTrack | undefined,
  waveformOverride: OscillatorType | undefined,
  fallbackDefaults: Required<Omit<SequencerTrack, 'notes'>>
): SequencerTrack | null {
  const defaults: Required<Omit<SequencerTrack, 'notes'>> = base
    ? {
        divide: base.divide ?? fallbackDefaults.divide,
        phase: base.phase ?? fallbackDefaults.phase,
        waveform: base.waveform ?? fallbackDefaults.waveform,
        volume: base.volume ?? fallbackDefaults.volume,
        gate: base.gate ?? fallbackDefaults.gate,
        bus: base.bus ?? fallbackDefaults.bus
      }
    : fallbackDefaults
  const resolved = override !== undefined ? normalizeTrack(override, defaults) : base
  if (!resolved) return null
  if (waveformOverride !== undefined) {
    return { ...resolved, waveform: waveformOverride }
  }
  return resolved
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a))
  let y = Math.abs(Math.floor(b))
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x || 1
}

function lcm(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Math.max(1, a, b)
  return Math.floor((a / gcd(a, b)) * b)
}

function resolveStepDuration(
  stepDuration: number | undefined,
  bpm: number | undefined,
  stepsPerBeat: number | undefined,
  fallback: number
): number {
  if (stepDuration !== undefined && Number.isFinite(stepDuration) && stepDuration > 0) {
    return stepDuration
  }
  if (bpm !== undefined && Number.isFinite(bpm) && bpm > 0) {
    const spb = stepsPerBeat !== undefined && Number.isFinite(stepsPerBeat) && stepsPerBeat > 0 ? stepsPerBeat : 2
    return 60 / (bpm * spb)
  }
  return fallback
}

function playTrackStep(
  target: StepSequencerTarget,
  track: SequencerTrack,
  stepIndex: number,
  stepDuration: number,
  defaultBus: AudioBus
): number {
  const len = track.notes.length
  if (len === 0) return 0
  const divide = Math.max(1, Math.floor(track.divide ?? 1))
  const phase = Math.max(0, Math.floor(track.phase ?? 0)) % divide
  if ((stepIndex % divide) !== phase) return 0
  const raw = track.notes[Math.floor(stepIndex / divide) % len]
  const frequency = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  if (frequency > 0) {
    target.tone({
      frequency,
      duration: stepDuration * (track.gate ?? 1.15),
      type: track.waveform ?? 'triangle',
      volume: track.volume ?? 0.25,
      bus: track.bus ?? defaultBus
    })
  }
  return frequency
}

/**
 * Lightweight deterministic step sequencer for procedural music and rhythmic patterns.
 * Drives a `createSoundscape` (or any `StepSequencerTarget`) via fixed or variable `step(dt)` calls.
 */
export function createStepSequencer(
  target: StepSequencerTarget,
  options: StepSequencerOptions = {}
): StepSequencer {
  const defaultBus: AudioBus = options.bus ?? 'music'
  const baseStepDuration = resolveStepDuration(options.stepDuration, options.bpm, options.stepsPerBeat, 0.3)
  const maxStepsPerTick = Math.max(1, Math.floor(options.maxStepsPerTick ?? 4))

  const melodyDefaults: Required<Omit<SequencerTrack, 'notes'>> = {
    divide: 1,
    phase: 0,
    waveform: 'triangle',
    volume: 0.25,
    gate: 1.15,
    bus: defaultBus
  }
  const bassDefaults: Required<Omit<SequencerTrack, 'notes'>> = {
    divide: 2,
    phase: 0,
    waveform: 'triangle',
    volume: 0.26,
    gate: 1.75,
    bus: defaultBus
  }

  const baseMelody = normalizeTrack(options.melody, melodyDefaults)
  const baseBass = normalizeTrack(options.bass, bassDefaults)
  const baseTracks = options.tracks ?? []

  let stepIndex = 0
  let accum = 0
  let elapsed = 0

  function computeCycleLength(melody: SequencerTrack | null, bass: SequencerTrack | null, tracks: readonly SequencerTrack[]): number {
    if (options.length !== undefined && Number.isFinite(options.length) && options.length >= 1) {
      return Math.floor(options.length)
    }
    let cycle = 0
    const consider = (track: SequencerTrack | null) => {
      if (!track || track.notes.length === 0) return
      const span = track.notes.length * Math.max(1, Math.floor(track.divide ?? 1))
      cycle = cycle === 0 ? span : lcm(cycle, span)
    }
    consider(melody)
    consider(bass)
    for (const track of tracks) consider(track)
    return cycle > 0 ? cycle : 16
  }

  function hasNonMusicTrack(melody: SequencerTrack | null, bass: SequencerTrack | null, tracks: readonly SequencerTrack[]): boolean {
    if (defaultBus !== 'music') return true
    if (melody && (melody.bus ?? defaultBus) !== 'music') return true
    if (bass && (bass.bus ?? defaultBus) !== 'music') return true
    for (const track of tracks) {
      if ((track.bus ?? defaultBus) !== 'music') return true
    }
    return false
  }

  return {
    get stepIndex() { return stepIndex },
    get elapsed() { return elapsed },
    reset() {
      stepIndex = 0
      accum = 0
      elapsed = 0
    },
    step(dt: number, overrides: StepSequencerStepOverrides = {}): number {
      if (!Number.isFinite(dt) || dt <= 0) return 0
      if (!target.running || target.isMuted()) return 0

      const melody = mergeTrackOverride(baseMelody, overrides.melody, overrides.melodyWaveform, melodyDefaults)
      const bass = mergeTrackOverride(baseBass, overrides.bass, overrides.bassWaveform, bassDefaults)
      const extraTracks = overrides.tracks ?? baseTracks

      if (!target.isMusicEnabled() && !hasNonMusicTrack(melody, bass, extraTracks)) {
        return 0
      }

      const stepDuration = resolveStepDuration(
        overrides.stepDuration,
        overrides.bpm,
        overrides.stepsPerBeat,
        baseStepDuration
      )
      if (!(stepDuration > 0) || !Number.isFinite(stepDuration)) return 0

      const cycleLength = computeCycleLength(melody, bass, extraTracks)
      const onStep = 'onStep' in overrides ? overrides.onStep : options.onStep

      accum += dt
      elapsed += dt
      let fired = 0
      while (accum >= stepDuration && fired < maxStepsPerTick) {
        accum -= stepDuration
        const currentStep = stepIndex
        const melodyNote = melody ? playTrackStep(target, melody, currentStep, stepDuration, defaultBus) : 0
        const bassNote = bass ? playTrackStep(target, bass, currentStep, stepDuration, defaultBus) : 0
        for (const track of extraTracks) {
          playTrackStep(target, track, currentStep, stepDuration, defaultBus)
        }
        onStep?.({ stepIndex: currentStep, stepDuration, melodyNote, bassNote })
        stepIndex = (currentStep + 1) % cycleLength
        fired++
      }
      if (accum >= stepDuration) {
        accum = accum % stepDuration
      }
      return fired
    }
  }
}

/**
 * Multi-bus Web Audio soundscape & procedural music/SFX mixer (`master`, `music`, `sfx`, `ambience`)
 * with pink-noise ambience beds, filtered noise bursts, declarative motif playback,
 * a built-in step sequencer, and unified `AudioBank` sample playback on the same `AudioContext`.
 */
export function createSoundscape<MotifName extends string = string>({
  master = 0.72,
  music = 0.16,
  sfx = 0.28,
  ambience = 1,
  musicCutoff = 1800,
  beds = {},
  motifs,
  createContext,
  context: externalContext,
  fetch: customFetch
}: SoundscapeOptions<MotifName> = {}): Soundscape<MotifName> {
  let ctx: AudioContextLike | null = externalContext ?? null
  const ownsContext = !externalContext
  let masterGain: GainNodeLike | null = null
  let musicGain: GainNodeLike | null = null
  let musicFilter: BiquadFilterNodeLike | null = null
  let sfxGain: GainNodeLike | null = null
  let ambienceGain: GainNodeLike | null = null
  let busSnapshot: SoundscapeBuses | null = null
  const bedNodes = new Map<string, { src: AudioBufferSourceNodeLike; filter: BiquadFilterNodeLike; gain: GainNodeLike }>()
  let internalBank: AudioBank | null = null

  let muted = false
  let musicEnabled = true
  const masterVolume = Math.max(0, master)
  let musicVolume = Math.max(0, music)
  let sfxVolume = Math.max(0, sfx)
  let ambienceVolume = Math.max(0, ambience)
  let currentMusicCutoff = Math.max(60, musicCutoff)

  function createNoiseBuffer(audioCtx: AudioContextLike, seconds = 2): AudioBuffer | null {
    if (typeof audioCtx.createBuffer !== 'function') return null
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

  function ensureMixer(): AudioContextLike | null {
    try {
      if (!ctx) {
        ctx = resolveAudioContext(createContext)
        if (!ctx) return null
      }
      if (!masterGain) {
        masterGain = ctx.createGain()
        masterGain.gain.value = muted ? 0 : masterVolume
        masterGain.connect(ctx.destination)

        if (typeof ctx.createBiquadFilter === 'function') {
          musicFilter = ctx.createBiquadFilter()
          musicFilter.type = 'lowpass'
          musicFilter.frequency.value = currentMusicCutoff
        } else {
          musicFilter = null
        }

        musicGain = ctx.createGain()
        musicGain.gain.value = musicEnabled && !muted ? musicVolume : 0
        if (musicFilter) {
          musicFilter.connect(musicGain)
        }
        musicGain.connect(masterGain)

        sfxGain = ctx.createGain()
        sfxGain.gain.value = sfxVolume
        sfxGain.connect(masterGain)

        ambienceGain = ctx.createGain()
        ambienceGain.gain.value = ambienceVolume
        ambienceGain.connect(masterGain)

        if (musicFilter) {
          busSnapshot = Object.freeze({
            master: masterGain,
            music: musicFilter,
            sfx: sfxGain,
            ambience: ambienceGain
          })
        }

        const entries = Object.entries(beds)
        if (
          entries.length &&
          typeof ctx.createBufferSource === 'function' &&
          typeof ctx.createBiquadFilter === 'function'
        ) {
          const sharedNoise = createNoiseBuffer(ctx, 2)
          if (sharedNoise) {
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
              bedNodes.set(id, { src, filter, gain })
            }
          }
        }
      }
      return ctx
    } catch {
      return null
    }
  }

  function busNode(bus: AudioBus): AudioNodeLike | null {
    if (bus === 'music') return musicFilter ?? musicGain
    if (bus === 'ambience') return ambienceGain
    return sfxGain
  }

  function getBankBusMap(): Partial<Record<string, AudioNodeLike>> | null {
    if (!masterGain) return null
    return {
      master: masterGain,
      music: musicFilter ?? musicGain ?? masterGain,
      sfx: sfxGain ?? masterGain,
      ambience: ambienceGain ?? masterGain
    }
  }

  function createAttachedBank(
    bankOptions: Omit<AudioBankOptions, 'context' | 'getContext' | 'destination' | 'getDestination' | 'buses' | 'getBuses'> = {}
  ): AudioBank {
    return createAudioBank({
      getContext: ensureMixer,
      getDestination: () => masterGain,
      getBuses: getBankBusMap,
      fetch: bankOptions.fetch ?? customFetch
    })
  }

  function ensureInternalBank(): AudioBank {
    if (!internalBank) {
      internalBank = createAttachedBank()
    }
    return internalBank
  }

  function tone({
    frequency,
    duration,
    type = 'triangle',
    volume = 0.28,
    delay = 0,
    endFrequency,
    bus = 'sfx'
  }: ToneOptions) {
    if (muted || !ctx || ctx.state !== 'running' || !(frequency > 0) || !(duration > 0)) return
    if (bus === 'music' && !musicEnabled) return
    const dest = busNode(bus)
    if (!dest) return
    scheduleTone(ctx, dest, {
      frequency,
      duration,
      type,
      volume,
      delay,
      endFrequency,
      attackCap: 0.025,
      attackRatio: 0.25,
      floor: 0.0008,
      minPeak: 0.002,
      minEndFrequency: 20,
      stopTail: 0.02
    })
  }

  function playMotif(motifOrName: MotifName | MotifInput, options: PlayMotifOptions = {}) {
    let raw: MotifInput | undefined
    if (typeof motifOrName === 'string') {
      raw = motifs ? motifs[motifOrName] : undefined
    } else {
      raw = motifOrName
    }
    if (!raw) return
    const motif = normalizeMotif(raw)
    const pitch = options.pitch ?? 1
    if (!(pitch > 0) || !Number.isFinite(pitch)) return
    const baseVolume = options.volume ?? motif.volume ?? motif.gain ?? 0.28
    const finalVolume = baseVolume * (options.volumeScale ?? 1)
    const type = options.waveform ?? motif.waveform ?? 'triangle'
    const bus = options.bus ?? motif.bus ?? 'sfx'
    const extraDelay = options.delay ?? 0

    for (const [frequency, duration, delay, endFrequency] of motif.notes) {
      tone({
        frequency: frequency * pitch,
        endFrequency: endFrequency !== undefined ? endFrequency * pitch : undefined,
        duration,
        delay: Math.max(0, delay) + extraDelay,
        type,
        volume: finalVolume,
        bus
      })
    }
  }

  function noiseBurst({
    duration,
    frequency = 800,
    type = 'bandpass',
    volume = 0.2,
    delay = 0,
    bus = 'sfx'
  }: NoiseBurstOptions) {
    if (muted || !ctx || ctx.state !== 'running' || !(duration > 0)) return
    if (bus === 'music' && !musicEnabled) return
    if (
      typeof ctx.createBuffer !== 'function' ||
      typeof ctx.createBufferSource !== 'function' ||
      typeof ctx.createBiquadFilter !== 'function'
    ) return
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
    const now = ctx.currentTime + (Number.isFinite(delay) ? Math.max(0, delay) : 0)
    const peak = Math.max(0.002, volume)
    if (typeof env.gain.setValueAtTime === 'function') {
      env.gain.setValueAtTime(peak, now)
    } else {
      env.gain.value = peak
    }
    if (typeof env.gain.exponentialRampToValueAtTime === 'function') {
      env.gain.exponentialRampToValueAtTime(0.001, now + duration)
    }
    src.connect(filter)
    filter.connect(env)
    env.connect(dest)
    src.start(now)
    src.onended = () => {
      src.disconnect?.()
      filter.disconnect?.()
      env.disconnect?.()
    }
  }

  const soundscape: Soundscape<MotifName> = {
    get running() { return ctx?.state === 'running' },
    get context() { return ctx },
    get buses() { return busSnapshot },
    unlock() {
      configurePlaybackAudioSession()
      const activeCtx = ensureMixer()
      if (!activeCtx) return
      if (activeCtx.state !== 'running' && activeCtx.state !== 'closed') {
        activeCtx.resume?.().catch(() => {})
      }
    },
    tone,
    playMotif,
    noiseBurst,
    setBed(id: string, { gain, frequency, ramp = 0.2 }: { gain?: number; frequency?: number; ramp?: number }) {
      const node = bedNodes.get(id)
      if (!node || !ctx || ctx.state !== 'running') return
      const now = ctx.currentTime
      if (gain !== undefined) setAudioParam(node.gain.gain, Math.max(0, gain), now, ramp)
      if (frequency !== undefined) setAudioParam(node.filter.frequency, Math.max(20, frequency), now, ramp)
    },
    setMusicFilter(frequency: number, ramp = 0.3) {
      currentMusicCutoff = Math.max(60, frequency)
      if (musicFilter && ctx && ctx.state === 'running') {
        setAudioParam(musicFilter.frequency, currentMusicCutoff, ctx.currentTime, ramp)
      }
    },
    setMusicVolume(value: number, ramp = 0.15) {
      musicVolume = Math.max(0, value)
      if (musicGain && ctx) {
        setAudioParam(musicGain.gain, musicEnabled && !muted ? musicVolume : 0, ctx.currentTime, ramp)
      }
    },
    setSfxVolume(value: number, ramp = 0.15) {
      sfxVolume = Math.max(0, value)
      if (sfxGain && ctx) {
        setAudioParam(sfxGain.gain, sfxVolume, ctx.currentTime, ramp)
      }
    },
    setAmbienceVolume(value: number, ramp = 0.15) {
      ambienceVolume = Math.max(0, value)
      if (ambienceGain && ctx) {
        setAudioParam(ambienceGain.gain, ambienceVolume, ctx.currentTime, ramp)
      }
    },
    setMuted(value: boolean) {
      muted = Boolean(value)
      if (masterGain && ctx) setAudioParam(masterGain.gain, muted ? 0 : masterVolume, ctx.currentTime, 0.05)
      if (musicGain && ctx) setAudioParam(musicGain.gain, musicEnabled && !muted ? musicVolume : 0, ctx.currentTime, 0.05)
    },
    isMuted: () => muted,
    setMusicEnabled(value: boolean) {
      musicEnabled = Boolean(value)
      if (musicGain && ctx) setAudioParam(musicGain.gain, musicEnabled && !muted ? musicVolume : 0, ctx.currentTime, 0.08)
    },
    isMusicEnabled: () => musicEnabled,
    createSequencer(seqOptions?: StepSequencerOptions) {
      return createStepSequencer(soundscape, seqOptions)
    },
    createBank: createAttachedBank,
    loadSample(name: string, source: AudioSampleSource) {
      return ensureInternalBank().load(name, source)
    },
    loadSamples(entries) {
      return ensureInternalBank().loadAll(entries)
    },
    playSample(name: string, playOptions: SoundscapeSamplePlayOptions = {}) {
      if (!ctx || ctx.state !== 'running') return NOOP_PLAY_HANDLE
      const bus = playOptions.bus ?? 'sfx'
      if (muted && !playOptions.loop) return NOOP_PLAY_HANDLE
      if (bus === 'music' && !musicEnabled && !playOptions.loop) return NOOP_PLAY_HANDLE
      return ensureInternalBank().play(name, { ...playOptions, bus })
    },
    hasSample(name: string) {
      return internalBank ? internalBank.has(name) : false
    },
    stopSamples() {
      internalBank?.stopAll()
    },
    suspend() { ctx?.suspend?.().catch(() => {}) },
    resume() {
      if (!muted && ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        configurePlaybackAudioSession()
        ctx.resume?.().catch(() => {})
      }
    },
    close() {
      internalBank?.dispose()
      internalBank = null
      for (const bed of bedNodes.values()) {
        try { bed.src.stop?.() } catch { /* ignore */ }
        try { bed.src.disconnect?.() } catch { /* ignore */ }
        try { bed.filter.disconnect?.() } catch { /* ignore */ }
        try { bed.gain.disconnect?.() } catch { /* ignore */ }
      }
      bedNodes.clear()
      try { musicFilter?.disconnect?.() } catch { /* ignore */ }
      try { musicGain?.disconnect?.() } catch { /* ignore */ }
      try { sfxGain?.disconnect?.() } catch { /* ignore */ }
      try { ambienceGain?.disconnect?.() } catch { /* ignore */ }
      try { masterGain?.disconnect?.() } catch { /* ignore */ }
      masterGain = musicGain = sfxGain = ambienceGain = null
      musicFilter = null
      busSnapshot = null
      const active = ctx
      if (ownsContext) {
        ctx = null
        active?.close?.().catch(() => {})
      }
    }
  }

  return soundscape
}
