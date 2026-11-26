import { createSoundscape } from 'ridgetop'
import type {
  AudioContextLike, AudioMotif, AudioParamLike, BiquadFilterNodeLike, GainNodeLike,
  NoiseBedSpec, OscillatorNodeLike, SequencerTrack, StepSequencerStepEvent, SynthWaveform
} from 'ridgetop'
import type { BiomeId, GameState, SoundEvent } from './types.ts'

export const BIOME_IDS: readonly BiomeId[] = [
  'meadow', 'river', 'crypt', 'frost', 'volcano', 'throne'
] as const

export type MusicMode = 'camp' | 'world' | 'battle'

export interface BiomePercussionSpec {
  /** 0 = rest, 1 = low drum/thump, 2 = high snare/metallic accent. */
  readonly pattern: readonly (0 | 1 | 2)[]
  readonly lowFreq: number
  readonly highFreq: number
  readonly volume: number
}

export interface BiomeMusicTheme {
  readonly biome: BiomeId
  readonly name: string
  readonly mode: string
  readonly bpm: number
  readonly stepsPerBeat: number
  readonly stepDuration: number
  readonly bossStepDuration: number
  readonly musicCutoff: number
  readonly bossCutoff: number
  readonly melody: SequencerTrack
  readonly bossMelody: readonly number[]
  readonly bass: SequencerTrack
  readonly harmony: SequencerTrack
  readonly percussion?: BiomePercussionSpec
}

export interface BiomeDroneSpec {
  readonly frequency: number
  readonly harmonicFrequency?: number
  readonly waveform: SynthWaveform
  readonly filterType: BiquadFilterType
  readonly filterFrequency: number
  readonly filterQ: number
  readonly gain: number
  readonly pulseRateHz: number
  readonly pulseDepth: number
}

export interface BiomeAmbientAccentSpec {
  readonly kind: 'bird' | 'ripple' | 'whisper' | 'chime' | 'crackle' | 'eclipse_pulse'
  readonly intervalMin: number
  readonly intervalMax: number
  readonly frequencies?: readonly number[]
  readonly noiseFrequency?: number
  readonly noiseType?: BiquadFilterType
  readonly duration: number
  readonly volume: number
}

export interface BiomeAmbientProfile {
  readonly biome: BiomeId
  readonly character: string
  readonly bedId: string
  readonly noiseBed: NoiseBedSpec
  readonly drone: BiomeDroneSpec
  readonly accent: BiomeAmbientAccentSpec
}

export interface CrownshardAudioOptions {
  /** Optional injectable `AudioContext` factory for headless Node tests. */
  readonly createContext?: () => AudioContextLike
  /** Optional externally owned `AudioContext`. */
  readonly context?: AudioContextLike
}

function stepFromBpm(bpm: number, stepsPerBeat = 2): number {
  return 60 / (bpm * stepsPerBeat)
}

// Camp hearthside D-Dorian motif (Hz)
const CAMP_MELODY: readonly number[] = [
  293.66, 349.23, 440.0, 392.0, 349.23, 329.63, 293.66, 0,
  349.23, 440.0, 523.25, 440.0, 392.0, 349.23, 329.63, 0
]
const CAMP_BASS: readonly number[] = [
  146.83, 146.83, 110.0, 110.0, 130.81, 130.81, 146.83, 110.0
]

// World Map overland D-Dorian / A-Mixolydian travelling theme (Hz)
const WORLD_MELODY: readonly number[] = [
  293.66, 0, 329.63, 392.0, 440.0, 392.0, 349.23, 329.63,
  440.0, 0, 523.25, 493.88, 440.0, 392.0, 329.63, 293.66
]
const WORLD_BASS: readonly number[] = [
  146.83, 196.0, 220.0, 146.83, 130.81, 196.0, 164.81, 146.83
]
const WORLD_HARMONY: SequencerTrack = {
  notes: [0, 0, 293.66, 0, 349.23, 0, 0, 0, 0, 0, 392.0, 0, 329.63, 0, 0, 0],
  waveform: 'sine',
  volume: 0.10,
  gate: 1.5
}

/**
 * Six distinct procedural battle themes, one per Crownshard biome.
 * Each biome has its own musical mode/key, BPM, melody, boss variation, bass voice,
 * harmony/arpeggio voice, timbre, cutoff, and optional rhythmic percussion pattern.
 */
export const BIOME_MUSIC_THEMES: Readonly<Record<BiomeId, BiomeMusicTheme>> = {
  meadow: {
    biome: 'meadow',
    name: 'Sunlit Vanguard',
    mode: 'D Major / Dorian',
    bpm: 108,
    stepsPerBeat: 2,
    stepDuration: stepFromBpm(108, 2),
    bossStepDuration: stepFromBpm(120, 2),
    musicCutoff: 2100,
    bossCutoff: 2400,
    melody: {
      notes: [
        293.66, 0, 440.0, 392.0, 369.99, 440.0, 493.88, 440.0,
        587.33, 523.25, 493.88, 440.0, 392.0, 369.99, 329.63, 293.66
      ],
      waveform: 'triangle',
      volume: 0.24,
      gate: 1.05
    },
    bossMelody: [
      293.66, 440.0, 587.33, 493.88, 440.0, 369.99, 440.0, 587.33,
      659.25, 587.33, 523.25, 493.88, 440.0, 392.0, 369.99, 440.0
    ],
    bass: {
      notes: [146.83, 146.83, 196.0, 146.83, 220.0, 196.0, 164.81, 146.83],
      divide: 2,
      waveform: 'triangle',
      volume: 0.25,
      gate: 1.55
    },
    harmony: {
      notes: [369.99, 0, 0, 0, 440.0, 0, 0, 0, 493.88, 0, 440.0, 0, 392.0, 0, 369.99, 0],
      waveform: 'sine',
      volume: 0.11,
      gate: 1.25
    },
    percussion: {
      pattern: [1, 0, 0, 2, 1, 0, 2, 0, 1, 0, 0, 2, 1, 2, 1, 0],
      lowFreq: 180,
      highFreq: 1600,
      volume: 0.06
    }
  },
  river: {
    biome: 'river',
    name: 'Silverfen Current',
    mode: 'G Pentatonic / Mixolydian',
    bpm: 96,
    stepsPerBeat: 2,
    stepDuration: stepFromBpm(96, 2),
    bossStepDuration: stepFromBpm(108, 2),
    musicCutoff: 1750,
    bossCutoff: 2050,
    melody: {
      notes: [
        392.0, 440.0, 493.88, 587.33, 493.88, 440.0, 392.0, 329.63,
        392.0, 493.88, 587.33, 659.25, 587.33, 523.25, 493.88, 440.0
      ],
      waveform: 'sine',
      volume: 0.24,
      gate: 1.35
    },
    bossMelody: [
      392.0, 493.88, 587.33, 659.25, 783.99, 659.25, 587.33, 493.88,
      523.25, 587.33, 659.25, 587.33, 493.88, 440.0, 392.0, 349.23
    ],
    bass: {
      notes: [196.0, 146.83, 164.81, 130.81, 196.0, 174.61, 146.83, 164.81],
      divide: 2,
      waveform: 'sine',
      volume: 0.26,
      gate: 1.9
    },
    harmony: {
      notes: [
        293.66, 392.0, 493.88, 392.0, 329.63, 392.0, 493.88, 392.0,
        293.66, 392.0, 587.33, 493.88, 349.23, 440.0, 523.25, 440.0
      ],
      waveform: 'triangle',
      volume: 0.13,
      gate: 0.85
    },
    percussion: {
      pattern: [1, 0, 2, 0, 0, 2, 1, 0, 1, 0, 2, 0, 0, 2, 0, 2],
      lowFreq: 210,
      highFreq: 1100,
      volume: 0.045
    }
  },
  crypt: {
    biome: 'crypt',
    name: 'Ashen Catacombs',
    mode: 'E Phrygian / Harmonic Minor',
    bpm: 82,
    stepsPerBeat: 2,
    stepDuration: stepFromBpm(82, 2),
    bossStepDuration: stepFromBpm(94, 2),
    musicCutoff: 1180,
    bossCutoff: 1480,
    melody: {
      notes: [
        329.63, 349.23, 329.63, 0, 392.0, 349.23, 329.63, 311.13,
        329.63, 493.88, 523.25, 493.88, 440.0, 392.0, 349.23, 311.13
      ],
      waveform: 'sawtooth',
      volume: 0.18,
      gate: 1.15
    },
    bossMelody: [
      329.63, 349.23, 493.88, 523.25, 493.88, 349.23, 329.63, 311.13,
      659.25, 523.25, 493.88, 440.0, 392.0, 349.23, 311.13, 329.63
    ],
    bass: {
      notes: [82.41, 82.41, 87.31, 82.41, 123.47, 130.81, 110.0, 77.78],
      divide: 2,
      waveform: 'triangle',
      volume: 0.28,
      gate: 1.95
    },
    harmony: {
      notes: [246.94, 0, 0, 261.63, 0, 0, 246.94, 0, 233.08, 0, 0, 246.94, 0, 261.63, 0, 233.08],
      waveform: 'sine',
      volume: 0.12,
      gate: 1.6
    },
    percussion: {
      pattern: [1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 0],
      lowFreq: 105,
      highFreq: 740,
      volume: 0.055
    }
  },
  frost: {
    biome: 'frost',
    name: 'Frostspire Chimes',
    mode: 'F# Aeolian / A Lydian',
    bpm: 88,
    stepsPerBeat: 2,
    stepDuration: stepFromBpm(88, 2),
    bossStepDuration: stepFromBpm(100, 2),
    musicCutoff: 3200,
    bossCutoff: 3500,
    melody: {
      notes: [
        739.99, 0, 659.25, 554.37, 622.25, 0, 739.99, 880.0,
        987.77, 0, 880.0, 739.99, 659.25, 622.25, 554.37, 0
      ],
      waveform: 'sine',
      volume: 0.22,
      gate: 1.65
    },
    bossMelody: [
      739.99, 880.0, 987.77, 1108.73, 987.77, 880.0, 739.99, 622.25,
      739.99, 659.25, 554.37, 622.25, 739.99, 880.0, 739.99, 659.25
    ],
    bass: {
      notes: [185.0, 185.0, 164.81, 146.83, 220.0, 185.0, 164.81, 138.59],
      divide: 2,
      waveform: 'sine',
      volume: 0.22,
      gate: 2.0
    },
    harmony: {
      notes: [0, 1108.73, 0, 0, 0, 987.77, 0, 0, 0, 1318.51, 0, 0, 0, 1108.73, 0, 880.0],
      waveform: 'triangle',
      volume: 0.10,
      gate: 1.4
    },
    percussion: {
      pattern: [0, 0, 2, 0, 0, 0, 2, 0, 1, 0, 2, 0, 0, 0, 2, 0],
      lowFreq: 240,
      highFreq: 2800,
      volume: 0.04
    }
  },
  volcano: {
    biome: 'volcano',
    name: 'Emberwaste Forge',
    mode: 'C Phrygian Dominant / Diminished',
    bpm: 126,
    stepsPerBeat: 2,
    stepDuration: stepFromBpm(126, 2),
    bossStepDuration: stepFromBpm(136, 2),
    musicCutoff: 1600,
    bossCutoff: 1950,
    melody: {
      notes: [
        261.63, 277.18, 329.63, 277.18, 261.63, 0, 392.0, 369.99,
        349.23, 329.63, 277.18, 261.63, 415.3, 392.0, 329.63, 277.18
      ],
      waveform: 'sawtooth',
      volume: 0.22,
      gate: 0.80
    },
    bossMelody: [
      261.63, 277.18, 329.63, 392.0, 415.3, 392.0, 369.99, 329.63,
      523.25, 415.3, 392.0, 369.99, 329.63, 277.18, 329.63, 261.63
    ],
    bass: {
      notes: [
        130.81, 0, 130.81, 138.59, 130.81, 0, 164.81, 138.59,
        130.81, 0, 130.81, 196.0, 185.0, 164.81, 138.59, 130.81
      ],
      divide: 1,
      waveform: 'square',
      volume: 0.21,
      gate: 0.72
    },
    harmony: {
      notes: [196.0, 0, 0, 0, 185.0, 0, 0, 0, 196.0, 0, 185.0, 0, 207.65, 0, 196.0, 0],
      waveform: 'sawtooth',
      volume: 0.13,
      gate: 0.65
    },
    percussion: {
      pattern: [1, 0, 2, 0, 1, 2, 1, 0, 1, 0, 2, 1, 1, 2, 2, 1],
      lowFreq: 110,
      highFreq: 1850,
      volume: 0.12
    }
  },
  throne: {
    biome: 'throne',
    name: 'Eclipse Sovereign',
    mode: 'A Imperial Harmonic Minor',
    bpm: 114,
    stepsPerBeat: 2,
    stepDuration: stepFromBpm(114, 2),
    bossStepDuration: stepFromBpm(124, 2),
    musicCutoff: 2450,
    bossCutoff: 2750,
    melody: {
      notes: [
        440.0, 0, 523.25, 493.88, 440.0, 659.25, 622.25, 587.33,
        523.25, 493.88, 415.3, 440.0, 659.25, 698.46, 659.25, 415.3
      ],
      waveform: 'sawtooth',
      volume: 0.24,
      gate: 1.25
    },
    bossMelody: [
      440.0, 523.25, 659.25, 622.25, 659.25, 880.0, 830.61, 698.46,
      659.25, 587.33, 523.25, 493.88, 440.0, 415.3, 523.25, 659.25
    ],
    bass: {
      notes: [110.0, 110.0, 87.31, 98.0, 110.0, 130.81, 116.54, 103.83],
      divide: 2,
      waveform: 'sawtooth',
      volume: 0.26,
      gate: 1.85
    },
    harmony: {
      notes: [
        220.0, 0, 261.63, 0, 329.63, 0, 311.13, 0,
        261.63, 0, 207.65, 0, 329.63, 349.23, 329.63, 207.65
      ],
      waveform: 'square',
      volume: 0.11,
      gate: 1.55
    },
    percussion: {
      pattern: [1, 0, 0, 1, 1, 0, 2, 0, 1, 0, 1, 0, 1, 2, 1, 2],
      lowFreq: 85,
      highFreq: 920,
      volume: 0.11
    }
  }
}

/**
 * Six distinct ambient soundscape bed profiles (noise filter, continuous drone, procedural accents).
 */
export const BIOME_AMBIENT_PROFILES: Readonly<Record<BiomeId, BiomeAmbientProfile>> = {
  meadow: {
    biome: 'meadow',
    character: 'soft wind & bird-like airy pastoral shimmer',
    bedId: 'meadow_wind',
    noiseBed: { type: 'bandpass', frequency: 540, q: 1.4, gain: 0.018 },
    drone: {
      frequency: 293.66,
      harmonicFrequency: 440.0,
      waveform: 'sine',
      filterType: 'lowpass',
      filterFrequency: 900,
      filterQ: 0.8,
      gain: 0.012,
      pulseRateHz: 0.25,
      pulseDepth: 0.22
    },
    accent: {
      kind: 'bird',
      intervalMin: 2.6,
      intervalMax: 4.8,
      frequencies: [1174.66, 1318.51, 1479.98, 1760.0],
      duration: 0.14,
      volume: 0.024
    }
  },
  river: {
    biome: 'river',
    character: 'gentle filtered flowing water current & soft ripples',
    bedId: 'river_current',
    noiseBed: { type: 'bandpass', frequency: 780, q: 0.95, gain: 0.028 },
    drone: {
      frequency: 196.0,
      harmonicFrequency: 293.66,
      waveform: 'triangle',
      filterType: 'bandpass',
      filterFrequency: 620,
      filterQ: 1.2,
      gain: 0.014,
      pulseRateHz: 0.42,
      pulseDepth: 0.30
    },
    accent: {
      kind: 'ripple',
      intervalMin: 1.5,
      intervalMax: 3.1,
      noiseFrequency: 1250,
      noiseType: 'bandpass',
      duration: 0.18,
      volume: 0.032
    }
  },
  crypt: {
    biome: 'crypt',
    character: 'low resonant cavern drone & eerie catacomb whispers',
    bedId: 'crypt_cavern',
    noiseBed: { type: 'bandpass', frequency: 210, q: 3.2, gain: 0.026 },
    drone: {
      frequency: 82.41,
      harmonicFrequency: 123.47,
      waveform: 'sawtooth',
      filterType: 'lowpass',
      filterFrequency: 240,
      filterQ: 3.5,
      gain: 0.024,
      pulseRateHz: 0.18,
      pulseDepth: 0.35
    },
    accent: {
      kind: 'whisper',
      intervalMin: 2.8,
      intervalMax: 5.2,
      frequencies: [164.81, 174.61, 155.56],
      noiseFrequency: 460,
      noiseType: 'bandpass',
      duration: 0.42,
      volume: 0.028
    }
  },
  frost: {
    biome: 'frost',
    character: 'whistling cold high-band alpine wind & crystalline ice chimes',
    bedId: 'frost_gale',
    noiseBed: { type: 'bandpass', frequency: 1650, q: 4.2, gain: 0.020 },
    drone: {
      frequency: 369.99,
      harmonicFrequency: 554.37,
      waveform: 'sine',
      filterType: 'highpass',
      filterFrequency: 320,
      filterQ: 1.8,
      gain: 0.011,
      pulseRateHz: 0.32,
      pulseDepth: 0.25
    },
    accent: {
      kind: 'chime',
      intervalMin: 2.0,
      intervalMax: 4.0,
      frequencies: [1479.98, 1760.0, 1975.53, 2217.46],
      duration: 0.34,
      volume: 0.022
    }
  },
  volcano: {
    biome: 'volcano',
    character: 'deep molten magma rumble & sharp ember crackles',
    bedId: 'volcano_magma',
    noiseBed: { type: 'lowpass', frequency: 165, q: 1.6, gain: 0.040 },
    drone: {
      frequency: 65.41,
      harmonicFrequency: 92.5,
      waveform: 'sawtooth',
      filterType: 'lowpass',
      filterFrequency: 150,
      filterQ: 2.4,
      gain: 0.028,
      pulseRateHz: 0.55,
      pulseDepth: 0.38
    },
    accent: {
      kind: 'crackle',
      intervalMin: 0.9,
      intervalMax: 2.2,
      noiseFrequency: 2200,
      noiseType: 'highpass',
      duration: 0.065,
      volume: 0.044
    }
  },
  throne: {
    biome: 'throne',
    character: 'ominous low cathedral resonance & solemn eclipse pulse',
    bedId: 'throne_eclipse',
    noiseBed: { type: 'lowpass', frequency: 260, q: 2.8, gain: 0.028 },
    drone: {
      frequency: 55.0,
      harmonicFrequency: 82.41,
      waveform: 'sawtooth',
      filterType: 'lowpass',
      filterFrequency: 210,
      filterQ: 2.6,
      gain: 0.030,
      pulseRateHz: 0.75,
      pulseDepth: 0.42
    },
    accent: {
      kind: 'eclipse_pulse',
      intervalMin: 2.4,
      intervalMax: 4.2,
      frequencies: [110.0, 164.81, 207.65],
      duration: 0.72,
      volume: 0.032
    }
  }
}

export type SfxMotif = AudioMotif

/**
 * Single source of truth for Crownshard's tonal SFX. The live soundscape plays these (plus noise
 * layers for impacts), and `package-assets.ts` bakes the very same motifs into Godot/console WAVs,
 * keyed by `SoundEvent.kind` (turn/pack split by team/rarity) so ports can map events 1:1.
 */
export const SFX_MOTIFS = {
  step: { notes: [[220, 0.05, 0, 160]], waveform: 'triangle', volume: 0.10 },
  slash: { notes: [[360, 0.12, 0, 150]], waveform: 'sawtooth', volume: 0.18 },
  arrow: { notes: [[920, 0.13, 0, 420]], waveform: 'triangle', volume: 0.26 },
  magic: { notes: [[440, 0.18, 0, 780], [660, 0.22, 0.05, 980]], waveform: 'sine', volume: 0.26 },
  heal: { notes: [[523.25, 0.14, 0], [659.25, 0.16, 0.07], [783.99, 0.24, 0.14]], waveform: 'sine', volume: 0.26 },
  shield: { notes: [[330, 0.14, 0, 495], [660, 0.16, 0.06]], waveform: 'triangle', volume: 0.26 },
  hit: { notes: [[165, 0.11, 0, 82]], waveform: 'square', volume: 0.18 },
  crit: { notes: [[587.33, 0.16, 0, 880], [1174.66, 0.20, 0.06]], waveform: 'sawtooth', volume: 0.24 },
  ko: { notes: [[240, 0.28, 0, 78]], waveform: 'sawtooth', volume: 0.25 },
  card: { notes: [[520, 0.07, 0, 660]], waveform: 'triangle', volume: 0.22 },
  coin: { notes: [[880, 0.08, 0], [1318.5, 0.15, 0.055]], waveform: 'sine', volume: 0.25 },
  equip: { notes: [[392, 0.09, 0], [587.33, 0.14, 0.06]], waveform: 'triangle', volume: 0.26 },
  pack: { notes: [[392, 0.12, 0], [493.88, 0.12, 0.08], [587.33, 0.18, 0.16]], waveform: 'triangle', volume: 0.30 },
  pack_rare: {
    notes: [[392, 0.12, 0], [493.88, 0.12, 0.08], [587.33, 0.18, 0.16], [783.99, 0.28, 0.24], [1174.66, 0.36, 0.34]],
    waveform: 'triangle',
    volume: 0.32
  },
  merge: { notes: [[349.23, 0.14, 0], [440, 0.14, 0.09], [523.25, 0.18, 0.18], [698.46, 0.42, 0.28]], waveform: 'sine', volume: 0.34 },
  turn_ally: { notes: [[440, 0.12, 0], [587.33, 0.18, 0.08]], waveform: 'triangle', volume: 0.24 },
  turn_enemy: { notes: [[246.94, 0.14, 0], [196.0, 0.22, 0.10]], waveform: 'triangle', volume: 0.17 },
  victory: { notes: [[293.66, 0.18, 0], [392, 0.18, 0.12], [440, 0.22, 0.24], [587.33, 0.5, 0.36]], waveform: 'sine', volume: 0.34 },
  defeat: { notes: [[293.66, 0.22, 0], [261.63, 0.24, 0.18], [220, 0.46, 0.38]], waveform: 'triangle', volume: 0.27 }
} as const satisfies Record<string, AudioMotif>

export type SfxMotifId = keyof typeof SFX_MOTIFS

interface ActiveDroneRig {
  readonly biome: BiomeId
  readonly osc: OscillatorNodeLike
  readonly harmonicOsc: OscillatorNodeLike | null
  readonly filter: BiquadFilterNodeLike
  readonly gain: GainNodeLike
  readonly baseGain: number
  readonly pulseRateHz: number
  readonly pulseDepth: number
}

const CROSSFADE_DURATION = 0.45
const BED_RAMP_SECONDS = 0.45

function setParamSmooth(param: AudioParamLike, value: number, time: number, ramp = 0) {
  if (ramp > 0 && typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, ramp)
  } else if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(value, time)
  } else {
    param.value = value
  }
}

function buildSoundscapeBeds(): Record<string, NoiseBedSpec> {
  const beds: Record<string, NoiseBedSpec> = {
    wind: { type: 'bandpass', frequency: 420, q: 1.8, gain: 0.012 },
    fire: { type: 'lowpass', frequency: 320, q: 0.9, gain: 0.026 }
  }
  for (const biome of BIOME_IDS) {
    const profile = BIOME_AMBIENT_PROFILES[biome]
    beds[profile.bedId] = {
      type: profile.noiseBed.type,
      frequency: profile.noiseBed.frequency,
      q: profile.noiseBed.q,
      gain: 0
    }
  }
  return beds
}

export function createCrownshardAudio(options: CrownshardAudioOptions = {}) {
  const sound = createSoundscape({
    master: 0.70,
    music: 0.14,
    sfx: 0.28,
    musicCutoff: 1900,
    motifs: SFX_MOTIFS,
    beds: buildSoundscapeBeds(),
    createContext: options.createContext,
    context: options.context
  })

  const sequencer = sound.createSequencer({
    stepDuration: 0.40,
    melody: { notes: CAMP_MELODY, waveform: 'sine', volume: 0.24, gate: 1.15 },
    bass: { notes: CAMP_BASS, divide: 2, waveform: 'triangle', volume: 0.26, gate: 1.7 }
  })

  let musicMode: MusicMode = 'camp'
  let battleBiome: BiomeId | null = null
  let crossfade = 1
  let ambienceClock = 0
  let accentTimer = 1.6
  let accentStep = 0
  let activeDrone: ActiveDroneRig | null = null

  function teardownDrone() {
    if (!activeDrone) return
    const rig = activeDrone
    activeDrone = null
    const now = sound.context?.currentTime ?? 0
    try {
      setParamSmooth(rig.gain.gain, 0.0001, now, 0.02)
      rig.osc.stop(now)
    } catch { /* oscillator may already be stopped */ }
    try { rig.osc.disconnect?.() } catch { /* ignore */ }
    if (rig.harmonicOsc) {
      try { rig.harmonicOsc.stop(now) } catch { /* ignore */ }
      try { rig.harmonicOsc.disconnect?.() } catch { /* ignore */ }
    }
    try { rig.filter.disconnect?.() } catch { /* ignore */ }
    try { rig.gain.disconnect?.() } catch { /* ignore */ }
  }

  function syncDrone() {
    const targetBiome = musicMode === 'battle' ? battleBiome : null
    if (!targetBiome || !sound.running || sound.isMuted()) {
      teardownDrone()
      return
    }
    if (activeDrone && activeDrone.biome === targetBiome) return
    teardownDrone()

    const ctx = sound.context
    const buses = sound.buses
    if (!ctx || !buses) return
    if (typeof ctx.createOscillator !== 'function' || typeof ctx.createBiquadFilter !== 'function') return

    const spec = BIOME_AMBIENT_PROFILES[targetBiome].drone
    const now = ctx.currentTime
    const filter = ctx.createBiquadFilter()
    filter.type = spec.filterType
    setParamSmooth(filter.frequency, spec.filterFrequency, now)
    setParamSmooth(filter.Q, spec.filterQ, now)

    const gain = ctx.createGain()
    setParamSmooth(gain.gain, 0.0001, now)
    setParamSmooth(gain.gain, spec.gain, now, 0.35)

    const osc = ctx.createOscillator()
    osc.type = spec.waveform
    setParamSmooth(osc.frequency, spec.frequency, now)
    osc.connect(filter)

    let harmonicOsc: OscillatorNodeLike | null = null
    if (spec.harmonicFrequency !== undefined && spec.harmonicFrequency > 0) {
      harmonicOsc = ctx.createOscillator()
      harmonicOsc.type = spec.waveform === 'sawtooth' ? 'triangle' : spec.waveform
      setParamSmooth(harmonicOsc.frequency, spec.harmonicFrequency, now)
      harmonicOsc.connect(filter)
    }

    filter.connect(gain)
    gain.connect(buses.ambience)

    osc.start(now)
    harmonicOsc?.start(now)

    activeDrone = {
      biome: targetBiome,
      osc,
      harmonicOsc,
      filter,
      gain,
      baseGain: spec.gain,
      pulseRateHz: spec.pulseRateHz,
      pulseDepth: spec.pulseDepth
    }
  }

  function syncAmbientBeds(isBoss = false) {
    if (!sound.running) return
    const activeBiome = musicMode === 'battle' ? battleBiome : null

    if (activeBiome) {
      const theme = BIOME_MUSIC_THEMES[activeBiome]
      sound.setBed('fire', { gain: activeBiome === 'volcano' ? 0.012 : 0, ramp: BED_RAMP_SECONDS })
      sound.setBed('wind', { gain: activeBiome === 'meadow' ? 0.006 : 0, ramp: BED_RAMP_SECONDS })
      for (const biome of BIOME_IDS) {
        const p = BIOME_AMBIENT_PROFILES[biome]
        const targetGain = biome === activeBiome ? (p.noiseBed.gain ?? 0.02) : 0
        sound.setBed(p.bedId, {
          gain: targetGain,
          frequency: p.noiseBed.frequency,
          ramp: BED_RAMP_SECONDS
        })
      }
      sound.setMusicFilter(isBoss ? theme.bossCutoff : theme.musicCutoff, 0.35)
    } else if (musicMode === 'world') {
      sound.setBed('fire', { gain: 0.004, ramp: BED_RAMP_SECONDS })
      sound.setBed('wind', { gain: 0.020, frequency: 480, ramp: BED_RAMP_SECONDS })
      for (const biome of BIOME_IDS) {
        sound.setBed(BIOME_AMBIENT_PROFILES[biome].bedId, { gain: 0, ramp: BED_RAMP_SECONDS })
      }
      sound.setMusicFilter(1650, 0.35)
    } else {
      sound.setBed('fire', { gain: 0.026, ramp: BED_RAMP_SECONDS })
      sound.setBed('wind', { gain: 0.012, frequency: 420, ramp: BED_RAMP_SECONDS })
      for (const biome of BIOME_IDS) {
        sound.setBed(BIOME_AMBIENT_PROFILES[biome].bedId, { gain: 0, ramp: BED_RAMP_SECONDS })
      }
      sound.setMusicFilter(1400, 0.35)
    }
  }

  function triggerBiomeAccent(biome: BiomeId) {
    if (!sound.running || sound.isMuted()) return
    const accent = BIOME_AMBIENT_PROFILES[biome].accent
    const idx = accentStep++
    const freqs = accent.frequencies
    const pickFreq = freqs && freqs.length > 0 ? freqs[idx % freqs.length] : 0

    switch (accent.kind) {
      case 'bird':
        if (pickFreq > 0) {
          sound.tone({
            frequency: pickFreq,
            endFrequency: pickFreq * 1.18,
            duration: accent.duration,
            type: 'sine',
            volume: accent.volume,
            bus: 'ambience'
          })
          sound.tone({
            frequency: pickFreq * 1.12,
            endFrequency: pickFreq * 1.32,
            duration: accent.duration * 0.85,
            delay: accent.duration * 0.9,
            type: 'sine',
            volume: accent.volume * 0.8,
            bus: 'ambience'
          })
        }
        break
      case 'ripple':
        sound.noiseBurst({
          duration: accent.duration,
          frequency: (accent.noiseFrequency ?? 1250) * (0.9 + (idx % 3) * 0.1),
          type: accent.noiseType ?? 'bandpass',
          volume: accent.volume,
          bus: 'ambience'
        })
        break
      case 'whisper':
        sound.noiseBurst({
          duration: accent.duration,
          frequency: (accent.noiseFrequency ?? 460) * (0.88 + (idx % 4) * 0.08),
          type: accent.noiseType ?? 'bandpass',
          volume: accent.volume,
          bus: 'ambience'
        })
        if (pickFreq > 0) {
          sound.tone({
            frequency: pickFreq,
            endFrequency: pickFreq * 0.94,
            duration: accent.duration * 1.1,
            type: 'sine',
            volume: accent.volume * 0.45,
            bus: 'ambience'
          })
        }
        break
      case 'chime':
        if (pickFreq > 0) {
          sound.tone({
            frequency: pickFreq,
            duration: accent.duration,
            type: 'sine',
            volume: accent.volume,
            bus: 'ambience'
          })
        }
        break
      case 'crackle':
        sound.noiseBurst({
          duration: accent.duration,
          frequency: (accent.noiseFrequency ?? 2200) * (0.85 + (idx % 4) * 0.14),
          type: accent.noiseType ?? 'highpass',
          volume: accent.volume,
          bus: 'ambience'
        })
        break
      case 'eclipse_pulse':
        if (pickFreq > 0) {
          sound.tone({
            frequency: pickFreq,
            endFrequency: pickFreq * 0.98,
            duration: accent.duration,
            type: 'triangle',
            volume: accent.volume,
            bus: 'ambience'
          })
        }
        break
    }

    const span = Math.max(0.1, accent.intervalMax - accent.intervalMin)
    const frac = ((idx * 37 + 13) % 100) / 100
    accentTimer = accent.intervalMin + span * frac
  }

  function playPercussionStep(percussion: BiomePercussionSpec, ev: StepSequencerStepEvent) {
    if (percussion.pattern.length === 0) return
    const hit = percussion.pattern[ev.stepIndex % percussion.pattern.length]
    if (hit === 1) {
      sound.noiseBurst({
        duration: 0.08,
        frequency: percussion.lowFreq,
        type: 'lowpass',
        volume: percussion.volume,
        bus: 'music'
      })
    } else if (hit === 2) {
      sound.noiseBurst({
        duration: 0.055,
        frequency: percussion.highFreq,
        type: 'bandpass',
        volume: percussion.volume * 0.75,
        bus: 'music'
      })
    }
  }

  function setMusicMode(nextMode: MusicMode, biome?: BiomeId) {
    const resolvedBiome: BiomeId | null = nextMode === 'battle'
      ? (biome ?? battleBiome ?? 'meadow')
      : null
    const changed = nextMode !== musicMode || resolvedBiome !== battleBiome

    musicMode = nextMode
    battleBiome = resolvedBiome

    if (changed) {
      crossfade = 0
      sequencer.reset()
      if (resolvedBiome) {
        accentTimer = BIOME_AMBIENT_PROFILES[resolvedBiome].accent.intervalMin * 0.6
      }
      if (sound.running) {
        sound.setMusicVolume(0.035, 0.08)
      }
      syncAmbientBeds(false)
      syncDrone()
    }
  }

  function setBattleBiome(biome: BiomeId) {
    setMusicMode('battle', biome)
  }

  function playSfx(ev: SoundEvent) {
    switch (ev.kind) {
      case 'step':
        // Footsteps stay pure noise live (the baked motif is a tonal stand-in for WAV-only ports).
        sound.noiseBurst({ duration: 0.055, frequency: 460 * (ev.pitch ?? 1), type: 'bandpass', volume: 0.16 })
        break
      case 'slash':
        sound.noiseBurst({ duration: 0.11, frequency: 1450 * (ev.pitch ?? 1), type: 'bandpass', volume: 0.26 })
        sound.playMotif('slash', { pitch: ev.pitch })
        break
      case 'arrow':
        sound.playMotif('arrow', { pitch: ev.pitch })
        sound.noiseBurst({ duration: 0.07, frequency: 2400, type: 'highpass', volume: 0.14 })
        break
      case 'hit':
        sound.noiseBurst({ duration: 0.09, frequency: 320, type: 'lowpass', volume: 0.34 })
        sound.playMotif('hit', { pitch: ev.pitch })
        break
      case 'crit':
        sound.noiseBurst({ duration: 0.14, frequency: 640, type: 'bandpass', volume: 0.38 })
        sound.playMotif('crit', { pitch: ev.pitch })
        break
      case 'ko':
        sound.playMotif('ko', { pitch: ev.pitch })
        sound.noiseBurst({ duration: 0.22, frequency: 260, type: 'lowpass', volume: 0.30 })
        break
      case 'magic':
      case 'card':
        sound.playMotif(ev.kind, { pitch: ev.pitch })
        break
      case 'heal':
      case 'shield':
      case 'coin':
        sound.playMotif(ev.kind)
        break
      case 'pack':
        sound.playMotif(ev.rarity === 'legendary' || ev.rarity === 'epic' ? 'pack_rare' : 'pack')
        break
      case 'turn':
        sound.playMotif(ev.team === 'ally' ? 'turn_ally' : 'turn_enemy')
        break
      case 'merge':
      case 'equip':
      case 'victory':
      case 'defeat':
        sound.playMotif(ev.kind)
        break
    }
  }

  function update(state: GameState, dt: number, active: boolean) {
    if (state.sounds.length) {
      for (const ev of state.sounds) playSfx(ev)
      state.sounds.length = 0
    }

    // Auto-sync battle biome if state entered/left battle without an explicit setMusicMode call.
    if (state.battle) {
      if (musicMode !== 'battle' || battleBiome !== state.battle.biome) {
        setMusicMode('battle', state.battle.biome)
      }
    } else if (musicMode === 'battle') {
      setMusicMode('camp')
    }

    if (!sound.running) return

    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0
    const isBoss = Boolean(state.battle?.units.some(u => u.alive && u.isBoss))

    if (crossfade < 1) {
      crossfade = Math.min(1, crossfade + safeDt / CROSSFADE_DURATION)
    }
    const baseMusicVolume = active ? 0.14 : 0.09
    const fadedVolume = baseMusicVolume * (0.25 + 0.75 * crossfade)
    sound.setMusicVolume(fadedVolume, 0.12)

    syncAmbientBeds(isBoss)
    syncDrone()

    if (activeDrone && sound.context && safeDt > 0) {
      ambienceClock += safeDt
      const wave = 1 + Math.sin(ambienceClock * Math.PI * 2 * activeDrone.pulseRateHz) * activeDrone.pulseDepth
      const targetGain = Math.max(0.0001, activeDrone.baseGain * wave)
      setParamSmooth(activeDrone.gain.gain, targetGain, sound.context.currentTime, 0.18)
    }

    if (musicMode === 'battle' && battleBiome) {
      if (safeDt > 0 && !sound.isMuted()) {
        accentTimer -= safeDt
        if (accentTimer <= 0) {
          triggerBiomeAccent(battleBiome)
        }
      }

      const theme = BIOME_MUSIC_THEMES[battleBiome]
      const melodyTrack: SequencerTrack = isBoss
        ? { ...theme.melody, notes: theme.bossMelody }
        : theme.melody
      const percussion = theme.percussion

      sequencer.step(safeDt, {
        stepDuration: isBoss ? theme.bossStepDuration : theme.stepDuration,
        melody: melodyTrack,
        bass: theme.bass,
        tracks: [theme.harmony],
        onStep: percussion ? ev => playPercussionStep(percussion, ev) : undefined
      })
    } else if (musicMode === 'world') {
      sequencer.step(safeDt, {
        stepDuration: 0.36,
        melody: { notes: WORLD_MELODY, waveform: 'triangle', volume: 0.21, gate: 1.2 },
        bass: { notes: WORLD_BASS, divide: 2, waveform: 'triangle', volume: 0.23, gate: 1.7 },
        tracks: [WORLD_HARMONY],
        onStep: undefined
      })
    } else {
      sequencer.step(safeDt, {
        stepDuration: 0.40,
        melody: { notes: CAMP_MELODY, waveform: 'sine', volume: 0.24, gate: 1.15 },
        bass: { notes: CAMP_BASS, divide: 2, waveform: 'triangle', volume: 0.26, gate: 1.7 },
        tracks: [],
        onStep: undefined
      })
    }
  }

  return {
    unlock() {
      sound.unlock()
      syncAmbientBeds(false)
      syncDrone()
    },
    update,
    setMusicMode,
    setBattleBiome,
    getMusicMode: (): MusicMode => musicMode,
    getBattleBiome: (): BiomeId | null => battleBiome,
    setMuted(value: boolean) {
      sound.setMuted(value)
      if (value) teardownDrone()
      else syncDrone()
    },
    isMuted: sound.isMuted,
    setMusic: sound.setMusicEnabled,
    isMusicEnabled: sound.isMusicEnabled,
    suspend() {
      sound.suspend()
    },
    resume() {
      sound.resume()
      syncDrone()
    },
    close() {
      teardownDrone()
      sound.close()
    }
  }
}
