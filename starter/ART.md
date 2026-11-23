# Make a low-poly game asset

Use `createArtBuilder` from the game's vendored `framework/index.js`. One editable recipe supplies the live 3D mesh, eight directional sprites and the inventory icon. Choose a body with the right silhouette, then add the two or three features a player needs to recognize the object. Allocate enough space for those features to read in a 32 px frame.

## Start from a reviewed reference

Run `npm run art-library -- list "portable radio antenna"` to find related local artwork. Run `npm run art-library -- list` to browse all 13 references. These are editable models selected from Ridgetop's earlier blind art trial. Each has named parts and uses the game's colors. Open a reference directly in the workshop or use `npm run art-library -- start field-radio weather-receiver` to make an independent file in the game's art directory.

Open `game/art/library/preview.png` in a generated project to compare the reference silhouettes at game size and from three angles.

An agent can also start a design from a reference in code. Read the JSON's part names before making changes. `adjust` changes a tone, multiplies local dimensions or moves a part in world units. `remove(name)` removes one part. Attach new features to the updated landmarks. The new asset inherits the game palette.

```js
import { readFile } from 'node:fs/promises'
import { createArtBuilder } from './framework/index.js'
const reference = JSON.parse(await readFile('game/art/library/field-radio.art.json', 'utf8'))
const receiver = createArtBuilder('weather-receiver', { reference })
receiver.adjust('antenna', { tone: 'light' })
receiver.disc('weather-dial', 'radio-body', 'right', .25, .09, 'accent')
const newRecipe = receiver.finish()
```

## Build from forms

This example creates a field toolbox. Save the script as `make-toolbox.mjs` in the generated project's root and run `node make-toolbox.mjs`.

```js
import { writeFile } from 'node:fs/promises'
import { createArtBuilder } from './framework/index.js'

const art = createArtBuilder('field-toolbox', { base: 'case', primary: 'accent', trim: 'ink' })
art.attach('lid', 'body', 'top', 'prism', [1.04, .16, .62], 'wood')
art.handle('grip', 'lid', 'top', .56, .29, .13, 'ink')
for (const x of [-.29, .29]) {
  art.attach(x < 0 ? 'left-latch' : 'right-latch', 'body', 'front', 'box', [.12, .23, .07], 'light', [x, .21, 0])
}
const recipe = art.finish()
await writeFile('game/art/field-toolbox.art.json', JSON.stringify(recipe, null, 2) + '\n', { flag: 'wx' })
```

Set `modelFiles` in `game/game.js` to `{ crate: 'art/field-toolbox.art.json' }` to replace the starter's crates. Open the file in the sprite workshop or in `low-poly-models.html`. Use `npm run playtest` to pin feedback to a named part or edit it in the game. The saved JSON is editable independently of the builder. The example creates a new file so rerunning it preserves workshop edits.

## Review your first draft

Run `npm run preview-art -- game/art/field-toolbox.art.json`. Open both PNGs in `game/art/previews/`. The strip uses the recipe's game resolution and the game's palette. The larger grid shows front, front-right, right and back-right across the top, then back through front-left across the bottom. The command uses the game's sprite rasterizer and runs entirely in Node.

Compare the small silhouette with the brief. Check each distinguishing feature from the side or rear as well as the front. A handle should have visible space inside it, a lens should point out of its housing, and a held object should meet the hand. Revise the named parts that missed the brief and render once more. You can pass an output directory as a second argument to keep before-and-after images.

The preview also writes `<name>-visibility.json` with the number of visible pixels per named part in each direction. If a badge disappears behind a pocket, check its counts and move it toward the visible face. Pixel counts help locate the problem. The PNG tells you whether the player can recognize the shape.

## Body forms

`createArtBuilder(name, { base, primary, trim, proportions, frameSize })` defaults to an empty model, the project palette, and 32 px. `proportions` multiplies the starter body's width, height and depth. Additions use world units. Bodies face +Z. Call `point()` to locate their landmarks.

| Base | Named landmarks and approximate size |
| --- | --- |
| `empty` | Start with a `solid`. Useful for architecture and unusual silhouettes. |
| `case` | Beveled `body` (1 × .75 × .58) and `base`. |
| `vessel` | Open `body` (.94 × .72 × .82), hollow `rim` and `foot`. |
| `biped` | `body`, `collar`, `head`, paired boots, legs, arms, hands and eyes. Stands about 1.36 units tall. |
| `quadruped` | `body`, `head`, `muzzle`, paired eyes and four legs and feet. Fore and hind legs support an elongated body. |
| `bird` | `body`, `head`, `beak`, `neck`, `tail`, paired wings, legs, feet and eyes. Stands about 1.2 units tall. |

## Place and connect features

Every added feature has a unique name. Sizes are full **width, height and depth** for every shape. Tones are `ground`, `leaf`, `wood`, `stone`, `ink`, `accent`, `light` and `glow`. The recipe inherits their colors from the game.

| Call | Placement |
| --- | --- |
| `solid(name, shape, size, tone, center?, rotation?)` | Place a form at its local center. Optional rotation is [pitch, yaw, roll] in radians. |
| `point(parent, face?, offset?)` | Get a 3D point on the named part's bounding box. Faces are `center`, `top`, `bottom`, `left`, `right`, `front` and `back`. Optional XYZ offsets use world units. |
| `attach(name, parent, face, shape, size, tone, offset?)` | Keep the feature upright and seat its base against the chosen face with a small overlap. |
| `between(name, from, to, width, tone, shape?)` | Aim a cylinder between two points. Use `taper` or `cone` for a narrowing end. Width is a diameter or a pair of cross-section dimensions. |
| `handle(name, parent, face, span, reach, depth, tone)` | Seat both feet of a continuous open arch on one face. Its opening stays visible. |
| `disc(name, parent, face, diameter, depth, tone, offset?, shape?)` | Seat a round part flat against that face. Pass `'ring'` as the last argument for a hollow center. |
| `finish()` | Return independent editable JSON, center and ground the geometry, and fit all eight sprite views with a margin. |

Choose `box`, `prism`, `cylinder`, `cone`, `octahedron`, `oval`, `dome`, `bowl`, `ring`, `taper` or `arch`. A bowl has an actual recessed interior. A dome has a flat underside. A cone's tip lies at its local +Y end. Connect important features by reusing the same endpoint or by attaching them to the parent. Use a separate contrasting tone for the identifying detail.

For a jointed part, define a bend relative to its socket, then use that exact point twice. For example, a weather vane's angled arm and pointer can share an elbow.

```js
const socket = art.point('lid', 'top')
const elbow = art.point('lid', 'top', [0, .24, 0])
const tip = art.point('lid', 'top', [.39, .26, 0])
art.between('arm', socket, elbow, .10, 'wood')
art.between('pointer', elbow, tip, .14, 'accent', 'cone')
```

Call `fitArtRecipe(recipe)` to ground and reframe an existing editable asset after a substantial shape change. It returns a copy. Keep the original camera for a review that calls for a local change at a fixed scale.
