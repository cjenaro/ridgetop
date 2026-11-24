import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createArtBuilder } from 'ridgetop'

const source = import.meta.url.endsWith('.ts')
const assets = new URL(source ? 'art/' : '../art/', import.meta.url)
const catalog: { id: string; title: string; tags: string[] }[] = JSON.parse(await readFile(new URL('library/catalog.json', assets), 'utf8'))
const [action = 'list', ...args] = process.argv.slice(2)
if (action === 'list') {
  const query = args.join(' ').trim()
  const terms = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const matches = query && !terms.size ? [] : catalog.map(ref => {
    const words = new Set([...ref.id.split('-'), ...ref.tags, ...ref.title.toLowerCase().split(' ')])
    return { ref, score: [...terms].filter(word => words.has(word)).length }
  }).filter(match => !terms.size || match.score).sort((a,b) => b.score-a.score || a.ref.id.localeCompare(b.ref.id))
  for (const { ref } of matches) console.log(ref.id + '  ' + ref.title + '  (' + ref.tags.join(', ') + ')')
  if (!matches.length) console.log('No matching references. Run art-library list to browse, or start with createArtBuilder.')
} else if (action === 'start' && args.length === 2) {
  const [id, name] = args
  const entry = catalog.find(ref => ref.id === id)
  if (!entry) throw new Error('Unknown reference ' + id)
  const reference = JSON.parse(await readFile(new URL('library/' + entry.id + '.art.json', assets), 'utf8'))
  const recipe = createArtBuilder(name, { reference }).finish()
  const destination = new URL(recipe.name + '.art.json', assets)
  await writeFile(destination, JSON.stringify(recipe,null,2) + '\n', { flag: 'wx' })
  console.log(fileURLToPath(destination) + '\nParts: ' + recipe.parts.map(part => part.name).join(', '))
} else {
  console.log('Usage: npm run art-library -- list [description] | start <reference-id> <new-asset-name>')
  process.exitCode = action === '--help' ? 0 : 1
}
