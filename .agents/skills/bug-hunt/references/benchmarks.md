# Ridgetop Performance Baselines

- `last_audited_commit`: `b3d597d`
- Script: `node .agents/skills/bug-hunt/scripts/bench.mjs`

## Microbenchmark Baselines

| Benchmark | Workload | Baseline (ms) | Notes |
|---|---|---:|---|
| `canvasMeshes` | 40 moving-cam frames × 500 instances | 41.32 | After Face pooling + single RGB quantization + `blendRank` |
| `bakeSpritePixels` | 256 px × 5 ranger bakes | 20.62 | After scanline `dzx` + flat arrays |
| `circuit.nearest` | 50,000 queries on circuit 0 | 13.18 | After indexed loop |
| `instances.add` | 200,000 quaternion packs | 17.41 | After zero-spread quaternion norm |
| `verifyBounded` | 50,000 state transitions | 81.44 | After removing duplicate `structuredClone(action)` |
| `encodePng` | 1024×1024 RGBA | 8.34 | After `zlib.crc32` + single-alloc chunks |
| `sprite-sheet` | 20 × 200-vertex polygons (512²) | 5.60 | After packed `Uint32Array` + precomputed edges |
| `fitArtRecipe` | 50 × ranger fits | 3.90 | After single clone + hoisted trig |
| `encodeGlb` | 20 × Signal Drift circuit static batches | 36.95 | After single-copy GLB assembly + hoisted rotation matrix |

## Browser `/benchmark` Baselines (Chrome SwiftShader Vulkan, 1,440 triangles)

- **WebGPU (static)**: 2 draws, 0 B/frame uploaded, CPU 0.2 ms median / 0.3 ms p95
- **WebGPU (dynamic)**: 2 draws, 9,216 B/frame uploaded, CPU 0.2 ms median / 0.4 ms p95
- **WebGL 2 (static)**: 2 draws, 0 B/frame uploaded, CPU 0.1 ms median / 0.3 ms p95
- **Canvas 2D (static)**: 716 draws, 0 B/frame uploaded, CPU 0.8 ms median / 2.1 ms p95
