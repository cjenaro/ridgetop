import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Buffer } from 'node:buffer'
import type { CourseId } from './game/level.ts'
import type { Player, PlayerSnapshot } from './game/simulation.ts'
import type { RoomService } from 'ridgetop/server'
import {
  createCookieSession, createGameHost, createRoomService, isMain, sendJson, sendText, startGameHost
} from 'ridgetop/server'
import { courses } from './game/level.ts'
import { canEnterRegion, characterView } from './game/expedition.ts'
import { createCharacterStore, openCharacterStore } from './game/character-store.ts'
import { createPlayer, restartPlayer, stepPlayer } from './game/simulation.ts'

const files = ['index.html', 'style.css', 'game-ui.css', 'main.js']
const roomRoute = /^\/rooms(?:\/([a-z0-9-]+))?\/([a-z0-9-]{1,32})$/
const expeditionRoute = /^\/expeditions\/([a-z0-9-]+)\/([a-z0-9-]{1,32})$/
const session = createCookieSession({ name: 'ridgetop_character', path: '/expeditions', maxAge: 31536000 })
function isCourseId(value: string): value is CourseId { return Object.hasOwn(courses, value) }

export interface BeaconRunBackend {
  rooms: RoomService<{ zone: CourseId; expedition: boolean }>
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, pathname: string): boolean | Promise<boolean>
  stop(): void
  save(): Promise<void>
}

export function createBeaconRunBackend({ characters = createCharacterStore() }: {
  characters?: ReturnType<typeof createCharacterStore>
} = {}): BeaconRunBackend {
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

  const roomHandlers = rooms.createHostHandlers({
    match(basePath) {
      const expedition = expeditionRoute.exec(basePath)
      const match = expedition ?? roomRoute.exec(basePath)
      if (!match) return null
      const [, zone = 'ridge', code] = match
      if (!isCourseId(zone)) {
        return { reject: 404, reason: 'Not Found', message: 'Course not found' }
      }
      const isExpedition = Boolean(expedition)
      return {
        key: (isExpedition ? 'expedition/' : 'race/') + zone + '/' + code,
        world: { zone, expedition: isExpedition }
      }
    },
    authorize(req, matched) {
      const { zone, expedition } = matched.world
      if (!expedition) return { ok: true }
      const identity = session.read(req)
      const profile = identity ? characters.get(identity) : undefined
      if (!profile) {
        return { ok: false, status: 401, reason: 'Unauthorized', message: 'Enter the expedition to create a character' }
      }
      if (!canEnterRegion(profile.cleared, zone)) {
        return { ok: false, status: 403, reason: 'Forbidden', message: 'Clear the previous zone first' }
      }
      return { ok: true, identity }
    }
  })

  async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
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
    return roomHandlers.handle(req, res, pathname)
  }

  return {
    rooms,
    handle,
    upgrade: roomHandlers.upgrade,
    stop: rooms.close,
    save: characters.save
  }
}

export function createBeaconRunServer({ characters = createCharacterStore(), testing }: {
  characters?: ReturnType<typeof createCharacterStore>
  testing?: boolean
} = {}) {
  const backend = createBeaconRunBackend({ characters })
  const source = import.meta.url.endsWith('.ts')
  const root = new URL(source ? '.' : '../', import.meta.url)
  const moduleRoot = new URL(source ? 'dist/' : '.', import.meta.url)
  return createGameHost({
    root,
    moduleRoot,
    files,
    mounts: {
      '/game/': { dir: new URL('game/', moduleRoot), extensions: ['js'], exclude: ['character-store.js'] }
    },
    artDirectories: ['game/assets'],
    aliases: { '/': 'index.html' },
    hosted: false,
    testing,
    stop: backend.stop,
    save: backend.save,
    handle: backend.handle,
    upgrade: backend.upgrade
  })
}

if (isMain(import.meta.url)) {
  const testing = process.argv.includes('--testing')
  const characters = await openCharacterStore(process.env.RIDGETOP_CHARACTER_SAVE ?? 'data/characters.json')
  const app = createBeaconRunServer({ characters, testing })
  startGameHost(app, testing ? { host: '127.0.0.1', name: 'Beacon Run testing' } : { name: 'Beacon Run' })
}
