import { createRemoteDecisionAgentBridge, mountDecisionAgentPane } from './testing-decision-ui.ts'

function bootPopout() {
  const root = document.getElementById('rt-popout-root')
  if (!root) return

  const header = document.createElement('header')
  header.className = 'rt-popout-head'
  const title = document.createElement('div')
  title.className = 'rt-popout-title'
  title.textContent = 'RIDGETOP · DECISION AGENT'
  const status = document.createElement('div')
  status.className = 'rt-muted'
  status.textContent = 'Companion Window — keeps game viewport unobstructed'
  header.append(title, status)

  const body = document.createElement('main')
  body.className = 'rt-popout-body-wrap'

  root.replaceChildren(header, body)

  let targetHostId: string | undefined
  try {
    const rawHost = new URLSearchParams(window.location.search).get('host')?.trim()
    if (rawHost) targetHostId = rawHost
  } catch { /* Ignore invalid location search. */ }

  const bridge = createRemoteDecisionAgentBridge(targetHostId)
  const handle = mountDecisionAgentPane(body, {
    bridge,
    onStatus(msg) {
      status.textContent = msg
    }
  })

  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    handle.dispose()
    bridge.dispose()
  }
  window.addEventListener('pagehide', cleanup)
  window.addEventListener('beforeunload', cleanup)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPopout, { once: true })
} else {
  bootPopout()
}
