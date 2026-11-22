import type { ArtRecipe } from '../framework/index.ts'
import type { ArtPin, ArtReview, ReviewScope } from '../framework/art-review.ts'
import { spriteDirections } from '../framework/index.ts'
import { measurePoint, reviewScene } from './testing-scene.ts'
import type { InspectGame } from './testing-scene.ts'

type Entry = { note: ArtReview; revision: string }
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const button = (id: string) => el<HTMLButtonElement>(id)
const choice = (id: string) => el<HTMLSelectElement>(id)
const status = (text: string) => { el('testing-status').textContent = text }
const endpoint = '/__testing/reviews'
async function api(url: string, method = 'GET', data?: unknown) {
  const response = await fetch(url, { method, cache: 'no-store', headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Could not save the review.')
  return result
}
function axes(container: string, label: string) {
  return ['X', 'Y', 'Z'].map(axis => {
    const item = document.createElement('label'), input = document.createElement('input')
    input.type = 'number'; input.step = 'any'; input.required = true
    input.setAttribute('aria-label', label + ' ' + axis)
    item.append(axis, input); el(container).append(item)
    return input
  })
}
function mark(canvas: HTMLCanvasElement, pin: ArtPin) {
  const [x, y, x2, y2] = pin.region
  const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d')
  ctx.strokeStyle = '#ffcc76'; ctx.lineWidth = 2
  if (x !== x2 || y !== y2) ctx.strokeRect(x*w, y*h, (x2-x)*w, (y2-y)*h)
  else {
    ctx.beginPath(); ctx.arc(x*w, y*h, 6, 0, 2*Math.PI); ctx.stroke()
  }
}

export async function attachTesting(game: InspectGame) {
  const fragment = await fetch('./testing.html')
  if (!fragment.ok) throw new Error('Testing controls are unavailable.')
  const content = new DOMParser().parseFromString(await fragment.text(), 'text/html')
  const board = document.querySelector<HTMLElement>('.board')
  const highlight = document.createElement('div')
  highlight.className = 'picked-object'; highlight.hidden = true; highlight.setAttribute('aria-hidden', 'true')
  board.append(highlight)
  board.before(content.getElementById('testing-bar'))
  board.after(content.getElementById('inspection'), content.getElementById('testing-status'))
  const scene = reviewScene(game)
  const list = choice('review-list'), objects = choice('object-list'), scopes = choice('pin-scope'), parts = choice('pin-part')
  const text = el<HTMLTextAreaElement>('review-text'), image = el<HTMLCanvasElement>('pin-image')
  const small = el<HTMLCanvasElement>('game-size'), move = el<HTMLInputElement>('move-part')
  const position = axes('edit-position', 'Position'), scale = axes('edit-scale', 'Size')
  const entries = new Map<string, Entry>()
  let active = false, target: ArtPin, entry: Entry, original: ArtRecipe, draft: ArtRecipe
  let rendered: HTMLCanvasElement, dirty = false, painting = 0, selecting = 0, busy = false, draftId: string
  let drag: { id: number; x: number; y: number; start?: readonly number[] } | undefined
  const report = (error: Error) => status(error.message)
  function reviewURL(id?: string) {
    const url = new URL(location.href)
    if (id) url.searchParams.set('review', id)
    else url.searchParams.delete('review')
    history.replaceState(null, '', url)
  }
  async function refresh() {
    const { entries: saved, errors } = await api(endpoint) as { entries: Entry[]; errors: string[] }
    entries.clear()
    list.replaceChildren(new Option('Choose a review', ''))
    for (const e of saved) {
      entries.set(e.note.id, e)
      list.add(new Option(e.note.status + ' · ' + e.note.target.view.asset + ' · ' + e.note.comment.slice(0, 40), e.note.id))
    }
    if (entry) list.value = entry.note.id
    if (errors.length) status('Could not load ' + errors.join(', '))
  }
  function thread() {
    el('thread').hidden = el('before-wrap').hidden = button('resolve-review').hidden = !entry
    el('comment-label').textContent = entry ? 'Reply' : 'Comment for Codex'
    el('pin-instruction').hidden = Boolean(entry)
    button('save-comment').textContent = entry ? 'Save reply' : 'Save comment'
    if (!entry) return
    el('thread-status').textContent = 'Review · ' + entry.note.status
    el('thread-comment').textContent = entry.note.comment
    el('thread-replies').replaceChildren(...entry.note.replies.map(reply => {
      const li = document.createElement('li'); li.textContent = reply.text; return li
    }))
    el<HTMLImageElement>('before-image').src = endpoint + '/' + entry.note.id + '/before.png'
    button('resolve-review').textContent = entry.note.status === 'resolved' ? 'Reopen' : 'Resolve'
  }
  function fields() {
    const part = draft?.parts.find(p => p.name === target?.part)
    el('direct-edit').hidden = !part || target.scope !== 'asset' || Boolean(target.view.handDrawn)
    for (let i = 0; i < 3 && part; i++) {
      position[i].value = String(part.position[i])
      scale[i].value = String(part.scale[i])
    }
    button('save-part').disabled = button('discard-part').disabled = !dirty || busy
    button('save-comment').disabled = dirty || busy || (!entry && !rendered)
    button('resolve-review').disabled = dirty || busy
  }
  async function paint() {
    const ticket = ++painting
    const view = target.view
    const next = await scene.image(view, false, dirty ? draft : undefined)
    if (ticket !== painting) return
    rendered = next
    image.width = next.width; image.height = next.height
    image.getContext('2d').drawImage(next, 0, 0)
    mark(image, target)
    small.width = Math.min(1024, Math.max(1, Math.round(view.width)))
    small.height = Math.min(1024, Math.max(1, Math.round(view.height)))
    const ctx = small.getContext('2d')
    ctx.imageSmoothingEnabled = view.surface === 'model'
    ctx.drawImage(next, 0, 0, small.width, small.height)
    fields()
  }
  function setParts() {
    const names = target.view.handDrawn ? [] : scene.parts(target.view.asset)
    parts.replaceChildren(new Option('Whole asset', ''), ...names.map(n => new Option(n, n)))
    if (target.part && !names.includes(target.part)) parts.add(new Option(target.part + ' (removed)', target.part))
    parts.value = target.part ?? ''
    el('part-label').hidden = !names.length && !target.part
  }
  async function highlightObject() {
    const pin = target
    if (!active || !pin) { highlight.hidden = true; return }
    const subject = await scene.locate(pin.view.instance)
    if (pin !== target) return
    highlight.hidden = !subject
    if (!subject) return
    const rect = (pin.view.surface === 'hud' ? game.hud : game.frame().surface).getBoundingClientRect()
    const parent = board.getBoundingClientRect()
    highlight.style.left = (rect.left - parent.left - board.clientLeft + subject.left) + 'px'
    highlight.style.top = (rect.top - parent.top - board.clientTop + subject.top) + 'px'
    highlight.style.width = subject.view.width + 'px'; highlight.style.height = subject.view.height + 'px'
  }
  new ResizeObserver(() => { if (active && target) requestAnimationFrame(() => highlightObject().catch(report)) }).observe(board)
  async function display(pin: ArtPin, saved?: Entry) {
    painting++
    drag = undefined
    target = structuredClone(pin); entry = saved; dirty = false; rendered = undefined; move.checked = false
    draftId = crypto.randomUUID()
    image.getContext('2d').clearRect(0, 0, image.width, image.height)
    small.getContext('2d').clearRect(0, 0, small.width, small.height)
    el('pin-details').hidden = false
    const v = pin.view
    objects.value = v.instance
    scopes.value = target.scope
    el('edit-source').textContent = target.editSource ?? scene.editSource(v, target.scope)
    for (const option of scopes.options) option.disabled = (option.value === 'hud' && v.surface !== 'hud') || (option.value === 'sprite' && v.surface === 'model')
    // A saved pin is immutable. Replies and new revisions retain the original target.
    scopes.disabled = Boolean(entry)
    parts.disabled = Boolean(entry)
    el('pin-title').textContent = v.asset
    el('pin-context').textContent = [v.surface === 'hud' ? 'Inventory icon' : v.surface === 'model' ? '3D model' : '2D sprite',
      v.instance, v.clip ? v.clip + ' · frame ' + (v.frame + 1) : 'Yaw ' + Math.round(v.yaw * 180 / Math.PI) + '°',
      Math.round(v.width) + ' × ' + Math.round(v.height) + ' px'].join(' · ')
    text.value = ''; status(''); thread()
    original = game.source(v.asset).recipe
    draft = original ? structuredClone(original) : undefined
    try { setParts(); fields(); await Promise.all([paint(), highlightObject()]) } catch (error) {
      el('direct-edit').hidden = true
      button('save-comment').disabled = !entry
      status('Current art unavailable. ' + error.message)
    }
  }
  function objectList() {
    const values = [...game.frame().objects].sort((a,b) => Number(a.id.startsWith('ground-')) - Number(b.id.startsWith('ground-')))
    objects.replaceChildren(new Option('Choose on the board…', ''), new Option('Inventory icon', 'inventory'),
      ...values.map(o => new Option(o.name + ' · ' + o.id, o.id)))
  }
  function pause(on: boolean) {
    active = on; game.pause(on)
    document.body.classList.toggle('testing-paused', on)
    el('inspection').hidden = !on
    button('inspect').textContent = on ? 'Resume play' : 'Pause & inspect'
    if (on) objectList()
    else {
      selecting++; painting++; target = entry = undefined; drag = undefined; dirty = false
      highlight.hidden = true
      list.value = ''; el('pin-details').hidden = true; reviewURL(); status('')
    }
  }
  function canNavigate() {
    if (busy) return false
    if (dirty) { status('Save or discard the part edit first.'); return false }
    return true
  }
  async function openReview(e: Entry) {
    const ticket = ++selecting
    if (!active) pause(true)
    await game.restore(e.note.scene)
    if (ticket !== selecting) return
    objectList(); list.value = e.note.id; reviewURL(e.note.id)
    await display(e.note.target, e)
  }
  button('inspect').onclick = () => { if (canNavigate()) pause(!active) }
  list.onchange = () => {
    const e = entries.get(list.value)
    if (canNavigate() && e) openReview(e).catch(report)
    else list.value = entry?.note.id ?? ''
  }
  button('refresh-reviews').onclick = () => refresh().then(() => {
    if (entry && entries.has(entry.note.id)) { entry = entries.get(entry.note.id); thread() }
  }).catch(report)
  objects.onchange = async () => {
    if (!objects.value || !canNavigate()) { objects.value = target?.view.instance ?? ''; return }
    const ticket = ++selecting
    try {
      const pin = await scene.select(objects.value)
      if (ticket === selecting) { list.value = ''; reviewURL(); await display(pin) }
    } catch (error) { report(error) }
  }
  board.addEventListener('click', async event => {
    if (!active || !canNavigate()) return
    const hud = event.target === game.hud
    if (!hud && event.target !== game.frame().surface) return
    const ticket = ++selecting
    try {
      const [u,v] = measurePoint(hud ? game.hud : game.frame().surface, event)
      const pin = await scene.pick(u, v, hud)
      if (ticket !== selecting) return
      if (!pin) { status('Click a visible part of an object.'); return }
      list.value = ''; reviewURL(); await display(pin)
    } catch (error) { report(error) }
  })
  scopes.onchange = () => {
    if (dirty) scopes.value = target.scope
    else {
      target.scope = scopes.value as ReviewScope
      target.editSource = scene.editSource(target.view, target.scope)
      el('edit-source').textContent = target.editSource
    }
    fields()
  }
  parts.onchange = () => { target.part = parts.value || undefined; fields() }
  function edited() {
    dirty = true
    fields()
    paint().catch(report)
  }
  function changeNumbers() {
    const p = draft?.parts.find(piece => piece.name === target.part)
    if (!p) return
    const [x,y,z] = position.map(i => i.valueAsNumber), [w,h,d] = scale.map(i => i.valueAsNumber)
    if (![x,y,z,w,h,d].every(Number.isFinite) || Math.min(w,h,d) <= 0) { status('Use finite positions and positive sizes.'); return }
    p.position = [x,y,z]; p.scale = [w,h,d]; status(''); edited()
  }
  for (const field of [...position, ...scale]) field.onchange = changeNumbers
  image.onpointerdown = event => {
    if (!target || busy || event.button !== 0) return
    const part = draft?.parts.find(p => p.name === target.part)
    const moving = move.checked && target.scope === 'asset' && !el('direct-edit').hidden && part
    if (entry && !moving) return
    const [x,y] = measurePoint(image, event)
    drag = { id: event.pointerId, x, y, start: moving ? [...part.position] : undefined }
    image.setPointerCapture(event.pointerId)
  }
  function moveTo(x: number, y: number) {
    const v = target.view, p = draft.parts.find(piece => piece.name === target.part)
    const angle = v.surface === 'model' ? v.yaw : -spriteDirections.indexOf(v.clip as typeof spriteDirections[number]) * Math.PI / 4
    const span = v.span / (v.surface === 'hud' ? 1.1 : 1)
    const dx = (x - drag.x) * span, dy = -(y - drag.y) * span / Math.cos(v.elevation)
    const round = (n: number) => Math.round(n * 1000) / 1000
    p.position = [round(drag.start[0] + dx*Math.cos(angle)), round(drag.start[1] + dy), round(drag.start[2] + dx*Math.sin(angle))]
    edited()
  }
  image.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return
    const [x,y] = measurePoint(image, event)
    if (drag.start) moveTo(x,y)
    else if (rendered) {
      const ctx = image.getContext('2d')
      ctx.clearRect(0, 0, image.width, image.height)
      ctx.drawImage(rendered, 0, 0)
      mark(image, { ...target, region: [drag.x, drag.y, x, y] })
    }
  }
  window.addEventListener('pointerup', async event => {
    if (!drag || event.pointerId !== drag.id) return
    const [x,y] = measurePoint(image,event), start = drag
    if (drag.start) { moveTo(x,y); drag = undefined; return }
    drag = undefined
    const current = target
    if (Math.hypot(x-start.x,y-start.y) < .015) {
      current.region = [x,y,x,y]
      try { const part = await scene.partAt(current.view,x,y,dirty ? draft : undefined); if (target === current) current.part = part }
      catch (error) { report(error); return }
    } else current.region = [Math.min(x,start.x),Math.min(y,start.y),Math.max(x,start.x),Math.max(y,start.y)]
    if (current === target) { parts.value = target.part ?? ''; fields(); paint().catch(report) }
  })
  function cancelDrag() {
    if (!drag) return
    drag = undefined
    paint().catch(report)
  }
  image.onpointercancel = cancelDrag
  window.addEventListener('blur', cancelDrag)
  button('discard-part').onclick = () => { draft = structuredClone(original); dirty = false; fields(); paint().catch(report) }
  function reload() {
    history.replaceState({ ridgetopInspection: { scene: game.snapshot(), target: entry ? entry.note.target : target, review: entry?.note.id } }, '')
    location.reload()
  }
  button('compare-latest').onclick = () => { if (canNavigate()) reload() }
  async function writing(action: () => Promise<void>) {
    if (busy) return
    busy = true; fields()
    try { await action() } catch (error) { report(error) }
    finally { busy = false; fields() }
  }
  button('save-part').onclick = () => writing(async () => {
    const source = game.source(target.view.asset)
    await api('/__testing/recipe', 'POST', { asset: target.view.asset, file: source.file, base: source.base, recipe: draft })
    dirty = false; reload()
  })
  async function update(statusValue: ArtReview['status'], reply: string) {
    entry = await api(endpoint + '/' + entry.note.id, 'PATCH', { revision: entry.revision, status: statusValue, reply })
    text.value = ''; await refresh(); thread()
  }
  button('resolve-review').onclick = () => writing(async () => {
    await update(entry.note.status === 'resolved' ? 'open' : 'resolved', text.value.trim())
    status('Review saved to the project.')
  })
  button('save-comment').onclick = () => writing(async () => {
    if (!text.value.trim()) throw new Error('Write a comment first.')
    if (entry) await update(entry.note.status, text.value.trim())
    else {
      const result: Entry = await api(endpoint, 'POST', { id: draftId, target, scene: game.snapshot(),
        comment: text.value, png: rendered.toDataURL('image/png').split(',')[1] })
      await refresh(); await display(result.note.target, result); list.value = result.note.id; reviewURL(result.note.id)
    }
    status('Saved in reviews/' + entry.note.id + '.json. Codex can read this comment from the project.')
  })
  await refresh()
  const resume = history.state?.ridgetopInspection
  const requested = resume?.review ?? new URLSearchParams(location.search).get('review')
  if (requested && entries.has(requested)) await openReview(entries.get(requested))
  else if (resume?.target) {
    pause(true); await game.restore(resume.scene); objectList(); await display(resume.target)
  } else if (requested) status('This review is missing from the project.')
  if (resume) history.replaceState(null, '')
}
