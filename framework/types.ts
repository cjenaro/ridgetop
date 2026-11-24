export type Vec3 = readonly [number, number, number]

export type Quaternion = readonly [number, number, number, number]
export type Color = readonly [number, number, number, number]

export type Matrix = Float32Array<ArrayBuffer>

export type Backend = 'auto' | 'webgpu' | 'webgl2' | 'canvas'

export type RendererName = 'WebGPU' | 'WebGL 2' | 'Canvas 2D'

export type BlendMode = 'opaque' | 'alpha' | 'additive'

export interface PointLight {
  readonly position: Vec3
  readonly color: Vec3 | Color
  readonly radius: number
  readonly intensity?: number
}

export interface LightingOptions {
  readonly direction?: Vec3
  readonly ambient?: number
  readonly color?: Vec3 | Color
  readonly fogColor?: Vec3 | Color
  readonly fogNear?: number
  readonly fogFar?: number
  readonly points?: readonly PointLight[]
}

export interface Mesh {
  /** Interleaved XYZ position and flat normal. Treat this array as read-only. */
  readonly data: Float32Array<ArrayBuffer>
  readonly vertexCount: number
  readonly radius: number
}

export interface InstanceTag {
  readonly kind?: 'model' | 'rig' | 'mesh'
  readonly asset?: string
  readonly part?: string
  readonly instanceId?: string
  readonly joint?: string
  readonly groupId?: string
  readonly sourceFile?: string
}

export interface BatchMeta {
  label?: string
  kind?: 'model' | 'rig' | 'mesh'
  asset?: string
  sourceSite?: string
  sourceFile?: string
  /** Optional per-instance tags aligned with batch slots; reset on batch.clear(). */
  tags?: (InstanceTag | undefined)[]
}

export interface InstanceBatch {
  readonly mesh: Mesh
  readonly blend: BlendMode
  readonly data: Float32Array<ArrayBuffer>
  readonly min: readonly number[]
  readonly max: readonly number[]
  readonly count: number
  readonly revision: number
  readonly meta?: BatchMeta
  /** Reset the batch while retaining allocated capacity. */
  clear(): void
  /** Scale components must be positive. Yaw is in radians around the Y axis. Fourth color component sets opacity for alpha/additive batches. */
  add(position?: Vec3, scale?: Vec3, rotation?: number | Quaternion, color?: Vec3 | Color, unlit?: number, tag?: InstanceTag): void
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
  /** Update directional light, ambient, light tint, distance fog, and up to 4 point lights at runtime without rebuilding batches. */
  setLighting(lighting: LightingOptions): void
  release(batch: InstanceBatch): void
  releaseMesh(mesh: Mesh): void
  dispose(): void
}

export interface RoomInput { left: boolean; right: boolean; jump: number }

export interface RoomEntity {
  id: string
  slot?: number
  revision?: number
  lastProcessedSeq?: number
}

export interface RoomPlayer extends RoomEntity {
  x: number
  y: number
  falls: number
}

export type RoomTransport = 'sse' | 'ws' | 'auto'

export type RoomStatus = 'connected' | 'reconnecting' | 'unavailable'

export interface RoomWelcome {
  id: string
  token: string
}

export interface RoomPrediction<T, Input = RoomInput> {
  step(state: T, input: Input, dt: number): T
  equals?(a: T, b: T): boolean
}

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
  setLighting?(light: Float32Array<ArrayBuffer>): void
  release(batch: InstanceBatch): void
  releaseMesh(mesh: Mesh): void
  dispose(): void
}

/** Options for projecting a contact or directional ground shadow onto a horizontal plane. */
export interface ShadowProjectionOptions {
  /** World-space Y height of the receiving ground plane. Default: `0`. */
  readonly groundY?: number
  /** World-space shadow radius (or X semi-axis) at ground level. Default: `0.5`. */
  readonly radius?: number
  /** Optional Z semi-axis before directional stretching. Defaults to `radius`. */
  readonly radiusZ?: number
  /** Directional light vector pointing toward the light source (same convention as `LightingOptions.direction`). */
  readonly direction?: Vec3
  /** Maximum shadow opacity when resting on the ground (`0–1`). Default: `0.38`. */
  readonly opacity?: number
  /** Height above `groundY` at which the shadow fully fades out. Default: `12`. */
  readonly maxHeight?: number
  /** Minimum relative shadow scale at `maxHeight` (`0–1`). Default: `0.55`. */
  readonly minScale?: number
  /** Maximum elongation factor along the light direction at low light angles. Default: `2.5`. */
  readonly maxStretch?: number
  /** Minimum effective light Y component used to prevent infinite stretch on horizontal lights. Default: `0.25`. */
  readonly minLightY?: number
  /** Multiplier for lateral shadow offset along the light direction (`0` keeps shadow directly beneath caster). Default: `1`. */
  readonly offsetScale?: number
  /** Small upward Y offset above `groundY` to prevent Z-fighting across WebGPU, WebGL 2, and Canvas 2D. Default: `0.015`. */
  readonly bias?: number
}

/** Computed ground-plane transform and visibility for a projected shadow instance. */
export interface ShadowProjection {
  readonly position: [number, number, number]
  readonly scale: [number, number, number]
  readonly yaw: number
  readonly opacity: number
  readonly visible: boolean
}

/** Options for projecting an arbitrary mesh onto the local `y = 0` plane along a directional light. */
export interface ProjectShadowMeshOptions {
  /** Directional light vector pointing toward the light source. Default: `[-0.48, 0.8, 0.36]`. */
  readonly direction?: Vec3
  /** Optional scale applied to the source mesh before projection. Default: `[1, 1, 1]`. */
  readonly scale?: Vec3
  /** Optional yaw (radians) or quaternion applied to the source mesh before projection. Default: `0`. */
  readonly rotation?: number | Quaternion
  /** Local Y coordinate treated as the base resting on the ground plane. Defaults to the mesh's minimum Y. */
  readonly baseY?: number
  /** Minimum effective light Y component used to avoid infinite shear on horizontal lights. Default: `0.25`. */
  readonly minLightY?: number
  /** When true, also flips away-facing projected triangles upward (useful for open single-sided meshes). Default: `false`. */
  readonly doubleSided?: boolean
}

/** Options for creating a reusable cross-backend shadow batch via `createShadowBatch`. */
export interface ShadowBatchOptions {
  /** Initial instance capacity of the underlying alpha-blended batch. Default: `32`. */
  readonly capacity?: number
  /** Shadow mesh to instance. Defaults to a faceted `shadowDisc(sides)`. */
  readonly mesh?: Mesh
  /** Number of sides for the default `shadowDisc` mesh when `mesh` is omitted. Default: `12`. */
  readonly sides?: number
  /** Directional light vector pointing toward the light source. Default: `[-0.48, 0.8, 0.36]`. */
  readonly direction?: Vec3
  /** Base RGB shadow tint (rendered unlit). Default: `[0.04, 0.06, 0.1]`. */
  readonly color?: Vec3
  /** Default ground plane Y height. Default: `0`. */
  readonly groundY?: number
  /** Default shadow radius at ground level. Default: `0.5`. */
  readonly radius?: number
  /** Default maximum shadow opacity at ground level (`0–1`). Default: `0.38`. */
  readonly opacity?: number
  /** Default fade-out height above `groundY`. Default: `12`. */
  readonly maxHeight?: number
  /** Default minimum relative scale at `maxHeight`. Default: `0.55`. */
  readonly minScale?: number
  /** Default maximum directional stretch factor. Default: `2.5`. */
  readonly maxStretch?: number
  /** Default minimum effective light Y component. Default: `0.25`. */
  readonly minLightY?: number
  /** Default lateral light-offset multiplier. Default: `1`. */
  readonly offsetScale?: number
  /** Default upward Y epsilon above `groundY` to prevent Z-fighting. Default: `0.015`. */
  readonly bias?: number
  /** Optional outer soft penumbra expansion (`0` disables extra ring; e.g. `0.35` adds a softer outer ring). Default: `0`. */
  readonly penumbra?: number
}

/** Per-caster overrides when adding a contact/blob shadow to a `ShadowBatch`. */
export interface ShadowCasterOptions {
  readonly groundY?: number
  readonly radius?: number
  readonly radiusZ?: number
  readonly opacity?: number
  readonly color?: Vec3
  readonly maxHeight?: number
  readonly minScale?: number
  readonly maxStretch?: number
  readonly offsetScale?: number
  readonly bias?: number
  readonly penumbra?: number
}

/** Per-caster overrides when placing a pre-projected mesh shadow via `ShadowBatch.addProjected`. */
export interface ProjectedShadowOptions {
  readonly groundY?: number
  readonly scale?: Vec3
  readonly rotation?: number | Quaternion
  readonly opacity?: number
  readonly color?: Vec3
  readonly maxHeight?: number
  readonly offsetScale?: number
  readonly bias?: number
}

/** Reusable alpha-blended ground shadow batch compatible with WebGPU, WebGL 2, and Canvas 2D. */
export interface ShadowBatch {
  /** Underlying alpha-blended `InstanceBatch` to pass to `renderer.render(...)`. */
  readonly batch: InstanceBatch
  /** Reset all shadows for the current frame while retaining allocated buffer capacity. */
  clear(): void
  /** Update the directional light used for shadow offset and stretching. */
  setLighting(lighting: Pick<LightingOptions, 'direction'> | Vec3): void
  /** Project and add a contact/blob shadow for a world-space caster position. */
  add(position: Vec3, options?: ShadowCasterOptions): void
  /** Project and add a pre-projected mesh shadow (e.g. from `projectShadowMesh`) onto `groundY`. */
  addProjected(position: Vec3, options?: ProjectedShadowOptions): void
}
