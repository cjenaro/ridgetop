import { readFile, writeFile } from 'node:fs/promises'
import { standalonePage } from './standalone-page.ts'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const template = await readFile(new URL('models/index.html', root), 'utf8')
const page = await standalonePage(template, root, dist)
const recipe = await readFile(new URL('starter/art/rain-ranger.art.json', root), 'utf8')
// The hosted viewer reads the starter's recipe on demand. Embed those same bytes for offline use.
await writeFile(new URL('low-poly-models.html', dist), page.replace('data-src="/starter/art/rain-ranger.art.json">',
  () => '>' + recipe.replaceAll('<', '\\u003c')))
