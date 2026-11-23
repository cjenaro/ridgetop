import { readFile, writeFile } from 'node:fs/promises'
import { standalonePage } from './standalone-page.ts'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const source = await readFile(new URL('racing.html', root), 'utf8')
const page = source.replace(/\s+data-hosted="1"/g, '')
await writeFile(new URL('signal-drift.html', dist), await standalonePage(page, root, dist))
