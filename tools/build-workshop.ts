import { readFile, writeFile } from 'node:fs/promises'
import { bundleStandaloneHtml } from 'ridgetop/server'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)
const frameworkDist = new URL('packages/ridgetop/dist/framework/', root)
let page = await readFile(new URL('sprite-workshop.html', root), 'utf8')
const navPattern = /<!-- hosted navigation -->[\s\S]*?<!-- end navigation -->/
if (!navPattern.test(page)) {
  throw new Error('Expected offline workshop template markers in sprite-workshop.html')
}
page = page.replace(navPattern,
  '<span class="identity"><span aria-hidden="true">◈</span> RIDGETOP</span><a class="text-link" href="#usage">Use in a game</a>')
const html = await bundleStandaloneHtml({
  html: page,
  stripStudio: false,
  readAsset: relPath => readFile(new URL(relPath, root), 'utf8'),
  readModule: relPath => readFile(
    relPath.startsWith('framework/')
      ? new URL(relPath.slice('framework/'.length), frameworkDist)
      : new URL(relPath, dist),
    'utf8'
  )
})
await writeFile(new URL('sprite-workshop-offline.html', dist), html)
