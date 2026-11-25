import { createSoundscape } from 'ridgetop'
import type { GameState, SoundEvent } from './types.ts'

// Heroic D-minor / D-Dorian tactical score motifs (Hz)
const CAMP_MELODY = [
  293.66, 349.23, 440.0, 392.0, 349.23, 329.63, 293.66, 0,
  349.23, 440.0, 523.25, 440.0, 392.0, 349.23, 329.63, 0
]
const BATTLE_MELODY = [
  293.66, 293.66, 440.0, 392.0, 349.23, 329.63, 293.66, 261.63,
  293.66, 349.23, 440.0, 523.25, 440.0, 392.0, 349.23, 0
]
const BOSS_MELODY = [
  220.0, 0, 261.63, 246.94, 220.0, 329.63, 311.13, 293.66,
  220.0, 261.63, 329.63, 392.0, 349.23, 329.63, 261.63, 246.94
]
const BASS_LINE = [146.83, 146.83, 110.0, 110.0, 130.81, 130.81, 146.83, 110.0]

type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth'
/** `[frequency, duration, delay, endFrequency?]` — the same note format `ridgetop package` bakes into WAVs. */
type MotifNote = readonly [number, number, number, number?]
export interface SfxMotif {
  readonly notes: readonly MotifNote[]
  readonly waveform: Waveform
  readonly volume: number
}

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
} as const satisfies Record<string, SfxMotif>

export type SfxMotifId = keyof typeof SFX_MOTIFS

export function createCrownshardAudio() {
  const sound = createSoundscape({
    master: 0.70,
    music: 0.14,
    sfx: 0.28,
    musicCutoff: 1900,
    beds: {
      wind: { type: 'bandpass', frequency: 420, q: 1.8, gain: 0.014 },
      fire: { type: 'lowpass', frequency: 320, q: 0.9, gain: 0.02 }
    }
  })

  let stepIndex = 0
  let stepAccum = 0

  function playMotif(id: SfxMotifId, pitch = 1) {
    const motif: SfxMotif = SFX_MOTIFS[id]
    for (const [frequency, duration, delay, endFrequency] of motif.notes) {
      sound.tone({
        frequency: frequency * pitch,
        endFrequency: endFrequency === undefined ? undefined : endFrequency * pitch,
        duration,
        delay,
        type: motif.waveform,
        volume: motif.volume
      })
    }
  }

  function playSfx(ev: SoundEvent) {
    switch (ev.kind) {
      case 'step':
        // Footsteps stay pure noise live (the baked motif is a tonal stand-in for WAV-only ports).
        sound.noiseBurst({ duration: 0.055, frequency: 460 * (ev.pitch ?? 1), type: 'bandpass', volume: 0.16 })
        break
      case 'slash':
        sound.noiseBurst({ duration: 0.11, frequency: 1450 * (ev.pitch ?? 1), type: 'bandpass', volume: 0.26 })
        playMotif('slash', ev.pitch)
        break
      case 'arrow':
        playMotif('arrow', ev.pitch)
        sound.noiseBurst({ duration: 0.07, frequency: 2400, type: 'highpass', volume: 0.14 })
        break
      case 'hit':
        sound.noiseBurst({ duration: 0.09, frequency: 320, type: 'lowpass', volume: 0.34 })
        playMotif('hit', ev.pitch)
        break
      case 'crit':
        sound.noiseBurst({ duration: 0.14, frequency: 640, type: 'bandpass', volume: 0.38 })
        playMotif('crit', ev.pitch)
        break
      case 'ko':
        playMotif('ko', ev.pitch)
        sound.noiseBurst({ duration: 0.22, frequency: 260, type: 'lowpass', volume: 0.30 })
        break
      case 'magic':
      case 'card':
        playMotif(ev.kind, ev.pitch)
        break
      case 'heal':
      case 'shield':
      case 'coin':
        playMotif(ev.kind)
        break
      case 'pack':
        playMotif(ev.rarity === 'legendary' || ev.rarity === 'epic' ? 'pack_rare' : 'pack')
        break
      case 'turn':
        playMotif(ev.team === 'ally' ? 'turn_ally' : 'turn_enemy')
        break
      case 'merge':
      case 'equip':
      case 'victory':
      case 'defeat':
        playMotif(ev.kind)
        break
    }
  }

  function update(state: GameState, dt: number, active: boolean) {
    if (state.sounds.length) {
      for (const ev of state.sounds) playSfx(ev)
      state.sounds.length = 0
    }
    if (!sound.running) return

    const inBattle = Boolean(state.battle)
    const isBoss = Boolean(state.battle?.units.some(u => u.alive && u.isBoss))
    sound.setBed('fire', { gain: inBattle ? 0.004 : 0.026 })
    sound.setBed('wind', { gain: inBattle ? 0.020 : 0.012 })
    sound.setMusicFilter(isBoss ? 2200 : inBattle ? 1850 : 1400)
    sound.setMusicVolume(active ? 0.14 : 0.09)

    if (!sound.isMusicEnabled() || sound.isMuted()) return

    const stepLen = isBoss ? 0.26 : inBattle ? 0.32 : 0.40
    stepAccum += dt
    if (stepAccum >= stepLen) {
      stepAccum -= stepLen
      const melody = isBoss ? BOSS_MELODY : inBattle ? BATTLE_MELODY : CAMP_MELODY
      const note = melody[stepIndex % melody.length]
      if (note > 0) {
        sound.tone({
          frequency: note,
          duration: stepLen * 1.15,
          type: inBattle ? 'triangle' : 'sine',
          volume: 0.24,
          bus: 'music'
        })
      }
      if (stepIndex % 2 === 0) {
        const bass = BASS_LINE[(stepIndex >> 1) % BASS_LINE.length]
        sound.tone({
          frequency: bass,
          duration: stepLen * 1.7,
          type: 'triangle',
          volume: 0.26,
          bus: 'music'
        })
      }
      stepIndex = (stepIndex + 1) % 32
    }
  }

  return {
    unlock: sound.unlock,
    update,
    setMuted: sound.setMuted,
    isMuted: sound.isMuted,
    setMusic: sound.setMusicEnabled,
    isMusicEnabled: sound.isMusicEnabled,
    suspend: sound.suspend,
    resume: sound.resume,
    close: sound.close
  }
}
