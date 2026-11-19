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

function icon(part: Upgrade) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 16
  canvas.setAttribute('aria-hidden', 'true')
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

const credits = new Intl.NumberFormat('en')

export function createGaragePanel(root: HTMLElement, progress: Championship, onPurchase: () => void) {
  const parts = root.querySelector<HTMLElement>('#garage-parts')
  const install = root.querySelector<HTMLButtonElement>('#garage-install')
  const balance = root.querySelector<HTMLElement>('#garage-credits')
  const tier = root.querySelector<HTMLElement>('#garage-tier')
  const heading = root.querySelector<HTMLElement>('#garage-part-name')
  const comparison = root.querySelector<HTMLElement>('#garage-stats')
  const feedback = root.querySelector<HTMLElement>('#garage-feedback')
  let selected: Upgrade = garageParts[0]
  let message = ''
  const tiles = garageParts.map(part => {
    const button = document.createElement('button')
    const name = document.createElement('strong')
    const pips = Array.from({ length: garage[part].costs.length }, () => document.createElement('i'))
    const pipsRow = document.createElement('span')
    const info = document.createElement('span')
    const cost = document.createElement('small')
    button.type = 'button'
    button.className = 'garage-tile'
    button.dataset.upgrade = part
    name.textContent = garage[part].name
    pipsRow.className = 'garage-pips'
    pipsRow.setAttribute('aria-hidden', 'true')
    pipsRow.append(...pips)
    info.className = 'garage-tile-info'
    info.append(name, pipsRow, cost)
    button.append(icon(part), info)
    button.onclick = () => {
      selected = part
      message = ''
      paint()
    }
    parts.append(button)
    return { part, button, pips, cost }
  })

  function paint() {
    const part = garage[selected]
    const level = progress.build[selected]
    const cost = part.costs[level]
    const shortage = cost === undefined ? 0 : Math.max(0, cost - progress.credits)
    balance.textContent = credits.format(progress.credits)
    heading.textContent = part.name
    tier.textContent = level === 0 ? 'Stock part' : 'Tier ' + level + ' of ' + part.costs.length + ' fitted'
    install.textContent = cost === undefined ? 'Fully upgraded' : 'Install · ' + credits.format(cost) + ' credits'
    install.setAttribute('aria-disabled', String(cost === undefined || shortage > 0))
    feedback.textContent = message || (shortage ? credits.format(shortage) + ' more credits needed' : '')
    if (message && shortage) feedback.textContent += ' ' + credits.format(shortage) + ' more credits for the next tier.'

    const current = vehicleStats(progress.build)
    const after = cost === undefined ? undefined : vehicleStats({ ...progress.build, [selected]: level + 1 })
    comparison.replaceChildren()
    for (const { name, read } of stats[selected]) {
      const label = document.createElement('dt')
      const line = document.createElement('dd')
      const before = document.createElement('span')
      label.textContent = name
      before.textContent = read(current)
      line.append(before)
      if (after) {
        const arrow = document.createElement('span')
        const upgrade = document.createElement('strong')
        arrow.textContent = '→'
        upgrade.textContent = read(after)
        line.append(arrow, upgrade)
      }
      comparison.append(label, line)
    }
    for (const tile of tiles) {
      const fitted = progress.build[tile.part]
      const next = garage[tile.part].costs[fitted]
      tile.button.setAttribute('aria-pressed', String(tile.part === selected))
      tile.button.setAttribute('aria-label', garage[tile.part].name + ', ' + (fitted ? 'tier ' + fitted : 'stock') +
        (next === undefined ? ', fully upgraded' : ', next tier costs ' + credits.format(next) + ' credits'))
      tile.cost.textContent = next === undefined ? 'Maxed' : credits.format(next) + ' CR'
      tile.pips.forEach((pip, i) => pip.classList.toggle('fitted', i < fitted))
    }
  }

  install.onclick = () => {
    if (install.getAttribute('aria-disabled') === 'true' || !buyUpgrade(progress, selected)) return
    onPurchase()
    message = garage[selected].name + ' tier ' + progress.build[selected] + ' installed.'
    paint()
  }

  return {
    get part() { return selected },
    open() {
      message = ''
      paint()
      tiles.find(tile => tile.part === selected)?.button.focus({ preventScroll: true })
    }
  }
}
