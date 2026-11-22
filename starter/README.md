# Your Ridgetop game

Run `npm start` in this directory with Node 22.18 or later and open http://localhost:3000. The game and artwork run locally. You can also serve `game/` and `framework/` from a static host and open `game/index.html`.

Open `low-poly-models.html` directly to orbit three live 3D examples. Choose **Open model file** to inspect your own `.art.json` from any side at display resolution.

Start in `game/game.js`. Change the title, palette, map, art names, or step time and reload the browser. Each map row has the same width. Use one `@` for the player, one `L` for the goal, `*` for pickups, and `.` for open ground. Entries in `scenery` place solid props. The game rules and camera are in `game/main.js`.

The view selector switches the same level and progress between live 3D meshes and 2D sprites. The inventory icon, pickup effect, character, terrain, and props use the same art kit. The included flower in `game/game.js` shows how to add a new recipe using colored parts. Change a palette role to update every part using it.

Try the included raincoat ranger by setting `modelFiles` to `{ ranger: 'art/rain-ranger.art.json' }` in `game/game.js`. Reload to see it in both views. Open `sprite-workshop.html`, choose **Open editable model** and pick `game/art/rain-ranger.art.json`. **Edit model parts** lets you change its hat brim or backpack, and **Compare model views** shows the result from three angles. Save your edit to the same game asset, or edit the named parts with a coding assistant. Assign a file to the pickup role to use its art for the inventory icon too.

To use your own 2D art, open `sprite-workshop.html` in a browser. Save its PNG and animation JSON together in `game/art/`. An entry for the ranger in `game/game.js` can use the exported run clip.

```js
export const sprites = {
  ranger: { manifest: 'art/scout-sheet.json', clip: 'run' }
}
```

Reload the browser to see the new art. A sprite override supplies the flat view and any HUD use of that asset. Its model recipe supplies the live 3D view. The 3D renderer tests depth for each pixel. Sprite mode draws transparent images from the back of the board to the front.

The built-in models are `ranger`, `tile`, `pine`, `rock`, `crate`, `crystal`, `lantern`, and `spark`. The vendored framework includes the public ES modules and TypeScript declarations.
