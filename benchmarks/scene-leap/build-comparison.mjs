import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve('benchmarks/scene-leap')
const ARTIFACT_PATH = '/home/jenaro/.gemini/antigravity-cli/brain/d62c7631-6dbf-4611-ad3b-0e0fcc9fa765/scene_leap_comparison.html'

async function b64(relPath) {
  const buf = await readFile(resolve(ROOT, relPath))
  return 'data:image/png;base64,' + buf.toString('base64')
}

const imgs = {
  lhBeforeGpu: await b64('before/lighthouse-webgpu-play.png'),
  lhAfterGpu: await b64('after/lighthouse-webgpu-play.png'),
  lhBeforeGl: await b64('before/lighthouse-webgl2-play.png'),
  lhAfterGl: await b64('after/lighthouse-webgl2-play.png'),
  lhBeforeC2d: await b64('before/lighthouse-canvas-play.png'),
  lhAfterC2d: await b64('after/lighthouse-canvas-play.png'),
  sdBeforeGpu: await b64('before/signal-drift-webgpu.png'),
  sdAfterGpu: await b64('after/signal-drift-webgpu.png'),
  sdBeforeGl: await b64('before/signal-drift-webgl2.png'),
  sdAfterGl: await b64('after/signal-drift-webgl2.png'),
  pxBeforeStrip: await b64('pixel-scene/before-scene.png'),
  pxAfterStrip: await b64('pixel-scene/after-scene.png'),
  pxBeforeF0: await b64('pixel-scene/before-frame0.png'),
  pxAfterF0: await b64('pixel-scene/after-frame0.png'),
  foxRawStrip: await b64('pixel-scene/fox-3d-to-pixel-raw.png'),
  foxSeloutStrip: await b64('pixel-scene/fox-3d-to-pixel-selout.png')
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ridgetop Scene-Level Visual Leap — Before vs After</title>
<style>
  :root {
    --bg: #0f131b;
    --panel: #171d29;
    --panel-2: #1f2737;
    --border: #2c374e;
    --text: #eef2f8;
    --muted: #9aa7bf;
    --accent: #f4a84d;
    --teal: #5fe6cf;
    --good: #6be28b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  header {
    padding: 22px 28px 16px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, #161d2b 0%, #0f131b 100%);
  }
  header h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: -0.01em; }
  header p { margin: 0; color: var(--muted); font-size: 14px; max-width: 920px; }
  .tabs {
    display: flex;
    gap: 8px;
    padding: 14px 28px;
    background: #131823;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 20;
    flex-wrap: wrap;
  }
  .tab-btn {
    background: var(--panel-2);
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 9px 16px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.14s ease;
  }
  .tab-btn:hover { color: var(--text); border-color: #465779; }
  .tab-btn.active {
    background: var(--accent);
    color: #17120c;
    border-color: var(--accent);
  }
  main { padding: 24px 28px 56px; max-width: 1240px; margin: 0 auto; }
  .section { display: none; }
  .section.active { display: block; }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 24px;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .card-head h2 { margin: 0 0 4px; font-size: 18px; }
  .card-head .sub { color: var(--muted); font-size: 13px; margin: 0; }
  .controls {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .pill {
    background: var(--panel-2);
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .pill.active {
    background: rgba(95, 230, 207, 0.16);
    color: var(--teal);
    border-color: var(--teal);
  }
  .pill.warn.active {
    background: rgba(244, 168, 77, 0.18);
    color: var(--accent);
    border-color: var(--accent);
  }
  .badges {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
  }
  .badge {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    background: #1d2638;
    border: 1px solid #2f3e5c;
    color: #cdd8eb;
  }
  .badge strong { color: var(--teal); }
  .compare-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 1120 / 660;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #0a0d12;
    user-select: none;
    touch-action: none;
    cursor: ew-resize;
  }
  .compare-wrap img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    pointer-events: none;
  }
  .compare-after-clip {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .compare-divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #fff;
    box-shadow: 0 0 10px rgba(0,0,0,0.85);
    pointer-events: none;
  }
  .compare-handle {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #fff;
    color: #111;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 13px;
    box-shadow: 0 3px 12px rgba(0,0,0,0.55);
  }
  .corner-tag {
    position: absolute;
    top: 12px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    background: rgba(12, 16, 24, 0.82);
    border: 1px solid rgba(255,255,255,0.16);
    pointer-events: none;
  }
  .tag-left { left: 12px; color: #ffad80; }
  .tag-right { right: 12px; color: var(--teal); }
  .pixel-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 18px;
  }
  .stage-box {
    background: #0b0e15;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    text-align: center;
  }
  .stage-box h3 {
    margin: 0 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .stage-box h3.after-lbl { color: var(--teal); }
  canvas.pixel-canvas {
    width: 100%;
    height: auto;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    border-radius: 6px;
    border: 1px solid #263147;
    background: #0a0c12;
    display: block;
    margin: 0 auto;
  }
  .strip-img {
    width: 100%;
    height: auto;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #0b0e14;
    display: block;
    margin-top: 10px;
  }
  .fox-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 18px;
    align-items: center;
  }
  canvas.fox-canvas {
    width: 240px;
    height: 240px;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: repeating-conic-gradient(#1b2230 0% 25%, #151b26 0% 50%) 50% / 16px 16px;
    display: block;
    margin: 0 auto;
  }
  .note-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 12px;
    margin-top: 14px;
  }
  .note {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 13px;
    color: #d6e0f0;
  }
  .note strong { color: var(--accent); display: block; margin-bottom: 3px; }
</style>
</head>
<body>
<header>
  <h1>Ridgetop Visual Quality Leap — Track 1 (3D Renderer) + Track 2 (2D Pixel Scene &amp; 3D→Pixel)</h1>
  <p>Drag the Before ↔ After wipe sliders on real captured Lighthouse &amp; Signal Drift gameplay (WebGPU, WebGL 2, and Canvas 2D), then inspect the live animated 240×135 pixel-art gameplay scene and <em>Dead Cells</em>-style 3D-to-pixel sprite baking.</p>
</header>

<nav class="tabs">
  <button class="tab-btn active" data-tab="t1">Track 1: 3D Shadows, Vertex AO &amp; Live Games</button>
  <button class="tab-btn" data-tab="t2">Track 2: Full-Scene 2D Pixel Art (Animated)</button>
  <button class="tab-btn" data-tab="t3">3D → Pixel Hybrid (outline: 'selout')</button>
</nav>

<main>
  <!-- TAB 1: 3D GAMES -->
  <section class="section active" id="t1">
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Tidewatch Lighthouse — Real Gameplay Before vs. After</h2>
          <p class="sub">Drag slider left/right to compare untouched baseline vs. 2048×2048 directional shadow map + stylized hemisphere/rim lighting + baked terrain AO + slope-conforming contact shadows.</p>
        </div>
        <div class="controls">
          <button class="pill active" data-lh-be="webgpu">WebGPU</button>
          <button class="pill" data-lh-be="webgl2">WebGL 2</button>
          <button class="pill" data-lh-be="canvas">Canvas 2D</button>
          <span style="width:6px"></span>
          <button class="pill warn" data-snap="lh-slider" data-val="100">Before</button>
          <button class="pill warn active" data-snap="lh-slider" data-val="50">50 / 50</button>
          <button class="pill warn" data-snap="lh-slider" data-val="0">After</button>
        </div>
      </div>
      <div class="compare-wrap" id="lh-slider" data-pos="50">
        <img class="img-before" src="${imgs.lhBeforeGpu}" alt="Lighthouse Before" />
        <div class="compare-after-clip">
          <img class="img-after" src="${imgs.lhAfterGpu}" alt="Lighthouse After" />
        </div>
        <div class="compare-divider"><div class="compare-handle">↔</div></div>
        <div class="corner-tag tag-left">Before (Baseline)</div>
        <div class="corner-tag tag-right">After (Shadows + AO + Hemi/Rim)</div>
      </div>
      <div class="badges">
        <span class="badge">Terrain Draw Calls: <strong>16 → 1</strong> (per-vertex RGB + bakeVertexAO)</span>
        <span class="badge">GPU Shadow Map: <strong>2048×2048 PCF</strong> (WebGPU &amp; WebGL 2 identical)</span>
        <span class="badge">Canvas 2D Fallback: <strong>Tier 1 slope-conforming contact shadows</strong></span>
        <span class="badge">Weather-Adaptive: <strong>clear / fog / rain / storm</strong> tint &amp; strength</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <h2>Signal Drift (Copper Basin) — Real Race Before vs. After</h2>
          <p class="sub">Every canyon mesa, rock spire, pit building, start gantry, and race car now casts soft-PCF cool-indigo shadows across the single-batch vertex-colored desert floor.</p>
        </div>
        <div class="controls">
          <button class="pill active" data-sd-be="webgpu">WebGPU</button>
          <button class="pill" data-sd-be="webgl2">WebGL 2</button>
          <span style="width:6px"></span>
          <button class="pill warn" data-snap="sd-slider" data-val="100">Before</button>
          <button class="pill warn active" data-snap="sd-slider" data-val="50">50 / 50</button>
          <button class="pill warn" data-snap="sd-slider" data-val="0">After</button>
        </div>
      </div>
      <div class="compare-wrap" id="sd-slider" data-pos="50">
        <img class="img-before" src="${imgs.sdBeforeGpu}" alt="Signal Drift Before" />
        <div class="compare-after-clip">
          <img class="img-after" src="${imgs.sdAfterGpu}" alt="Signal Drift After" />
        </div>
        <div class="compare-divider"><div class="compare-handle">↔</div></div>
        <div class="corner-tag tag-left">Before (No Shadows)</div>
        <div class="corner-tag tag-right">After (2048 Shadow Map + Car Shadows)</div>
      </div>
      <div class="badges">
        <span class="badge">Terrain Draw Calls: <strong>6 → 1</strong> (single vertex-colored + AO mesh)</span>
        <span class="badge">Car Grounding: <strong>Directional shadow + oriented contact shadow</strong></span>
        <span class="badge">Godot Export: <strong>encodeGlb() preserves COLOR_0</strong> vertex colors</span>
      </div>
    </div>
  </section>

  <!-- TAB 2: FULL-SCENE 2D PIXEL ART -->
  <section class="section" id="t2">
    <div class="card">
      <div class="card-head">
        <div>
          <h2>Full-Scene 2D Pixel Art Leap (240×135 Live Animated Gameplay)</h2>
          <p class="sub">Side-by-side live playback of a naive Iter-0 flat scene vs. a full cohesive Ridgetop pixel-craft scene with pose-variant <code>PixelRig</code> stride, parallax restraint, underfoot shadows, dust puffs, and <code>frame.glint()</code> sparkles.</p>
        </div>
        <div class="controls">
          <button class="pill active" id="px-play">Pause</button>
          <button class="pill" data-px-fps="4">0.5× (4 fps)</button>
          <button class="pill active" data-px-fps="8">1× (8 fps)</button>
          <button class="pill" data-px-fps="14">1.75× (14 fps)</button>
          <button class="pill" id="px-step">Step Frame (<span id="px-frame-idx">F0</span>)</button>
        </div>
      </div>

      <div class="pixel-grid">
        <div class="stage-box">
          <h3>Before — Naive rect/polygon Scene</h3>
          <canvas id="cv-px-before" class="pixel-canvas" width="240" height="135"></canvas>
        </div>
        <div class="stage-box">
          <h3 class="after-lbl">After — Full Ridgetop 2D Pixel-Craft Scene</h3>
          <canvas id="cv-px-after" class="pixel-canvas" width="240" height="135"></canvas>
        </div>
      </div>

      <div class="note-grid">
        <div class="note"><strong>Pose-Variant PixelRig (No Sliding Cutouts)</strong><code>pixelClips.bipedRun(4)</code> swaps distinct <code>f0..f3</code> bent-knee &amp; extended-stride leg stamps while parenting head/crest/arm transforms cleanly.</div>
        <div class="note"><strong>Figure-Ground Restraint</strong>Dithered dusk sky + 3 muted cool-slate parallax layers stay low-contrast so the warm-lit Sprout Knight, Potion Flask, and Moss Golem pop immediately.</div>
        <div class="note"><strong>Living Atmosphere</strong>Grounded underfoot shadows, animated boot dust puffs, drifting fireflies, and <code>frame.glint()</code> specular cross-sparkles on the floating flask.</div>
      </div>

      <div style="margin-top:18px;">
        <div style="font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">After — All 4 Frames Contact Strip (960×135)</div>
        <img class="strip-img" src="${imgs.pxAfterStrip}" alt="After 4-frame strip" />
      </div>
    </div>
  </section>

  <!-- TAB 3: 3D-TO-PIXEL HYBRID -->
  <section class="section" id="t3">
    <div class="card">
      <div class="card-head">
        <div>
          <h2>3D-to-Pixel Hybrid Baking (<code>outline: 'selout'</code>)</h2>
          <p class="sub">The same rigged 3D low-poly <code>fox-courier</code> baked headlessly via <code>bakeAnimatedSpritePixels()</code> at 48×48 with hemisphere + rim + toon lighting — Raw vs. automatic palette-harmonized pixel outline (<em>Dead Cells</em> workflow).</p>
        </div>
        <div class="controls">
          <button class="pill active" id="fox-play">Pause</button>
          <button class="pill" data-fox-fps="4">0.5×</button>
          <button class="pill active" data-fox-fps="8">1×</button>
          <button class="pill" data-fox-fps="12">1.5×</button>
        </div>
      </div>

      <div class="fox-grid">
        <div class="stage-box">
          <h3>Raw 3D-to-Pixel Bake (48×48 @ 5×)</h3>
          <canvas id="cv-fox-raw" class="fox-canvas" width="48" height="48"></canvas>
        </div>
        <div class="stage-box">
          <h3 class="after-lbl">With <code>outline: 'selout'</code> (48×48 @ 5×)</h3>
          <canvas id="cv-fox-selout" class="fox-canvas" width="48" height="48"></canvas>
        </div>
      </div>

      <div class="pixel-grid" style="margin-top:16px;">
        <div>
          <div style="font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Raw 4-Frame Strip (192×48)</div>
          <img class="strip-img" src="${imgs.foxRawStrip}" alt="Fox raw strip" />
        </div>
        <div>
          <div style="font-size:12px;color:var(--teal);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Selout Outlined 4-Frame Strip (192×48)</div>
          <img class="strip-img" src="${imgs.foxSeloutStrip}" alt="Fox selout strip" />
        </div>
      </div>
    </div>
  </section>
</main>

<script>
const IMAGES = ${JSON.stringify(imgs)};

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Before/After Wipe Sliders
function setSliderPos(el, pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  el.dataset.pos = String(clamped);
  const clip = el.querySelector('.compare-after-clip');
  const div = el.querySelector('.compare-divider');
  // Left side shows BEFORE, Right side shows AFTER
  clip.style.clipPath = 'inset(0 0 0 ' + clamped + '%)';
  div.style.left = clamped + '%';
}

document.querySelectorAll('.compare-wrap').forEach(el => {
  setSliderPos(el, Number(el.dataset.pos || 50));
  let dragging = false;
  const update = (clientX) => {
    const rect = el.getBoundingClientRect();
    setSliderPos(el, ((clientX - rect.left) / rect.width) * 100);
  };
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    update(e.clientX);
  });
  el.addEventListener('pointermove', (e) => { if (dragging) update(e.clientX); });
  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointercancel', () => { dragging = false; });
});

document.querySelectorAll('[data-snap]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.snap;
    const val = Number(btn.dataset.val);
    setSliderPos(document.getElementById(id), val);
    document.querySelectorAll('[data-snap="' + id + '"]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Backend switchers
const LH_MAP = {
  webgpu: [IMAGES.lhBeforeGpu, IMAGES.lhAfterGpu],
  webgl2: [IMAGES.lhBeforeGl, IMAGES.lhAfterGl],
  canvas: [IMAGES.lhBeforeC2d, IMAGES.lhAfterC2d]
};
document.querySelectorAll('[data-lh-be]').forEach(btn => {
  btn.addEventListener('click', () => {
    const [bef, aft] = LH_MAP[btn.dataset.lhBe];
    const wrap = document.getElementById('lh-slider');
    wrap.querySelector('.img-before').src = bef;
    wrap.querySelector('.img-after').src = aft;
    document.querySelectorAll('[data-lh-be]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

const SD_MAP = {
  webgpu: [IMAGES.sdBeforeGpu, IMAGES.sdAfterGpu],
  webgl2: [IMAGES.sdBeforeGl, IMAGES.sdAfterGl]
};
document.querySelectorAll('[data-sd-be]').forEach(btn => {
  btn.addEventListener('click', () => {
    const [bef, aft] = SD_MAP[btn.dataset.sdBe];
    const wrap = document.getElementById('sd-slider');
    wrap.querySelector('.img-before').src = bef;
    wrap.querySelector('.img-after').src = aft;
    document.querySelectorAll('[data-sd-be]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Animated Pixel Strip Player
function loadImg(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
}

(async () => {
  const [pxBef, pxAft, foxRaw, foxSel] = await Promise.all([
    loadImg(IMAGES.pxBeforeStrip),
    loadImg(IMAGES.pxAfterStrip),
    loadImg(IMAGES.foxRawStrip),
    loadImg(IMAGES.foxSeloutStrip)
  ]);

  const cBef = document.getElementById('cv-px-before').getContext('2d');
  const cAft = document.getElementById('cv-px-after').getContext('2d');
  const cFoxRaw = document.getElementById('cv-fox-raw').getContext('2d');
  const cFoxSel = document.getElementById('cv-fox-selout').getContext('2d');
  [cBef, cAft, cFoxRaw, cFoxSel].forEach(ctx => { ctx.imageSmoothingEnabled = false; });

  let pxPlaying = true, pxFps = 8, pxFrame = 0, pxAcc = 0;
  let foxPlaying = true, foxFps = 8, foxFrame = 0, foxAcc = 0;

  function drawPx() {
    cBef.clearRect(0, 0, 240, 135);
    cBef.drawImage(pxBef, pxFrame * 240, 0, 240, 135, 0, 0, 240, 135);
    cAft.clearRect(0, 0, 240, 135);
    cAft.drawImage(pxAft, pxFrame * 240, 0, 240, 135, 0, 0, 240, 135);
    document.getElementById('px-frame-idx').textContent = 'F' + pxFrame;
  }
  function drawFox() {
    cFoxRaw.clearRect(0, 0, 48, 48);
    cFoxRaw.drawImage(foxRaw, foxFrame * 48, 0, 48, 48, 0, 0, 48, 48);
    cFoxSel.clearRect(0, 0, 48, 48);
    cFoxSel.drawImage(foxSel, foxFrame * 48, 0, 48, 48, 0, 0, 48, 48);
  }
  drawPx();
  drawFox();

  document.getElementById('px-play').addEventListener('click', (e) => {
    pxPlaying = !pxPlaying;
    e.target.textContent = pxPlaying ? 'Pause' : 'Play';
    e.target.classList.toggle('active', pxPlaying);
  });
  document.getElementById('px-step').addEventListener('click', () => {
    pxPlaying = false;
    document.getElementById('px-play').textContent = 'Play';
    document.getElementById('px-play').classList.remove('active');
    pxFrame = (pxFrame + 1) % 4;
    drawPx();
  });
  document.querySelectorAll('[data-px-fps]').forEach(btn => {
    btn.addEventListener('click', () => {
      pxFps = Number(btn.dataset.pxFps);
      document.querySelectorAll('[data-px-fps]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('fox-play').addEventListener('click', (e) => {
    foxPlaying = !foxPlaying;
    e.target.textContent = foxPlaying ? 'Pause' : 'Play';
    e.target.classList.toggle('active', foxPlaying);
  });
  document.querySelectorAll('[data-fox-fps]').forEach(btn => {
    btn.addEventListener('click', () => {
      foxFps = Number(btn.dataset.foxFps);
      document.querySelectorAll('[data-fox-fps]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (pxPlaying) {
      pxAcc += dt;
      if (pxAcc >= 1 / pxFps) {
        pxAcc %= (1 / pxFps);
        pxFrame = (pxFrame + 1) % 4;
        drawPx();
      }
    }
    if (foxPlaying) {
      foxAcc += dt;
      if (foxAcc >= 1 / foxFps) {
        foxAcc %= (1 / foxFps);
        foxFrame = (foxFrame + 1) % 4;
        drawFox();
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
</script>
</body>
</html>
`

await writeFile(resolve(ROOT, 'comparison.html'), html, 'utf8')
await writeFile(ARTIFACT_PATH, html, 'utf8')
console.log('Built comparison HTML:', (html.length / 1024).toFixed(1), 'KB')
