import { artModels, bindActionControls, color, createArtKit, createArtRecipe, createLowPolyRenderer, createPlatform,
  createSpriteAtlas, fixedLoop, modelFromArtRecipe, multiply, orthographic, projectPoint, registerTestingHooks, view } from '../framework/index.ts'
import type { ArtRecipe, Backend, LowPolyRenderer, Matrix, Vec3 } from '../framework/index.ts'
import { boxNode, column, overlay, row, spacerNode } from '../framework/ui-layout.ts'
import { buttonPrimitive } from '../framework/ui-button.ts'
import { togglePrimitive } from '../framework/ui-toggle.ts'
import { dialogPrimitive, menuPrimitive } from '../framework/ui-menu.ts'
import { createCanvasUi, createUiTheme } from '../framework/ui-canvas.ts'
import { game, modelFiles, models, sprites } from './game.ts'

const moves = { left: [-1, 0], up: [0, -1], down: [0, 1], right: [1, 0] } as const
type Direction = keyof typeof moves
const keys: Record<string, Direction> = { KeyA: 'left', ArrowLeft: 'left', KeyW: 'up', ArrowUp: 'up',
  KeyD: 'right', ArrowRight: 'right', KeyS: 'down', ArrowDown: 'down' }
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function start() {
  const platform = createPlatform()
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
  type ObjectInGame = { id: string; name: Name; x: number; z: number; y?: number; yaw?: number }
  const scenery: ObjectInGame[] = [], ground: ObjectInGame[] = [], pickups: ObjectInGame[] = []
  const solid = new Set<number>()
  const width = game.map[0]?.length, depth = game.map.length
  if (!width) throw new Error('Add at least one row of tiles to the map.')
  const cell = (x: number, z: number) => z * width + x
  const legend: Record<string, Name> = game.scenery
  let spawn: ObjectInGame, goal: ObjectInGame
  for (const [z, rowTiles] of game.map.entries()) {
    if (rowTiles.length !== width) throw new Error('Each map row must have the same width.')
    for (const [x, mark] of Array.from(rowTiles).entries()) {
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
  const layer = $<HTMLCanvasElement>('sprites')
  const uiCanvas = $<HTMLCanvasElement>('ui')
  const board = layer.parentElement
  let renderer: LowPolyRenderer
  let rendererPromise: Promise<LowPolyRenderer> | undefined
  let viewRequest = 0
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const atlases = new Map<Name, Awaited<ReturnType<typeof createSpriteAtlas>>>()
  const atlasPromises = new Map<Name, Promise<Awaited<ReturnType<typeof createSpriteAtlas>>>>()
  const names = new Set<Name>([game.ground, game.player, game.goal, game.pickup, game.effect, ...scenery.map(p => p.name)])
  async function atlasFor(canvas: HTMLCanvasElement, name: Name) {
    const override = sprites[name]
    const atlas = await createSpriteAtlas(canvas, override?.manifest ?? art.sprite(name))
    if (override && !Object.hasOwn(atlas.clips, override.clip)) throw new Error('Unknown clip ' + override.clip + ' for ' + name)
    return atlas
  }
  function ensureAtlas(name: Name) {
    const existing = atlases.get(name)
    if (existing) return Promise.resolve(existing)
    let pending = atlasPromises.get(name)
    if (!pending) {
      pending = atlasFor(layer, name)
        .then(atlas => { atlases.set(name, atlas); return atlas })
        .finally(() => { atlasPromises.delete(name) })
      atlasPromises.set(name, pending)
    }
    return pending
  }

  // Offscreen pickup icon canvas reused inside the Canvas UI HUD badge (zero HTML chrome).
  const icon = document.createElement('canvas')
  icon.width = 48
  icon.height = 48
  const inventory = await atlasFor(icon, game.pickup)
  inventory.begin(icon)
  inventory.drawClip(sprites[game.pickup]?.clip ?? 'front-right', 0, [0, 0], { height: 1.1, anchor: .5 })

  const fixed = art.group(), items = art.group(), moving = art.group()
  for (const obj of [...ground, ...scenery]) fixed.add(obj.name, [obj.x, 0, obj.z])
  const remaining = new Map<number, ObjectInGame>()
  let player: ObjectInGame, fromX = 0, fromZ = 0, travel = 0
  let flash: ObjectInGame | undefined, flashTime = 0, won = false, queued: Direction | undefined
  let lastPaintTime = 0, spriteView = false, dirty = true, uiDirty = true
  let errorBanner = ''
  document.title = game.title

  // Opt-in UI state machines (only button, toggle, menu, dialog are imported; unused widgets stay out of the bundle).
  let syncingView = false
  const menuDialog = dialogPrimitive.create({ id: 'pause-dialog', open: false, onOpenChange: () => { uiDirty = true } })
  const viewToggle = togglePrimitive.create({
    id: 'view-toggle',
    label: '2D Sprites',
    checked: params.get('view') === '2d',
    onChange(checked) {
      if (syncingView) return
      void setViewMode(checked ? '2d' : '3d').catch(err => {
        syncingView = true
        viewToggle.api.set(spriteView)
        syncingView = false
        errorBanner = err.message
        uiDirty = true
      })
    }
  })
  const resumeBtn = buttonPrimitive.create({ id: 'resume-btn', label: 'Resume', onPress: () => menuDialog.api.close() })
  const restartBtn = buttonPrimitive.create({ id: 'restart-btn', label: 'Restart', onPress: () => { menuDialog.api.close(); restart() } })
  const menuBtn = buttonPrimitive.create({ id: 'menu-btn', label: 'Menu', onPress: () => menuDialog.api.toggle() })
  const quitBtn = buttonPrimitive.create({ id: 'quit-btn', label: 'Quit', onPress: () => { void platform.quit() } })
  const pauseMenu = menuPrimitive.create({
    id: 'pause-menu',
    items: [
      { id: 'resume-btn' },
      { id: 'view-toggle' },
      { id: 'restart-btn' },
      ...(platform.canQuit ? [{ id: 'quit-btn' }] : [])
    ],
    onBack: () => menuDialog.api.close()
  })

  const isMenuOpen = () => menuDialog.api.isOpen() || won

  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme(game.palette),
    safeArea: { top: 12, right: 12, bottom: 12, left: 12 },
    keyboardEnabled: () => isMenuOpen(),
    onBack: () => { if (menuDialog.api.isOpen()) menuDialog.api.close() }
  })
  function renderUiNow() {
    const w = Math.max(1, board.clientWidth), h = Math.max(1, board.clientHeight)
    const ratio = Math.min(devicePixelRatio || 1, 2)
    ui.render(buildUiTree(w), { width: w, height: h, pixelRatio: ratio })
    uiDirty = false
  }
  ;(globalThis as { __ridgetopUi?: unknown }).__ridgetopUi = {
    snapshot: () => ui.snapshot(),
    query: (filter?: { id?: string; kind?: string; state?: string; label?: string }) => ui.query(filter),
    act: (id: string, action: string, payload?: unknown) => {
      if (uiDirty) renderUiNow()
      const ok = ui.act(id, action, payload)
      renderUiNow()
      return ok
    },
    rects: () => Object.fromEntries(ui.rects),
    state: () => ({
      count: `${pickups.length - remaining.size} / ${pickups.length}`,
      view: spriteView ? '2d' : '3d',
      won,
      paused: menuDialog.api.isOpen()
    })
  }

  const controls = bindActionControls({
    keys,
    buttons: [],
    enabled: () => !won && !menuDialog.api.isOpen(),
    onPause: () => { if (!won) { menuDialog.api.toggle(); uiDirty = true } },
    onPress: key => { queued = key }
  })

  function updateItems() {
    dirty = true
    uiDirty = true
    items.clear()
    for (const obj of remaining.values()) items.add(obj.name, [obj.x, 0, obj.z])
  }

  function restart() {
    player = { ...spawn, yaw: 0 }
    fromX = player.x
    fromZ = player.z
    travel = flashTime = 0
    flash = undefined
    queued = undefined
    won = false
    errorBanner = ''
    controls.clear()
    remaining.clear()
    for (const obj of pickups) remaining.set(cell(obj.x, obj.z), obj)
    updateItems()
  }

  function arrive() {
    if (remaining.delete(cell(player.x, player.z))) {
      flash = { id: 'pickup-effect', name: game.effect, x: player.x, z: player.z }
      flashTime = .38
      platform.haptic('light')
      updateItems()
    }
    if (!remaining.size && player.x === goal.x && player.z === goal.z) {
      won = true
      platform.haptic('medium')
      updateItems()
    }
  }

  async function setViewMode(nextMode: '2d' | '3d') {
    const ticket = ++viewRequest
    const next = nextMode === '2d'
    if (next && [...names].some(name => !atlases.has(name))) {
      await Promise.all([...names].map(name => ensureAtlas(name)))
    }
    if (!next && !renderer) {
      rendererPromise ??= createLowPolyRenderer(stage, { backend, canvasDepth: true })
        .then(r => { renderer = r; return r })
        .finally(() => { rendererPromise = undefined })
      await rendererPromise
    }
    if (ticket !== viewRequest) return
    spriteView = next
    const world = renderer?.canvas ?? stage
    world.hidden = spriteView
    layer.hidden = !spriteView
    dirty = true
    uiDirty = true
  }

  restart()
  await setViewMode(viewToggle.api.checked() ? '2d' : '3d')

  const cx = (width - 1) / 2, cz = (depth - 1) / 2
  const target: Vec3 = [cx, .5, cz]
  const distance = Math.max(width, depth) * 2 + 8
  const eye = view([cx, target[1] + distance * .5, cz + distance * Math.cos(Math.PI / 6)], target)
  const sky = color('21393e')
  let camera: Matrix, spanY = 0, previousAspect = 0
  let lastSurface: HTMLCanvasElement, lastWidth = 0, lastHeight = 0, lastRatio = 0
  const usesClips = Object.keys(sprites).length > 0

  function foreground(hero: ObjectInGame, effect?: ObjectInGame) {
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
    const columnIndex = (Math.round(-(obj.yaw ?? 0) * 4 / Math.PI) % 8 + 8) % 8
    atlases.get(obj.name).draw(columnIndex, 0, point, options)
  }

  function buildUiTree(w: number) {
    const compact = w < 620
    const statusText = errorBanner || (won ? game.victory : remaining.size ? game.objective : game.returnToGoal)
    const collected = `${pickups.length - remaining.size} / ${pickups.length}`
    const modalOpen = isMenuOpen()

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Top HUD bar (title, objective, score badge, view toggle, menu)
      row({ id: 'hud-bar', style: { anchor: 'top', width: Math.min(w - 24, 960), inset: 12, gap: 10, align: 'center', respectSafeArea: true } }, [
        row({ id: 'score-card', style: { height: 44, padding: [4, 12, 4, 6], gap: 8, align: 'center' }, widget: { type: 'panel' } }, [
          boxNode({ id: 'pickup-icon', style: { width: 32, height: 32 }, widget: { type: 'icon', image: icon } }),
          boxNode({ id: 'pickup-count', style: { width: 54, height: 24 }, widget: { type: 'text', text: collected, size: 15, weight: 800, mono: true } })
        ]),
        column({ id: 'title-card', style: { grow: 1, height: 44, padding: [4, 12], justify: 'center' }, widget: { type: 'panel' } }, [
          boxNode({ id: 'game-title', style: { height: 20 }, widget: { type: 'text', text: compact ? game.title : `${game.title} — ${statusText}`, size: 14, weight: 700 } })
        ]),
        boxNode({
          id: 'hud-view-toggle',
          style: { width: compact ? 88 : 128, height: 44 },
          widget: { type: 'toggle', label: compact ? '2D' : '2D Sprites', checked: viewToggle.api.checked(), disabled: modalOpen, primitive: viewToggle }
        }),
        boxNode({
          id: 'menu-btn',
          style: { width: 78, height: 44 },
          widget: { type: 'button', label: 'Menu', disabled: modalOpen, primitive: menuBtn }
        })
      ]),

      // Touch / pointer D-pad (hidden when menu modal is open)
      column({ id: 'dpad', hidden: modalOpen, style: { anchor: 'bottom-right', inset: 14, gap: 6, align: 'center', respectSafeArea: true } }, [
        boxNode({ id: 'pad-up', style: { width: 48, height: 48 }, widget: { type: 'button', label: '↑', onPress: () => { queued = 'up' } } }),
        row({ id: 'dpad-mid', style: { gap: 6 } }, [
          boxNode({ id: 'pad-left', style: { width: 48, height: 48 }, widget: { type: 'button', label: '←', onPress: () => { queued = 'left' } } }),
          boxNode({ id: 'pad-down', style: { width: 48, height: 48 }, widget: { type: 'button', label: '↓', onPress: () => { queued = 'down' } } }),
          boxNode({ id: 'pad-right', style: { width: 48, height: 48 }, widget: { type: 'button', label: '→', onPress: () => { queued = 'right' } } })
        ])
      ]),

      // Modal scrim + low-poly faceted pause / victory menu
      boxNode({ id: 'modal-scrim', hidden: !modalOpen, style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'modal-card',
        hidden: !modalOpen,
        style: { anchor: 'center', width: Math.min(w - 32, 340), padding: 20, gap: 10 },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'modal-heading', style: { height: 32 }, widget: { type: 'text', text: won ? game.victory : game.title, size: 22, weight: 800, align: 'center' } }),
        boxNode({ id: 'modal-sub', style: { height: 22 }, widget: { type: 'text', text: won ? `Collected ${collected}` : statusText, size: 13, color: ui.theme.muted, align: 'center' } }),
        spacerNode(0),
        boxNode({
          id: 'resume-btn',
          hidden: won,
          style: { height: 42 },
          widget: { type: 'button', label: 'Resume', primary: true, primitive: resumeBtn }
        }),
        ...(won ? [
          boxNode({
            id: 'restart-btn',
            style: { height: 42 },
            widget: { type: 'button', label: 'Play Again', primary: true, primitive: restartBtn }
          }),
          boxNode({
            id: 'modal-view-toggle',
            style: { height: 40 },
            widget: { type: 'toggle', label: '2D Sprites', checked: viewToggle.api.checked(), primitive: viewToggle }
          })
        ] : [
          boxNode({
            id: 'modal-view-toggle',
            style: { height: 40 },
            widget: { type: 'toggle', label: '2D Sprites', checked: viewToggle.api.checked(), primitive: viewToggle }
          }),
          boxNode({
            id: 'restart-btn',
            style: { height: 42 },
            widget: { type: 'button', label: 'Restart', primary: false, primitive: restartBtn }
          })
        ]),
        boxNode({
          id: 'quit-btn',
          hidden: !platform.canQuit,
          style: { height: 40 },
          widget: { type: 'button', label: 'Quit', primitive: quitBtn }
        })
      ])
    ])
  }

  function renderScene(now: number, force = false) {
    const w = Math.max(1, board.clientWidth), h = Math.max(1, board.clientHeight)
    const surface = spriteView ? layer : renderer.canvas
    const ratio = Math.min(devicePixelRatio || 1, 2)
    const resized = surface !== lastSurface || w !== lastWidth || h !== lastHeight || ratio !== lastRatio
    if (uiDirty || ui.dirty || resized || force) {
      ui.render(buildUiTree(w), { width: w, height: h, pixelRatio: ratio })
      uiDirty = false
    }
    if (!force && !dirty && !(spriteView && usesClips && !reduced.matches) && !resized) return
    dirty = false
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

  const stop = fixedLoop({
    update(dt) {
      if (menuDialog.api.isOpen()) return
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
      renderScene(now)
    }
  })

  const unregisterTestingHooks = registerTestingHooks({
    getArtSource(name) {
      const file = Object.hasOwn(modelFiles, name) ? modelFiles[name] : null
      if (file) {
        const url = new URL(file, location.href), folder = new URL('art/', location.href)
        const filename = url.origin === folder.origin && url.pathname.startsWith(folder.pathname)
          ? decodeURIComponent(url.pathname.slice(folder.pathname.length)) : ''
        const local = /^[^/\\\0]+\.art\.json$/i.test(filename) ? 'art/' + filename : null
        return { path: local ?? file, file: local, base: recipes.get(name), recipe: local ? recipes.get(name) : undefined }
      }
      if (Object.hasOwn(models, name)) return { path: 'game.js#models.' + name, file: null, base: null }
      const base = Object.hasOwn(overrides, name) ? overrides[name] : null
      const stock = !base && Object.hasOwn(artModels, name) ? createArtRecipe(name as keyof typeof artModels) : undefined
      if (stock) stock.palette = {}
      return { path: 'art/overrides.json#' + name, file: null, base, recipe: base ?? stock }
    },
    snapshot: () => ({
      view: spriteView ? '2d' : '3d', time: lastPaintTime, player: [player.x, player.z, player.yaw],
      fromX, fromZ, travel, pickups: [...remaining.keys()], flash: flash ? [flash.x, flash.z] : null, flashTime, won
    }),
    async restore(raw) {
      const s = raw as { view: string; time: number; player: number[]; fromX: number; fromZ: number;
        travel: number; pickups: number[]; flash?: number[]; flashTime: number; won: boolean }
      if (!s || !['2d', '3d'].includes(s.view) || s.player?.length !== 3 ||
          ![...s.player, s.time, s.fromX, s.fromZ, s.travel, s.flashTime].every(Number.isFinite) || !Array.isArray(s.pickups)) return
      await setViewMode(s.view as '2d' | '3d')
      syncingView = true
      viewToggle.api.set(spriteView)
      syncingView = false
      player = { ...spawn, x: s.player[0], z: s.player[1], yaw: s.player[2] }
      fromX = s.fromX; fromZ = s.fromZ; travel = s.travel
      lastPaintTime = s.time
      flash = s.flash?.length === 2 ? { id: 'pickup-effect', name: game.effect, x: s.flash[0], z: s.flash[1] } : undefined
      flashTime = s.flashTime
      won = s.won
      remaining.clear()
      for (const obj of pickups) if (s.pickups.includes(cell(obj.x, obj.z))) remaining.set(cell(obj.x, obj.z), obj)
      updateItems()
      renderScene(lastPaintTime, true)
    }
  })

  void pauseMenu
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    unregisterTestingHooks()
    stop()
    ui.dispose()
    controls.dispose()
    renderer?.dispose()
  })
}

start().catch(error => console.error(error))
