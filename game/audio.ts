import { createSynthAudio } from '../framework/index.ts'

const motifs = {
  jump: [[310, .10, 0, 495]],
  crystal: [[660, .12, 0], [990, .13, .07]],
  signal: [[420, .12, 0], [630, .14, .09], [840, .16, .18]],
  hit: [[195, .23, 0, 70]],
  finish: [[392, .16, 0], [493.9, .17, .13], [587.3, .18, .26], [784, .38, .39]],
  ending: [[392, .25, 0], [523.25, .25, .18], [659.25, .25, .36], [784, .35, .54], [1046.5, .8, .74]]
} as const

export function createAudio() {
  return createSynthAudio(motifs, { waveform: { hit: 'triangle' } })
}
