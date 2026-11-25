import { createSpriteSheet, hueShiftRamp, auditSpriteSheet } from '../../../../packages/ridgetop/dist/framework/index.js';

export function build() {
  const glass = hueShiftRamp('#689bc0', { highlightHue: 198 });
  const elixir = hueShiftRamp('#1fb88e', { highlightHue: 156 });
  const cork = hueShiftRamp('#b88252');
  const wax = hueShiftRamp('#d94a38');

  const palette = {
    K: '#141c2c',   // shared deep cool ink & interior glass depth
    g: glass.dark,  // dark refractive glass rim
    s: glass.shade, // cool crystal facet shadow
    G: glass.light, // ice-blue glass highlight & sheen edge
    W: '#f4fdff',   // crisp specular highlight, meniscus sparkle & star glint core
    d: elixir.dark, // deep teal-emerald lower-right liquid shadow
    e: elixir.shade,// rich emerald shadow
    E: elixir.mid,  // glowing teal-emerald elixir
    M: elixir.light,// bright aqua-mint meniscus & rising bubbles
    k: cork.dark,   // cork shadow
    c: cork.mid,    // warm cork body
    C: cork.light,  // sunlit cork top-left
    r: wax.dark,    // deep crimson wax ribbon shadow
    R: wax.mid      // vibrant crimson-orange wax ribbon
  };

  const sheet = createSpriteSheet(24, 24, 4, 1);

  // Base faceted crystal flask (24x24, raw pixels within x=4..19, y=2..21 so outlined fits cleanly in x=3..20, y=1..22)
  const baseFlask = [
    '..........CCck..........', // y=2  cork top
    '..........Ccck..........', // y=3  cork mid
    '..........cckk..........', // y=4  cork base
    '........GWGssssg........', // y=5  flared crystal lip
    '..........Gsgg..........', // y=6  narrow neck
    '.........RRRRr..........', // y=7  crimson wax ribbon wrap
    '.........rrRRRr.........', // y=8  ribbon knot & tie
    '........GGsggRRr........', // y=9  upper facet & ribbon tail
    '.......GWGKggKssg.......', // y=10 crystal shoulder
    '......GWGKKggKKsg.......', // y=11 faceted upper chamber (air)
    '.....GWGKKggggKKgg......', // y=12 faceted shoulder angle
    '....GsWGKggggggKKgg.....', // y=13 lower air pocket
    '....gGWMEMMMMMEMdgg.....', // y=14 bright glowing meniscus
    '....gGMMEEEEEEEEddg.....', // y=15 upper glowing elixir
    '....gGMEEEEEEEEeddg.....', // y=16 bulbous liquid belly
    '.....gMEEEEEEEeedg......', // y=17 lower faceted taper
    '.....ggEEEEEEeedgg......', // y=18 saturated lower-right liquid
    '......ggEeeeeedgg.......', // y=19 bottom refraction curve
    '.......gGGssssgg........', // y=20 thick crystal base highlight
    '........gggggggg........'  // y=21 flat grounded glass base
  ];

  // Subtle meniscus slosh + sweeping diagonal crystal sheen + rising bubbles per frame
  const shimmerOverlays = [
    // Frame 0: sheen enters upper-left shoulder, bubble A low-left, bubble B upper-right
    (f) => {
      // Meniscus slosh (left crest bright)
      f.pixel(7, 14, palette.W);
      f.pixel(8, 14, palette.W);
      f.pixel(9, 14, palette.M);
      f.pixel(15, 14, palette.E);
      // Diagonal crystal sheen entering upper-left air chamber
      f.pixel(8, 11, palette.G);
      f.pixel(9, 10, palette.G);
      f.pixel(8, 12, palette.W);
      f.pixel(9, 11, palette.W);
      f.pixel(10, 10, palette.G);
      // Rising bubbles (2px connected clusters for clean readability)
      f.pixel(9, 18, palette.M);
      f.pixel(10, 18, palette.W);
      f.pixel(14, 15, palette.W);
      f.pixel(14, 16, palette.M);
    },
    // Frame 1: sheen crosses center air chamber & meniscus, bubble A rises mid-left, bubble B pops at meniscus
    (f) => {
      // Meniscus slosh (center crest bright)
      f.pixel(10, 14, palette.W);
      f.pixel(11, 14, palette.W);
      f.pixel(12, 14, palette.W);
      f.pixel(14, 13, palette.M); // tiny bubble pop crest on meniscus
      f.pixel(14, 14, palette.W);
      // Diagonal crystal sheen gliding through center chamber
      f.pixel(9, 13, palette.G);
      f.pixel(10, 12, palette.W);
      f.pixel(11, 11, palette.W);
      f.pixel(12, 10, palette.G);
      f.pixel(10, 13, palette.G);
      f.pixel(11, 12, palette.G);
      // Rising bubble A mid-left
      f.pixel(9, 16, palette.W);
      f.pixel(9, 17, palette.M);
      f.pixel(10, 16, palette.M);
    },
    // Frame 2: sheen sweeps diagonally across right liquid facet, bubble A reaches meniscus, bubble C spawns bottom-right
    (f) => {
      // Meniscus slosh (right crest bright)
      f.pixel(9, 13, palette.M);
      f.pixel(9, 14, palette.W);
      f.pixel(13, 14, palette.W);
      f.pixel(14, 14, palette.W);
      // Diagonal sheen gliding across mid-right liquid
      f.pixel(11, 16, palette.M);
      f.pixel(12, 15, palette.W);
      f.pixel(13, 14, palette.W);
      f.pixel(14, 13, palette.G);
      f.pixel(15, 12, palette.G);
      f.pixel(12, 16, palette.M);
      f.pixel(13, 15, palette.M);
      // New bubble C spawning bottom-right
      f.pixel(13, 18, palette.W);
      f.pixel(14, 18, palette.M);
    },
    // Frame 3: sheen kisses lower-right crystal facet & base, bubble C rises mid-right
    (f) => {
      // Meniscus settles smoothly
      f.pixel(8, 14, palette.M);
      f.pixel(11, 14, palette.W);
      f.pixel(12, 14, palette.M);
      // Diagonal sheen exiting lower-right crystal facet
      f.pixel(13, 18, palette.M);
      f.pixel(14, 17, palette.W);
      f.pixel(15, 16, palette.W);
      f.pixel(16, 15, palette.M);
      f.pixel(15, 17, palette.M);
      f.pixel(11, 20, palette.W);
      f.pixel(12, 20, palette.G);
      // Bubble C rising mid-right
      f.pixel(12, 16, palette.W);
      f.pixel(12, 17, palette.M);
      f.pixel(8, 17, palette.M);
      f.pixel(8, 18, palette.M);
    }
  ];

  // Crisp luminous star glints drawn AFTER outline() so they stay airy and orphan-free
  const drawGlint = [
    // Frame 0: soft 2x2 diamond-start on upper-left shoulder
    (f) => {
      f.pixel(4, 9, palette.G);
      f.pixel(5, 9, palette.W);
      f.pixel(4, 10, palette.G);
    },
    // Frame 1: blazing 3x3 cross star glint on upper-left shoulder
    (f) => {
      f.pixel(4, 8, palette.G);
      f.pixel(3, 9, palette.G);
      f.pixel(4, 9, palette.W);
      f.pixel(5, 9, palette.G);
      f.pixel(4, 10, palette.G);
    },
    // Frame 2: fading compact glint on upper-left shoulder
    (f) => {
      f.pixel(4, 9, palette.W);
      f.pixel(5, 9, palette.G);
      f.pixel(4, 8, palette.G);
    },
    // Frame 3: crisp secondary 3x3 star glint on upper-right crystal shoulder
    (f) => {
      f.pixel(19, 10, palette.G);
      f.pixel(18, 11, palette.G);
      f.pixel(19, 11, palette.W);
      f.pixel(20, 11, palette.G);
      f.pixel(19, 12, palette.G);
    }
  ];

  for (let i = 0; i < 4; i++) {
    const f = sheet.frame(i, 0);
    f.stamp(0, 2, baseFlask, palette);
    shimmerOverlays[i](f);

    // Palette-locked selective outline (4-way, zero palette bloat)
    f.outline('selout', { palette });

    // Luminous star glint on top of silhouette edge (zero orphans, crisp indie sparkle)
    drawGlint[i](f);
  }

  return sheet;
}
