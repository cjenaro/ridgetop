import { championshipBackup, readChampionshipBackup } from './progression.ts'
import type { Championship } from './progression.ts'

/** Headless save backup exporter/importer wired to Signal Drift's Canvas UI (zero HTML menus). */
export function createSaveBackup(
  input: HTMLInputElement,
  progress: Championship,
  restore: (next: Championship) => boolean,
  onChange: () => void
) {
  let candidate: Championship | undefined
  let statusText = ''
  let selection = 0

  function clear() {
    selection++
    candidate = undefined
    input.value = ''
    statusText = ''
    onChange()
  }

  input.onchange = async () => {
    const file = input.files?.[0]
    selection++
    candidate = undefined
    input.value = ''
    statusText = ''
    if (!file) { onChange(); return }
    const current = selection
    try {
      const backup = readChampionshipBackup(await file.text())
      if (current !== selection) return
      candidate = backup
      const count = Object.keys(backup.records).length
      statusText = `Selected backup has ${backup.credits} credits and ${count} recorded events.`
    } catch (error) {
      if (current === selection) statusText = error.message
    }
    onChange()
  }

  return {
    get status() { return statusText },
    get hasCandidate() { return Boolean(candidate) },
    clear,
    exportBackup() {
      const blob = new Blob([championshipBackup(progress)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'signal-drift-save.json'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    chooseFile() {
      input.click()
    },
    applyRestore() {
      if (!candidate) return false
      const saved = restore(candidate)
      candidate = undefined
      input.value = ''
      statusText = saved ? 'Championship restored and saved.' : 'Championship restored for this session.'
      onChange()
      return true
    }
  }
}
