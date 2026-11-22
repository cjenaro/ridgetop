# Working on this game

- Run `npm start` with Node 22.18+ and open the URL in the README. The generated project has zero package dependencies and runs the JavaScript directly.
- Begin with `game/game.js` for the level, copy, palette, art assignments, and custom model recipes. The same named art can appear as a live mesh, a directional sprite, or a HUD icon.
- Edit movement, interactions, drawing order, and the win condition in `game/main.js`. Check both view modes after changing a mechanic or asset. Switch views partway through a run to verify that progress carries over.
- Put workshop PNG and JSON exports together in `game/art/`, register the named clip in `sprites`, and reload the browser.
- For a 3D model and its derived sprites, put the editable `.art.json` in `game/art/` and map the target asset name to that file in `modelFiles`. Change named parts and keep the camera framing and ground origin stable across variants.
- Use `framework/index.js` and its declarations for public game APIs. Keep static mesh batches separate from moving objects.
