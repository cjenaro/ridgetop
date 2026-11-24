import { readFile, writeFile } from 'node:fs/promises'
import { standalonePage } from './standalone-page.ts'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
let page = await readFile(new URL('sprite-workshop.html', root), 'utf8')
const navPattern = /<!-- hosted navigation -->[\s\S]*?<!-- end navigation -->/
if (!navPattern.test(page)) {
  throw new Error('Expected offline workshop template markers in sprite-workshop.html')
}
page = page.replace(navPattern,
  '<span class="identity"><span aria-hidden="true">◈</span> RIDGETOP</span><a class="text-link" href="#usage">Use in a game</a>')
await writeFile(new URL('sprite-workshop-offline.html', dist), await standalonePage(page, root, dist))
