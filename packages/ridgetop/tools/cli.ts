#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadGodotCompiler } from '../framework/export-godot.ts'
import { runArtLibraryCli, runOtaKeygenCli, runOtaServeCli, runPackageGameCli, runPreviewArtCli } from '../framework/server.ts'
import {
  type HelpSpec,
  mergeCliFlags,
  parseGlobalFlags,
  renderError,
  renderHelp,
  renderSuccess,
  resolveErrorUi
} from './cli-ui.ts'
import { createGame } from './create-game.ts'

async function readVersion(): Promise<string> {
  try {
    const pkgUrl = new URL(import.meta.url.endsWith('.ts') ? '../package.json' : '../../package.json', import.meta.url)
    const pkg = JSON.parse(await readFile(pkgUrl, 'utf8'))
    return String(pkg.version ?? '0.0.0')
  } catch (error) {
    void error
    return '0.0.0'
  }
}

function buildHelpSpec(version: string): HelpSpec {
  return {
    title: 'Ridgetop CLI',
    version,
    subtitle: 'Scaffold, preview art, compile to Godot 4, and package Ridgetop games.',
    usage: 'ridgetop [options] <command> [args...]',
    groups: [
      {
        heading: 'Project & Packaging',
        items: [
          { name: 'create <dir>', summary: 'Scaffold a new standalone Ridgetop game project' },
          { name: 'package [options]', summary: 'Package a game for web, steam, mobile, ota, godot, player, or all' },
          { name: 'compile-godot <out-dir> <entry...>', summary: 'Compile TypeScript game modules to Godot 4 GDScript' }
        ]
      },
      {
        heading: 'Art & Assets',
        items: [
          { name: 'preview-art <recipe.art.json> [dir]', summary: 'Render directional sprite sheet & 8-view preview PNGs' },
          { name: 'art-library <list|start> [args...]', summary: 'Browse or derive starter art recipes from the library' }
        ]
      },
      {
        heading: 'Mobile OTA',
        items: [
          { name: 'ota-serve [options]', summary: 'Serve a local LAN OTA bundle for testing on iOS/Android' },
          { name: 'ota-keygen', summary: 'Generate an Ed25519 keypair for signing OTA manifests' }
        ]
      }
    ],
    options: [
      { name: '--human', summary: 'Force rich terminal output for human readers' },
      { name: '--agent', summary: 'Force compact, token-economical plain output' },
      { name: '--json', summary: 'Emit structured JSON output where supported' },
      { name: '--no-color', summary: 'Disable ANSI color escapes' },
      { name: '-h, --help', summary: 'Show this help text' },
      { name: '-v, --version', summary: 'Print package version' }
    ],
    examples: [
      'ridgetop create ../my-game',
      'ridgetop package --target web --game signal-drift',
      'ridgetop art-library list "radio"'
    ]
  }
}

async function main(argv: readonly string[]) {
  const parsed = parseGlobalFlags(argv, { stopAtFirstPositional: true })
  const ui = parsed.ui
  const [command, ...rest] = parsed.rest

  if (!command || command === '--help' || command === '-h') {
    const version = await readVersion()
    console.log(renderHelp(buildHelpSpec(version), ui))
    return
  }
  if (command === '--version' || command === '-v') {
    const version = await readVersion()
    if (ui.mode === 'json') {
      console.log(JSON.stringify({ version }))
    } else {
      console.log(version)
    }
    return
  }
  if (command === 'create') {
    const merged = mergeCliFlags(parsed, parseGlobalFlags(rest))
    const [destination, ...extra] = merged.rest
    const isHelp = destination === '--help' || destination === '-h'
    if (!destination || extra.length || isHelp) {
      if (merged.ui.mode === 'json') {
        console.log(JSON.stringify({ ok: isHelp, usage: 'ridgetop create <new-directory>' }))
      } else {
        console.log('Usage: ridgetop create <new-directory>')
      }
      process.exitCode = isHelp ? 0 : 1
      return
    }
    const created = await createGame(destination)
    console.log(
      renderSuccess(`Created ${created}`, merged.ui, {
        detail: 'Run npm start inside it. Edit game/game.js and reload the browser.',
        json: { command: 'create', path: created }
      })
    )
    return
  }
  if (command === 'package') {
    await runPackageGameCli(rest)
    return
  }
  if (command === 'ota-serve') {
    await runOtaServeCli(rest)
    return
  }
  if (command === 'ota-keygen') {
    runOtaKeygenCli()
    return
  }
  if (command === 'compile-godot') {
    const merged = mergeCliFlags(parsed, parseGlobalFlags(rest))
    const [outDir, ...entries] = merged.rest
    const isHelp = outDir === '--help' || outDir === '-h'
    if (!outDir || !entries.length || isHelp) {
      if (merged.ui.mode === 'json') {
        console.log(JSON.stringify({ ok: isHelp, usage: 'ridgetop compile-godot <out-dir> <entry1.ts> [entry2.ts ...]' }))
      } else {
        console.log('Usage: ridgetop compile-godot <out-dir> <entry1.ts> [entry2.ts ...]')
      }
      process.exitCode = isHelp ? 0 : 1
      return
    }
    const { compileTsProjectToGodot } = await loadGodotCompiler()
    const result = await compileTsProjectToGodot({
      entries: entries.map(e => (e === 'ridgetop' || e.startsWith('ridgetop/') ? e : resolve(e))),
      rootDir: process.cwd(),
      outDir: resolve(outDir)
    })
    console.log(
      renderSuccess(`Compiled ${result.files.length} TypeScript module(s) to GDScript in ${outDir}`, merged.ui, {
        json: { command: 'compile-godot', outDir, count: result.files.length }
      })
    )
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

  console.error(renderError(`Unknown ridgetop command "${command}".`, ui, 'Run "ridgetop --help" for usage.'))
  process.exitCode = 1
}

main(process.argv.slice(2)).catch(error => {
  const ui = resolveErrorUi(process.argv.slice(2))
  const message = error?.code === 'EEXIST'
    ? 'Choose a new directory. The destination already exists.'
    : (error?.message ?? String(error))
  console.error(renderError(message, ui))
  process.exitCode = 1
})
