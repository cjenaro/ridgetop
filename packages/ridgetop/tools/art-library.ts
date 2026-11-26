import { isMain, runArtLibraryCli } from '../framework/server.ts'

export { runArtLibraryCli }

if (isMain(import.meta.url)) {
  runArtLibraryCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
