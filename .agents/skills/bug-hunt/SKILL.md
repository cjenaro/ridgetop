---
name: bug-hunt
description: >-
  Continuous bug-hunting, performance-auditing, and self-learning workflow for Ridgetop.
  Use when the user asks to hunt bugs, audit performance, review recent changes/features for
  regressions, or run a full quality sweep across the framework, asset pipeline, example games,
  and Godot compiler/packager.
---

# Ridgetop Continuous Bug Hunt

Systematic, module-split bug and performance hunting workflow that verifies every fix with
tests and benchmarks, keeps all example games playable, and distills newly discovered bug
classes back into this skill after each run.

## Modules

Always partition work cleanly into Ridgetop's four modules:

1. **Game Framework** — `framework/` (excluding asset building & packaging): geometry, instances, WebGPU/WebGL 2/Canvas 2D backends, fixed loop, platformer, vehicle, audio, input, UI SDK (`ui-*.ts`), room client/server, host, records, verification, decision API.
2. **Asset Building** — `framework/art*.ts`, `framework/png.ts`, `framework/sprite-sheet.ts`, `framework/review-store.ts`, `sprite-workshop*.ts`, `models/`, `tools/build-*.ts`, `tools/standalone-page.ts`, `starter/art-library.ts`, `starter/preview-art.ts`.
3. **Example Games** — `main.ts`, `server.ts`, `game/`, `racing/`, `starter/`, `benchmark.ts`.
4. **Compiler to Godot & Packager** — `tools/ts-to-gd.ts`, `framework/export-godot.ts`, `framework/packager.ts`, `tools/package-game.ts`, `tools/create-game.ts`, `package.json`.

## Workflow

### 1. Determine Scope & Load Memory

1. Read [references/patterns.md](./references/patterns.md) and [references/benchmarks.md](./references/benchmarks.md).
2. Decide scope:
   - **Incremental run (default after new features/changes):** inspect `git log --oneline <last_audited_commit>..HEAD` and `git diff --stat <last_audited_commit>..HEAD`, focusing first on changed files and the modules they belong to (plus any modules coupled via shared exports or compilers). If there are no product-code changes since `last_audited_commit`, fall back automatically to a **full sweep**.
   - **Full sweep (when requested, after major refactors, or on zero diff):** audit all 4 modules in parallel with dedicated `research` subagents (one per module), passing them the relevant section of `references/patterns.md` and explicitly instructing them to trace **cross-module seams** (caller↔callee contracts across framework primitives/bridges, example game loops, and the Godot compiler/packager).

### 2. Baseline Performance (Before Perf Edits)

Run the microbenchmark suite before changing any hot path:

```sh
node .agents/skills/bug-hunt/scripts/bench.mjs
```

Use `--only <name>` (e.g., `--only encodeGlb`) for fast before/after loops while optimizing a single subsystem. Compare against [references/benchmarks.md](./references/benchmarks.md) to catch regressions immediately.

### 3. Fix → Verify → Commit Loop

Do not stop at the first bug. Work through prioritized findings (critical/correctness/leaks/perf first):

1. **Reproduce or baseline** the issue (failing test case, Godot stderr reproduction, or baseline benchmark).
2. **Fix** cleanly while honoring `AGENTS.md` (zero external runtime dependencies, Node/Bun/Deno compatibility, TypeScript source of truth, static/animated batch separation).
3. **Verify**:
   - Correctness bug → add or extend a regression test in `test/*.test.ts` and run `npm run typecheck && npm test`.
   - Performance bug → re-run `node .agents/skills/bug-hunt/scripts/bench.mjs --only <name>` and confirm measurable improvement (and for renderer changes, also check `/benchmark`).
   - Godot compiler/exporter bug → run `node .agents/skills/bug-hunt/scripts/godot-smoke.mjs` and confirm `stderr` is completely clean.
4. **Commit** each logical fix (or module batch) with a clear commit message including benchmark before→after numbers where applicable, then continue hunting.

### 4. Full End-to-End Playability & Release Verification

Once all fixes are committed, build and run the complete verification matrix:

```sh
npm run build && npm run typecheck && npm test && npm run verify && npm run test:runtimes
node .agents/skills/bug-hunt/scripts/godot-smoke.mjs
```

Verify all example games in real Chrome across **WebGPU**, **WebGL 2**, and **Canvas 2D**:

1. Start the server (`PORT=3000 node dist/server.js`) and headless Chrome with Vulkan SwiftShader WebGPU flags (see [references/patterns.md](./references/patterns.md#verification-environment-gotchas)):
   ```sh
   google-chrome --headless=new --remote-debugging-port=9222 \
     --user-data-dir="$(mktemp -d)" --no-first-run --no-default-browser-check \
     --window-size=1280,800 --enable-unsafe-webgpu --enable-unsafe-swiftshader \
     --use-gl=angle --use-angle=vulkan --use-vulkan=swiftshader \
     --enable-features=Vulkan about:blank
   ```
2. Run all browser suites:
   ```sh
   npm run test:browser
   npm run test:player
   npm run test:review
   RIDGETOP_REVIEW_RENDERER=webgpu npm run test:review
   ```
3. Stop temporary server/Chrome processes and verify package contents & size:
   ```sh
   npm pack --dry-run
   ```
   Confirm no build artifacts like `dist/packages` bloat the tarball and `git status` is clean.

### 5. Post-Run Learning Step (Distill & Prune)

Before finishing, update this skill so the next run starts smarter—**distill, never append raw logs**:

1. **Patterns ([references/patterns.md](./references/patterns.md))**:
   - Add a concise bullet *only* for newly discovered **repeatable bug classes, invariant traps, or environment gotchas**.
   - Merge duplicates and prune bullets that are no longer relevant.
2. **Benchmarks ([references/benchmarks.md](./references/benchmarks.md))**:
   - Run `node .agents/skills/bug-hunt/scripts/bench.mjs` on the final commit.
   - Update `last_audited_commit` to `HEAD` and update baseline numbers if any benchmark improved meaningfully or a new benchmark was added.
3. **Scripts ([scripts/bench.mjs](./scripts/bench.mjs), [scripts/godot-smoke.mjs](./scripts/godot-smoke.mjs))**:
   - If a new hot path or silent runtime failure mode was discovered, add an automated case to the appropriate script.
4. Commit the updated `.agents/skills/bug-hunt/` files so future sessions inherit the improvements.
