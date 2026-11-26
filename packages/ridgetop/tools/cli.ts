#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadGodotCompiler } from '../framework/export-godot.ts'
import { createGame } from './create-game.ts'
import { runPackageCli } from './package-game.ts'
import { runPreviewArtCli } from './preview-art.ts'
import { runArtLibraryCli } from './art-library.ts'

function printHelp() {
  console.log([
    'Ridgetop CLI',
    '',
    'Usage: ridgetop <command> [options]',
    '',
    'Commands:',
    '  create <dir>                          Scaffold a new standalone Ridgetop game project',
    '  package [options]                     Package a game for web, steam, mobile, godot, player, or all',
    '  compile-godot <out-dir> <entry...>    Compile TypeScript game modules to Godot 4 GDScript',
    '  preview-art <recipe.art.json> [dir]   Render directional sprite sheet & 8-view preview PNGs',
    '  art-library <list|start> [args...]    Browse or derive starter art recipes from the library',
    '',
    'Options:',
    '  -h, --help                            Show this help text',
    '  -v, --version                         Print package version'
  ].join('\n'))
}

async function readVersion(): Promise<string> {
  try {
    const pkgUrl = new URL(import.meta.url.endsWith('.ts') ? '../package.json' : '../../package.json', import.meta.url)
    const pkg = JSON.parse(await readFile(pkgUrl, 'utf8'))
    return String(pkg.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

async function main(argv: readonly string[]) {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === '--version' || command === '-v') {
    console.log(await readVersion())
    return
  }
  if (command === 'create') {
    const [destination, ...extra] = rest
    if (!destination || extra.length || destination === '--help' || destination === '-h') {
      console.log('Usage: ridgetop create <new-directory>')
      process.exitCode = destination === '--help' || destination === '-h' ? 0 : 1
      return
    }
    const created = await createGame(destination)
    console.log('Created ' + created + '\nRun npm start inside it. Edit game/game.js and reload the browser to change the game.')
    return
  }
  if (command === 'package') {
    await runPackageCli(rest)
    return
  }
  if (command === 'compile-godot') {
    const [outDir, ...entries] = rest
    if (!outDir || !entries.length || outDir === '--help' || outDir === '-h') {
      console.log('Usage: ridgetop compile-godot <out-dir> <entry1.ts> [entry2.ts ...]')
      process.exitCode = outDir === '--help' || outDir === '-h' ? 0 : 1
      return
    }
    const { compileTsProjectToGodot } = await loadGodotCompiler()
    const result = await compileTsProjectToGodot({
      entries: entries.map(e => (e === 'ridgetop' || e.startsWith('ridgetop/') ? e : resolve(e))),
      rootDir: process.cwd(),
      outDir: resolve(outDir)
    })
    console.log(`Compiled ${result.files.length} TypeScript module(s) to GDScript in ${outDir}`)
    return
  }
  if (command === 'preview-art') {
    await runPreviewArtCli(rest)
    return
  }
  if (command === 'art-library') {
    await runArtLibraryCli(rest)
    return
  }
  console.error(`Unknown ridgetop command "${command}". Run "ridgetop --help" for usage.`)
  process.exitCode = 1
}

main(process.argv.slice(2)).catch(error => {
  console.error(error?.code === 'EEXIST' ? 'Choose a new directory. The destination already exists.' : (error?.message ?? String(error)))
  process.exitCode = 1
})
