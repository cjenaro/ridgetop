import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  AudioBufferSourceNodeLike, AudioContextLike, AudioNodeLike, AudioParamLike,
  BiquadFilterNodeLike, GainNodeLike, OscillatorNodeLike
} from '../packages/ridgetop/framework/index.ts'
import { bakeMotifWav } from '../packages/ridgetop/framework/server.ts'
import {
  BIOME_AMBIENT_PROFILES, BIOME_IDS, BIOME_MUSIC_THEMES, SFX_MOTIFS, createCrownshardAudio
} from '../examples/crownshard/crownshard/audio.ts'
import { CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import { resolvePackageAssets } from '../examples/crownshard/crownshard/package-assets.ts'
import { createInitialState, startChapterBattle } from '../examples/crownshard/crownshard/simulation.ts'
import type { BiomeId } from '../examples/crownshard/crownshard/types.ts'

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

interface MockAudioContext extends AudioContextLike {
  state: 'suspended' | 'running' | 'closed'
  currentTime: number
  sampleRate: number
  readonly destination: AudioNodeLike
  readonly gains: MockGainNode[]
  readonly filters: MockFilterNode[]
  readonly oscillators: MockOscNode[]
  readonly bufferSources: MockBufferSourceNode[]
  resumeCalls: number
  suspendCalls: number
  closeCalls: number
}

function createMockAudioBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
  const channelArrays: Float32Array<ArrayBuffer>[] = Array.from(
    { length: channels },
    () => new Float32Array(length)
  )
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

function createMockAudioContext(initialState: 'suspended' | 'running' = 'suspended', sampleRate = 44100): MockAudioContext {
  const gains: MockGainNode[] = []
  const filters: MockFilterNode[] = []
  const oscillators: MockOscNode[] = []
  const bufferSources: MockBufferSourceNode[] = []
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
    resumeCalls: 0,
    suspendCalls: 0,
    closeCalls: 0,
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
      return createMockAudioBuffer(channels, length, sr)
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

function findChapterIndexForBiome(biome: BiomeId): number {
  const chapter = CHAPTERS.find(c => !c.comingSoon && c.biome === biome)
  assert.ok(chapter, `Expected a playable chapter for biome "${biome}"`)
  return chapter.index
}

test('all 9 biomes have defined, non-empty, mutually distinct battle music motifs, bass lines, harmonies, and tempos', () => {
  const expectedBiomes: readonly BiomeId[] = ['meadow', 'river', 'crypt', 'frost', 'volcano', 'throne', 'dunes', 'aether', 'expanse']
  assert.deepEqual([...BIOME_IDS], [...expectedBiomes])

  const melodyKeys = new Set<string>()
  const bossMelodyKeys = new Set<string>()
  const bassKeys = new Set<string>()
  const harmonyKeys = new Set<string>()
  const bpms = new Set<number>()
  const cutoffs = new Set<number>()

  for (const biome of expectedBiomes) {
    const theme = BIOME_MUSIC_THEMES[biome]
    assert.ok(theme, `Missing BIOME_MUSIC_THEMES entry for ${biome}`)
    assert.equal(theme.biome, biome)
    assert.ok(theme.name.length > 0, `${biome} theme must have a name`)
    assert.ok(theme.mode.length > 0, `${biome} theme must document its musical mode`)
    assert.ok(theme.bpm >= 60 && theme.bpm <= 160, `${biome} BPM (${theme.bpm}) out of musical range`)
    assert.ok(theme.stepDuration > 0 && theme.bossStepDuration > 0)
    assert.ok(theme.bossStepDuration < theme.stepDuration, `${biome} boss tempo should intensify`)

    const activeMelodyNotes = theme.melody.notes.filter((n): n is number => typeof n === 'number' && n > 0)
    assert.ok(theme.melody.notes.length >= 16, `${biome} melody should have at least 16 steps`)
    assert.ok(activeMelodyNotes.length >= 10, `${biome} melody should have substantial pitched notes`)
    assert.ok(theme.bossMelody.length >= 16, `${biome} boss melody should have at least 16 steps`)

    const activeBassNotes = theme.bass.notes.filter((n): n is number => typeof n === 'number' && n > 0)
    assert.ok(activeBassNotes.length >= 6, `${biome} bass should have pitched notes`)

    const activeHarmonyNotes = theme.harmony.notes.filter((n): n is number => typeof n === 'number' && n > 0)
    assert.ok(activeHarmonyNotes.length >= 4, `${biome} harmony voice should have pitched notes`)

    const melodySig = theme.melody.notes.join(',')
    const bossSig = theme.bossMelody.join(',')
    const bassSig = theme.bass.notes.join(',')
    const harmonySig = theme.harmony.notes.join(',')

    assert.notEqual(melodySig, bossSig, `${biome} boss melody should differ from regular battle melody`)
    assert.ok(!melodyKeys.has(melodySig), `Duplicate melody detected for biome ${biome}`)
    assert.ok(!bossMelodyKeys.has(bossSig), `Duplicate boss melody detected for biome ${biome}`)
    assert.ok(!bassKeys.has(bassSig), `Duplicate bass line detected for biome ${biome}`)
    assert.ok(!harmonyKeys.has(harmonySig), `Duplicate harmony track detected for biome ${biome}`)

    melodyKeys.add(melodySig)
    bossMelodyKeys.add(bossSig)
    bassKeys.add(bassSig)
    harmonyKeys.add(harmonySig)
    bpms.add(theme.bpm)
    cutoffs.add(theme.musicCutoff)
  }

  assert.equal(melodyKeys.size, BIOME_IDS.length, 'All biomes must have distinct melodies')
  assert.equal(bossMelodyKeys.size, BIOME_IDS.length, 'All biomes must have distinct boss melodies')
  assert.equal(bassKeys.size, BIOME_IDS.length, 'All biomes must have distinct bass lines')
  assert.equal(harmonyKeys.size, BIOME_IDS.length, 'All biomes must have distinct harmonies')
  assert.equal(bpms.size, BIOME_IDS.length, 'All biomes must have distinct tempos/BPM')
  assert.equal(cutoffs.size, BIOME_IDS.length, 'All biomes must have distinct filter cutoffs')
})

test('all 6 biomes have distinct ambient soundscape bed specs, drones, and accent characters', () => {
  const bedIds = new Set<string>()
  const bedSignatures = new Set<string>()
  const droneFrequencies = new Set<number>()
  const accentKinds = new Set<string>()
  const characters = new Set<string>()

  for (const biome of BIOME_IDS) {
    const profile = BIOME_AMBIENT_PROFILES[biome]
    assert.ok(profile, `Missing BIOME_AMBIENT_PROFILES entry for ${biome}`)
    assert.equal(profile.biome, biome)
    assert.ok(profile.character.length > 0)
    assert.ok(profile.bedId.length > 0)
    assert.ok(profile.noiseBed.frequency > 0)
    assert.ok((profile.noiseBed.gain ?? 0) > 0)
    assert.ok(profile.drone.frequency > 0)
    assert.ok(profile.drone.filterFrequency > 0)
    assert.ok(profile.drone.gain > 0)
    assert.ok(profile.accent.intervalMin > 0 && profile.accent.intervalMax >= profile.accent.intervalMin)

    const bedSig = `${profile.noiseBed.type}:${profile.noiseBed.frequency}:${profile.noiseBed.q}:${profile.noiseBed.gain}`
    assert.ok(!bedIds.has(profile.bedId), `Duplicate bedId for ${biome}`)
    assert.ok(!bedSignatures.has(bedSig), `Duplicate noise bed config for ${biome}`)
    assert.ok(!droneFrequencies.has(profile.drone.frequency), `Duplicate drone frequency for ${biome}`)
    assert.ok(!accentKinds.has(profile.accent.kind), `Duplicate ambient accent kind for ${biome}`)
    assert.ok(!characters.has(profile.character), `Duplicate ambient character for ${biome}`)

    bedIds.add(profile.bedId)
    bedSignatures.add(bedSig)
    droneFrequencies.add(profile.drone.frequency)
    accentKinds.add(profile.accent.kind)
    characters.add(profile.character)
  }

  assert.equal(bedIds.size, BIOME_IDS.length)
  assert.equal(bedSignatures.size, BIOME_IDS.length)
  assert.equal(droneFrequencies.size, BIOME_IDS.length)
  assert.equal(accentKinds.size, BIOME_IDS.length)
})

test('headless Node (no AudioContext) handles switching all 6 biomes, camp, world, mute/unmute, and SFX safely', () => {
  const audio = createCrownshardAudio()
  const state = createInitialState(1337)

  assert.equal(audio.getMusicMode(), 'camp')
  assert.equal(audio.getBattleBiome(), null)

  audio.unlock()
  audio.update(state, 0.5, false)

  audio.setMusicMode('world')
  assert.equal(audio.getMusicMode(), 'world')
  assert.equal(audio.getBattleBiome(), null)
  audio.update(state, 0.5, false)

  for (const biome of BIOME_IDS) {
    audio.setBattleBiome(biome)
    assert.equal(audio.getMusicMode(), 'battle')
    assert.equal(audio.getBattleBiome(), biome)

    const chapterIdx = findChapterIndexForBiome(biome)
    startChapterBattle(state, chapterIdx)
    state.sounds.push({ kind: 'slash' }, { kind: 'turn', team: 'ally' })
    audio.update(state, 0.5, true)
    assert.equal(state.sounds.length, 0, 'SFX queue should be drained even without AudioContext')
  }

  audio.setMuted(true)
  assert.equal(audio.isMuted(), true)
  audio.update(state, 0.5, true)

  audio.setMuted(false)
  assert.equal(audio.isMuted(), false)
  audio.setMusic(false)
  assert.equal(audio.isMusicEnabled(), false)
  audio.setMusic(true)
  assert.equal(audio.isMusicEnabled(), true)

  state.battle = null
  audio.setMusicMode('camp')
  assert.equal(audio.getMusicMode(), 'camp')
  assert.equal(audio.getBattleBiome(), null)
  audio.update(state, 0.5, false)

  audio.suspend()
  audio.resume()
  audio.close()
})

test('mocked AudioContext schedules distinct biome oscillators, ramps ambient beds, and cleans up drones on switch/mute/close', () => {
  const ctx = createMockAudioContext('suspended')
  const audio = createCrownshardAudio({ createContext: () => ctx })
  const state = createInitialState(2026)

  audio.unlock()
  assert.equal(ctx.state, 'running')
  // 2 base beds (wind, fire) + per-biome beds looping pink-noise buffer sources
  assert.equal(ctx.bufferSources.length, 2 + BIOME_IDS.length, 'Expected 2 base beds + all biome noise beds')

  const scheduledMelodySets = new Map<BiomeId, number[]>()
  let activeDroneOscSnapshot: MockOscNode[] = []

  for (const biome of BIOME_IDS) {
    const chapterIdx = findChapterIndexForBiome(biome)
    startChapterBattle(state, chapterIdx)
    // Remove boss flag for baseline biome theme verification
    if (state.battle) {
      for (const unit of state.battle.units) {
        if (unit.isBoss) unit.alive = false
      }
    }

    const prevOscCount = ctx.oscillators.length
    const prevFilterCount = ctx.filters.length
    const prevGainCount = ctx.gains.length

    audio.setBattleBiome(biome)
    assert.equal(audio.getMusicMode(), 'battle')
    assert.equal(audio.getBattleBiome(), biome)

    // Previous biome's drone oscillators must have been stopped and disconnected cleanly
    for (const oldOsc of activeDroneOscSnapshot) {
      assert.ok(oldOsc.stops.length >= 1, `Previous biome drone oscillator should be stopped before entering ${biome}`)
      assert.ok(oldOsc.disconnected >= 1, `Previous biome drone oscillator should be disconnected before entering ${biome}`)
    }

    // Entering a battle biome creates its drone rig (osc + optional harmonic + filter + gain)
    const droneOscs = ctx.oscillators.slice(prevOscCount)
    assert.ok(droneOscs.length >= 1, `Expected ambient drone oscillator(s) created for ${biome}`)
    assert.equal(
      droneOscs[0].frequency.value,
      BIOME_AMBIENT_PROFILES[biome].drone.frequency,
      `Primary drone frequency should match ${biome} profile`
    )
    assert.ok(ctx.filters.length > prevFilterCount, `Expected drone filter created for ${biome}`)
    assert.ok(ctx.gains.length > prevGainCount, `Expected drone gain created for ${biome}`)
    activeDroneOscSnapshot = droneOscs

    // Advance time enough to fire multiple sequencer steps AND an ambient accent
    const theme = BIOME_MUSIC_THEMES[biome]
    const oscBeforeSteps = ctx.oscillators.length
    for (let tick = 0; tick < 12; tick++) {
      ctx.currentTime += theme.stepDuration
      audio.update(state, theme.stepDuration, true)
    }

    const noteOscs = ctx.oscillators.slice(oscBeforeSteps)
    assert.ok(noteOscs.length >= 8, `Expected scheduled melody/bass/harmony oscillators for ${biome}`)

    // Confirm first non-zero melody frequency from this biome was scheduled
    const firstMelodyFreq = theme.melody.notes.find((n): n is number => typeof n === 'number' && n > 0)
    assert.ok(firstMelodyFreq !== undefined)
    const freqs = noteOscs.map(o => o.frequency.value)
    assert.ok(
      freqs.includes(firstMelodyFreq),
      `Expected ${biome} melody note ${firstMelodyFreq}Hz to be scheduled`
    )
    scheduledMelodySets.set(biome, freqs.slice(0, 6))
  }

  // Verify no two biomes produced the exact same scheduled pitch sequence
  const uniqueScheduled = new Set(Array.from(scheduledMelodySets.values(), arr => arr.join(',')))
  assert.equal(uniqueScheduled.size, BIOME_IDS.length, 'Each biome should schedule a distinct sequence of frequencies')

  // Mute tears down active drone cleanly and suppresses new note scheduling
  audio.setMuted(true)
  for (const oldOsc of activeDroneOscSnapshot) {
    assert.ok(oldOsc.stops.length >= 1, 'Active drone should stop on mute')
    assert.ok(oldOsc.disconnected >= 1, 'Active drone should disconnect on mute')
  }
  const oscCountWhileMuted = ctx.oscillators.length
  ctx.currentTime += 1.0
  audio.update(state, 1.0, true)
  assert.equal(ctx.oscillators.length, oscCountWhileMuted, 'Muted audio must not schedule new oscillators')

  // Unmuting restores active battle biome drone
  const oscBeforeUnmute = ctx.oscillators.length
  audio.setMuted(false)
  const restoredDroneOscs = ctx.oscillators.slice(oscBeforeUnmute)
  assert.ok(restoredDroneOscs.length >= 1, 'Unmuting during battle should restore biome drone')

  // Switching back to camp cleans up battle drone and fades biome beds down
  state.battle = null
  audio.setMusicMode('camp')
  assert.equal(audio.getMusicMode(), 'camp')
  assert.equal(audio.getBattleBiome(), null)
  for (const osc of restoredDroneOscs) {
    assert.ok(osc.stops.length >= 1, 'Battle drone should stop when switching to camp')
    assert.ok(osc.disconnected >= 1, 'Battle drone should disconnect when switching to camp')
  }

  // Switching to world map schedules world music cleanly
  audio.setMusicMode('world')
  const oscBeforeWorld = ctx.oscillators.length
  ctx.currentTime += 0.8
  audio.update(state, 0.8, false)
  assert.ok(ctx.oscillators.length > oscBeforeWorld, 'World mode should schedule music oscillators')

  // Boss battle switches to biome's intensified boss melody and higher filter cutoff
  const throneIdx = findChapterIndexForBiome('throne')
  const throneBattle = startChapterBattle(state, throneIdx)
  assert.ok(throneBattle.units.some(u => u.alive && u.isBoss), 'Throne chapter should include an active boss')
  audio.setBattleBiome('throne')
  const oscBeforeBoss = ctx.oscillators.length
  const throneTheme = BIOME_MUSIC_THEMES.throne
  for (let tick = 0; tick < 8; tick++) {
    ctx.currentTime += throneTheme.bossStepDuration
    audio.update(state, throneTheme.bossStepDuration, true)
  }
  const bossFreqs = ctx.oscillators.slice(oscBeforeBoss).map(o => o.frequency.value)
  assert.ok(
    bossFreqs.includes(throneTheme.bossMelody[5]),
    'Active boss encounter should schedule the biome bossMelody variation'
  )

  // Closing tears down soundscape, active drone, and all looping noise beds cleanly
  audio.close()
  assert.equal(ctx.closeCalls, 1)
  assert.equal(ctx.state, 'closed')
  const loopingBeds = ctx.bufferSources.filter(src => src.loop)
  assert.equal(loopingBeds.length, 2 + BIOME_IDS.length, 'Expected 2 base + all biome looping noise bed sources')
  for (const src of loopingBeds) {
    assert.ok(src.stops >= 1 && src.disconnected >= 1, 'All looping bed sources must stop and disconnect on close')
  }
  const oneShotBursts = ctx.bufferSources.filter(src => !src.loop)
  assert.ok(oneShotBursts.length > 0, 'Expected procedural percussion / ambient accent noise bursts to have fired')
  for (const src of oneShotBursts) {
    assert.equal(typeof src.onended, 'function', 'One-shot noise bursts must register onended cleanup')
    src.onended?.()
    assert.ok(src.disconnected >= 1, 'One-shot noise burst onended handler must disconnect source')
  }
})

test('SFX_MOTIFS and resolvePackageAssets remain intact and bake cleanly to WAV', () => {
  const motifEntries = Object.entries(SFX_MOTIFS)
  assert.ok(motifEntries.length >= 18, 'Expected all Crownshard SFX motifs to remain exported')

  for (const [id, motif] of motifEntries) {
    assert.ok(motif.notes.length > 0, `SFX motif "${id}" must have at least one note`)
    const wav = bakeMotifWav(motif.notes, { waveform: motif.waveform })
    assert.ok(wav.byteLength > 44, `SFX motif "${id}" should bake to a valid non-empty WAV`)
  }

  const assets = resolvePackageAssets()
  assert.equal(assets.title, 'Crownshard')
  assert.strictEqual(assets.audio, SFX_MOTIFS, 'package-assets.ts should expose SFX_MOTIFS directly')
})
