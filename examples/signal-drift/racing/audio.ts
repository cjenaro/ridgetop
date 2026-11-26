import { createSynthAudio } from 'ridgetop'
import type { AudioMotif } from 'ridgetop'

/** Shared Signal Drift synth motifs for live Web Audio playback and `package-assets.ts` WAV baking. */
export const AUDIO_MOTIFS = {
  pulse: { notes: [[610, 0.12, 0, 240]], waveform: 'triangle' },
  snare: { notes: [[300, 0.18, 0, 105]], waveform: 'sine' },
  hit: { notes: [[175, 0.2, 0, 68]], waveform: 'triangle' },
  go: { notes: [[660, 0.15, 0], [880, 0.20, 0.10]], waveform: 'sine' },
  podium: { notes: [[392, 0.18, 0], [523, 0.17, 0.12], [660, 0.24, 0.26], [784, 0.38, 0.42]], waveform: 'sine' }
} as const satisfies Record<string, AudioMotif>

export function createRaceAudio() {
  return createSynthAudio(AUDIO_MOTIFS, { volume: 0.13 })
}
