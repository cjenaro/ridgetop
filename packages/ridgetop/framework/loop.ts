import { isTestingPaused } from './testing-runtime.ts'

export const STEP = 1 / 60

export function fixedLoop({ update, render }: { update(dt: number): void; render(alpha: number, now: number): void }) {
  let previous = performance.now()
  let lag = 0
  let frame: number
  let stopped = false
  function advance(now: number) {
    if (stopped) return
    if (isTestingPaused()) {
      previous = now
      lag = 0
      if (!stopped) frame = requestAnimationFrame(advance)
      return
    }
    lag += Math.max(0, Math.min((now - previous) / 1000, STEP * 5))
    previous = now
    while (lag >= STEP) {
      update(STEP)
      if (stopped || isTestingPaused()) {
        if (isTestingPaused()) lag = 0
        break
      }
      lag -= STEP
    }
    if (!stopped && !isTestingPaused()) render(lag / STEP, now)
    if (!stopped) frame = requestAnimationFrame(advance)
  }
  frame = requestAnimationFrame(advance)
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
  }
}
