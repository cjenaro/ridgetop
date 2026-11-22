# Working on Ridgetop

- Keep the framework free of external libraries. Use browser standards and server APIs supported on Node, Bun, and Deno. TypeScript is the source of truth.
- The public source entry points are `framework/index.ts` and `framework/server.ts`. Generate modules and declarations with `npm run build` and keep the README contracts aligned with the source.
- Add meshes and camera math in `framework/geometry.ts`, instance packing and culling in `framework/instances.ts`, and backend selection in `framework/low-poly.ts`. The backend modules must agree on winding, depth, transforms, colors, and lights.
- Reuse static batches and keep animated instances in separate batches. Measure render changes through `/benchmark` with the same settings. Verify both static reuse and animated uploads.
- Change levels in `game/level.ts`, rules in `game/simulation.ts`, and presentation in `game/scene.ts`. Keep rules independent of the browser and use the same fixed step for solo and online play.
- Start at `main.ts` for controls and UI, `server.ts` for authoritative rooms, and `framework/room-client.ts` for input, snapshots, and reconnects. Register browser modules in the server asset list.
- Run `npm test` after changes to geometry, gameplay, or rooms. Build with `npm run build`, run `npm start`, and open two tabs with the same room URL after changing browser integration or transport. The browser smoke test automates this and exercises WebGPU, WebGL 2, and `?canvas=1`.
- Check `npm run typecheck` and `npm run test:runtimes` when changing public types or hosting. Keep Signal Drift in `racing/` on the same renderer and simulation utilities.
- Run `npm pack` and verify the contents before handing off a release.

- For a new game, start with `npm run create-game -- <new-directory>` from a built checkout. Edit `starter/game.ts` for template defaults and `framework/art.ts` for shared art recipes. The generated project's `game/game.js` is directly editable.
