import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const baseDir = new URL('./', import.meta.url).pathname
const briefs = JSON.parse(await readFile(join(baseDir, 'briefs.json'), 'utf8'))
const iters = ['iter0', 'iter1', 'iter2', 'iter3']
const labels = {
  iter0: 'Iter 0 — Baseline (Original Ridgetop)',
  iter1: 'Iter 1 — Framework v1 + Style Skills v1',
  iter2: 'Iter 2 — Visual-Critique Refinements (v2)',
  iter3: 'Iter 3 — 2D/3D Skeletons, Seamless Tube, Crevice AO & Split Skills'
}

const data = {}
for (const it of iters) {
  const audit = JSON.parse(await readFile(join(baseDir, it, 'audit.json'), 'utf8'))
  const lpPng = (await readFile(join(baseDir, it, 'low-poly-sheet.png'))).toString('base64')
  const pxPng = (await readFile(join(baseDir, it, 'pixel-art-sheet.png'))).toString('base64')
  const sprites = {}
  for (const b of briefs.pixelArt) {
    sprites[b.id] = (await readFile(join(baseDir, it, 'pixel-art', `${b.id}.png`))).toString('base64')
  }
  data[it] = { label: labels[it], audit, lpPng, pxPng, sprites }
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Ridgetop Art Self-Improvement Loop — Iter 0 → Iter 1 → Iter 2</title>
<style>
  :root { color-scheme: dark; --bg: #111b22; --card: #1a2831; --line: #2d4452; --text: #eef4f2; --muted: #9cb4be; --accent: #f0a858; --ok: #7ef2d4; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  h2 { margin: 28px 0 12px; font-size: 17px; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  p.sub { margin: 0 0 20px; color: var(--muted); max-width: 82ch; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  button { background: var(--card); color: var(--text); border: 1px solid var(--line); padding: 7px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
  button.active { background: var(--accent); color: #162028; border-color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  .card h3 { margin: 0 0 10px; font-size: 15px; display: flex; justify-content: space-between; align-items: center; }
  .sheet { width: 100%; height: auto; image-rendering: pixelated; border-radius: 6px; border: 1px solid #263945; display: block; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #243742; }
  th { color: var(--muted); font-weight: 600; }
  .ok { color: var(--ok); font-weight: 600; }
  .warn { color: #ff8e72; font-weight: 600; }
  .live-strip { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
  .live-box { background: #132028; border: 1px solid #283c48; border-radius: 8px; padding: 10px; text-align: center; }
  .live-box canvas { image-rendering: pixelated; display: block; margin: 0 auto 6px; background: repeating-conic-gradient(#1b2932 0 25%, #23343f 0 50%) 50% / 16px 16px; border-radius: 4px; }
  .live-box span { font-size: 11px; color: var(--muted); }
</style>
</head>
<body>
  <h1>Ridgetop Art Quality Self-Improvement Loop (Iter 0 → Iter 1 → Iter 2)</h1>
  <p class="sub">Controlled visual benchmark on the same 6 frozen briefs (3 Low-Poly 3D + 3 Pixel Art) authored by independent subagents of the same model as framework constraints, rendering primitives, and style skills evolved.</p>

  <div class="tabs">
    <button class="active" data-view="side">Side-by-Side Progression</button>
    <button data-view="live">Live Animated Pixel Comparison</button>
  </div>

  <div id="view-side">
    <h2>Low-Poly 3D Progression (Fox Courier · Apothecary Lantern · Windswept Cottage)</h2>
    <div class="grid" id="lp-grid"></div>
    <h2>Pixel Art Progression (Sprout Knight · Alchemist Elixir Flask · Ancient Moss Golem)</h2>
    <div class="grid" id="px-grid"></div>
  </div>

  <div id="view-live" style="display:none">
    <h2>Live Animated Pixel Sprites (4x Crisp Playback — Iter 0 vs Iter 1 vs Iter 2)</h2>
    <div class="grid" id="live-grid"></div>
  </div>

<script>
const DATA = ${JSON.stringify(data)};
const BRIEFS = ${JSON.stringify(briefs)};
const ITERS = ${JSON.stringify(iters)};

function renderLpTable(list) {
  return '<table><tr><th>Asset</th><th>Parts</th><th>Tris</th><th>Hidden</th><th>Lum</th><th>Walk Δ</th></tr>' +
    list.map(r => \`<tr><td>\${r.id}</td><td>\${r.parts}</td><td>\${r.triangles}</td><td class="\${r.hiddenParts?.length ? 'warn' : 'ok'}">\${r.hiddenParts?.length ?? 0}</td><td>\${r.lumRange}</td><td>\${r.animMetrics ? r.animMetrics.frameDeltaPx + 'px' : '—'}</td></tr>\`).join('') + '</table>';
}
function renderPxTable(list) {
  return '<table><tr><th>Asset</th><th>Colors</th><th>Fill</th><th>Orphans</th><th>FootΔ</th><th>AnimΔ</th></tr>' +
    list.map(r => \`<tr><td>\${r.id}</td><td class="\${r.uniqueColors > 14 ? 'warn' : 'ok'}">\${r.uniqueColors}</td><td class="\${r.fillRatio > 0.56 ? 'warn' : 'ok'}">\${r.fillRatio}</td><td class="\${r.orphans ? 'warn' : 'ok'}">\${r.orphans}</td><td>\${r.footDriftPx}</td><td>\${r.frameDeltaPx}px</td></tr>\`).join('') + '</table>';
}

const lpGrid = document.getElementById('lp-grid');
const pxGrid = document.getElementById('px-grid');
for (const it of ITERS) {
  const d = DATA[it];
  lpGrid.innerHTML += \`<div class="card"><h3>\${d.label}</h3><img class="sheet" src="data:image/png;base64,\${d.lpPng}" />\${renderLpTable(d.audit.lowPoly)}</div>\`;
  pxGrid.innerHTML += \`<div class="card"><h3>\${d.label}</h3><img class="sheet" src="data:image/png;base64,\${d.pxPng}" />\${renderPxTable(d.audit.pixelArt)}</div>\`;
}

const liveGrid = document.getElementById('live-grid');
const animItems = [];
for (const b of BRIEFS.pixelArt) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = \`<h3>\${b.title} (\${b.frameWidth}x\${b.frameHeight}, \${b.frames} frames)</h3><div class="live-strip"></div>\`;
  const strip = card.querySelector('.live-strip');
  for (const it of ITERS) {
    const box = document.createElement('div');
    box.className = 'live-box';
    const scale = b.frameWidth <= 24 ? 5 : 4;
    const c = document.createElement('canvas');
    c.width = b.frameWidth * scale;
    c.height = b.frameHeight * scale;
    box.appendChild(c);
    const lbl = document.createElement('span');
    lbl.textContent = it.toUpperCase();
    box.appendChild(lbl);
    strip.appendChild(box);
    const img = new Image();
    img.src = 'data:image/png;base64,' + DATA[it].sprites[b.id];
    animItems.push({ c, img, fw: b.frameWidth, fh: b.frameHeight, frames: b.frames, scale, ms: b.frames === 2 ? 480 : 150 });
  }
  liveGrid.appendChild(card);
}

function tick(now) {
  for (const item of animItems) {
    if (!item.img.complete) continue;
    const ctx = item.c.getContext('2d');
    ctx.clearRect(0, 0, item.c.width, item.c.height);
    ctx.imageSmoothingEnabled = false;
    const f = Math.floor(now / item.ms) % item.frames;
    ctx.drawImage(item.img, f * item.fw, 0, item.fw, item.fh, 0, 0, item.fw * item.scale, item.fh * item.scale);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const v = btn.dataset.view;
    document.getElementById('view-side').style.display = v === 'side' ? '' : 'none';
    document.getElementById('view-live').style.display = v === 'live' ? '' : 'none';
  });
});
</script>
</body>
</html>
`

await writeFile(join(baseDir, 'gallery.html'), html)
console.log('Wrote offline comparison gallery:', join(baseDir, 'gallery.html'))
