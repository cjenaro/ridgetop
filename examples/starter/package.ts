import { fileURLToPath } from 'node:url'
import { isMain, runPackageGameCli } from 'ridgetop/server'

const source = import.meta.url.endsWith('.ts')
const projectDir = fileURLToPath(new URL(source ? '.' : '../', import.meta.url))

if (isMain(import.meta.url)) {
  runPackageGameCli(process.argv.slice(2), {
    projectDir,
    command: 'npm run package --'
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
