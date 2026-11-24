import { buyUpgrade, garage, garageParts, vehicleStats } from './progression.ts'
import type { Championship, Upgrade } from './progression.ts'

const pixels = {
  '#': '#0a1621', a: '#2c4454', b: '#59788a', c: '#a3c1c5', d: '#e4f4e7',
  g: '#64dbb5', h: '#30826e', y: '#ffc978', o: '#a96c40', v: '#a58df2', w: '#6552a7'
}

const icons: Record<Upgrade, readonly string[]> = {
  motor: [
    '................', '......####......', '...####yy##.....', '..#cyyyyyy##....',
    '..#oddcddco##...', '...##bcbc##c#...', '..#####a####b#..', '.#cbbcccccb#b#..',
    '.#b#ba#b#ba#b##.', '.#c#bc#b#bc#ab#.', '.#b#ba#b#ba#bb#.', '.#c#bc#b#bc#ab#.',
    '..#bbccccbbbbb#.', '...##ooyooa###..', '....########....', '................'
  ],
  tires: [
    '................', '......#####.....', '....###bba##....', '...#cb#abba##...',
    '..#ba#abbab##...', '..#ab#abcba#a#..', '.#bb#a#cgh##a#..', '.#ab#bb#c#a#a#..',
    '.#bb#bb#g#a#a#..', '.#bb#a#ch##ba#..', '..#ab#abbab#a#..', '..#ba#babaa##...',
    '...#cb#bba##....', '....###a###.....', '......###.......', '................'
  ],
  armor: [
    '................', '.......##.......', '.....##dd##.....', '...##dccccc##...',
    '..#ccccdcbbbh#..', '..#ccgcdchggb#..', '..#cbgcdchgah#..', '..#ccgcdchggb#..',
    '..#cbgcdchgah#..', '...#cgcdchgb#...', '...#bcdchha#....', '....#bcbha#.....',
    '.....#bba#......', '......#a#.......', '.......#........', '................'
  ],
  capacitor: [
    '................', '....########....', '...#cbccccbc#...', '...#bcddddcb#...',
    '...##bvvvvb##...', '....#wvvvvw#....', '..##bvwwvwb##...', '..#a#vwvww#a#...',
    '..#c#wwvww#b#...', '..#a#wwvww#a#...', '..##bvwvvwb##...', '....#wvvvvw#....',
    '...##bvvvvb##...', '...#bccccccb#...', '....########....', '................'
  ]
}

export function renderPartIcon(part: Upgrade) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  const ctx = canvas.getContext('2d')
  if (ctx) {
    icons[part].forEach((row, y) => Array.from(row).forEach((pixel, x) => {
      const tint = pixels[pixel as keyof typeof pixels]
      if (tint) {
        ctx.fillStyle = tint
        ctx.fillRect(x, y, 1, 1)
      }
    }))
  }
  return canvas
}

type Stat = { name: string; read: (stats: ReturnType<typeof vehicleStats>) => string }
const stats: Record<Upgrade, Stat[]> = {
  motor: [
    { name: 'Acceleration', read: s => s.acceleration + ' m/s²' },
    { name: 'Top speed', read: s => Math.round(s.maxSpeed * 3.6) + ' km/h' }
  ],
  tires: [
    { name: 'Cornering grip', read: s => s.grip.toFixed(2) },
    { name: 'Steering rate', read: s => s.turnRate.toFixed(2) + ' rad/s' },
    { name: 'Off-road traction', read: s => Math.round(s.offroadGrip * 100) + '%' }
  ],
  armor: [{ name: 'Maximum shield', read: s => String(s.maxShield) }],
  capacitor: [
    { name: 'Pulse reserve', read: s => String(s.maxPulses) },
    { name: 'Pulse cooldown', read: s => s.pulseInterval.toFixed(2) + ' s' },
    { name: 'Snare cooldown', read: s => s.snareInterval.toFixed(2) + ' s' }
  ]
}

const creditsFormat = new Intl.NumberFormat('en')

/** Headless Garage state + pixel-art icons consumed by Signal Drift's Canvas UI (zero HTML menus). */
export function createGarageState(progress: Championship, onPurchase: () => void) {
  let selected: Upgrade = garageParts[0]
  let message = ''
  const iconCanvases = Object.fromEntries(garageParts.map(part => [part, renderPartIcon(part)])) as Record<Upgrade, HTMLCanvasElement>

  return {
    get part() { return selected },
    icon(part: Upgrade) { return iconCanvases[part] },
    select(part: Upgrade) {
      selected = part
      message = ''
    },
    open() {
      message = ''
    },
    install() {
      const level = progress.build[selected]
      const cost = garage[selected].costs[level]
      if (cost === undefined || progress.credits < cost || !buyUpgrade(progress, selected)) return false
      onPurchase()
      message = garage[selected].name + ' tier ' + progress.build[selected] + ' installed.'
      return true
    },
    view() {
      const part = garage[selected]
      const level = progress.build[selected]
      const cost = part.costs[level]
      const shortage = cost === undefined ? 0 : Math.max(0, cost - progress.credits)
      const current = vehicleStats(progress.build)
      const after = cost === undefined ? undefined : vehicleStats({ ...progress.build, [selected]: level + 1 })
      const statLines = stats[selected].map(({ name, read }) =>
        after ? `${name}: ${read(current)}→${read(after)}` : `${name}: ${read(current)}`
      )
      const feedback = message
        ? (shortage ? `${message} ${creditsFormat.format(shortage)} more credits for the next tier.` : message)
        : (shortage ? `${creditsFormat.format(shortage)} more credits needed` : '')
      return {
        part: selected,
        partName: part.name,
        creditsText: creditsFormat.format(progress.credits),
        tierText: level === 0 ? 'Stock part' : `Tier ${level} of ${part.costs.length} fitted`,
        installLabel: cost === undefined ? 'Fully upgraded' : `Install · ${creditsFormat.format(cost)} credits`,
        canInstall: cost !== undefined && shortage === 0,
        feedback,
        statLines,
        tiles: garageParts.map(id => {
          const fitted = progress.build[id]
          const next = garage[id].costs[fitted]
          return {
            id,
            name: garage[id].name,
            fitted,
            total: garage[id].costs.length,
            costLabel: next === undefined ? 'Maxed' : `${creditsFormat.format(next)} CR`,
            selected: id === selected,
            icon: iconCanvases[id]
          }
        })
      }
    }
  }
}
