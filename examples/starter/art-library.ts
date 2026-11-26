import { fileURLToPath } from 'node:url'
import { isMain, runArtLibraryCli } from 'ridgetop/server'

const source = import.meta.url.endsWith('.ts')
const assets = new URL(source ? 'art/' : '../art/', import.meta.url)

if (isMain(import.meta.url)) {
  runArtLibraryCli(process.argv.slice(2), {
    libraryDir: fileURLToPath(new URL('library/', assets)),
    outputDir: fileURLToPath(assets),
    usage: 'Usage: npm run art-library -- list [description] | start <reference-id> <new-asset-name> [out-dir]'
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
