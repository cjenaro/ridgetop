import { readFile, writeFile } from 'node:fs/promises'
import { standalonePage } from '../packages/ridgetop/tools/standalone-page.ts'

const root = new URL('../', import.meta.url)
const signalDrift = new URL('examples/signal-drift/', root)
const dist = new URL('dist/', root)
const source = await readFile(new URL('index.html', signalDrift), 'utf8')
const page = source.replace(/\s+data-hosted="1"/g, '')
await writeFile(new URL('signal-drift.html', dist), await standalonePage(page, signalDrift, new URL('dist/', signalDrift)))
