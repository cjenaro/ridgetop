import { readFile, writeFile } from 'node:fs/promises'
import { standalonePage } from '../packages/ridgetop/tools/standalone-page.ts'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const template = await readFile(new URL('models/index.html', root), 'utf8')
await writeFile(new URL('low-poly-models.html', dist), await standalonePage(template, root, dist))
