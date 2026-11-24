import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP, verifyTrace } from '../framework/index.ts'
import {
  buyUpgrade, canBuyUpgrade, createInitialState, serializeSave, stepGame
} from '../lighthouse/simulation.ts'
import { PADS, UPGRADES, carryCapFor, islandHeight, upgradeCost } from '../lighthouse/types.ts'
import type { GameState, MoveInput } from '../lighthouse/types.ts'

test('Tidewatch terrain tiers separate headland, pier, beach, and tidal shoals', () => {
  const headland = islandHeight(0, -2.5)
  const pier = islandHeight(-5.5, 4.5)
  const shoal = islandHeight(6.8, 5.2)
  const deepSea = islandHeight(16, 12)
  assert.ok(headland > 1.1, `Expected dry headland, got ${headland}`)
  assert.ok(pier > 0.6, `Expected elevated pier, got ${pier}`)
  assert.ok(shoal > -0.1 && shoal < 0.4, `Expected intertidal shoal, got ${shoal}`)
  assert.ok(deepSea < -0.5, `Expected deep seabed offshore, got ${deepSea}`)
})

test('Tidewatch cycles tides, weather, fuel burn, and ship guidance deterministically', () => {
  const state = createInitialState(42)
  const seenTides = new Set<string>([state.tidePhase])
  const seenWeathers = new Set<string>([state.weather])

  // Simulate 140 seconds at 60 Hz, refilling fuel periodically so ships are guided
  for (let i = 0; i < 140 * 60; i++) {
    if (state.fuel < 40) state.fuel = 95
    stepGame(state, { x: 0, z: 0 }, STEP)
    seenTides.add(state.tidePhase)
    seenWeathers.add(state.weather)
  }

  assert.deepEqual([...seenTides].sort(), ['ebbing', 'high', 'low', 'rising'])
  assert.ok(seenWeathers.has('clear') && seenWeathers.has('fog') && seenWeathers.has('rain') && seenWeathers.has('storm'),
    `Expected all 4 weather phases, saw ${[...seenWeathers].join(', ')}`)
  assert.ok(state.shipsGuided >= 1, `Expected at least 1 passing ship guided, got ${state.shipsGuided}`)
  assert.ok(state.totalEarned > 20, 'Guiding ships should increase totalEarned')
})

test('Tidewatch resource pickup, sell pad auto-transfer, fuel pad, and upgrades work end-to-end', () => {
  const state = createInitialState(77)
  // Place a guaranteed amber right in front of the player
  state.items.push({
    id: 9999,
    kind: 'amber',
    x: state.player.x + 0.5,
    z: state.player.z,
    y: state.player.y,
    yaw: 0,
    age: 0,
    pulling: false,
    pullT: 0
  })

  // Step briefly for magnet pickup
  for (let i = 0; i < 40; i++) stepGame(state, { x: 0.4, z: 0 }, STEP)
  assert.ok(state.player.carry.includes('amber'), 'Player should magnet-collect nearby amber')

  // Move onto Trading Pier pad and auto-sell
  const sellPad = PADS.find(p => p.id === 'sell')!
  state.player.x = sellPad.x
  state.player.z = sellPad.z
  const coinsBefore = state.coins
  for (let i = 0; i < 30; i++) stepGame(state, { x: 0, z: 0 }, STEP)
  assert.ok(state.coins > coinsBefore, 'Standing on Trading Pier pad should sell carried loot for gold')
  assert.equal(state.player.carry.length, 0)

  // Test fuel pad auto-refuel
  state.fuel = 40
  state.player.carry.push('driftwood')
  const fuelPad = PADS.find(p => p.id === 'fuel')!
  state.player.x = fuelPad.x
  state.player.z = fuelPad.z
  for (let i = 0; i < 20; i++) stepGame(state, { x: 0, z: 0 }, STEP)
  assert.ok(state.fuel > 55, 'Standing on Lighthouse Fuel pad should consume driftwood and boost fuel')

  // Buy Boots & Pack upgrades
  state.coins = 200
  const packSpec = UPGRADES.find(u => u.id === 'pack')!
  const packCost = upgradeCost(packSpec, 1)
  assert.equal(canBuyUpgrade(state, 'pack'), true)
  assert.equal(buyUpgrade(state, 'pack'), true)
  assert.equal(state.upgrades.pack, 2)
  assert.equal(state.coins, 200 - packCost)
  assert.equal(carryCapFor(state.upgrades.pack), 8)

  // Save/load round-trip preserves progression
  const saved = serializeSave(state)
  const restored = createInitialState(77, saved)
  assert.equal(restored.coins, state.coins)
  assert.equal(restored.upgrades.pack, 2)
})

test('Tidewatch simulation passes Ridgetop verifyTrace invariants', () => {
  const actions: MoveInput[] = Array.from({ length: 120 }, (_, i) => ({
    x: i < 60 ? 1 : -1,
    z: i < 60 ? 0.5 : -0.3
  }))
  const report = verifyTrace<GameState, MoveInput>({
    initial: createInitialState(101),
    step(state, action) {
      stepGame(state, action, STEP)
      return state
    },
    actions,
    checks: [
      {
        id: 'finite-position',
        test: ({ after }) => Number.isFinite(after.player.x) && Number.isFinite(after.player.y) && Number.isFinite(after.player.z)
      },
      {
        id: 'bounded-fuel-and-warmth',
        test: ({ after }) => after.fuel >= 0 && after.fuel <= 100 && after.player.warmth >= 0 && after.player.warmth <= 100
      },
      {
        id: 'carry-within-cap',
        test: ({ after }) => after.player.carry.length <= carryCapFor(after.upgrades.pack)
      }
    ]
  })
  assert.equal(report.status, 'pass')
})
