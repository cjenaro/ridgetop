# Working on this game

- Run `npm start` with Node 22.18+ and open the URL in the README. The generated project has zero package dependencies and runs the JavaScript directly.
- Begin with `game/game.js` for the level, copy, palette, art assignments, and custom model recipes. The same named art can appear as a live mesh, a directional sprite, or a HUD icon.
- Edit movement, interactions, drawing order, and the win condition in `game/main.js`. Check both view modes after changing a mechanic or asset. Switch views partway through a run to verify that progress carries over.
- Put workshop PNG and JSON exports together in `game/art/`, register the named clip in `sprites`, and reload the browser.
- For a 3D model and its derived sprites, put the editable `.art.json` in `game/art/` and map the target asset name to that file in `modelFiles`. Change named parts and keep the camera framing and ground origin stable across variants.
- Use `framework/index.js` and its declarations for public game APIs. Keep static mesh batches separate from moving objects.

## Work from art reviews

When asked to address art feedback, read the open `game/reviews/*.json` threads and the adjacent PNG named in `before`. The target records its scope, asset, instance, source file (relative to `game/`), named part or normalized image region, and the original pose or animation frame. The scene records the paused game state.

Follow the selected scope and its `target.editSource`. For shared art, edit the named recipe or model. For an instance, change that placement in the game. For a sprite frame, inspect the referenced clip and sheet. A baked direction can use a sprite override for a frame-specific change. For HUD-only feedback, check how the icon is drawn in `game/main.js`. Preserve part names when changing their shape or placement.

After making the requested change, append a short `{ "text": "...", "date": "<ISO timestamp>" }` to `replies` and set `status` to `"ready"`. Keep the original target, scene and PNG for comparison. The creator can reopen the thread in testing mode and resolve it after playing.
