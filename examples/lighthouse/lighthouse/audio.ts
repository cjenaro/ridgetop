import { createSoundscape } from 'ridgetop'
import type { GameState, SoundEvent, WeatherKind } from './types.ts'

// D Dorian sea-shanty scale frequencies (Hz)
const MELODY_CLEAR = [293.66, 329.63, 349.23, 440.0, 392.0, 349.23, 329.63, 293.66,
  349.23, 440.0, 523.25, 440.0, 392.0, 349.23, 329.63, 0]
const MELODY_STORM = [293.66, 0, 349.23, 329.63, 293.66, 261.63, 220.0, 261.63,
  293.66, 349.23, 440.0, 349.23, 329.63, 293.66, 220.0, 0]
const BASS_LINE = [146.83, 146.83, 130.81, 130.81, 110.0, 110.0, 130.81, 146.83]

/**
 * Tidewatch adaptive coastal music, weather ambience, and maritime SFX
 * built cleanly on Ridgetop's multi-bus `createSoundscape`.
 */
export function createLighthouseAudio() {
  const sound = createSoundscape({
    master: 0.72,
    music: 0.16,
    sfx: 0.28,
    musicCutoff: 1800,
    beds: {
      ocean: { type: 'lowpass', frequency: 380, q: 0.7, gain: 0.07 },
      wind: { type: 'bandpass', frequency: 520, q: 2.2, gain: 0.015 },
      rain: { type: 'highpass', frequency: 2400, q: 0.5, gain: 0 }
    }
  })

  let stepIndex = 0
  let stepAccum = 0

  function playSfx(event: SoundEvent) {
    const p = event.pitch ?? 1
    switch (event.kind) {
      case 'pickup':
        sound.tone({ frequency: 460 * p, endFrequency: 690 * p, duration: 0.11, type: 'triangle', volume: 0.34 })
        break
      case 'sell':
        sound.tone({ frequency: 740 * p, duration: 0.09, type: 'sine', volume: 0.30 })
        sound.tone({ frequency: 1080 * p, duration: 0.14, delay: 0.055, type: 'triangle', volume: 0.26 })
        break
      case 'fuel':
        sound.tone({ frequency: 220 * p, endFrequency: 440 * p, duration: 0.16, type: 'triangle', volume: 0.32 })
        sound.noiseBurst({ duration: 0.14, frequency: 900, type: 'bandpass', volume: 0.16 })
        break
      case 'upgrade':
        sound.tone({ frequency: 392, duration: 0.16, volume: 0.35 })
        sound.tone({ frequency: 493.88, duration: 0.16, delay: 0.09, volume: 0.35 })
        sound.tone({ frequency: 587.33, duration: 0.22, delay: 0.18, volume: 0.38 })
        sound.tone({ frequency: 783.99, duration: 0.36, delay: 0.28, type: 'sine', volume: 0.35 })
        break
      case 'foghorn':
        sound.tone({ frequency: 116.54, endFrequency: 110, duration: 0.85, type: 'sawtooth', volume: 0.22 })
        sound.tone({ frequency: 174.61, endFrequency: 168, duration: 0.82, delay: 0.02, type: 'triangle', volume: 0.18 })
        break
      case 'thunder':
        sound.noiseBurst({ duration: 1.45, frequency: 160, type: 'lowpass', volume: 0.55 })
        sound.tone({ frequency: 62, endFrequency: 34, duration: 0.9, delay: 0.05, type: 'sawtooth', volume: 0.16 })
        break
      case 'tideLow':
        sound.tone({ frequency: 523.25, duration: 0.18, type: 'sine', volume: 0.22 })
        sound.tone({ frequency: 392.0, duration: 0.26, delay: 0.14, type: 'sine', volume: 0.22 })
        break
      case 'tideHigh':
        sound.tone({ frequency: 329.63, duration: 0.18, type: 'sine', volume: 0.22 })
        sound.tone({ frequency: 440.0, duration: 0.26, delay: 0.14, type: 'sine', volume: 0.22 })
        break
      case 'step':
        sound.noiseBurst({ duration: 0.05, frequency: 520 * p, type: 'bandpass', volume: 0.10 })
        break
      case 'splash':
        sound.noiseBurst({ duration: 0.11, frequency: 1350 * p, type: 'bandpass', volume: 0.18 })
        break
      case 'full':
        sound.tone({ frequency: 240, endFrequency: 180, duration: 0.12, type: 'square', volume: 0.14 })
        break
      case 'victory':
        sound.tone({ frequency: 293.66, duration: 0.2, volume: 0.35 })
        sound.tone({ frequency: 392.0, duration: 0.2, delay: 0.14, volume: 0.35 })
        sound.tone({ frequency: 493.88, duration: 0.24, delay: 0.28, volume: 0.36 })
        sound.tone({ frequency: 587.33, duration: 0.52, delay: 0.42, type: 'sine', volume: 0.40 })
        break
    }
  }

  function update(state: GameState, dt: number, playing: boolean) {
    for (const ev of state.sounds) playSfx(ev)
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

    if (!sound.isMusicEnabled() || sound.isMuted()) return

    const stepLen = weather === 'storm' ? 0.28 : weather === 'fog' ? 0.44 : 0.34
    stepAccum += dt
    if (stepAccum >= stepLen) {
      stepAccum -= stepLen
      const melody = weather === 'storm' || weather === 'rain' ? MELODY_STORM : MELODY_CLEAR
      const note = melody[stepIndex % melody.length]
      if (note > 0) {
        sound.tone({ frequency: note, duration: stepLen * 1.15, type: weather === 'fog' ? 'sine' : 'triangle', volume: 0.26, bus: 'music' })
        if (stepIndex % 4 === 0 && weather !== 'fog') {
          sound.tone({ frequency: note * 0.75, duration: stepLen * 1.6, type: 'sine', volume: 0.14, bus: 'music' })
        }
      }
      if (stepIndex % 2 === 0) {
        const bass = BASS_LINE[(stepIndex >> 1) % BASS_LINE.length]
        sound.tone({ frequency: bass, duration: stepLen * 1.85, type: 'triangle', volume: 0.28, bus: 'music' })
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
