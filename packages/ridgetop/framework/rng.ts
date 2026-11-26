/** Pure deterministic PRNG step (Mulberry32) for cloneable simulation states. */
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(next ^ (next >>> 15), 1 | next)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next }
}

/** Stateful deterministic PRNG for scripts and procedural generators. */
export function createRng(initialSeed = 1337) {
  let state = initialSeed | 0
  return {
    get seed() { return state },
    next() {
      const step = nextRandom(state)
      state = step.seed
      return step.value
    }
  }
}
