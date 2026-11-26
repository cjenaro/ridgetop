import { createSynthAudio } from 'ridgetop'
import type { AudioMotif } from 'ridgetop'

/** Shared Beacon Run synth motifs for live Web Audio playback and `package-assets.ts` WAV baking. */
export const AUDIO_MOTIFS = {
  jump: { notes: [[310, 0.10, 0, 495]], waveform: 'sine' },
  crystal: { notes: [[660, 0.12, 0], [990, 0.13, 0.07]], waveform: 'sine' },
  signal: { notes: [[420, 0.12, 0], [630, 0.14, 0.09], [840, 0.16, 0.18]], waveform: 'sine' },
  hit: { notes: [[195, 0.23, 0, 70]], waveform: 'triangle' },
  finish: { notes: [[392, 0.16, 0], [493.9, 0.17, 0.13], [587.3, 0.18, 0.26], [784, 0.38, 0.39]], waveform: 'sine' },
  ending: { notes: [[392, 0.25, 0], [523.25, 0.25, 0.18], [659.25, 0.25, 0.36], [784, 0.35, 0.54], [1046.5, 0.8, 0.74]], waveform: 'sine' }
} as const satisfies Record<string, AudioMotif>

export function createAudio() {
  return createSynthAudio(AUDIO_MOTIFS)
}
