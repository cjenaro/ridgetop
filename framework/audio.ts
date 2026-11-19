export function createSynthAudio<Name extends string>(motifs: Record<Name, readonly (readonly [number, number, number, number?])[]>,
  { volume = .22, waveform = {} }: { volume?: number; waveform?: Partial<Record<Name, OscillatorType>> } = {}) {
  let muted = false
  let context
  let output
  return {
    unlock() {
      const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext
      if (!Audio) return
      try {
        if (!context) {
          context = new Audio()
          output = context.createGain()
          output.gain.value = muted ? 0 : volume
          output.connect(context.destination)
        }
        if (context.state !== 'running') context.resume().catch(() => {})
      } catch { /* Sound is optional. */ }
    },
    play(name: Name) {
      if (context?.state !== 'running') return
      for (const [frequency, duration, delay, endFrequency] of motifs[name] ?? []) {
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        const at = context.currentTime + delay
        oscillator.type = waveform[name] ?? 'sine'
        oscillator.frequency.setValueAtTime(frequency, at)
        if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration)
        envelope.gain.setValueAtTime(.001, at)
        envelope.gain.exponentialRampToValueAtTime(.25, at + .015)
        envelope.gain.exponentialRampToValueAtTime(.001, at + duration)
        oscillator.connect(envelope)
        envelope.connect(output)
        oscillator.start(at)
        oscillator.stop(at + duration)
        oscillator.onended = () => {
          oscillator.disconnect()
          envelope.disconnect()
        }
      }
    },
    mute(value: boolean) {
      muted = value
      if (output) output.gain.value = muted ? 0 : volume
    },
    close() { context?.close().catch(() => {}) }
  }
}
