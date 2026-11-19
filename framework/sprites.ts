export async function createSpriteAtlas(canvas: HTMLCanvasElement, { src, frameWidth, frameHeight }: { src: string; frameWidth: number; frameHeight: number }) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the sprite layer')
  const image = new Image()
  image.src = src
  await image.decode()

  return {
    begin(stage: HTMLCanvasElement) {
      if (canvas.width !== stage.width) canvas.width = stage.width
      if (canvas.height !== stage.height) canvas.height = stage.height
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = false
    },
    draw(column: number, row: number, point: readonly [number, number], { height, anchor = .9, flip = false }: { height: number; anchor?: number; flip?: boolean }) {
      const h = canvas.height * height
      const w = h * frameWidth / frameHeight
      const x = Math.round((point[0] + 1) * canvas.width / 2)
      const y = Math.round((1 - point[1]) * canvas.height / 2)
      context.save()
      context.translate(x, y)
      if (flip) context.scale(-1, 1)
      context.drawImage(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight, -w / 2, -h * anchor, w, h)
      context.restore()
    },
    marker(point: readonly [number, number], { offset, size, minimumSize = 0, fill }: { offset: number; size: number; minimumSize?: number; fill: string }) {
      const x = (point[0] + 1) * canvas.width / 2
      const y = (1 - point[1]) * canvas.height / 2 - offset * canvas.height
      const radius = Math.max(minimumSize, canvas.height * size)
      context.fillStyle = fill
      context.beginPath()
      context.moveTo(x - radius, y)
      context.lineTo(x + radius, y)
      context.lineTo(x, y + radius)
      context.fill()
    }
  }
}
