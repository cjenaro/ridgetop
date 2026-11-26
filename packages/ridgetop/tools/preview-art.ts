import { isMain, runPreviewArtCli } from '../framework/server.ts'

export { runPreviewArtCli }

if (isMain(import.meta.url)) {
  runPreviewArtCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
