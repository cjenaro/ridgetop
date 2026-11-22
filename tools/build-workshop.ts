import { readFile, writeFile } from 'node:fs/promises'
import { standalonePage } from './standalone-page.ts'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
let page = await readFile(new URL('sprite-workshop.html', root), 'utf8')
const icon = await readFile(new URL('game/assets/scout.png', root))
page = page.replace('href="/game/assets/scout.png"', 'href="data:image/png;base64,' + icon.toString('base64') + '"')
page = page.replace(/<!-- hosted navigation -->[\s\S]*?<!-- end navigation -->/,
  '<span class="identity"><span aria-hidden="true">◈</span> RIDGETOP</span><a class="text-link" href="#usage">Use in a game</a>')
await writeFile(new URL('sprite-workshop-offline.html', dist), await standalonePage(page, root, dist))
