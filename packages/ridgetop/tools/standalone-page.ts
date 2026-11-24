import { readFile } from 'node:fs/promises'
import { bundleStandaloneHtml } from '../framework/packager.ts'

/** Embed the page's local styles and emitted ES module graph into one browser file. */
export async function standalonePage(page: string, assets: URL, modules: URL) {
  return bundleStandaloneHtml({
    html: page,
    readAsset: relPath => readFile(new URL(relPath, assets), 'utf8'),
    readModule: relPath => readFile(new URL(relPath, modules), 'utf8')
  })
}
