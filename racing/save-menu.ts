import { championshipBackup, readChampionshipBackup } from './progression.ts'
import type { Championship } from './progression.ts'

export function createSaveMenu(root: HTMLDetailsElement, progress: Championship, restore: (next: Championship) => boolean) {
  const input = root.querySelector<HTMLInputElement>('#race-save-file')
  const apply = root.querySelector<HTMLButtonElement>('#race-save-restore')
  const status = root.querySelector<HTMLElement>('#race-save-status')
  let candidate: Championship | undefined
  let selection = 0

  function clear() {
    selection++
    candidate = undefined
    input.value = ''
    apply.hidden = true
    status.textContent = ''
  }
  root.addEventListener('toggle', () => { if (!root.open) clear() })

  root.querySelector<HTMLButtonElement>('#race-save-export').onclick = () => {
    const blob = new Blob([championshipBackup(progress)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'signal-drift-save.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  root.querySelector<HTMLButtonElement>('#race-save-import').onclick = () => input.click()
  input.onchange = async () => {
    const file = input.files?.[0]
    clear()
    if (!file) return
    const current = selection
    try {
      const backup = readChampionshipBackup(await file.text())
      if (current !== selection || !root.open) return
      candidate = backup
      const count = Object.keys(backup.records).length
      status.textContent = 'Selected backup has ' + backup.credits + ' credits and ' + count + ' recorded events.'
      apply.hidden = false
      apply.focus()
    } catch (error) {
      if (current === selection) status.textContent = error.message
    }
  }
  apply.onclick = () => {
    if (!candidate) return
    const saved = restore(candidate)
    clear()
    status.textContent = saved ? 'Championship restored and saved.' : 'Championship restored for this session.'
    root.querySelector('summary').focus()
  }
  return {
    show(visible: boolean) {
      root.hidden = !visible
      if (!visible && root.open) { root.open = false; clear() }
    }
  }
}
