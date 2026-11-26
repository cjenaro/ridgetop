import { isMain, runPackageGameCli } from '../framework/server.ts'

export { runPackageGameCli, runPackageGameCli as runPackageCli }

if (isMain(import.meta.url)) {
  runPackageGameCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
