import type { Player, PlayerSnapshot } from './game/simulation.ts'
import {
  createCookieSession, createGameHost, createRoomService, isMain, sendJson, sendText, startGameHost
} from './framework/server.ts'
import { courses } from './game/level.ts'
import { canEnterRegion, characterView } from './game/expedition.ts'
import { createCharacterStore, openCharacterStore } from './game/character-store.ts'
import { createPlayer, restartPlayer, stepPlayer } from './game/simulation.ts'

const files = [
  'index.html', 'style.css', 'game-ui.css', 'main.js', 'benchmark.html', 'benchmark.js', 'racing.html',
  'starter/index.html', 'starter/style.css', 'starter/main.js', 'starter/game.js',
  'models/index.html', 'models/style.css', 'models/main.js', 'models/headland.js',
  'sprite-workshop.html', 'sprite-workshop.css', 'sprite-workshop.js', 'sprite-model-editor.js',
  'racing/style.css', 'racing/main.js', 'racing/race.js', 'racing/scene.js', 'racing/track.js', 'racing/progression.js',
  'racing/car-art.js', 'racing/garage.js', 'racing/garage-art.js', 'racing/save-menu.js',
  'game/level.js', 'game/simulation.js', 'game/scene.js', 'game/campaign.js', 'game/sprites.js',
  'game/sprite-art.js', 'game/assets/sprites.json', 'game/audio.js', 'game/expedition.js', 'game/assets/sprites.png', 'game/assets/scout.png'
]
const roomRoute = /^\/rooms(?:\/([a-z0-9-]+))?\/([a-z0-9-]{1,32})\/(events|input|leave)$/
const expeditionRoute = /^\/expeditions\/([a-z0-9-]+)\/([a-z0-9-]{1,32})\/(events|input|leave)$/
const session = createCookieSession({ name: 'ridgetop_character', path: '/expeditions', maxAge: 31536000 })

export function createGameServer({ characters = createCharacterStore() } = {}) {
  function saveRewards() {
    characters.save().catch(error => console.error('Character save failed', error.message))
  }

  const rooms = createRoomService<{ zone: string; expedition: boolean }, Player, Omit<PlayerSnapshot, 'id' | 'slot'>>({
    createPlayer: (id, slot, world) => createPlayer(id, slot, courses[world.zone]),
    restartPlayer: (player, input, world) => restartPlayer(player, input, courses[world.zone]),
    stepPlayer(player, input, dt, world, identity) {
      const finished = player.finished
      stepPlayer(player, input, dt, courses[world.zone])
      if (identity && !finished && player.finished) {
        characters.award(identity, world.zone, player)
        saveRewards()
      }
    },
    beforePublish(world, participants, tick) {
      if (!world.expedition) return
      const finishers = participants.filter(({ player }) => player.finished).map(({ identity }) => identity)
      if (characters.awardGuild(world.zone, finishers) || (finishers.length && tick % 60 === 0)) saveRewards()
    },
    snapshot(player, _world, identity) {
      const { x, y, vy, grounded, moving, facing, crystals, falls, finished, ticks, signal, checkpoint, revision } = player
      const character = identity ? characterView(characters.get(identity)) : undefined
      return { x, y, vy, grounded, moving, facing, crystals, falls, finished, ticks, signal, checkpoint, revision, character }
    }
  })

  const source = import.meta.url.endsWith('.ts')
  return createGameHost({
    root: new URL(source ? '.' : '../', import.meta.url),
    moduleRoot: new URL(source ? 'dist/' : '.', import.meta.url),
    files, artDirectories: ['starter/art'],
    aliases: { '/': 'index.html', '/benchmark': 'benchmark.html', '/racing': 'racing.html', '/sprites': 'sprite-workshop.html', '/models': 'models/index.html', '/starter/': 'starter/index.html' },
    stop: rooms.close,
    save: characters.save,
    async handle(req, res, pathname) {
      if (pathname === '/starter') {
        res.writeHead(308, { Location: '/starter/' + new URL(req.url, 'http://localhost').search }).end()
        return true
      }
      if (pathname === '/expeditions/character' && req.method === 'POST') {
        if (req.headers['sec-fetch-site'] === 'cross-site') sendText(res, 403)
        else {
          let id = session.read(req)
          if (!characters.get(id)) {
            id = characters.create()
            session.write(req, res, id)
          }
          await characters.save()
          sendJson(res, characterView(characters.get(id)))
        }
        return true
      }
      const expedition = expeditionRoute.exec(pathname)
      const match = expedition ?? roomRoute.exec(pathname)
      if (!match) return false
      const [, zone = 'ridge', code, action] = match
      const key = (expedition ? 'expedition/' : 'race/') + zone + '/' + code
      if (!Object.hasOwn(courses, zone)) sendText(res, 404, 'Course not found')
      else if (action === 'events' && req.method === 'GET') {
        const identity = expedition ? session.read(req) : undefined
        const profile = identity && characters.get(identity)
        if (expedition && !profile) sendText(res, 401, 'Enter the expedition to create a character')
        else if (expedition && !canEnterRegion(profile.cleared, zone)) sendText(res, 403, 'Clear the previous zone first')
        else rooms.join(req, res, { key, world: { zone, expedition: Boolean(expedition) }, identity })
      } else if ((action === 'input' || action === 'leave') && req.method === 'POST') {
        await rooms.receive(req, res, key, action)
      } else sendText(res, 405)
      return true
    }
  })
}

if (isMain(import.meta.url)) {
  const characters = await openCharacterStore(process.env.RIDGETOP_CHARACTER_SAVE ?? 'data/characters.json')
  startGameHost(createGameServer({ characters }))
}
