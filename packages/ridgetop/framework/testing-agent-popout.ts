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

  const bridge = createRemoteDecisionAgentBridge()
  const handle = mountDecisionAgentPane(body, {
    bridge,
    onStatus(msg) {
      status.textContent = msg
    }
  })

  window.addEventListener('beforeunload', () => {
    handle.dispose()
    bridge.dispose()
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootPopout, { once: true })
} else {
  bootPopout()
}
