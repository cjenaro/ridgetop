export const STEP = 1 / 60

export function fixedLoop({ update, render }: { update(dt: number): void; render(alpha: number, now: number): void }) {
  let previous = performance.now()
  let lag = 0
  let frame: number
  let stopped = false
  function advance(now: number) {
    if (stopped) return
    lag += Math.max(0, Math.min((now - previous) / 1000, STEP * 5))
    previous = now
    while (lag >= STEP) {
      update(STEP)
      if (stopped) return
      lag -= STEP
    }
    render(lag / STEP, now)
    if (!stopped) frame = requestAnimationFrame(advance)
  }
  frame = requestAnimationFrame(advance)
  return () => {
    stopped = true
    cancelAnimationFrame(frame)
  }
}
