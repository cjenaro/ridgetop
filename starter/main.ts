import { artModels, bindActionControls, color, createArtKit, createArtRecipe, createLowPolyRenderer, createSpriteAtlas,
  fixedLoop, modelFromArtRecipe, multiply, orthographic, projectPoint, view } from '../framework/index.ts'
import type { ArtRecipe, Backend, LowPolyRenderer, Matrix, Vec3 } from '../framework/index.ts'
import type { ReviewObject } from '../framework/art-review.ts'
import { game, modelFiles, models, sprites } from './game.ts'

const moves = { left: [-1, 0], up: [0, -1], down: [0, 1], right: [1, 0] } as const
type Direction = keyof typeof moves
const keys: Record<string, Direction> = { KeyA: 'left', ArrowLeft: 'left', KeyW: 'up', ArrowUp: 'up',
  KeyD: 'right', ArrowRight: 'right', KeyS: 'down', ArrowDown: 'down' }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function start() {
  const recipes = new Map<string, ArtRecipe>()
  const overrideResponse = await fetch('art/overrides.json')
  if (!overrideResponse.ok && overrideResponse.status !== 404) throw new Error('Could not load art/overrides.json.')
  const overrides: Record<string, ArtRecipe> = overrideResponse.ok ? await overrideResponse.json() : {}
  const loadedModels = await Promise.all(Object.entries(modelFiles).map(async ([name, path]) => {
    const response = await fetch(path)
    if (!response.ok) throw new Error('Could not load model ' + path + ' (' + response.status + ')')
    const source = await response.json()
    recipes.set(name, source)
    return [name, modelFromArtRecipe(source)] as const
  }))
  const edited = Object.fromEntries(Object.entries(overrides).map(([name, source]) => [name, modelFromArtRecipe(source)]))
  const art = createArtKit<string>({ palette: game.palette, models: { ...edited, ...models, ...Object.fromEntries(loadedModels) } })
  type Name = Parameters<typeof art.sprite>[0]
  type ObjectInGame = ReviewObject
  const scenery: ObjectInGame[] = [], ground: ObjectInGame[] = [], pickups: ObjectInGame[] = []
  const solid = new Set<number>()
  const width = game.map[0]?.length, depth = game.map.length
  if (!width) throw new Error('Add at least one row of tiles to the map.')
  const cell = (x: number, z: number) => z * width + x
  const legend: Record<string, Name> = game.scenery
  let spawn: ObjectInGame, goal: ObjectInGame
  for (const [z, row] of game.map.entries()) {
    if (row.length !== width) throw new Error('Each map row must have the same width.')
    for (const [x, mark] of Array.from(row).entries()) {
      ground.push({ id: 'ground-' + x + '-' + z, name: game.ground, x, z })
      if (mark === '@' && !spawn) spawn = { id: 'player', name: game.player, x, z }
      else if (mark === 'L' && !goal) {
        goal = { id: 'goal', name: game.goal, x, z }
        scenery.push(goal)
      } else if (mark === '*') pickups.push({ id: 'pickup-' + x + '-' + z, name: game.pickup, x, z })
      else if (Object.hasOwn(legend, mark)) {
        scenery.push({ id: 'prop-' + x + '-' + z, name: legend[mark], x, z })
        solid.add(cell(x, z))
      } else if (mark !== '.') throw new Error('Unexpected map character ' + mark + ' at row ' + (z + 1))
    }
  }
  if (!spawn || !goal) throw new Error('Place one @ for the player and one L for the goal.')
  if (!(game.stepSeconds > 0 && Number.isFinite(game.stepSeconds))) throw new Error('stepSeconds must be positive.')

  const params = new URLSearchParams(location.search)
  const backend = (params.get('renderer') ?? (params.has('canvas') ? 'canvas' : 'auto')) as Backend
  const stage = $<HTMLCanvasElement>('world')
  let renderer: LowPolyRenderer
  const layer = $<HTMLCanvasElement>('sprites'), mode = $<HTMLSelectElement>('view')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const atlases = new Map<Name, Awaited<ReturnType<typeof createSpriteAtlas>>>()
  const names = new Set<Name>([game.ground, game.player, game.goal, game.pickup, game.effect, ...scenery.map(p => p.name)])
  async function atlasFor(canvas: HTMLCanvasElement, name: Name) {
    const override = sprites[name]
    const atlas = await createSpriteAtlas(canvas, override?.manifest ?? art.sprite(name))
    if (override && !Object.hasOwn(atlas.clips, override.clip)) throw new Error('Unknown clip ' + override.clip + ' for ' + name)
    return atlas
  }
  const icon = $<HTMLCanvasElement>('icon')
  const inventory = await atlasFor(icon, game.pickup)
  inventory.begin(icon)
  inventory.drawClip(sprites[game.pickup]?.clip ?? 'front-right', 0, [0, 0], { height: 1.1, anchor: .5 })

  const fixed = art.group(), items = art.group(), moving = art.group()
  for (const obj of [...ground, ...scenery]) fixed.add(obj.name, [obj.x, 0, obj.z])
  const remaining = new Map<number, ObjectInGame>()
  let player: ObjectInGame, fromX = 0, fromZ = 0, travel = 0
  let flash: ObjectInGame | undefined, flashTime = 0, won = false, queued: Direction | undefined
  let paused = false, lastPaintTime = 0, clockOffset = 0
  const controls = bindActionControls({ keys, buttons: document.querySelectorAll<HTMLElement>('[data-control]'),
    enabled: () => !won && !paused, onPress: key => { queued = key } })
  const title = $('title'), objective = $('objective'), count = $('count')
  title.textContent = document.title = game.title
  let dirty = true
  function updateItems() {
    dirty = true
    items.clear()
    for (const obj of remaining.values()) items.add(obj.name, [obj.x, 0, obj.z])
    count.textContent = (pickups.length - remaining.size) + ' / ' + pickups.length
    objective.textContent = won ? game.victory : remaining.size ? game.objective : game.returnToGoal
  }
  function restart() {
    player = { ...spawn, yaw: 0 }
    fromX = player.x
    fromZ = player.z
    travel = flashTime = 0
    flash = undefined
    queued = undefined
    won = false
    controls.clear()
    remaining.clear()
    for (const obj of pickups) remaining.set(cell(obj.x, obj.z), obj)
    updateItems()
  }
  function arrive() {
    if (remaining.delete(cell(player.x, player.z))) {
      flash = { id: 'pickup-effect', name: game.effect, x: player.x, z: player.z }
      flashTime = .38
      updateItems()
    }
    if (!remaining.size && player.x === goal.x && player.z === goal.z) { won = true; updateItems() }
  }

  restart()
  $('restart').onclick = restart
  if (params.get('view') === '2d') mode.value = '2d'
  let spriteView = false
  async function changeView() {
    mode.disabled = true
    const next = mode.value === '2d'
    try {
      if (next && [...names].some(name => !atlases.has(name))) {
        const loaded = await Promise.all([...names].filter(name => !atlases.has(name)).map(async name => [name, await atlasFor(layer, name)] as const))
        for (const [name, atlas] of loaded) atlases.set(name, atlas)
      }
      if (!next) renderer ??= await createLowPolyRenderer(stage, { backend, canvasDepth: true })
      spriteView = next
      const world = renderer?.canvas ?? stage
      world.hidden = spriteView
      layer.hidden = !spriteView
      dirty = true
    } finally { mode.disabled = false }
  }
  mode.onchange = () => changeView().catch(error => {
    mode.value = spriteView ? '2d' : '3d'
    objective.textContent = error.message
  })
  await changeView()
  const board = layer.parentElement
  const cx = (width - 1) / 2, cz = (depth - 1) / 2
  const target: Vec3 = [cx, .5, cz]
  const distance = Math.max(width, depth) * 2 + 8
  const eye = view([cx, target[1] + distance * .5, cz + distance * Math.cos(Math.PI / 6)], target)
  const sky = color('21393e')
  let camera: Matrix, spanY = 0, previousAspect = 0
  let lastSurface: HTMLCanvasElement, lastWidth = 0, lastHeight = 0, lastRatio = 0
  const usesClips = Object.keys(sprites).length > 0
  let drawnHero: ReviewObject, drawnEffect: ReviewObject
  function foreground(hero: ReviewObject, effect?: ReviewObject) {
    const objects = [...scenery, ...remaining.values(), hero]
    if (effect) objects.push(effect)
    return objects.sort((a, b) => a.z - b.z)
  }
  function paint(obj: ObjectInGame, now: number) {
    const model = art.model(obj.name)
    const point = projectPoint(camera, obj.x, (obj.y ?? 0) + model.centerY, obj.z)
    const options = { height: model.span / spanY, anchor: .5 }
    if (sprites[obj.name]) {
      atlases.get(obj.name).drawClip(sprites[obj.name].clip, reduced.matches ? 0 : now, point, options)
      return
    }
    const column = (Math.round(-(obj.yaw ?? 0) * 4 / Math.PI) % 8 + 8) % 8
    atlases.get(obj.name).draw(column, 0, point, options)
  }

  const stop = fixedLoop({
    update(dt) {
      if (paused) return
      if (travel > 0 || flashTime > 0) dirty = true
      flashTime = Math.max(0, flashTime - dt)
      if (travel > 0) {
        travel = Math.max(0, travel - dt)
        if (travel === 0) arrive()
        return
      }
      if (won) return
      const direction = queued ?? (Object.keys(moves) as Direction[]).find(key => controls.active(key))
      queued = undefined
      if (!direction) return
      const [dx, dz] = moves[direction]
      const yaw = Math.atan2(dx, dz)
      if (yaw !== player.yaw) dirty = true
      player.yaw = yaw
      const x = player.x + dx, z = player.z + dz
      if (x < 0 || x >= width || z < 0 || z >= depth || solid.has(cell(x, z))) return
      fromX = player.x
      fromZ = player.z
      player.x = x
      player.z = z
      dirty = true
      travel = game.stepSeconds
    },
    render(_alpha, now) {
      const w = Math.max(1, board.clientWidth), h = Math.max(1, board.clientHeight)
      const surface = spriteView ? layer : renderer.canvas
      const ratio = Math.min(devicePixelRatio || 1, 2)
      if (!dirty && !(spriteView && usesClips && !reduced.matches && !paused) && surface === lastSurface &&
          w === lastWidth && h === lastHeight && ratio === lastRatio) return
      dirty = false
      now = paused ? lastPaintTime : now - clockOffset
      lastPaintTime = now
      lastSurface = surface
      lastWidth = w
      lastHeight = h
      lastRatio = ratio
      const aspect = w / h
      if (aspect !== previousAspect) {
        spanY = Math.max(depth * .5 + 3.4, (width + 1.65) / aspect)
        camera = multiply(orthographic(spanY * aspect, spanY, .1, distance * 2), eye)
        previousAspect = aspect
      }
      const t = travel / game.stepSeconds
      const hero = { ...player, x: player.x + (fromX - player.x) * t, z: player.z + (fromZ - player.z) * t,
        y: reduced.matches ? 0 : .08 * Math.sin(Math.PI * t) }
      const effect = flashTime > 0 && flash ? { ...flash, y: 1.15 + (reduced.matches ? 0 : (.38 - flashTime) * 1.6) } : undefined
      drawnHero = hero
      drawnEffect = effect
      if (spriteView) {
        if (layer.width !== Math.round(w * ratio)) layer.width = Math.round(w * ratio)
        if (layer.height !== Math.round(h * ratio)) layer.height = Math.round(h * ratio)
        atlases.get(game.ground).begin(layer)
        for (const obj of ground) paint(obj, now)
        for (const obj of foreground(hero, effect)) paint(obj, now)
      } else {
        moving.clear()
        moving.add(hero.name, [hero.x, hero.y, hero.z], { yaw: hero.yaw })
        if (effect) moving.add(effect.name, [effect.x, effect.y, effect.z])
        renderer.render(camera, [...fixed.batches, ...items.batches, ...moving.batches], sky)
      }
    }
  })
  if (params.has('testing')) {
    try {
      const { attachTesting } = await import('./testing.ts')
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      await attachTesting({
        kit: art, hud: icon, pickup: game.pickup,
        frame: () => ({ objects: [...ground, ...foreground(drawnHero, drawnEffect)], matrix: camera, spanY,
          now: reduced.matches ? 0 : lastPaintTime, sprite: spriteView, surface: spriteView ? layer : renderer.canvas }),
        source(name) {
          const file = Object.hasOwn(modelFiles, name) ? modelFiles[name] : null
          if (file) {
            const url = new URL(file, location.href), folder = new URL('art/', location.href)
            const filename = url.origin === folder.origin && url.pathname.startsWith(folder.pathname)
              ? decodeURIComponent(url.pathname.slice(folder.pathname.length)) : ''
            const local = /^[^/\\\0]+\.art\.json$/i.test(filename) ? 'art/' + filename : null
            return { path: local ?? file, file: local, base: recipes.get(name), recipe: local ? recipes.get(name) : undefined }
          }
          if (Object.hasOwn(models, name)) return { path: 'game.js#models.' + name, file, base: null }
          const base = Object.hasOwn(overrides, name) ? overrides[name] : null
          const stock = !base && Object.hasOwn(artModels, name) ? createArtRecipe(name as keyof typeof artModels) : undefined
          if (stock) stock.palette = {}
          return { path: 'art/overrides.json#' + name, file, base, recipe: base ?? stock }
        },
        sprite: name => sprites[name],
        async atlas(name) {
          if (!atlases.has(name)) atlases.set(name, await atlasFor(layer, name))
          return atlases.get(name)
        },
        pause(on) {
          controls.clear()
          queued = undefined
          if (!on) clockOffset = performance.now() - lastPaintTime
          paused = on
          mode.disabled = on
          $<HTMLButtonElement>('restart').disabled = on
        },
        snapshot: () => ({ view: spriteView ? '2d' : '3d', time: lastPaintTime, player: [player.x, player.z, player.yaw],
          fromX, fromZ, travel, pickups: [...remaining.keys()], flash: flash ? [flash.x, flash.z] : null, flashTime, won }),
        async restore(raw) {
          const s = raw as { view: string; time: number; player: number[]; fromX: number; fromZ: number;
            travel: number; pickups: number[]; flash?: number[]; flashTime: number; won: boolean }
          if (!s || !['2d', '3d'].includes(s.view) || s.player?.length !== 3 ||
              ![...s.player, s.time, s.fromX, s.fromZ, s.travel, s.flashTime].every(Number.isFinite) || !Array.isArray(s.pickups)) throw new Error('This saved scene cannot be restored.')
          mode.value = s.view
          await changeView()
          mode.disabled = true
          player = { ...spawn, x: s.player[0], z: s.player[1], yaw: s.player[2] }
          fromX = s.fromX; fromZ = s.fromZ; travel = s.travel
          lastPaintTime = s.time
          flash = s.flash?.length === 2 ? { id: 'pickup-effect', name: game.effect, x: s.flash[0], z: s.flash[1] } : undefined
          flashTime = s.flashTime
          won = s.won
          remaining.clear()
          for (const obj of pickups) if (s.pickups.includes(cell(obj.x, obj.z))) remaining.set(cell(obj.x, obj.z), obj)
          updateItems()
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        }
      })
    } catch (error) { objective.textContent = 'Art testing needs the local npm run playtest server. ' + error.message }
  }
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    stop()
    controls.dispose()
    renderer?.dispose()
  })
}

start().catch(error => { $('objective').textContent = error.message; console.error(error) })
