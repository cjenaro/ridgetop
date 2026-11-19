export interface HudPainter {
  readonly width: number
  readonly height: number
  panel(x: number, y: number, width: number, height: number, style: {
    fill: string
    stroke?: string
    radius?: number
  }): void
  text(value: string, x: number, y: number, style: {
    fill: string
    size: number
    weight?: number
    align?: CanvasTextAlign
    mono?: boolean
    maxWidth?: number
  }): void
}

/** A screen-space layer that shares the render target's size and pixel density. */
export function createHud(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the game HUD')
  let previous: string
  let previousStage: HTMLCanvasElement
  let width = 0
  let height = 0
  canvas.addEventListener('contextrestored', () => { previousStage = undefined })
  const painter: HudPainter = {
    get width() { return width },
    get height() { return height },
    panel(x, y, w, h, { fill, stroke, radius = 0 }) {
      context.beginPath()
      context.roundRect(x, y, w, h, radius)
      context.fillStyle = fill
      context.fill()
      if (stroke) {
        context.strokeStyle = stroke
        context.lineWidth = 1
        context.stroke()
      }
    },
    text(value, x, y, { fill, size, weight = 600, align = 'left', mono = false, maxWidth }) {
      context.fillStyle = fill
      context.font = weight + ' ' + size + 'px ' + (mono ? 'ui-monospace, monospace' : 'system-ui, sans-serif')
      context.textAlign = align
      context.textBaseline = 'top'
      if (maxWidth === undefined) context.fillText(value, x, y)
      else context.fillText(value, x, y, maxWidth)
    }
  }

  return {
    render(stage: HTMLCanvasElement, key: string, paint: (ui: HudPainter) => void) {
      const w = Math.max(1, stage.clientWidth)
      const h = Math.max(1, stage.clientHeight)
      if (stage === previousStage && key === previous && w === width && h === height &&
          canvas.width === stage.width && canvas.height === stage.height) return
      previous = key
      previousStage = stage
      width = w
      height = h
      if (canvas.width !== stage.width) canvas.width = stage.width
      if (canvas.height !== stage.height) canvas.height = stage.height
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0)
      context.clearRect(0, 0, width, height)
      paint(painter)
    }
  }
}
