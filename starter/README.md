# Your Ridgetop game

Run `npm start` in this directory with Node 22.18 or later and open http://localhost:3000. The game and artwork run locally. You can also serve `game/` and `framework/` from a static host and open `game/index.html`.

Open `low-poly-models.html` directly to orbit three live 3D examples. Choose **Open model file** to inspect your own `.art.json` from any side at display resolution.

To make your own models and sprites, choose a starter body, seat features on named parts, and export its eight directions. The toolbox example takes a lid, a handle and two latches. [Build low-poly art](ART.md)

Start in `game/game.js`. Change the title, palette, map, art names, or step time and reload the browser. Each map row has the same width. Use one `@` for the player, one `L` for the goal, `*` for pickups, and `.` for open ground. Entries in `scenery` place solid props. The game rules and camera are in `game/main.js`.

The view selector switches the same level and progress between live 3D meshes and 2D sprites. The inventory icon, pickup effect, character, terrain, and props use the same art kit. The included flower in `game/game.js` shows how to add a new recipe using colored parts. Change a palette role to update every part using it.

## Review the art while playing

Run `npm run playtest` and open the local URL it prints. Choose **Pause & inspect**, then click a visible part of a character, a prop, a sprite or the inventory icon. The **Object** list also works by keyboard. The inspector shows the selected art at its in-game size and in a larger view.

- For a 3D model or one of its baked sprites, click a named part such as the visor. Choose **Shared asset** and open **Edit this part** to move it or change its size. **Save part to project** updates the bound `.art.json` or records a stock model change in `game/art/overrides.json`. Resume to see that change everywhere the model is used.
- For painted sprites, drag a box around the pixels you mean. The review remembers the sheet, animation, frame, facing and displayed size.
- Choose whether your comment applies to the shared art, this placement, this frame or the inventory icon. Click **Save comment**. Each thread has a JSON file and its original PNG in `game/reviews/`. You can ask Codex, “Read my open art reviews, make the requested changes, and mark them ready for me.”
- Choose the thread under **Reviews**. **Refresh reviews** reads replies from disk. **Reload latest art** opens the revised game in the saved pose so you can compare **Before** and **Current**. Reply, resolve, or reopen the thread there.

Direct part edits apply to editable model recipes. Reviews also work on hand-drawn art and code-defined meshes such as the flower. Use `npm start` for regular play.

Try the included raincoat ranger by setting `modelFiles` to `{ ranger: 'art/rain-ranger.art.json' }` in `game/game.js`. Reload to see it in both views. Open `sprite-workshop.html`, choose **Open editable model** and pick `game/art/rain-ranger.art.json`. **Edit model parts** lets you change its hat brim or backpack, and **Compare model views** shows the result from three angles. Save your edit to the same game asset, or edit the named parts with a coding assistant. Assign a file to the pickup role to use its art for the inventory icon too.

To use your own 2D art, open `sprite-workshop.html` in a browser. Save its PNG and animation JSON together in `game/art/`. An entry for the ranger in `game/game.js` can use the exported run clip.

```js
export const sprites = {
  ranger: { manifest: 'art/scout-sheet.json', clip: 'run' }
}
```

Reload the browser to see the new art. A sprite override supplies the flat view and any HUD use of that asset. Its model recipe supplies the live 3D view. The 3D renderer tests depth for each pixel. Sprite mode draws transparent images from the back of the board to the front.

The built-in models are `ranger`, `tile`, `pine`, `rock`, `crate`, `crystal`, `lantern`, and `spark`. The vendored framework includes the public ES modules and TypeScript declarations.
