import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleStandaloneHtml } from '../framework/packager.ts'

const packageFrameworkDist = fileURLToPath(
  new URL(import.meta.url.endsWith('.ts') ? '../dist/framework/' : '../framework/', import.meta.url)
)

/** Embed the page's local styles and emitted ES module graph into one browser file. */
export async function standalonePage(page: string, assets: URL, modules: URL) {
  return bundleStandaloneHtml({
    html: page,
    readAsset: relPath => readFile(new URL(relPath, assets), 'utf8'),
    async readModule(relPath) {
      const primary = new URL(relPath, modules)
      try {
        await access(primary)
        return await readFile(primary, 'utf8')
      } catch {
        if (relPath.startsWith('framework/')) {
          return readFile(join(packageFrameworkDist, relPath.slice('framework/'.length)), 'utf8')
        }
        throw new Error('Module not found: ' + relPath)
      }
    }
  })
}
