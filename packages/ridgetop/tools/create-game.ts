import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from '../framework/server.ts'

const packageRoot = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../' : '../../', import.meta.url))

async function copyModule(source: string, target: string, rewrite?: (code: string) => string) {
  let code = (await readFile(source, 'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm, '')
  if (rewrite) code = rewrite(code)
  await writeFile(target, code)
}

async function firstExisting(paths: readonly string[]): Promise<string | null> {
  for (const p of paths) {
    try { await access(p); return p } catch { /* Candidate path missing; try next. */ }
  }
  return null
}

export async function createGame(destination: string) {
  const target = resolve(destination)
  const distDir = join(packageRoot, 'dist')
  const frameworkDist = join(distDir, 'framework')
  const templateSrc = join(packageRoot, 'templates', 'starter')
  const templateDist = join(distDir, 'templates', 'starter')

  await access(join(frameworkDist, 'index.js')).catch(() => {
    throw new Error('Build the ridgetop package with pnpm run build first, or use a prebuilt Ridgetop package.')
  })
  await access(join(templateDist, 'main.js')).catch(() => {
    throw new Error('Missing compiled starter template in dist/templates/starter/. Run pnpm run build first.')
  })

  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const temporary = await mkdtemp(join(parent, '.ridgetop-'))
  try {
    const game = join(temporary, 'game')
    await mkdir(join(game, 'art'), { recursive: true })
    await cp(join(templateSrc, 'art', 'rain-ranger.art.json'), join(game, 'art', 'rain-ranger.art.json'))
    await cp(join(templateSrc, 'art', 'library'), join(game, 'art', 'library'), { recursive: true })
    await writeFile(join(game, 'art', 'overrides.json'), '{}\n')
    for (const file of ['index.html', 'style.css']) await cp(join(templateSrc, file), join(game, file))
    const rewriteTemplateFramework = (code: string) =>
      code.replaceAll("'../../framework/", "'../framework/").replaceAll('"../../framework/', '"../framework/')
    for (const name of ['game', 'main', 'serve', 'preview-art', 'art-library', 'package']) {
      await copyModule(join(templateDist, name + '.js'), join(game, name + '.js'), rewriteTemplateFramework)
    }
    for (const file of ['README.md', 'AGENTS.md', 'ART.md']) await cp(join(templateSrc, file), join(temporary, file))

    await mkdir(join(temporary, 'framework'))
    for (const file of await readdir(frameworkDist)) {
      const to = join(temporary, 'framework', file)
      if (file.endsWith('.js')) await copyModule(join(frameworkDist, file), to)
      else if (file.endsWith('.d.ts')) await cp(join(frameworkDist, file), to)
    }
    const overlayCss = await firstExisting([
      join(frameworkDist, 'testing-overlay.css'),
      join(packageRoot, 'framework', 'testing-overlay.css')
    ])
    if (overlayCss) await cp(overlayCss, join(temporary, 'framework', 'testing-overlay.css'))

    const tsToGdDist = join(distDir, 'tools', 'ts-to-gd.js')
    if (await firstExisting([tsToGdDist])) {
      await mkdir(join(temporary, 'tools'), { recursive: true })
      await copyModule(tsToGdDist, join(temporary, 'tools', 'ts-to-gd.js'))
    }

    // Optional offline studio companions when available in the workspace or package dist.
    const monorepoDist = resolve(packageRoot, '..', '..', 'dist')
    const workshopHtml = await firstExisting([
      join(distDir, 'sprite-workshop-offline.html'),
      join(monorepoDist, 'sprite-workshop-offline.html')
    ])
    if (workshopHtml) await cp(workshopHtml, join(temporary, 'sprite-workshop.html'))
    const modelsHtml = await firstExisting([
      join(distDir, 'low-poly-models.html'),
      join(monorepoDist, 'low-poly-models.html')
    ])
    if (modelsHtml) await cp(modelsHtml, join(temporary, 'low-poly-models.html'))

    await writeFile(join(temporary, 'package.json'), JSON.stringify({
      name: basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'ridgetop-game',
      private: true, type: 'module', scripts: {
        start: 'node game/serve.js',
        playtest: 'node game/serve.js --testing',
        'preview-art': 'node game/preview-art.js',
        'art-library': 'node game/art-library.js',
        package: 'node game/package.js',
        'package:web': 'node game/package.js --target web',
        'package:steam': 'node game/package.js --target steam',
        'package:mobile': 'node game/package.js --target mobile',
        'package:godot': 'node game/package.js --target godot',
        'package:player': 'node game/package.js --target player'
      }, engines: { node: '>=22.18' }
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
