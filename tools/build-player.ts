import { readFile, writeFile } from 'node:fs/promises'
import { bundleStandaloneHtml } from 'ridgetop/server'

const root = new URL('../', import.meta.url)
const signalDrift = new URL('examples/signal-drift/', root)
const modules = new URL('dist/', signalDrift)
const frameworkDist = new URL('packages/ridgetop/dist/framework/', root)
const dist = new URL('dist/', root)
const source = await readFile(new URL('index.html', signalDrift), 'utf8')
const page = source.replace(/\s+data-hosted="1"/g, '')
const html = await bundleStandaloneHtml({
  html: page,
  stripStudio: true,
  readAsset: relPath => readFile(new URL(relPath, signalDrift), 'utf8'),
  readModule: relPath => readFile(
    relPath.startsWith('framework/')
      ? new URL(relPath.slice('framework/'.length), frameworkDist)
      : new URL(relPath, modules),
    'utf8'
  )
})
await writeFile(new URL('signal-drift.html', dist), html)
