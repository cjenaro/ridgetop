import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { isMain } from '../framework/server.ts'

const root = new URL('../', import.meta.url)

async function copyModule(source: URL, target: string) {
  const code = (await readFile(source, 'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm, '')
  await writeFile(target, code)
}

export async function createGame(destination: string) {
  const target = resolve(destination)
  const dist = new URL('dist/', root)
  await access(new URL('sprite-workshop-offline.html', dist)).catch(() => {
    throw new Error('Build the source checkout with npm run build first, or use a prebuilt Ridgetop archive.')
  })
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(join(parent, '.ridgetop-'))
  try {
    const game = join(temporary, 'game')
    await mkdir(join(game, 'art'), { recursive: true })
    await cp(new URL('starter/art/rain-ranger.art.json', root), join(game, 'art', 'rain-ranger.art.json'))
    await cp(new URL('starter/art/library/', root), join(game, 'art', 'library'), { recursive: true })
    await writeFile(join(game, 'art', 'overrides.json'), '{}\n')
    for (const file of ['index.html', 'style.css', 'testing.html']) await cp(new URL('starter/' + file, root), join(game, file))
    for (const name of ['game', 'main', 'serve', 'testing', 'testing-scene', 'preview-art', 'art-library']) {
      await copyModule(new URL('starter/' + name + '.js', dist), join(game, name + '.js'))
    }
    for (const file of ['README.md', 'AGENTS.md', 'ART.md']) await cp(new URL('starter/' + file, root), join(temporary, file))
    const framework = new URL('framework/', dist)
    await mkdir(join(temporary, 'framework'))
    for (const file of await readdir(framework)) {
      const to = join(temporary, 'framework', file)
      if (file.endsWith('.js')) await copyModule(new URL(file, framework), to)
      else if (file.endsWith('.d.ts')) await cp(new URL(file, framework), to)
    }
    await cp(new URL('sprite-workshop-offline.html', dist), join(temporary, 'sprite-workshop.html'))
    await cp(new URL('low-poly-models.html', dist), join(temporary, 'low-poly-models.html'))
    await writeFile(join(temporary, 'package.json'), JSON.stringify({
      name: basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'ridgetop-game',
      private: true, type: 'module', scripts: { start: 'node game/serve.js', playtest: 'node game/serve.js --testing',
        'preview-art': 'node game/preview-art.js', 'art-library': 'node game/art-library.js' }, engines: { node: '>=22.18' }
    }, null, 2) + '\n')
    // Reserve the destination exclusively. A concurrent invocation or an existing project keeps its directory.
    await mkdir(target)
    const moved: string[] = []
    try {
      for (const name of await readdir(temporary)) {
        await rename(join(temporary, name), join(target, name))
        moved.push(name)
      }
    } catch (error) {
      for (const name of moved.reverse()) await rename(join(target, name), join(temporary, name))
      await rmdir(target)
      throw error
    }
    return target
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

if (isMain(import.meta.url)) {
  const [, , destination, ...extra] = process.argv
  if (!destination || extra.length || destination === '--help') {
    console.log('Usage: npm run create-game -- <new-directory>')
    process.exitCode = destination === '--help' ? 0 : 1
  } else {
    try {
      const path = await createGame(destination)
      console.log('Created ' + path + '\nRun npm start inside it. Edit game/game.js and reload the browser to change the game.')
    } catch (error) {
      console.error(error.code === 'EEXIST' ? 'Choose a new directory. The destination already exists.' : error.message)
      process.exitCode = 1
    }
  }
}
