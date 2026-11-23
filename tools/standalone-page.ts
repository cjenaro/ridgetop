import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path/posix'
import ts from 'typescript'

/** Embed the page's local styles and emitted ES module graph into one browser file. */
export async function standalonePage(page: string, assets: URL, modules: URL) {
  const imports: Record<string, string> = {}
  const moduleName = (path: string) => 'ridgetop-offline/' + path
  async function include(path: string) {
    if (Object.hasOwn(imports, moduleName(path))) return
    let source = (await readFile(new URL(path, modules), 'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm, '')
    const children: string[] = []
    for (const ref of ts.preProcessFile(source).importedFiles.reverse()) {
      if (!ref.fileName.startsWith('.')) throw new Error('Expected a local module in ' + path)
      const child = normalize(join(dirname(path), ref.fileName))
      children.push(child)
      // TypeScript reports the opening quote and the length of the literal's contents.
      source = source.slice(0, ref.pos + 1) + moduleName(child) + source.slice(ref.end + 1)
    }
    imports[moduleName(path)] = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
    for (const child of children) await include(child)
  }

  for (const [link, path] of page.matchAll(/<link rel="stylesheet" href="\/([^"]+)">/g)) {
    const css = (await readFile(new URL(path, assets), 'utf8')).replace(/<\/style/gi, '<\\/style')
    page = page.replace(link, () => '<style>\n' + css + '</style>')
  }
  const entries = [...page.matchAll(/<script type="module" src="\/([^"]+)"><\/script>/g)]
  if (entries.length !== 1) throw new Error('Expected one local ES module entry point in the player page')
  const [tag, entry] = entries[0]
  await include(entry)
  const scripts = '<script type="importmap">' + JSON.stringify({ imports }).replaceAll('<', '\\u003c') + '</script>\n' +
    '<script type="module">import ' + JSON.stringify(moduleName(entry)) + '</script>'
  return page.replace(tag, () => scripts)
}
