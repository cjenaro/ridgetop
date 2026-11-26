import { createSoundscape } from 'ridgetop'
import type { AudioMotif } from 'ridgetop'
import type { GameState, SoundEvent, WeatherKind } from './types.ts'

// D Dorian sea-shanty scale frequencies (Hz)
const MELODY_CLEAR = [293.66, 329.63, 349.23, 440.0, 392.0, 349.23, 329.63, 293.66,
  349.23, 440.0, 523.25, 440.0, 392.0, 349.23, 329.63, 0]
const MELODY_STORM = [293.66, 0, 349.23, 329.63, 293.66, 261.63, 220.0, 261.63,
  293.66, 349.23, 440.0, 349.23, 329.63, 293.66, 220.0, 0]
const BASS_LINE = [146.83, 146.83, 130.81, 130.81, 110.0, 110.0, 130.81, 146.83]

/**
 * Single source of truth for Tidewatch's tonal SFX motifs, shared between live playback
 * and `package-assets.ts` WAV baking.
 */
export const SFX_MOTIFS = {
  pickup: { notes: [[460, 0.11, 0, 690]], waveform: 'triangle', volume: 0.34 },
  sell: { notes: [[740, 0.09, 0], [1080, 0.14, 0.055]], waveform: 'triangle', volume: 0.28 },
  fuel: { notes: [[220, 0.16, 0, 440]], waveform: 'triangle', volume: 0.32 },
  upgrade: {
    notes: [[392, 0.16, 0], [493.88, 0.16, 0.09], [587.33, 0.22, 0.18], [783.99, 0.36, 0.28]],
    waveform: 'sine',
    volume: 0.36
  },
  foghorn: { notes: [[116.54, 0.85, 0, 110], [174.61, 0.82, 0.02, 168]], waveform: 'sawtooth', volume: 0.20 },
  thunder: { notes: [[62, 0.9, 0.05, 34]], waveform: 'sawtooth', volume: 0.16 },
  tideLow: { notes: [[523.25, 0.18, 0], [392.0, 0.26, 0.14]], waveform: 'sine', volume: 0.22 },
  tideHigh: { notes: [[329.63, 0.18, 0], [440.0, 0.26, 0.14]], waveform: 'sine', volume: 0.22 },
  full: { notes: [[240, 0.12, 0, 180]], waveform: 'square', volume: 0.14 },
  victory: {
    notes: [[293.66, 0.2, 0], [392.0, 0.2, 0.14], [493.88, 0.24, 0.28], [587.33, 0.52, 0.42]],
    waveform: 'sine',
    volume: 0.36
  }
} as const satisfies Record<string, AudioMotif>

/**
 * Tidewatch adaptive coastal music, weather ambience, and maritime SFX
 * built cleanly on Ridgetop's unified multi-bus `createSoundscape`.
 */
export function createLighthouseAudio() {
  const sound = createSoundscape({
    master: 0.72,
    music: 0.16,
    sfx: 0.28,
    musicCutoff: 1800,
    motifs: SFX_MOTIFS,
    beds: {
      ocean: { type: 'lowpass', frequency: 380, q: 0.7, gain: 0.07 },
      wind: { type: 'bandpass', frequency: 520, q: 2.2, gain: 0.015 },
      rain: { type: 'highpass', frequency: 2400, q: 0.5, gain: 0 }
    }
  })

  const sequencer = sound.createSequencer({
    stepDuration: 0.34,
    melody: { notes: MELODY_CLEAR, waveform: 'triangle', volume: 0.26, gate: 1.15 },
    bass: { notes: BASS_LINE, divide: 2, waveform: 'triangle', volume: 0.28, gate: 1.85 }
  })

  function playSfx(event: SoundEvent) {
    const pitch = event.pitch ?? 1
    switch (event.kind) {
      case 'pickup':
      case 'sell':
        sound.playMotif(event.kind, { pitch })
        break
      case 'fuel':
        sound.playMotif('fuel', { pitch })
        sound.noiseBurst({ duration: 0.14, frequency: 900, type: 'bandpass', volume: 0.16 })
        break
      case 'thunder':
        sound.noiseBurst({ duration: 1.45, frequency: 160, type: 'lowpass', volume: 0.55 })
        sound.playMotif('thunder')
        break
      case 'step':
        sound.noiseBurst({ duration: 0.05, frequency: 520 * pitch, type: 'bandpass', volume: 0.10 })
        break
      case 'splash':
        sound.noiseBurst({ duration: 0.11, frequency: 1350 * pitch, type: 'bandpass', volume: 0.18 })
        break
      case 'upgrade':
      case 'foghorn':
      case 'tideLow':
      case 'tideHigh':
      case 'full':
      case 'victory':
        sound.playMotif(event.kind)
        break
    }
  }

  function update(state: GameState, dt: number, playing: boolean) {
    if (state.sounds.length) {
      for (const ev of state.sounds) playSfx(ev)
      state.sounds.length = 0
    }
    if (!sound.running) return

    const weather: WeatherKind = state.weather
    const swell = 0.5 + 0.5 * Math.sin(state.time * 0.85)
    const tideNorm = Math.max(0, Math.min(1, (state.tideLevel + 0.22) / 0.72))
    const stormBoost = weather === 'storm' ? 1.85 : weather === 'rain' ? 1.3 : 1.0

    sound.setBed('ocean', {
      gain: (0.055 + tideNorm * 0.045 + swell * 0.028) * stormBoost,
      frequency: 280 + swell * 220 + (weather === 'storm' ? 320 : 0)
    })
    sound.setBed('wind', {
      gain: weather === 'storm' ? 0.14 : weather === 'rain' ? 0.055 : weather === 'fog' ? 0.032 : 0.014,
      frequency: weather === 'storm' ? 680 + Math.sin(state.time * 1.4) * 240 : 420
    })
    sound.setBed('rain', {
      gain: weather === 'storm' ? 0.085 : weather === 'rain' ? 0.055 : 0
    })

    const cutoff = weather === 'storm' ? 1350 : weather === 'fog' ? 920 : weather === 'rain' ? 1250 : 2100
    sound.setMusicFilter(cutoff)
    sound.setMusicVolume(playing ? 0.15 : 0.10)

    sequencer.step(dt, {
      stepDuration: weather === 'storm' ? 0.28 : weather === 'fog' ? 0.44 : 0.34,
      melody: weather === 'storm' || weather === 'rain' ? MELODY_STORM : MELODY_CLEAR,
      melodyWaveform: weather === 'fog' ? 'sine' : 'triangle',
      onStep: weather !== 'fog'
        ? ({ stepIndex, stepDuration, melodyNote }) => {
            if (melodyNote > 0 && stepIndex % 4 === 0) {
              sound.tone({ frequency: melodyNote * 0.75, duration: stepDuration * 1.6, type: 'sine', volume: 0.14, bus: 'music' })
            }
          }
        : undefined
    })
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
