import type { Color } from './types.ts'

const STRIDE = 8
const shader = `
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}
@vertex fn vertex(@builtin(vertex_index) i: u32, @location(0) rect: vec4f,
                  @location(1) color: vec4f) -> Vertex {
  var corners = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1),
                               vec2f(0,1), vec2f(1,0), vec2f(1,1));
  return Vertex(vec4f(rect.xy + corners[i] * rect.zw, 0, 1), color);
}
@fragment fn fragment(in: Vertex) -> @location(0) vec4f { return in.color; }
`

export function color(hex: string): Color {
  const clean = typeof hex === 'string' ? hex.replace(/^#/, '') : ''
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    const rgb = Number.parseInt(clean, 16)
    return [((rgb >>> 16) & 255) / 255, ((rgb >>> 8) & 255) / 255, (rgb & 255) / 255, 1]
  }
  if (/^[0-9a-f]{8}$/i.test(clean)) {
    const rgba = Number.parseInt(clean, 16)
    return [((rgba >>> 24) & 255) / 255, ((rgba >>> 16) & 255) / 255, ((rgba >>> 8) & 255) / 255, (rgba & 255) / 255]
  }
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return [
      Number.parseInt(clean[0] + clean[0], 16) / 255,
      Number.parseInt(clean[1] + clean[1], 16) / 255,
      Number.parseInt(clean[2] + clean[2], 16) / 255,
      1
    ]
  }
  throw new RangeError('Invalid hex color: ' + hex)
}

async function gpuBackend(canvas) {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  try {
    const format = navigator.gpu.getPreferredCanvasFormat()
    const module = device.createShaderModule({ code: shader })
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module, entryPoint: 'vertex',
        buffers: [{
          arrayStride: STRIDE * 4, stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x4' },
            { shaderLocation: 1, offset: 16, format: 'float32x4' }
          ]
        }]
      },
      fragment: { module, entryPoint: 'fragment', targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
        }
      }] },
      primitive: { topology: 'triangle-list' }
    })
    const context = canvas.getContext('webgpu')
    context.configure({ device, format, alphaMode: 'opaque' })
    let buffer
    return {
      name: 'WebGPU',
      lost: device.lost,
      maxDimension: device.limits.maxTextureDimension2D,
      maxInstances: Math.floor(device.limits.maxBufferSize / (STRIDE * 4)),
      draw(data, count, clear) {
        const required = count * STRIDE * 4
        if (count && (!buffer || buffer.size < required)) {
          buffer?.destroy()
          const capacity = Math.min(device.limits.maxBufferSize, Math.max(data.byteLength, required))
          buffer = device.createBuffer({
            size: capacity,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX
          })
        }
        if (count) device.queue.writeBuffer(buffer, 0, data, 0, count * STRIDE)
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: clear, loadOp: 'clear', storeOp: 'store'
          }]
        })
        if (count) {
          pass.setPipeline(pipeline)
          pass.setVertexBuffer(0, buffer)
          pass.draw(6, count)
        }
        pass.end()
        device.queue.submit([encoder.finish()])
      },
      dispose() {
        context.unconfigure()
        device.destroy()
      }
    }
  } catch (error) {
    device.destroy()
    throw error
  }
}

const css = (r: number, g: number, b: number, a: number) =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`

function canvasBackend(canvas) {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D is unavailable')
  return {
    name: 'Canvas 2D',
    maxDimension: 4096,
    maxInstances: Infinity,
    draw(data, count, clear) {
      const width = canvas.width / 2
      const height = canvas.height / 2
      context.fillStyle = css(clear[0], clear[1], clear[2], clear[3])
      context.fillRect(0, 0, canvas.width, canvas.height)
      let prevR = -1, prevG = -1, prevB = -1, prevA = -1
      const end = count * STRIDE
      for (let i = 0; i < end; i += STRIDE) {
        const r = data[i + 4], g = data[i + 5], b = data[i + 6], a = data[i + 7]
        if (r !== prevR || g !== prevG || b !== prevB || a !== prevA) {
          context.fillStyle = css(r, g, b, a)
          prevR = r; prevG = g; prevB = b; prevA = a
        }
        context.fillRect((data[i]+1)*width, (1-data[i+1])*height, data[i+2]*width, -data[i+3]*height)
      }
    },
    dispose() {}
  }
}

export async function createRenderer(canvas: HTMLCanvasElement, { width, height, forceCanvas = false }: { width: number; height: number; forceCanvas?: boolean }) {
  let backend
  let disposed = false
  function useCanvas() {
    // A canvas that acquired a WebGPU context cannot also acquire a 2D context.
    try {
      backend = canvasBackend(canvas)
    } catch {
      const replacement = canvas.cloneNode() as HTMLCanvasElement
      canvas.replaceWith(replacement)
      canvas = replacement
      backend = canvasBackend(canvas)
    }
  }
  if (!forceCanvas) {
    try { backend = await gpuBackend(canvas) }
    catch (error) { console.warn('WebGPU initialization failed', error) }
  }
  if (!backend) useCanvas()
  backend.lost?.then(info => {
    if (!disposed) {
      console.warn('WebGPU device lost:', info.message)
      backend.dispose()
      useCanvas()
    }
  })

  let data = new Float32Array(STRIDE * 256)
  let count = 0
  return {
    get name() { return backend.name },
    get canvas() { return canvas },
    begin() { count = 0 },
    rect(x, y, w, h, tint) {
      if (x + w <= 0 || x >= width || y + h <= 0 || y >= height) return
      if (count >= backend.maxInstances) throw new RangeError('Rectangle batch exceeds GPU buffer limit')
      if (count * STRIDE === data.length) {
        const enlarged = new Float32Array(data.length * 2)
        enlarged.set(data)
        data = enlarged
      }
      let index = count++ * STRIDE
      data[index++] = x / width * 2 - 1
      data[index++] = 1 - y / height * 2
      data[index++] = w / width * 2
      data[index++] = -h / height * 2
      data.set(tint, index)
    },
    end(clear) {
      const w = Math.max(1, canvas.clientWidth)
      const h = Math.max(1, canvas.clientHeight)
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2, backend.maxDimension / Math.max(w, h))
      const pixelWidth = Math.max(1, Math.round(w * ratio))
      const pixelHeight = Math.max(1, Math.round(h * ratio))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      backend.draw(data, count, clear)
      return count
    },
    dispose() {
      disposed = true
      backend.dispose()
    }
  }
}
