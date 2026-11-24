export const WIDTH = 960
export const HEIGHT = 540

function course(name: string, description: string, theme: string, surfaces: readonly (readonly [number, number, number, number?])[], crystalOffsets: readonly number[], {
  pads = [], spikes = [], signal = [4, 44, 100], par = 18
}: { pads?: readonly (readonly [number, number, number])[]; spikes?: readonly (readonly [number, number, number, number?])[]; signal?: readonly [number, number, number]; par?: number } = {}) {
  const platforms = surfaces.map(([x, y, w, h = 24]) => ({ x, y, w, h }))
  const crystals = platforms.slice(1).map((p, i) => ({ x: p.x + crystalOffsets[i], y: p.y - 37 }))
  const goal = platforms.at(-1)
  const [signalPlatform, signalX, signalY] = signal
  return {
    name, description, theme, platforms, crystals, par,
    pads: pads.map(([i, offset, w]) => ({ x: platforms[i].x + offset, y: platforms[i].y, w })),
    spikes: spikes.map(([x, y, w, h = 16]) => ({ x, y, w, h })),
    signal: { platform: signalPlatform, x: platforms[signalPlatform].x + signalX, y: platforms[signalPlatform].y - signalY },
    spawn: { x: 64, y: platforms[0].y - 54 },
    checkpoint: { x: crystals[2].x - 12, y: platforms[3].y - 32 },
    beacon: { x: 915, y: goal.y - 45, w: 24, h: 45 }
  }
}

export const courses = {
  ridge: course('Moss Ridge', 'Collect five crystals to relight the relay. Extra signal chips hover above the trail.', 'jade', [
    [0, 450, 188, 90], [218, 396, 112], [364, 335, 115],
    [518, 284, 115], [674, 350, 104], [814, 420, 146, 120]
  ], [48, 49, 51, 44, 34]),
  ruins: course('Amber Ruins', 'Use short jumps to land on the lower sandstone terraces.', 'amber', [
    [0, 445, 170, 95], [215, 385, 100], [355, 423, 92],
    [494, 350, 119], [652, 286, 109], [804, 357, 156, 110]
  ], [47, 45, 53, 53, 53], { signal: [2, 52, 107] }),
  summit: course('Frost Summit', 'Jump late on the narrow shelves before crossing the final chasm.', 'ice', [
    [0, 458, 163, 82], [203, 390, 91], [335, 322, 107],
    [480, 253, 122], [651, 303, 96], [815, 365, 145, 108]
  ], [43, 52, 64, 50, 44], { signal: [3, 47, 98] }),
  storm: course('Stormworks', 'Leap over exposed red contacts. Your checkpoint saves after the third crystal.', 'storm', [
    [0, 462, 166, 78], [213, 404, 119], [376, 355, 109],
    [529, 412, 107], [681, 350, 99], [824, 298, 136, 100]
  ], [66, 45, 45, 49, 40], {
    spikes: [[224, 390, 16, 14], [490, 375, 29], [689, 337, 16, 13]], signal: [5, 56, 104], par: 20
  }),
  foundry: course('Ember Foundry', 'Jump from a blue launch pad to reach ledges above your normal jump height.', 'ember', [
    [0, 466, 172, 74], [216, 410, 115], [378, 295, 104],
    [528, 350, 93], [675, 232, 107], [821, 367, 139, 90]
  ], [45, 52, 43, 53, 43], {
    pads: [[1, 77, 29], [3, 60, 29]], spikes: [[794, 355, 21]], signal: [4, 65, 111], par: 21
  }),
  lastlight: course('Last Light', 'Clear the final contacts and send the signal home from the tallest relay.', 'dawn', [
    [0, 459, 158, 81], [203, 395, 98], [344, 335, 117],
    [503, 382, 129], [677, 261, 103], [827, 217, 133, 100]
  ], [44, 45, 48, 57, 50], {
    pads: [[3, 94, 29]], spikes: [[357, 321, 15, 14], [656, 348, 17], [838, 203, 15, 14]],
    signal: [5, 63, 97], par: 23
  })
}

export const { spawn: SPAWN, platforms, crystals, beacon } = courses.ridge

export type Course = (typeof courses)[keyof typeof courses]
