export const STEP = 1 / 60

export function fixedLoop({ update, render }: { update(dt: number): void; render(alpha: number, now: number): void }) {
  let previous = performance.now()
  let lag = 0
  let frame: number
  function advance(now: number) {
    lag += Math.min((now - previous) / 1000, STEP * 5)
    previous = now
    while (lag >= STEP) {
      update(STEP)
      lag -= STEP
    }
    render(lag / STEP, now)
    frame = requestAnimationFrame(advance)
  }
  frame = requestAnimationFrame(advance)
  return () => cancelAnimationFrame(frame)
}
