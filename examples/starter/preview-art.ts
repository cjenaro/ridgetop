import { isMain, runPreviewArtCli } from 'ridgetop/server'
import { game } from './game.ts'

if (isMain(import.meta.url)) {
  runPreviewArtCli(process.argv.slice(2), {
    palette: game.palette,
    usage: 'Usage: npm run preview-art -- <recipe.art.json> [output-directory]'
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
