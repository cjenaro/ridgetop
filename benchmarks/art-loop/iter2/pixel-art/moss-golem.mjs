import { createSpriteSheet, hueShiftRamp, auditSpriteSheet } from '../../../../packages/ridgetop/dist/framework/index.js';

export function build() {
  const stone = hueShiftRamp('#788996');
  const moss = hueShiftRamp('#4c8f52');
  const amber = hueShiftRamp('#f09d32', { highlightHue: 54 });

  const palette = {
    K: '#141c2c',       // shared deep cool ink, sunken face cavity, recessed stone cracks
    d: stone.dark,      // deep recessed stone shadow & crevices
    s: stone.shade,     // cool shadowed stone plane
    S: stone.mid,       // weathered ancient stone surface
    L: stone.light,     // angular upper-left lit stone bevel
    H: stone.highlight, // crisp top-left chiseled stone edge glint
    m: moss.dark,       // overhanging moss underside shadow
    v: moss.shade,      // deep moss folds & tendril roots
    M: moss.mid,        // lush moss carpet body
    G: moss.light,      // sunlit upper moss tufts
    T: moss.highlight,  // bright sunlit crown moss tips
    a: amber.dark,      // warm burnt-amber bounce light on neighboring stone
    A: amber.mid,       // glowing amber-gold rune & eye halo
    Y: '#fff4c2'        // blazing pale-gold rune & eye core
  };

  const sheet = createSpriteSheet(40, 40, 2, 1);

  // Planted stubby stone legs & feet (STAY PLANTED at y=36 raw -> y=37 outlined; footDriftPx === 0)
  // Left foot x=14..17, 4px arch gap x=18..21, right foot x=22..25
  const plantedLegs = [
    '.LSs....Sss.', // y=31 pelvis join
    'HLSsd...Sssd', // y=32 knee bevels
    'LLSsd...SSsd', // y=33 shins
    'LSSd....SSsd', // y=34
    'HLLSd..LSSsd', // y=35 grounded foot bevel
    'dSSdd..dSSdd'  // y=36 flat planted soles
  ];

  // Planted massive asymmetric boulder fists (STAY PLANTED at y=36 raw -> y=37 outlined!)
  // Left massive boulder fist at x=4, y=28 (x=4..10, 3px gap to left foot at x=14)
  const leftFist = [
    '.HLLSS.', // y=28 wrist join
    'HLLSSsd', // y=29 broad boulder back
    'HLLSKsd', // y=30 recessed stone crack
    'LLSSKsd', // y=31
    'LSSSdss', // y=32 knuckle facet
    'LSsKSsd', // y=33 knuckle cleft
    'SSdKssd', // y=34
    'Sssddsd', // y=35 heavy grounded knuckles
    '.ddddd.'  // y=36 planted flat base
  ];

  // Right heavy boulder fist at x=29, y=29 (x=29..34, 3px gap from right foot at x=25)
  const rightFist = [
    '.LLSS.', // y=29 wrist join
    'LLSSsd', // y=30 boulder back
    'LSSKsd', // y=31 stone crack
    'LSKdss', // y=32
    'SSsKsd', // y=33 knuckle cleft
    'Ssdssd', // y=34
    'Ssddsd', // y=35 grounded knuckles
    '.dddd.'  // y=36 planted flat base
  ];

  // Connecting heavy upper arms (stretch smoothly from planted fists up to heaving shoulders, preserving wide armpit negative space!)
  const leftUpperArms = [
    // Frame 0 (Rest): y=18..28 at x=5..10
    {
      x: 5, y: 18,
      rows: [
        '.HLLSS',
        'HLLSSs',
        'HLLKss',
        'LLSKsd',
        'LSSsd.',
        'LSSd..',
        'LSsd..',
        'LLSsd.',
        'HLLSs.',
        'HLLSS.',
        '.LLSS.'
      ]
    },
    // Frame 1 (Inhale): shoulder end heaves UP 2px (y=16..28), forearm stays locked into planted fist!
    {
      x: 5, y: 16,
      rows: [
        '.HLLSS',
        'HLLSSs',
        'HLLKss',
        'LLSKsd',
        'LSSsd.',
        'LSSd..',
        'LSSd..',
        'LSsd..',
        'LLSsd.',
        'HLLSs.',
        'HLLSs.',
        'HLLSS.',
        '.LLSS.'
      ]
    }
  ];

  const rightUpperArms = [
    // Frame 0 (Rest): y=19..29 at x=29..34
    {
      x: 29, y: 19,
      rows: [
        'LLSSs.',
        'LLSSsd',
        'LSKSsd',
        'LSKssd',
        '.SSsd.',
        '..SSd.',
        '..SSd.',
        '..LSs.',
        '.LLSs.',
        '.LLSS.',
        '.LLSS.'
      ]
    },
    // Frame 1 (Inhale): shoulder end heaves UP 2px (y=17..29), forearm stays locked into planted fist!
    {
      x: 29, y: 17,
      rows: [
        'LLSSs.',
        'LLSSsd',
        'LSKSsd',
        'LSKssd',
        '.SSsd.',
        '..SSd.',
        '..SSd.',
        '..SSd.',
        '..LSs.',
        '.LLSs.',
        '.LLSs.',
        '.LLSS.',
        '.LLSS.'
      ]
    }
  ];

  // Compact heavy beveled stone chest + carved glowing chest rune + tight tapered waist
  const torsos = [
    // Frame 0 (Rest): x=14..25, y=19..31
    {
      x: 14, y: 19,
      rows: [
        'HLLSSSSSssdd', // y=19 upper chest bevel
        'HLLSaAKSSssd', // y=20 rune top
        'LLSSaAYaSssd', // y=21 rune diamond glow
        'LLSaAYYAaSsd', // y=22 bright core + warm stone bounce
        'LSSKaAAaKSsd', // y=23 carved chevron cleft
        '.LSSaAYasSd.', // y=24 lower rune tip
        '.LSSsaasSSd.', // y=25 warm bounce light
        '..LSKSSsSd..', // y=26 diagonal stone crack
        '..LSKdssdd..', // y=27 tapered waist!
        '..LSSssdd...', // y=28 narrow pelvis -> crisp negative space!
        '..LSSssdd...', // y=29
        '..LSSssdd...', // y=30
        '..LSssddd...'  // y=31 seamless join to planted legs
      ]
    },
    // Frame 1 (Inhale): chest heaves UP 1px (y=18..31), rune & warm amber bounce flare dramatically!
    {
      x: 14, y: 18,
      rows: [
        'HLLSSSSSssdd', // y=18 heaved up 1px
        'HLLSaAAaSssd', // y=19 bright flare top
        'LLSaAYYAaSsd', // y=20 blazing rune flare!
        'LLSaAYYYaSsd', // y=21 expanded pale-gold core
        'LSSaAYYAaSsd', // y=22 warm amber bounce blooms onto stone bevels
        '.LSKaAYaKSd.', // y=23
        '.LSSaAAasSd.', // y=24
        '..LSKaaSSd..', // y=25
        '..LSKdssdd..', // y=26
        '..LSSssdd...', // y=27
        '..LSSssdd...', // y=28
        '..LSSssdd...', // y=29
        '..LSSssdd...', // y=30
        '..LSssddd...'  // y=31 keeps seamless pelvic join while chest heaves!
      ]
    }
  ];

  // Hunched asymmetric stone shoulders + sunken dark face cavity + glowing amber eyes
  // Towering left monolith + lower stepped right shoulder + deep valley notch above mossy brow; heaves UP 2px in Frame 1!
  const shouldersAndFace = [
    // Frame 0 (Rest): x=7..32, y=9..19
    {
      x: 7, y: 9,
      rows: [
        '...HLLSSs.................', // y=9  high left monolith peak
        '.HHLLSSSss................', // y=10 angular top-left lit stone bevel
        'HHLLSKSSssd.......LLSSs...', // y=11 asymmetric lower right shoulder!
        'HLLSSKSSssd.....LLLSSSss..', // y=12 stone cracks + bevel planes
        'HLLSSSSSKKKKKK..LLLSSssdd.', // y=13 sunken dark face cavity starts
        'LLSSSSSKKKKKKKKLLSSKSssdd.', // y=14 overhanging shadow cavity
        'LLSSSSKKYAaKYAKKSSSKssdd..', // y=15 glowing amber-gold rune eyes!
        '.LLSSsKKAAKKAAKKSSssddd...', // y=16 lower eye glow
        '.LSSssKKKKKKKKKKSSssdd....', // y=17 dark lower jaw recess
        '..SSsd..KKKKKK..SSsdd.....', // y=18 collar shadow
        '.......dddddddd...........'  // y=19 seamless chest join
      ]
    },
    // Frame 1 (Inhale): heaved UP 2px (y=7..18) + blazing flared amber eyes!
    {
      x: 7, y: 7,
      rows: [
        '...HLLSSs.................', // y=7
        '.HHLLSSSss................', // y=8
        'HHLLSKSSssd.......LLSSs...', // y=9
        'HLLSSKSSssd.....LLLSSSss..', // y=10
        'HLLSSSSSKKKKKK..LLLSSssdd.', // y=11
        'LLSSSSSKKaKKaKKLLSSKSssdd.', // y=12 warm brow bounce from flaring eyes!
        'LLSSSSKYYaKYYaKKSSSKssdd..', // y=13 blazing flared amber eyes!
        '.LLSSsKAAaKAAaKKSSssddd...', // y=14 strong glowing halo
        '.LSSssKKaKKKKaKKSSssdd....', // y=15
        '..SSsd..KKKKKK..SSsdd.....', // y=16
        '.......dddddddd...........', // y=17
        '.......LSSSSsdd...........'  // y=18 solid neck/chest bridge as shoulders heave!
      ]
    }
  ];

  // Lush overhanging moss carpet, mossy brow, and varied-length draped tendrils
  // Deep valley notch above brow + distinct hanging tendril silhouettes; canopy lifts 2px in Frame 1 while tips sway 1px!
  const mossDrapes = [
    // Frame 0 (Rest): x=5..34, y=7..18
    {
      x: 5, y: 7,
      rows: [
        '....TTGGMMv...................', // y=7  sunlit moss crown on high left monolith
        '..TTGGGMMMv...................', // y=8
        '.TGGGMMMMvvv........GGMMv.....', // y=9  deep asymmetric saddle valley!
        '.TGGMMMMvvvm..GGMMv.GGGMMvv...', // y=10 lush mossy brow ridge
        '.GGMMvvmm..mmTGGMMvvGGMMMvv...', // y=11 overhanging mossy brow dips over dark face!
        '.GMvvmm.....mGGMvmmvGMMMvvmm..', // y=12 ragged organic moss edge
        '.Mvvmm.......mvvmm..vMMvvmm...', // y=13
        '.Mvm..........mm.....vmm..mv..', // y=14 varied draped tendrils!
        '.vm..................mm...mv..', // y=15 left & right hanging tendrils
        '.vm.......................vm..', // y=16
        '.m........................vm..', // y=17
        '..........................m...'  // y=18 long right vine tip
      ]
    },
    // Frame 1 (Inhale): canopy lifts 2px (y=5..16), dangling tendrils sway 1px outward with organic drag!
    {
      x: 5, y: 5,
      rows: [
        '....TTGGMMv...................', // y=5
        '..TTGGGMMMv...................', // y=6
        '.TGGGMMMMvvv........GGMMv.....', // y=7
        '.TGGMMMMvvvm..GGMMv.GGGMMvv...', // y=8
        '.GGMMvvmm..mmTGGMMvvGGMMMvv...', // y=9
        '.GMvvmm.....mGGMvmmvGMMMvvmm..', // y=10
        'GMvvmm.......mvvmm..vMMvvmm...', // y=11 outer tendril sways 1px outward
        'Mvm...........mm.....vmm..mv..', // y=12
        'vm...................mm...mv..', // y=13
        'vm........................mv..', // y=14 right outer tendril sways smoothly without gap
        'm.........................vmm.', // y=15
        '..........................mm..'  // y=16
      ]
    }
  ];

  // Small moss tuft perched on left boulder wrist (stays grounded with 1px rustle!)
  const forearmMoss = [
    { x: 4, y: 26, rows: ['.GGMv', 'GMvm.', 'vm...'] },
    { x: 4, y: 26, rows: ['.TGMv', 'GGvm.', '.vm..'] }
  ];

  for (let i = 0; i < 2; i++) {
    const f = sheet.frame(i, 0);

    // Layer order: planted legs -> tapered beveled torso -> upper arms -> planted boulder fists -> hunched shoulders & dark face cavity -> lush overhanging moss & tendrils
    f.stamp(14, 31, plantedLegs, palette);
    f.stamp(torsos[i].x, torsos[i].y, torsos[i].rows, palette);
    f.stamp(leftUpperArms[i].x, leftUpperArms[i].y, leftUpperArms[i].rows, palette);
    f.stamp(rightUpperArms[i].x, rightUpperArms[i].y, rightUpperArms[i].rows, palette);
    f.stamp(4, 28, leftFist, palette);
    f.stamp(29, 29, rightFist, palette);
    f.stamp(shouldersAndFace[i].x, shouldersAndFace[i].y, shouldersAndFace[i].rows, palette);
    f.stamp(mossDrapes[i].x, mossDrapes[i].y, mossDrapes[i].rows, palette);
    f.stamp(forearmMoss[i].x, forearmMoss[i].y, forearmMoss[i].rows, palette);

    // Palette-locked selective outline (4-way, zero palette bloat)
    f.outline('selout', { palette });
  }

  return sheet;
}
