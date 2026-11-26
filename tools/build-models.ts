import { readFile, writeFile } from 'node:fs/promises'
import { bundleStandaloneHtml } from 'ridgetop/server'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const frameworkDist = new URL('packages/ridgetop/dist/framework/', root)
const template = await readFile(new URL('models/index.html', root), 'utf8')
const html = await bundleStandaloneHtml({
  html: template,
  stripStudio: true,
  readAsset: relPath => readFile(new URL(relPath, root), 'utf8'),
  readModule: relPath => readFile(
    relPath.startsWith('framework/')
      ? new URL(relPath.slice('framework/'.length), frameworkDist)
      : new URL(relPath, dist),
    'utf8'
  )
})
await writeFile(new URL('low-poly-models.html', dist), html)
