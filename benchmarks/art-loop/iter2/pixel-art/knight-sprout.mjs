import { createSpriteSheet, hueShiftRamp, auditSpriteSheet } from '../../../../packages/ridgetop/dist/framework/index.js';

export function build() {
  const leaf = hueShiftRamp('#4a9b60');
  const cloak = hueShiftRamp('#d96846');
  const wood = hueShiftRamp('#a46a42');

  const palette = {
    K: '#141c2c', // shared deep cool ink, visor cavity, boot sole
    g: leaf.dark,
    s: leaf.shade,
    G: leaf.mid,
    L: leaf.light,
    H: leaf.highlight,
    c: cloak.dark,
    C: cloak.mid,
    O: cloak.light,
    w: wood.dark,
    W: wood.mid,
    B: wood.light,
    e: '#ffd15c', // warm amber visor eye shade & shield boss
    E: '#fff7d6'  // crisp cream-gold eye highlight & buckler rim glint
  };

  const sheet = createSpriteSheet(32, 32, 4, 1);

  const helmet = [
    '...HLLGGGs...',
    '..HLLGGGGss..',
    '.HLLGGGGGGss.',
    '.LLGGGGKKKKK.',
    '.LGGGKEEKKEK.',
    '.LGGGKeeKKeK.',
    '.GGGsKKKKKK..',
    '..Gssgssssg..',
    '...ggggggg...'
  ];

  const buckler = [
    '..EBB..',
    '.EBWWW.',
    'EBWEWWw',
    'BWWeeWw',
    'BWWWWww',
    '.WWwww.',
    '..www..'
  ];

  // 4 distinct twin-leaf sprout poses (drag on squash, tall stretch on up)
  const sprouts = [
    // Frame 0: Contact - perky twin leaves with clear V negative space
    {
      x: 11, y: 3,
      rows: [
        '.......HLG..',
        '.HLG..HLLGs.',
        'HLLGs.LGss..',
        '.LGGs.Gss...',
        '..GGsGGg....',
        '....gGg.....',
        '.....G......'
      ]
    },
    // Frame 1: Down/Squash - dragged back & slightly flattened
    {
      x: 10, y: 5,
      rows: [
        '.........HLG.',
        '.HLGG...HLLGs',
        'HLLGGs..LGss.',
        '.LGGGs.GGs...',
        '...GssGGg....',
        '.....gGg.....'
      ]
    },
    // Frame 2: Passing - leaning slightly forward into stride
    {
      x: 12, y: 3,
      rows: [
        '......HLG...',
        '.HLG.HLLGs..',
        'HLLGs.LGss..',
        '.LGGs.Gss...',
        '..GssGGg....',
        '....gGg.....',
        '.....G......'
      ]
    },
    // Frame 3: Up/Stretch - tall buoyant leaves springing high
    {
      x: 12, y: 2,
      rows: [
        '......HL....',
        '.HL..HLLG...',
        'HLLG.LLGs...',
        '.LGG.LGs....',
        '..GGsGGs....',
        '...gGGg.....',
        '....GG......'
      ]
    }
  ];

  // Flowing S-curve capes draping downward from shoulders and trailing in a smooth wave
  const capes = [
    // Frame 0: Contact - graceful downward drape into mid S-trough and soft upward-curled hem
    {
      x: 3, y: 18,
      rows: [
        '.........OOCCc.',
        '........OCCCCc.',
        '.......OCCCCcc.',
        '.....OOCCCCcc..',
        '..OOOCCCCCCc...',
        '.OCCCCCCCcc....',
        '..CCcccc.......'
      ]
    },
    // Frame 1: Down/Squash - deep low cloth drape settling downward
    {
      x: 4, y: 19,
      rows: [
        '........OOCCc.',
        '.......OCCCCc.',
        '......OCCCCcc.',
        '.....OCCCCcc..',
        '..OOOCCCCcc...',
        '.OCCCCCCcc....',
        '.CCCCccc......',
        '..ccc.........'
      ]
    },
    // Frame 2: Passing - traveling wave crest ripples toward the trailing hem
    {
      x: 2, y: 18,
      rows: [
        '..........OOCCc.',
        '.........OCCCCc.',
        '......OOOCCCCcc.',
        '....OOCCCCCCcc..',
        '..OOCCCCCCCcc...',
        '.OCCCCccc.......',
        '..ccc...........'
      ]
    },
    // Frame 3: Up/Stretch - buoyant drape with tail whipping upward in follow-through
    {
      x: 3, y: 17,
      rows: [
        '.........OOCCc.',
        '........OCCCCc.',
        '.......OCCCCcc.',
        '.OO...OCCCCcc..',
        'OCCCCOCCCCcc...',
        '.CCCCCCCCcc....',
        '..cccccc.......'
      ]
    }
  ];

  // Grounded run cycle: lowest raw boot pixel y=29 on F0/1/2 (outlined y=30), y=28 on F3 (outlined y=29) -> footDriftPx = 1
  const bodiesAndLegs = [
    // Frame 0: Contact (y=19..29, 11 rows) - wide athletic A-stride, boots pointing forward
    {
      x: 10, y: 19,
      rows: [
        '....gGGg......',
        '....gGGsg.....',
        '....gGssg.....',
        '....gsss......',
        '...gs..gg.....',
        '..gs....gg....',
        '..ww....WW....',
        '.wWw....WWw...',
        'wWw......WWw..',
        'wWw......WWBW.',
        'KKw......KKKK.'
      ]
    },
    // Frame 1: Down/Squash (y=20..29, 10 rows) - knees bent, flat planted front boot, tucked back boot
    {
      x: 11, y: 20,
      rows: [
        '...gGGg....',
        '...gGGsg...',
        '...gGssg...',
        '...gsss....',
        '..gs..gg...',
        '.ww...WW...',
        'wWw...WWw..',
        'KKw...WWw..',
        '.....WWBWW.',
        '.....KKKKK.'
      ]
    },
    // Frame 2: Passing / Opposite Contact (y=19..29, 11 rows) - opposite stride, crisp leg swap
    {
      x: 10, y: 19,
      rows: [
        '....gGGg.....',
        '....gGGsg....',
        '....gGssg....',
        '....gsss.....',
        '...gg..gs....',
        '..gg....gs...',
        '..WW....ww...',
        '.WWw....wWw..',
        '.WWw.....wWw.',
        'WWBW.....wWw.',
        'KKKK.....KKw.'
      ]
    },
    // Frame 3: Up/Stretch (y=18..28, 11 rows) - airborne knee drive + rear toe push-off (y=28 raw -> y=29 outlined)
    {
      x: 11, y: 18,
      rows: [
        '...gGGg.......',
        '...gGGsg......',
        '...gGssg......',
        '...gsss.......',
        '..gs..gg......',
        '..gs...gg.....',
        '.ww.....WW....',
        '.wWw....WWBW..',
        'wWw.....KKKK..',
        'wWw...........',
        'KK............'
      ]
    }
  ];

  const headOffsets = [
    { x: 12, y: 10 }, // F0 Contact
    { x: 12, y: 11 }, // F1 Down/Squash
    { x: 12, y: 10 }, // F2 Passing
    { x: 12, y: 9 }   // F3 Up/Stretch
  ];

  const shieldOffsets = [
    { x: 18, y: 19 }, // F0 Contact
    { x: 19, y: 20 }, // F1 Down/Squash
    { x: 20, y: 19 }, // F2 Passing
    { x: 19, y: 18 }  // F3 Up/Stretch
  ];

  for (let i = 0; i < 4; i++) {
    const f = sheet.frame(i, 0);
    // Layer order: flowing S-curve cape -> body & stride legs -> moss helmet -> twin-leaf sprout -> front wooden buckler
    f.stamp(capes[i].x, capes[i].y, capes[i].rows, palette);
    f.stamp(bodiesAndLegs[i].x, bodiesAndLegs[i].y, bodiesAndLegs[i].rows, palette);
    f.stamp(headOffsets[i].x, headOffsets[i].y, helmet, palette);
    f.stamp(sprouts[i].x, sprouts[i].y, sprouts[i].rows, palette);
    f.stamp(shieldOffsets[i].x, shieldOffsets[i].y, buckler, palette);

    // Palette-locked selective outline (4-way, zero palette bloat)
    f.outline('selout', { palette });
  }

  return sheet;
}
