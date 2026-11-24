import { setTestingActive } from './testing-runtime.ts'
import { mountTestingStudio } from './testing-studio.ts'

function shouldBoot(): boolean {
  try {
    const params = new URLSearchParams(location.search)
    const flag = params.get('testing')
    if (flag === '0' || flag === 'false') return false
    return true
  } catch {
    return true
  }
}

if (typeof document !== 'undefined' && shouldBoot()) {
  setTestingActive(true)
  const start = () => {
    if (document.getElementById('ridgetop-testing-root')) return
    mountTestingStudio()
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }
}
