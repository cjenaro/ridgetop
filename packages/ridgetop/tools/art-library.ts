import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createArtBuilder } from '../framework/index.ts'
import { isMain } from '../framework/server.ts'

const packageRoot = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../' : '../../', import.meta.url))
const bundledLibraryDir = join(packageRoot, 'templates', 'starter', 'art', 'library')

async function resolveLibraryDir(preferredDir?: string): Promise<string> {
  if (preferredDir) {
    try { await access(join(preferredDir, 'catalog.json')); return preferredDir } catch { /* Preferred library catalog not present. */ }
  }
  const local = join(process.cwd(), 'art', 'library')
  try { await access(join(local, 'catalog.json')); return local } catch { /* Local library catalog not present; fall back to bundled library. */ }
  return bundledLibraryDir
}

export async function runArtLibraryCli(argv: readonly string[], options?: { libraryDir?: string; outputDir?: string }) {
  const libraryDir = await resolveLibraryDir(options?.libraryDir)
  const catalog: { id: string; title: string; tags: string[] }[] = JSON.parse(await readFile(join(libraryDir, 'catalog.json'), 'utf8'))
  const [action = 'list', ...args] = argv
  if (action === 'list') {
    const query = args.join(' ').trim()
    const terms = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    const matches = query && !terms.size ? [] : catalog.map(ref => {
      const words = new Set([...ref.id.split('-'), ...ref.tags, ...ref.title.toLowerCase().split(' ')])
      return { ref, score: [...terms].filter(word => words.has(word)).length }
    }).filter(match => !terms.size || match.score).sort((a, b) => b.score - a.score || a.ref.id.localeCompare(b.ref.id))
    for (const { ref } of matches) console.log(ref.id + '  ' + ref.title + '  (' + ref.tags.join(', ') + ')')
    if (!matches.length) console.log('No matching references. Run art-library list to browse, or start with createArtBuilder.')
  } else if (action === 'start' && (args.length === 2 || args.length === 3)) {
    const [id, name, outDirArg] = args
    const entry = catalog.find(ref => ref.id === id)
    if (!entry) throw new Error('Unknown reference ' + id)
    const reference = JSON.parse(await readFile(join(libraryDir, entry.id + '.art.json'), 'utf8'))
    const recipe = createArtBuilder(name, { reference }).finish()
    const outDir = resolve(outDirArg ?? options?.outputDir ?? join(process.cwd(), 'art'))
    await mkdir(outDir, { recursive: true })
    const destination = join(outDir, recipe.name + '.art.json')
    await writeFile(destination, JSON.stringify(recipe, null, 2) + '\n', { flag: 'wx' })
    console.log(destination + '\nParts: ' + recipe.parts.map(part => part.name).join(', '))
  } else {
    console.log('Usage: ridgetop art-library list [description] | start <reference-id> <new-asset-name> [out-dir]')
    process.exitCode = action === '--help' || action === '-h' ? 0 : 1
  }
}

if (isMain(import.meta.url)) {
  await runArtLibraryCli(process.argv.slice(2))
}
