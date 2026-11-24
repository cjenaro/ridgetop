import type { CourseId } from './game/level.ts'
import type { Player, PlayerSnapshot } from './game/simulation.ts'
import {
  createCookieSession, createGameHost, createRoomService, isMain, sendJson, sendText, startGameHost
} from 'ridgetop/server'
import { courses } from './game/level.ts'
import { canEnterRegion, characterView } from './game/expedition.ts'
import { createCharacterStore, openCharacterStore } from './game/character-store.ts'
import { createPlayer, restartPlayer, stepPlayer } from './game/simulation.ts'

const files = [
  'index.html', 'style.css', 'game-ui.css', 'main.js',
  'game/level.js', 'game/simulation.js', 'game/scene.js', 'game/campaign.js', 'game/sprites.js',
  'game/sprite-art.js', 'game/assets/sprites.json', 'game/audio.js', 'game/expedition.js',
  'game/assets/sprites.png', 'game/assets/scout.png'
]
const roomRoute = /^\/rooms(?:\/([a-z0-9-]+))?\/([a-z0-9-]{1,32})\/(events|input|leave)$/
const expeditionRoute = /^\/expeditions\/([a-z0-9-]+)\/([a-z0-9-]{1,32})\/(events|input|leave)$/
const session = createCookieSession({ name: 'ridgetop_character', path: '/expeditions', maxAge: 31536000 })
function isCourseId(value: string): value is CourseId { return Object.hasOwn(courses, value) }

export function createBeaconRunServer({ characters = createCharacterStore(), testing }: {
  characters?: ReturnType<typeof createCharacterStore>
  testing?: boolean
} = {}) {
  function saveRewards() {
    characters.save().catch(error => console.error('Character save failed', error.message))
  }

  const rooms = createRoomService<{ zone: CourseId; expedition: boolean }, Player, Omit<PlayerSnapshot, 'id' | 'slot'>>({
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
      const finishers = participants
        .filter(({ player }) => player.finished)
        .map(({ identity }) => identity)
        .filter((id): id is string => typeof id === 'string')
      if (characters.awardGuild(world.zone, finishers) || (finishers.length && tick % 60 === 0)) saveRewards()
    },
    snapshot(player, _world, identity) {
      const { x, y, vy, grounded, moving, facing, crystals, falls, finished, ticks, signal, checkpoint, revision } = player
      const record = identity ? characters.get(identity) : undefined
      const character = record ? characterView(record) : undefined
      return { x, y, vy, grounded, moving, facing, crystals, falls, finished, ticks, signal, checkpoint, revision, character }
    }
  })

  const source = import.meta.url.endsWith('.ts')
  return createGameHost({
    root: new URL(source ? '.' : '../', import.meta.url),
    moduleRoot: new URL(source ? 'dist/' : '.', import.meta.url),
    files,
    aliases: { '/': 'index.html' },
    hosted: false,
    testing,
    stop: rooms.close,
    save: characters.save,
    async handle(req, res, pathname) {
      if (pathname === '/expeditions/character' && req.method === 'POST') {
        if (req.headers['sec-fetch-site'] === 'cross-site') sendText(res, 403)
        else {
          let id = session.read(req)
          let profile = id ? characters.get(id) : undefined
          if (!profile) {
            id = characters.create()
            session.write(req, res, id)
            profile = characters.get(id)
          }
          await characters.save()
          if (profile) sendJson(res, characterView(profile))
          else sendText(res, 500, 'Could not create character')
        }
        return true
      }
      const expedition = expeditionRoute.exec(pathname)
      const match = expedition ?? roomRoute.exec(pathname)
      if (!match) return false
      const [, zone = 'ridge', code, action] = match
      const key = (expedition ? 'expedition/' : 'race/') + zone + '/' + code
      if (!isCourseId(zone)) sendText(res, 404, 'Course not found')
      else if (action === 'events' && req.method === 'GET') {
        const courseZone: CourseId = zone
        const identity = expedition ? session.read(req) : undefined
        const profile = identity ? characters.get(identity) : undefined
        if (expedition && !profile) sendText(res, 401, 'Enter the expedition to create a character')
        else if (expedition && profile && !canEnterRegion(profile.cleared, courseZone)) sendText(res, 403, 'Clear the previous zone first')
        else rooms.join(req, res, { key, world: { zone: courseZone, expedition: Boolean(expedition) }, identity })
      } else if ((action === 'input' || action === 'leave') && req.method === 'POST') {
        await rooms.receive(req, res, key, action)
      } else sendText(res, 405)
      return true
    }
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const characters = await openCharacterStore(process.env.RIDGETOP_CHARACTER_SAVE ?? 'data/characters.json')
  const app = createBeaconRunServer({ characters, testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Beacon Run testing' } : { name: 'Beacon Run' })
}
