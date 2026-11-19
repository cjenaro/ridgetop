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
  const rgb = Number.parseInt(hex.replace(/^#/, ''), 16)
  return [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1]
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
      maxInstances: Math.floor(device.limits.maxBufferSize / (STRIDE * 4)),
      draw(data, count, clear) {
        if (count && (!buffer || buffer.size < count * STRIDE * 4)) {
          buffer?.destroy()
          buffer = device.createBuffer({
            size: count * STRIDE * 4,
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

const css = rgba => `rgba(${Math.round(rgba[0]*255)},${Math.round(rgba[1]*255)},${Math.round(rgba[2]*255)},${rgba[3]})`

function canvasBackend(canvas) {
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D is unavailable')
  return {
    name: 'Canvas 2D',
    maxInstances: Infinity,
    draw(data, count, clear) {
      const width = canvas.width / 2
      const height = canvas.height / 2
      context.fillStyle = css(clear)
      context.fillRect(0, 0, canvas.width, canvas.height)
      let previous = -4
      for (let i = 0; i < count * STRIDE; i += STRIDE) {
        if (data[i+4] !== data[previous+4] || data[i+5] !== data[previous+5] ||
            data[i+6] !== data[previous+6] || data[i+7] !== data[previous+7] || i === 0) {
          context.fillStyle = css(data.subarray(i+4, i+8))
          previous = i
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
      const ratio = Math.min(devicePixelRatio, 2)
      const pixelWidth = Math.max(1, Math.round(canvas.clientWidth * ratio))
      const pixelHeight = Math.max(1, Math.round(canvas.clientHeight * ratio))
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
