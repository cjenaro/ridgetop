import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAudioBank,
  createSoundscape,
  createStepSequencer,
  createSynthAudio,
  parseWav
} from '../packages/ridgetop/framework/index.ts'
import type {
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioMotif,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike
} from '../packages/ridgetop/framework/index.ts'
import { bakeMotifWav, encodeWav } from '../packages/ridgetop/framework/server.ts'
import { AUDIO_MOTIFS as BEACON_MOTIFS } from '../examples/beacon-run/game/audio.ts'
import { SFX_MOTIFS as CROWNSHARD_MOTIFS } from '../examples/crownshard/crownshard/audio.ts'
import { SFX_MOTIFS as LIGHTHOUSE_MOTIFS } from '../examples/lighthouse/lighthouse/audio.ts'
import { AUDIO_MOTIFS as SIGNAL_DRIFT_MOTIFS } from '../examples/signal-drift/racing/audio.ts'

interface ParamEvent {
  readonly kind: 'set' | 'expRamp' | 'target'
  readonly value: number
  readonly time: number
  readonly ramp?: number
}

interface MockParam extends AudioParamLike {
  value: number
  readonly events: ParamEvent[]
}

function createMockParam(initial = 0): MockParam {
  const events: ParamEvent[] = []
  return {
    value: initial,
    events,
    setValueAtTime(value: number, time: number) {
      this.value = value
      events.push({ kind: 'set', value, time })
    },
    exponentialRampToValueAtTime(value: number, time: number) {
      this.value = value
      events.push({ kind: 'expRamp', value, time })
    },
    setTargetAtTime(value: number, time: number, ramp: number) {
      this.value = value
      events.push({ kind: 'target', value, time, ramp })
    }
  }
}

interface MockGainNode extends GainNodeLike {
  readonly gain: MockParam
  readonly connectedTo: AudioNodeLike[]
  disconnected: number
}

interface MockFilterNode extends BiquadFilterNodeLike {
  readonly frequency: MockParam
  readonly Q: MockParam
  readonly connectedTo: AudioNodeLike[]
  disconnected: number
}

interface MockOscNode extends OscillatorNodeLike {
  readonly frequency: MockParam
  readonly connectedTo: AudioNodeLike[]
  readonly starts: number[]
  readonly stops: number[]
  disconnected: number
}

interface MockBufferSourceNode extends AudioBufferSourceNodeLike {
  readonly playbackRate: MockParam
  readonly detune: MockParam
  readonly connectedTo: AudioNodeLike[]
  readonly starts: (readonly (number | undefined)[])[]
  stops: number
  disconnected: number
}

function createMockAudioBuffer(channels: number, length: number, sampleRate: number, existing?: readonly Float32Array[]): AudioBuffer {
  const channelArrays: Float32Array<ArrayBuffer>[] = Array.from({ length: channels }, (_, ch) => {
    const arr = new Float32Array(length)
    if (existing?.[ch]) arr.set(existing[ch].subarray(0, length))
    return arr
  })
  return {
    duration: length / sampleRate,
    length,
    numberOfChannels: channels,
    sampleRate,
    getChannelData(channel: number) {
      return channelArrays[channel]
    },
    copyFromChannel(destination: Float32Array<ArrayBuffer>, channelNumber: number, bufferOffset = 0) {
      destination.set(channelArrays[channelNumber].subarray(bufferOffset, bufferOffset + destination.length))
    },
    copyToChannel(source: Float32Array<ArrayBuffer>, channelNumber: number, bufferOffset = 0) {
      channelArrays[channelNumber].set(source, bufferOffset)
    }
  }
}

interface MockAudioContext extends AudioContextLike {
  state: 'suspended' | 'running' | 'closed'
  currentTime: number
  sampleRate: number
  readonly destination: AudioNodeLike
  readonly gains: MockGainNode[]
  readonly filters: MockFilterNode[]
  readonly oscillators: MockOscNode[]
  readonly bufferSources: MockBufferSourceNode[]
  readonly buffers: AudioBuffer[]
  resumeCalls: number
  suspendCalls: number
  closeCalls: number
  decodeCalls: number
}

function createMockAudioContext(initialState: 'suspended' | 'running' = 'suspended', sampleRate = 44100): MockAudioContext {
  const gains: MockGainNode[] = []
  const filters: MockFilterNode[] = []
  const oscillators: MockOscNode[] = []
  const bufferSources: MockBufferSourceNode[] = []
  const buffers: AudioBuffer[] = []
  const destination: AudioNodeLike = { connect() {} }

  const ctx: MockAudioContext = {
    state: initialState,
    currentTime: 0,
    sampleRate,
    destination,
    gains,
    filters,
    oscillators,
    bufferSources,
    buffers,
    resumeCalls: 0,
    suspendCalls: 0,
    closeCalls: 0,
    decodeCalls: 0,
    createGain() {
      const node: MockGainNode = {
        gain: createMockParam(1),
        connectedTo: [],
        disconnected: 0,
        connect(target) { this.connectedTo.push(target); return target },
        disconnect() { this.disconnected++ }
      }
      gains.push(node)
      return node
    },
    createBiquadFilter() {
      const node: MockFilterNode = {
        type: 'lowpass',
        frequency: createMockParam(350),
        Q: createMockParam(1),
        connectedTo: [],
        disconnected: 0,
        connect(target) { this.connectedTo.push(target); return target },
        disconnect() { this.disconnected++ }
      }
      filters.push(node)
      return node
    },
    createOscillator() {
      const node: MockOscNode = {
        type: 'sine',
        frequency: createMockParam(440),
        connectedTo: [],
        starts: [],
        stops: [],
        disconnected: 0,
        onended: null,
        connect(target) { this.connectedTo.push(target); return target },
        disconnect() { this.disconnected++ },
        start(when = 0) { this.starts.push(when) },
        stop(when = 0) { this.stops.push(when) }
      }
      oscillators.push(node)
      return node
    },
    createBuffer(channels: number, length: number, sr: number) {
      const buf = createMockAudioBuffer(channels, length, sr)
      buffers.push(buf)
      return buf
    },
    createBufferSource() {
      const node: MockBufferSourceNode = {
        buffer: null,
        loop: false,
        playbackRate: createMockParam(1),
        detune: createMockParam(0),
        connectedTo: [],
        starts: [],
        stops: 0,
        disconnected: 0,
        onended: null,
        connect(target) { this.connectedTo.push(target); return target },
        disconnect() { this.disconnected++ },
        start(when?: number, offset?: number, duration?: number) {
          this.starts.push([when, offset, duration])
        },
        stop() { this.stops++ }
      }
      bufferSources.push(node)
      return node
    },
    async decodeAudioData(arrayBuffer: ArrayBuffer) {
      ctx.decodeCalls++
      const parsed = parseWav(arrayBuffer)
      return createMockAudioBuffer(parsed.channels, parsed.samples.length, parsed.sampleRate, parsed.channelData)
    },
    async resume() {
      ctx.resumeCalls++
      ctx.state = 'running'
    },
    async suspend() {
      ctx.suspendCalls++
      ctx.state = 'suspended'
    },
    async close() {
      ctx.closeCalls++
      ctx.state = 'closed'
    }
  }
  return ctx
}

// Compile-time check: real browser AudioContext must be directly assignable to AudioContextLike.
function _assertBrowserAudioContextAssignable(browserCtx: AudioContext): AudioContextLike {
  return browserCtx
}
void _assertBrowserAudioContextAssignable

test('createSoundscape wires master/music/sfx/ambience buses, toggles mute & music, and manages lifecycle', () => {
  const created: MockAudioContext[] = []
  const sound = createSoundscape({
    master: 0.8,
    music: 0.2,
    sfx: 0.35,
    ambience: 0.6,
    musicCutoff: 1600,
    createContext: () => {
      const c = createMockAudioContext('suspended')
      created.push(c)
      return c
    }
  })

  const initialContext = sound.context
  const initialBuses = sound.buses
  assert.equal(sound.running, false)
  assert.equal(initialContext, null)
  assert.equal(initialBuses, null)

  sound.unlock()
  assert.equal(created.length, 1)
  const ctx = created[0]
  assert.equal(ctx.resumeCalls, 1)
  assert.equal(sound.running, true)
  assert.equal(sound.context, ctx)
  const buses = sound.buses
  assert.ok(buses)

  // Verify bus graph wiring:
  // masterGain -> destination
  // musicFilter -> musicGain -> masterGain
  // sfxGain -> masterGain
  // ambienceGain -> masterGain
  const masterGain = ctx.gains[0]
  const musicGain = ctx.gains[1]
  const sfxGain = ctx.gains[2]
  const ambienceGain = ctx.gains[3]
  const musicFilter = ctx.filters[0]

  assert.equal(buses.master, masterGain)
  assert.equal(buses.music, musicFilter)
  assert.equal(buses.sfx, sfxGain)
  assert.equal(buses.ambience, ambienceGain)

  assert.equal(masterGain.gain.value, 0.8)
  assert.equal(musicGain.gain.value, 0.2)
  assert.equal(sfxGain.gain.value, 0.35)
  assert.equal(ambienceGain.gain.value, 0.6)
  assert.equal(musicFilter.type, 'lowpass')
  assert.equal(musicFilter.frequency.value, 1600)

  assert.equal(masterGain.connectedTo[0], ctx.destination)
  assert.equal(musicFilter.connectedTo[0], musicGain)
  assert.equal(musicGain.connectedTo[0], masterGain)
  assert.equal(sfxGain.connectedTo[0], masterGain)
  assert.equal(ambienceGain.connectedTo[0], masterGain)

  // Verify tone routing per bus
  sound.tone({ frequency: 440, duration: 0.1, bus: 'sfx' })
  sound.tone({ frequency: 330, duration: 0.2, bus: 'music' })
  sound.tone({ frequency: 110, duration: 0.3, bus: 'ambience' })
  assert.equal(ctx.oscillators.length, 3)
  assert.equal((ctx.oscillators[0].connectedTo[0] as MockGainNode).connectedTo[0], sfxGain)
  assert.equal((ctx.oscillators[1].connectedTo[0] as MockGainNode).connectedTo[0], musicFilter)
  assert.equal((ctx.oscillators[2].connectedTo[0] as MockGainNode).connectedTo[0], ambienceGain)

  // onended cleans up oscillator and envelope nodes
  ctx.oscillators[0].onended?.()
  assert.equal(ctx.oscillators[0].disconnected, 1)
  assert.equal((ctx.oscillators[0].connectedTo[0] as MockGainNode).disconnected, 1)

  // Music toggle silences music bus and blocks new music tones while allowing sfx
  sound.setMusicEnabled(false)
  assert.equal(sound.isMusicEnabled(), false)
  assert.equal(musicGain.gain.value, 0)
  sound.tone({ frequency: 523, duration: 0.1, bus: 'music' })
  assert.equal(ctx.oscillators.length, 3)
  sound.tone({ frequency: 523, duration: 0.1, bus: 'sfx' })
  assert.equal(ctx.oscillators.length, 4)

  sound.setMusicEnabled(true)
  assert.equal(musicGain.gain.value, 0.2)

  // Filter and volume controls
  sound.setMusicFilter(900, 0.25)
  assert.equal(musicFilter.frequency.value, 900)
  sound.setMusicVolume(0.3, 0.1)
  assert.equal(musicGain.gain.value, 0.3)
  sound.setSfxVolume(0.5, 0.1)
  assert.equal(sfxGain.gain.value, 0.5)
  sound.setAmbienceVolume(0.4, 0.1)
  assert.equal(ambienceGain.gain.value, 0.4)

  // Mute silences master + music, blocks tones, and prevents resume() from unmuting
  sound.setMuted(true)
  assert.equal(sound.isMuted(), true)
  assert.equal(masterGain.gain.value, 0)
  sound.tone({ frequency: 440, duration: 0.1 })
  assert.equal(ctx.oscillators.length, 4)

  sound.suspend()
  assert.equal(ctx.suspendCalls, 1)
  assert.equal(sound.running, false)
  sound.resume()
  assert.equal(ctx.resumeCalls, 1, 'resume() should not wake context while muted')

  sound.setMuted(false)
  assert.equal(masterGain.gain.value, 0.8)
  sound.resume()
  assert.equal(ctx.resumeCalls, 2)
  assert.equal(sound.running, true)

  // close() closes owned context and clears mixer; unlock() cleanly rebuilds a fresh context
  sound.close()
  assert.equal(ctx.closeCalls, 1)
  assert.equal(sound.context, null)
  assert.equal(sound.buses, null)

  sound.unlock()
  assert.equal(created.length, 2)
  assert.equal(sound.running, true)
  assert.equal(sound.context, created[1])
  sound.close()
})

test('createSoundscape builds pink-noise ambience beds, modulates them, emits filtered noise bursts, and cleans up on close', () => {
  const ctx = createMockAudioContext('running', 1000)
  const sound = createSoundscape({
    context: ctx,
    beds: {
      ocean: { type: 'lowpass', frequency: 380, q: 0.7, gain: 0.08 },
      wind: { type: 'bandpass', frequency: 520, q: 2.2, gain: 0.02 }
    }
  })

  sound.unlock()
  assert.equal(ctx.buffers.length, 1, 'all beds should share one generated pink-noise buffer')
  assert.equal(ctx.buffers[0].length, 2000)
  const bedSamples = ctx.buffers[0].getChannelData(0)
  let energy = 0
  for (let i = 0; i < bedSamples.length; i++) energy += Math.abs(bedSamples[i])
  assert.ok(energy > 0, 'pink noise buffer should contain non-zero signal')

  // Two looping bed sources routed through filter -> gain -> ambienceGain
  assert.equal(ctx.bufferSources.length, 2)
  assert.equal(ctx.bufferSources[0].loop, true)
  assert.equal(ctx.bufferSources[1].loop, true)
  assert.equal(ctx.bufferSources[0].buffer, ctx.buffers[0])
  assert.equal(ctx.bufferSources[1].buffer, ctx.buffers[0])
  const oceanFilter = ctx.bufferSources[0].connectedTo[0] as MockFilterNode
  const oceanGain = oceanFilter.connectedTo[0] as MockGainNode
  assert.equal(oceanFilter.type, 'lowpass')
  assert.equal(oceanFilter.frequency.value, 380)
  assert.equal(oceanFilter.Q.value, 0.7)
  assert.equal(oceanGain.gain.value, 0.08)
  assert.equal(oceanGain.connectedTo[0], sound.buses?.ambience)

  // setBed smoothly targets gain & frequency
  ctx.currentTime = 1.5
  sound.setBed('ocean', { gain: 0.15, frequency: 640, ramp: 0.25 })
  assert.equal(oceanGain.gain.value, 0.15)
  assert.equal(oceanGain.gain.events.at(-1)?.kind, 'target')
  assert.equal(oceanFilter.frequency.value, 640)

  // Filtered noise burst routes to requested bus and cleans up on onended
  sound.noiseBurst({ duration: 0.2, frequency: 950, type: 'highpass', volume: 0.3, delay: 0.05, bus: 'sfx' })
  assert.equal(ctx.bufferSources.length, 3)
  const burstSrc = ctx.bufferSources[2]
  const burstFilter = burstSrc.connectedTo[0] as MockFilterNode
  const burstEnv = burstFilter.connectedTo[0] as MockGainNode
  assert.equal(burstFilter.type, 'highpass')
  assert.equal(burstFilter.frequency.value, 950)
  assert.equal(burstEnv.connectedTo[0], sound.buses?.sfx)
  assert.equal(burstSrc.starts[0][0], 1.55)
  burstSrc.onended?.()
  assert.equal(burstSrc.disconnected, 1)
  assert.equal(burstFilter.disconnected, 1)
  assert.equal(burstEnv.disconnected, 1)

  // Music-bus noise burst respects setMusicEnabled(false)
  sound.setMusicEnabled(false)
  sound.noiseBurst({ duration: 0.1, bus: 'music' })
  assert.equal(ctx.bufferSources.length, 3)

  // External context is NOT closed by sound.close(), while bed sources ARE stopped and disconnected
  sound.close()
  assert.equal(ctx.closeCalls, 0)
  assert.equal(ctx.bufferSources[0].stops, 1)
  assert.equal(ctx.bufferSources[1].stops, 1)
  assert.equal(ctx.bufferSources[0].disconnected, 1)
  assert.equal(ctx.bufferSources[1].disconnected, 1)
})

test('createSoundscape plays declarative motifs with pitch, volume, waveform, delay, and bus overrides, matching bakeMotifWav', () => {
  const ctx = createMockAudioContext('running')
  const motifs = {
    chime: { notes: [[440, 0.12, 0], [660, 0.18, 0.08, 880]], waveform: 'sine', volume: 0.30 },
    horn: { notes: [[220, 0.25, 0, 180]], waveform: 'sawtooth', gain: 0.22, bus: 'ambience' },
    rawTuple: [[500, 0.1, 0, 750]]
  } as const

  const sound = createSoundscape({ context: ctx, motifs })
  sound.unlock()

  // Named AudioMotif with pitch + volumeScale + delay overrides
  ctx.currentTime = 2
  sound.playMotif('chime', { pitch: 1.5, volumeScale: 0.5, delay: 0.1 })
  assert.equal(ctx.oscillators.length, 2)
  assert.equal(ctx.oscillators[0].type, 'sine')
  assert.equal(ctx.oscillators[0].frequency.events[0].value, 660)
  assert.ok(Math.abs(ctx.oscillators[0].starts[0] - 2.1) < 1e-6)
  const env0 = ctx.oscillators[0].connectedTo[0] as MockGainNode
  assert.ok(Math.abs(env0.gain.events[1].value - 0.15) < 1e-6)
  assert.equal(env0.connectedTo[0], sound.buses?.sfx)

  assert.equal(ctx.oscillators[1].frequency.events[0].value, 990)
  assert.equal(ctx.oscillators[1].frequency.events[1].value, 1320)
  assert.ok(Math.abs(ctx.oscillators[1].starts[0] - 2.18) < 1e-6)

  // Motif using gain alias + default bus='ambience'
  sound.playMotif('horn')
  assert.equal(ctx.oscillators.length, 3)
  assert.equal(ctx.oscillators[2].type, 'sawtooth')
  const env2 = ctx.oscillators[2].connectedTo[0] as MockGainNode
  assert.ok(Math.abs(env2.gain.events[1].value - 0.22) < 1e-6)
  assert.equal(env2.connectedTo[0], sound.buses?.ambience)

  // Named raw note tuple + inline ad-hoc motif with waveform & volume override
  sound.playMotif('rawTuple', { waveform: 'square', volume: 0.4 })
  assert.equal(ctx.oscillators[3].type, 'square')
  assert.equal((ctx.oscillators[3].connectedTo[0] as MockGainNode).gain.events[1].value, 0.4)

  const inlineMotif: AudioMotif = { notes: [[330, 0.15, 0]], waveform: 'triangle', volume: 0.25 }
  sound.playMotif(inlineMotif, { bus: 'music' })
  assert.equal((ctx.oscillators[4].connectedTo[0] as MockGainNode).connectedTo[0], sound.buses?.music)

  // Every example game's shared motifs bake cleanly into valid WAVs via bakeMotifWav
  for (const catalog of [BEACON_MOTIFS, SIGNAL_DRIFT_MOTIFS, LIGHTHOUSE_MOTIFS, CROWNSHARD_MOTIFS]) {
    for (const [id, motif] of Object.entries(catalog)) {
      const wav = bakeMotifWav(motif.notes, { waveform: motif.waveform })
      const parsed = parseWav(wav)
      assert.ok(parsed.samples.length > 0, `expected non-empty baked WAV for ${id}`)
    }
  }
})

test('createSynthAudio accepts both legacy tuple maps and declarative AudioMotif objects with injectable context', () => {
  const ctx = createMockAudioContext('running')
  const synth = createSynthAudio(
    {
      legacy: [[300, 0.1, 0, 450]],
      declarative: { notes: [[500, 0.12, 0]], waveform: 'triangle', volume: 0.35 }
    },
    { context: ctx, waveform: { legacy: 'square' } }
  )

  synth.unlock()
  synth.play('legacy')
  synth.play('declarative', { pitch: 2 })

  assert.equal(ctx.oscillators.length, 2)
  assert.equal(ctx.oscillators[0].type, 'square')
  assert.equal(ctx.oscillators[0].frequency.events[0].value, 300)
  assert.equal(ctx.oscillators[1].type, 'triangle')
  assert.equal(ctx.oscillators[1].frequency.events[0].value, 1000)
  assert.equal((ctx.oscillators[1].connectedTo[0] as MockGainNode).gain.events[1].value, 0.35)
})

test('step sequencer advances melody, half-time bass, rests, dynamic overrides, and pauses when muted or music disabled', () => {
  const ctx = createMockAudioContext('running')
  const sound = createSoundscape({ context: ctx })
  sound.unlock()

  const stepEvents: number[] = []
  const seq = sound.createSequencer({
    stepDuration: 0.25,
    melody: { notes: [293.66, 0, 349.23, null], waveform: 'triangle', volume: 0.25, gate: 1.2 },
    bass: { notes: [146.83, 110.0], divide: 2, waveform: 'sine', volume: 0.3, gate: 1.8 },
    onStep: ev => stepEvents.push(ev.stepIndex)
  })

  // Sub-step dt does not fire yet
  assert.equal(seq.step(0.1), 0)
  assert.equal(ctx.oscillators.length, 0)
  assert.equal(seq.stepIndex, 0)

  // Crossing 0.25s fires step 0: melody (293.66) + bass (146.83)
  assert.equal(seq.step(0.16), 1)
  assert.equal(seq.stepIndex, 1)
  assert.equal(ctx.oscillators.length, 2)
  assert.equal(ctx.oscillators[0].frequency.events[0].value, 293.66)
  assert.equal(ctx.oscillators[1].frequency.events[0].value, 146.83)

  // Step 1: melody is rest (0), bass skipped (step 1 % 2 !== 0) -> 0 oscillators added
  assert.equal(seq.step(0.25), 1)
  assert.equal(seq.stepIndex, 2)
  assert.equal(ctx.oscillators.length, 2)

  // Step 2 with dynamic melodyWaveform override: melody (349.23) + bass (110.0)
  assert.equal(seq.step(0.25, { melodyWaveform: 'sawtooth' }), 1)
  assert.equal(seq.stepIndex, 3)
  assert.equal(ctx.oscillators.length, 4)
  assert.equal(ctx.oscillators[2].type, 'sawtooth')
  assert.equal(ctx.oscillators[2].frequency.events[0].value, 349.23)
  assert.equal(ctx.oscillators[3].frequency.events[0].value, 110.0)

  // Step 3: null rest, wraps stepIndex back to 0 (natural LCM of 4 and 2*2 is 4)
  assert.equal(seq.step(0.25), 1)
  assert.equal(seq.stepIndex, 0)
  assert.deepEqual(stepEvents, [0, 1, 2, 3])

  // Pauses cleanly when music is disabled or muted
  sound.setMusicEnabled(false)
  assert.equal(seq.step(0.5), 0)
  assert.equal(seq.stepIndex, 0)
  sound.setMusicEnabled(true)
  sound.setMuted(true)
  assert.equal(seq.step(0.5), 0)
  sound.setMuted(false)

  // Huge dt is clamped by maxStepsPerTick (default 4) so tab-switches never explode
  const burstSteps = seq.step(30)
  assert.equal(burstSteps, 4)
  seq.reset()
  assert.equal(seq.stepIndex, 0)
  assert.equal(seq.elapsed, 0)

  // Standalone createStepSequencer with bpm + custom track phase
  const standalone = createStepSequencer(sound, {
    bpm: 120,
    stepsPerBeat: 2, // 0.25s per step
    tracks: [{ notes: [880], divide: 2, phase: 1, bus: 'sfx', waveform: 'square' }],
    length: 4
  })
  const oscBefore = ctx.oscillators.length
  assert.equal(standalone.step(0.25), 1) // step 0 (phase 1 skipped)
  assert.equal(ctx.oscillators.length, oscBefore)
  assert.equal(standalone.step(0.25), 1) // step 1 (phase 1 fires on sfx bus!)
  assert.equal(ctx.oscillators.length, oscBefore + 1)
  assert.equal((ctx.oscillators.at(-1)?.connectedTo[0] as MockGainNode).connectedTo[0], sound.buses?.sfx)
})

test('createSoundscape integrates AudioBank sample loading & playback on the exact same AudioContext and buses', async () => {
  const createdContexts: MockAudioContext[] = []
  const hitWav = encodeWav(new Float32Array([0, 0.5, -0.5, 0.25]), 22050)
  const bgmWav = encodeWav(new Float32Array([0.1, -0.1, 0.2, -0.2]), 22050)
  let fetchCalls = 0

  const sound = createSoundscape({
    createContext: () => {
      const c = createMockAudioContext('suspended')
      createdContexts.push(c)
      return c
    },
    fetch: (async (input: string | URL | Request) => {
      fetchCalls++
      const url = String(input)
      const bytes = url.endsWith('bgm.wav') ? bgmWav : hitWav
      return new Response(new Uint8Array(bytes), { status: 200 })
    }) as typeof globalThis.fetch
  })

  // Preloading samples BEFORE unlock() creates one shared AudioContext (still suspended)
  const loaded = await sound.loadSamples({
    hit: hitWav,
    bgm: '/audio/bgm.wav'
  })
  assert.deepEqual(loaded, { hit: true, bgm: true })
  assert.equal(fetchCalls, 1)
  assert.equal(createdContexts.length, 1)
  assert.equal(sound.hasSample('hit'), true)
  assert.equal(sound.hasSample('bgm'), true)

  // playSample does not play before unlock()
  assert.equal(sound.playSample('hit').playing, false)

  // unlock() resumes the SAME AudioContext — never creates a second one
  sound.unlock()
  assert.equal(createdContexts.length, 1)
  const ctx = createdContexts[0]
  assert.equal(ctx.decodeCalls, 2)
  assert.equal(sound.running, true)

  // Default playSample routes through sfx bus -> masterGain -> destination
  const sfxHandle = sound.playSample('hit', { volume: 0.7, rate: 1.1 })
  assert.equal(sfxHandle.playing, true)
  const sfxSrc = ctx.bufferSources[0]
  assert.equal(sfxSrc.playbackRate.value, 1.1)
  const sfxPlayGain = sfxSrc.connectedTo[0] as MockGainNode
  assert.equal(sfxPlayGain.gain.value, 0.7)
  assert.equal(sfxPlayGain.connectedTo[0], sound.buses?.sfx)

  // Music bus sample routes through musicFilter -> musicGain -> masterGain
  const bgmHandle = sound.playSample('bgm', { bus: 'music', loop: true, volume: 0.5 })
  assert.equal(bgmHandle.playing, true)
  const bgmSrc = ctx.bufferSources[1]
  assert.equal(bgmSrc.loop, true)
  assert.equal((bgmSrc.connectedTo[0] as MockGainNode).connectedTo[0], sound.buses?.music)

  // Ambience bus sample routes through ambienceGain
  const ambHandle = sound.playSample('hit', { bus: 'ambience' })
  assert.equal((ctx.bufferSources[2].connectedTo[0] as MockGainNode).connectedTo[0], sound.buses?.ambience)
  ambHandle.stop()

  // Muting soundscape blocks one-shot sfx samples while still allowing looping tracks (silenced by masterGain=0)
  sound.setMuted(true)
  assert.equal(sound.playSample('hit').playing, false)
  const mutedLoop = sound.playSample('bgm', { bus: 'music', loop: true })
  assert.equal(mutedLoop.playing, true)
  mutedLoop.stop()
  sound.setMuted(false)

  // sound.createBank() attaches a separate AudioBank to the SAME AudioContext & buses
  const bank = sound.createBank()
  assert.equal(await bank.load('alt', hitWav), true)
  assert.equal(createdContexts.length, 1, 'createBank() must share soundscape AudioContext')
  const bankHandle = bank.play('alt', { bus: 'sfx' })
  assert.equal(bankHandle.playing, true)
  const bankSrc = ctx.bufferSources.at(-1)
  assert.equal((bankSrc?.connectedTo[0] as MockGainNode).connectedTo[0], sound.buses?.sfx)

  // Disposing an attached bank must NOT close the shared AudioContext
  bank.dispose()
  assert.equal(ctx.closeCalls, 0)
  assert.equal(sound.running, true)

  // Manual createAudioBank wiring via sound.context + sound.buses also works cleanly
  const manualBank = createAudioBank({
    context: sound.context ?? undefined,
    destination: sound.buses?.master,
    buses: sound.buses ?? undefined
  })
  assert.equal(await manualBank.load('manual', hitWav), true)
  const manualHandle = manualBank.play('manual', { bus: 'ambience' })
  assert.equal((ctx.bufferSources.at(-1)?.connectedTo[0] as MockGainNode).connectedTo[0], sound.buses?.ambience)
  manualHandle.stop()
  manualBank.dispose()
  assert.equal(ctx.closeCalls, 0)

  // sound.stopSamples() stops active internal samples; sound.close() tears down cleanly
  sound.stopSamples()
  assert.equal(sfxHandle.playing, false)
  assert.equal(bgmHandle.playing, false)
  sound.close()
  assert.equal(ctx.closeCalls, 1)
  assert.equal(sound.hasSample('hit'), false)
})

test('createSoundscape & createSynthAudio configure iOS playback audioSession and recover from interrupted state', () => {
  const nav = globalThis.navigator as unknown as { audioSession?: { type: string } }
  const hadAudioSession = Object.prototype.hasOwnProperty.call(nav, 'audioSession')
  const prevAudioSession = nav.audioSession
  const fakeSession = { type: 'ambient' }
  Object.defineProperty(nav, 'audioSession', {
    value: fakeSession,
    configurable: true,
    writable: true
  })

  try {
    const soundCtx = createMockAudioContext()
    const sound = createSoundscape({ createContext: () => soundCtx })
    sound.unlock()
    assert.equal(fakeSession.type, 'playback')
    assert.equal(soundCtx.resumeCalls, 1)

    // Simulate iOS background/lock 'interrupted' AudioContext state
    fakeSession.type = 'ambient'
    ;(soundCtx as { state: string }).state = 'interrupted'
    sound.resume()
    assert.equal(fakeSession.type, 'playback')
    assert.equal(soundCtx.resumeCalls, 2, 'soundscape.resume() must recover from iOS interrupted state')

    // Closed contexts must not be resumed
    ;(soundCtx as { state: string }).state = 'closed'
    sound.resume()
    sound.unlock()
    assert.equal(soundCtx.resumeCalls, 2)

    const synthCtx = createMockAudioContext()
    const synth = createSynthAudio({ ping: [[440, 0.1, 0]] }, { createContext: () => synthCtx })
    fakeSession.type = 'ambient'
    synth.unlock()
    assert.equal(fakeSession.type, 'playback')
    assert.equal(synthCtx.resumeCalls, 1)

    fakeSession.type = 'ambient'
    ;(synthCtx as { state: string }).state = 'interrupted'
    synth.resume()
    assert.equal(fakeSession.type, 'playback')
    assert.equal(synthCtx.resumeCalls, 2, 'synth.resume() must recover from iOS interrupted state')
  } finally {
    if (hadAudioSession) {
      Object.defineProperty(nav, 'audioSession', {
        value: prevAudioSession,
        configurable: true,
        writable: true
      })
    } else {
      delete nav.audioSession
    }
  }
})
