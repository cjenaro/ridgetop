# Ridgetop Performance Baselines

- `last_audited_commit`: `cb4752d`
- Script: `node .agents/skills/bug-hunt/scripts/bench.mjs`

## Microbenchmark Baselines

| Benchmark | Workload | Baseline (ms) | Notes |
|---|---|---:|---|
| `canvasMeshes` | 40 moving-cam frames × 500 instances | 53.86 | After MVP hoist + flat NDC + cached `fillStyle` |
| `bakeSpritePixels` | 256 px × 5 ranger bakes | 16.93 | After scanline `dzx` + flat arrays |
| `circuit.nearest` | 50,000 queries on circuit 0 | 13.01 | After indexed loop |
| `instances.add` | 200,000 quaternion packs | 16.65 | After zero-spread quaternion norm |
| `verifyBounded` | 50,000 state transitions | 90.49 | After removing duplicate `structuredClone(action)` |
| `encodePng` | 1024×1024 RGBA | 9.29 | After `zlib.crc32` + single-alloc chunks |
| `sprite-sheet` | 20 × 200-vertex polygons (512²) | 5.73 | After packed `Uint32Array` + precomputed edges |
| `fitArtRecipe` | 50 × ranger fits | 3.87 | After single clone + hoisted trig |
| `encodeGlb` | 20 × Signal Drift circuit static batches | 47.97 | After hoisted rotation matrix + Float32 min/max |

## Browser `/benchmark` Baselines (Chrome SwiftShader Vulkan, 1,440 triangles)

- **WebGPU (static)**: 2 draws, 0 B/frame uploaded, CPU 0.1 ms median / 0.2 ms p95
- **WebGPU (dynamic)**: 2 draws, 9,216 B/frame uploaded, CPU 0.2 ms median / 0.3 ms p95
- **WebGL 2 (static)**: 2 draws, 0 B/frame uploaded, CPU 0.1 ms median / 0.1 ms p95
- **Canvas 2D (static)**: 716 draws, 0 B/frame uploaded, CPU 0.7 ms median / 1.5 ms p95
