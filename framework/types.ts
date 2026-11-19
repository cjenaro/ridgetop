export type Vec3 = readonly [number, number, number]

export type Quaternion = readonly [number, number, number, number]
export type Color = readonly [number, number, number, number]

export type Matrix = Float32Array<ArrayBuffer>

export type Backend = 'auto' | 'webgpu' | 'webgl2' | 'canvas'

export type RendererName = 'WebGPU' | 'WebGL 2' | 'Canvas 2D'

export interface Mesh {
  /** Interleaved XYZ position and flat normal. Treat this array as read-only. */
  readonly data: Float32Array<ArrayBuffer>
  readonly vertexCount: number
  readonly radius: number
}

export interface InstanceBatch {
  readonly mesh: Mesh
  readonly data: Float32Array<ArrayBuffer>
  readonly min: readonly number[]
  readonly max: readonly number[]
  readonly count: number
  readonly revision: number
  /** Reset the batch while retaining allocated capacity. */
  clear(): void
  /** Scale components must be positive. Yaw is in radians around the Y axis. */
  add(position?: Vec3, scale?: Vec3, rotation?: number | Quaternion, color?: Vec3 | Color, unlit?: number): void
}

export interface RenderStats {
  drawCalls: number
  triangles: number
  instances: number
  uploadBytes: number
  culledBatches: number
}

export interface LowPolyRenderer {
  readonly name: RendererName
  readonly canvas: HTMLCanvasElement
  /** Returns the same statistics object each frame. Copy it to retain a sample. */
  render(matrix: Matrix, batches: Iterable<InstanceBatch>, clear?: Color): Readonly<RenderStats>
  release(batch: InstanceBatch): void
  releaseMesh(mesh: Mesh): void
  dispose(): void
}

export interface RoomInput { left: boolean; right: boolean; jump: number }

export interface RoomPlayer { id: string; x: number; y: number; falls: number; revision?: number }

export interface VerificationFrame<S, A> {
  readonly tick: number
  readonly before: Readonly<S>
  readonly after: Readonly<S>
  readonly action?: Readonly<A>
}

export interface VerificationCheck<S, A> {
  id: string
  test(frame: VerificationFrame<S, A>): boolean
}

export interface VerificationModel<S, A> {
  initial: S
  step(state: S, action: A): S | void
  checks: readonly VerificationCheck<S, A>[]
}

export interface Counterexample<S, A> {
  status: 'fail'
  rule: string
  frame: VerificationFrame<S, A>
  actions: readonly A[]
}

export interface DecisionInput<I, E> {
  id: string
  input: I
  evidence: readonly { id: string; value: E }[]
}

export interface Decision<L extends string> { label: L; evidence: readonly string[] }

export type DecisionOutcome<L extends string> = { id: string } & (
  { status: 'error'; message: string } |
  { status: 'invalid' } |
  { status: 'pass' | 'fail'; label: L; expected: L; evidence: string[]; missingEvidence: string[] }
)

export interface PlatformerBody {
  x: number
  y: number
  vy: number
  grounded: boolean
  moving: boolean
  facing: number
  jump: number
  coyote: number
  buffer: number
}

export interface MeshBackend {
  name: RendererName
  lost?: Promise<unknown>
  maxDimension: number
  draw(matrix: Matrix, clear: Color, visible: readonly InstanceBatch[], stats: RenderStats): void
  release(batch: InstanceBatch): void
  releaseMesh(mesh: Mesh): void
  dispose(): void
}
