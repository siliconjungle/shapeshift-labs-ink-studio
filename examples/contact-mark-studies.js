/* Two contact cels in motion. The tools hold on the contact while the marks advance. */
const { rect, line, fill, pixel } = require('./pixel-stamp-studies.js');
const W = 272, H = 158, U = .038, DIST = 10, LOOP = 3.2;
const point = (x, y) => [(x + .5 - W / 2) * U, (H / 2 - y - .5) * U, 0];
const cycle = t => ((t % LOOP) + LOOP) % LOOP;

function paint(K, colors, width = W, height = H) {
  const strokes = [], slots = new Map(Object.keys(colors).map((key, i) => [key, i]));
  const font = K.inspection.font({});
  return {
    box: (name, ...bounds) => strokes.push(rect(slots.get(name), ...bounds)),
    path: (name, points, weight) => strokes.push(line(slots.get(name), points, weight)),
    poly: (name, points) => strokes.push(fill(slots.get(name), points)),
    dot: (name, x, y) => strokes.push(pixel(slots.get(name), x, y)),
    text(name, value, x, y) {
      for (const [i, ch] of [...value].entries()) {
        const glyph = font.get(ch);
        for (let v = 0; v < 8; v++) for (let u = 0; u < 6; u++)
          if (glyph[v * 6 + u]) strokes.push(pixel(slots.get(name), x + i * 6 + u, y + v));
      }
    },
    image: () => K.pixelStamps.image({ width, height, palette: Object.values(colors), strokes })
  };
}

function blit(rgba, art, left, top) {
  for (let y = Math.max(0, -top); y < Math.min(art.height, H - top); y++)
    for (let x = Math.max(0, -left); x < Math.min(art.width, W - left); x++) {
      const i = (y * art.width + x) * 4;
      if (art.rgba[i + 3]) rgba.set(art.rgba.subarray(i, i + 4), ((y + top) * W + x + left) * 4);
    }
}

function bell(K, seed) {
  const palette = {
    base: '#111725', vault: '#192333', masonry: '#202b3d', joints: '#151e2c', pale: '#9ab3b7',
    dark: '#211c28', brassShade: '#533340', copper: '#865044', gold: '#bc774e',
    light: '#e3a867', paleGold: '#f9d496', mouth: '#171c27', steel: '#48546a', brightSteel: '#758595',
    wood: '#56343a', warm: '#bb7354'
  };
  const art = paint(K, palette), { box, poly, path, dot } = art, random = K.grow.dice(seed);
  box('base', 0, 0, W, H);
  art.text('pale', 'FOUNDRY BELL', 14, 10);
  path('masonry', [[14, 22], [258, 22]]);
  poly('vault', [[16, 139], [16, 52], [45, 32], [228, 32], [256, 52], [256, 139]]);
  poly('base', [[49, 139], [49, 60], [68, 47], [197, 47], [224, 66], [224, 139]]);
  for (const [x, side] of [[24, 1], [248, -1]]) {
    for (let y = 55; y < 137; y += 11) {
      path('joints', [[x - 5, y], [x + side * 19, y]]);
      path('masonry', [[x, y + 1], [x + side * 12, y + 1]]);
    }
    path('masonry', [[x, 55], [x + side * 29, 34], [131, 34]]);
    box('joints', x - 2, 71, 6, 67);
  }
  box('joints', 46, 128, 181, 11);
  box('masonry', 50, 129, 168, 2);
  for (let i = 0; i < 86; i++) {
    const x = 21 + random() * 229, y = 41 + random() * 93;
    if (x < 68 || x > 167) dot(i % 3 === 0 ? 'masonry' : 'vault', x, y);
  }
  path('steel', [[74, 36], [143, 36]]);
  box('brassShade', 107, 32, 15, 20);
  box('gold', 107, 38, 3, 12);
  box('copper', 112, 37, 9, 11);
  const skirt = [[93, 43], [105, 39], [124, 39], [137, 44], [147, 54], [152, 66],
    [155, 82], [159, 91], [166, 99], [168, 105], [162, 111], [67, 111],
    [60, 106], [62, 100], [70, 92], [73, 81], [76, 65], [81, 53]];
  poly('dark', skirt);
  poly('brassShade', [[95, 44], [107, 41], [125, 41], [139, 48], [149, 63], [155, 84],
    [159, 94], [166, 103], [162, 107], [65, 107], [63, 103], [72, 91], [77, 66], [82, 54]]);
  poly('copper', [[96, 46], [107, 43], [120, 43], [133, 50], [141, 62], [144, 81],
    [150, 94], [155, 98], [71, 98], [78, 83], [81, 63], [86, 53]]);
  poly('gold', [[98, 47], [104, 45], [113, 45], [120, 50], [125, 64], [127, 83],
    [134, 96], [77, 96], [84, 82], [87, 64], [91, 54]]);
  poly('light', [[101, 48], [107, 46], [111, 49], [114, 60], [113, 78], [116, 93],
    [91, 95], [93, 82], [91, 67], [95, 55]]);
  path('paleGold', [[105, 48], [99, 52], [96, 62], [97, 77], [95, 89]]);
  path('gold', [[132, 52], [142, 63], [145, 83], [152, 94]]);
  path('gold', [[72, 93], [89, 90], [122, 90], [150, 92], [159, 95]]);
  path('light', [[70, 98], [86, 94], [119, 93], [150, 95], [162, 100]]);
  path('gold', [[65, 102], [92, 97], [126, 97], [155, 99], [165, 103]], 2);
  poly('mouth', [[62, 105], [73, 101], [96, 100], [143, 101], [163, 103], [167, 106],
    [157, 113], [137, 115], [89, 115], [69, 111]]);
  path('copper', [[66, 105], [88, 103], [137, 103], [162, 105]]);
  path('gold', [[63, 106], [70, 111], [94, 114], [144, 114], [163, 110], [167, 106]]);
  box('brassShade', 111, 106, 6, 10);
  poly('copper', [[111, 114], [117, 114], [119, 118], [116, 121], [111, 121], [108, 118]]);
  path('light', [[109, 117], [111, 115], [114, 115]]);
  for (let x = 82; x < 150; x += 8) dot('brassShade', x, 94 + Math.floor((x - 112) ** 2 / 480));
  path('masonry', [[184, 108], [187, 114], [231, 114], [242, 107]]);
  path('steel', [[186, 108], [200, 108], [204, 112], [229, 112]]);
  for (const x of [211, 222, 233]) box('joints', x, 120, 7, 4);

  const head = paint(K, palette, 76, 24);
  head.poly('mouth', [[8, 5], [25, 5], [30, 9], [74, 9], [74, 15], [30, 15], [24, 20], [8, 20], [5, 17], [5, 8]]);
  head.box('wood', 28, 10, 46, 5);
  head.path('warm', [[32, 10], [48, 10], [52, 11], [73, 11]]);
  head.poly('steel', [[8, 7], [24, 7], [28, 10], [28, 15], [24, 18], [8, 18], [6, 16], [6, 9]]);
  head.path('brightSteel', [[7, 9], [9, 7], [23, 7], [26, 9]]);
  head.path('masonry', [[10, 16], [23, 16], [26, 14]]);
  head.path('pale', [[8, 9], [8, 14]]);
  head.dot('pale', 23, 11);
  const time = 1.2, x = 159, y = 95;
  return { base: art.image(), tool: head.image(), pivot: [5, 12],
    keys: [[0, [221, 95]], [.47, [221, 95]], [.76, [229, 93]], [1.02, [203, 94]],
      [time, [x, y]], [1.36, [180, 95]], [1.87, [221, 95]], [LOOP, [221, 95]]],
    contacts: [{ time, hold: .12, data: { point: point(x, y), normal: [1, .12, 0], velocity: [-11, -.15, 0] } }]
  };
}

function rail(K, seed) {
  const palette = {
    base: '#121828', wall: '#1d283a', seams: '#283748', navy: '#151f2e', pale: '#a8bbc4',
    plate: '#334454', steel: '#5d7483', light: '#94a9ae', black: '#121d29', track: '#1e2939',
    bronze: '#80564d', amber: '#bb7857', bright: '#e9ac75', white: '#ffe2ad'
  };
  const art = paint(K, palette), { box, path, poly, dot } = art, rand = K.grow.dice(seed + 12);
  box('base', 0, 0, W, H);
  art.text('pale', 'RIVET RAIL', 14, 10);
  path('seams', [[14, 22], [258, 22]]);
  poly('wall', [[13, 46], [32, 30], [240, 30], [258, 43], [258, 123], [235, 145], [13, 145]]);
  poly('navy', [[13, 91], [58, 64], [119, 64], [140, 42], [258, 42], [258, 45],
    [147, 45], [121, 69], [60, 69], [13, 96]]);
  for (const y of [37, 72, 105, 140]) for (let x = 26; x < 250; x += 6)
    dot(x % 5 === 0 ? 'plate' : 'seams', x, y);
  for (let i = 0; i < 105; i++) dot(i % 3 === 0 ? 'seams' : 'navy', 22 + rand() * 229, 39 + rand() * 96);
  for (const [x, y] of [[67, 129], [108, 107], [162, 78], [216, 48]]) {
    poly('black', [[x - 6, y], [x + 6, y - 6], [x + 9, y + 2], [x + 5, y + 17],
      [x - 4, y + 21], [x - 9, y + 12]]);
    path('steel', [[x - 6, y + 8], [x - 3, y + 15], [x + 1, y + 13]]);
    dot('light', x - 4, y + 8);
  }
  poly('black', [[38, 144], [50, 134], [227, 36], [241, 35], [245, 40], [241, 52],
    [57, 153], [42, 153], [36, 149]]);
  poly('track', [[40, 144], [50, 135], [228, 37], [240, 36], [241, 41], [237, 49],
    [56, 149], [43, 152]]);
  path('steel', [[45, 148], [52, 148], [236, 47], [239, 43]], 2);
  path('bronze', [[44, 141], [233, 37]], 4);
  path('amber', [[45, 139], [232, 36]], 2);
  path('bright', [[49, 139], [227, 41]]);
  for (let x = 58; x < 230; x += 11) {
    const y = Math.round(144 - (x - 45) * .55);
    path('black', [[x, y], [x + 1, y + 2]]);
    dot('light', x + 1, y);
  }
  const shoe = paint(K, palette, 56, 42);
  shoe.poly('black', [[4, 23], [10, 19], [18, 7], [39, 2], [52, 7], [54, 15],
    [44, 22], [33, 21], [24, 28], [22, 32], [10, 36], [4, 32]]);
  shoe.poly('plate', [[6, 24], [16, 19], [21, 10], [39, 5], [50, 8], [51, 14],
    [43, 19], [31, 19], [22, 25], [21, 30], [10, 34], [7, 30]]);
  shoe.poly('steel', [[8, 24], [17, 19], [23, 10], [39, 6], [48, 9], [44, 13],
    [28, 15], [22, 21], [20, 26], [9, 31]]);
  shoe.path('light', [[8, 25], [18, 20], [23, 12], [38, 7], [47, 9]]);
  shoe.path('black', [[11, 32], [18, 29], [22, 25], [27, 22]]);
  shoe.path('bright', [[12, 33], [18, 30], [21, 26]]);
  shoe.box('black', 33, 12, 6, 3);
  shoe.dot('white', 36, 13);
  const x = 124, y = 98, time = 1.12;
  const normal = [-.48, .88, 0], velocity = [7, 2.65, 0];
  return { base: art.image(), tool: shoe.image(), pivot: [12, 33],
    keys: [[0, [41, 125]], [.34, [54, 124]], [.67, [73, 124]], [.91, [101, 110]],
      [time, [x, y]], [1.37, [159, 76]], [1.64, [197, 58]], [1.88, [230, 36]],
      [2.06, [254, 14]], [2.27, [288, -16]], [2.28, [-65, 144]], [2.96, [41, 125]], [LOOP, [41, 125]]],
    contacts: [
      { time, hold: .08, data: { point: point(x, y), normal, velocity } },
      { time: 1.72, sourceTime: 1.64, hold: .04, data: { point: point(197, 58), normal, velocity, strength: .4 } }
    ]
  };
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'contact-mark-studies', name: 'Contact Mark Studies', seed: 47,
  build(seed, { controls: { study = 'bell' } = {} } = {}) {
    if (!['bell', 'rail'].includes(study)) throw new RangeError('Choose the bell or rail contact study');
    const shot = (study === 'bell' ? bell : rail)(K, seed);
    const clip = K.anim.clip({ id: 'tool', duration: LOOP, tracks: { 'head.xy': shot.keys },
      cues: shot.contacts.map(({ time, hold }, i) => K.anim.cue('hold-' + i, 'freeze', time, { duration: hold })),
      events: shot.contacts.map(({ time, sourceTime = time, data }) => ({ time: sourceTime, name: 'contact-mark', data })) });
    const track = K.contactMarks.create({ lift: 0 }).fromClip(clip, { period: LOOP });
    const source = ({ time }) => {
      const t = cycle(time), rgba = shot.base.rgba.slice();
      const [x, y] = clip.sample(t).head.xy.map(Math.round);
      blit(rgba, shot.tool, x - shot.pivot[0], y - shot.pivot[1]);
      return { w: W, h: H, rgba };
    };
    const markLayer = track.layer({ resolution: [W, H] });
    return makeBuilder(seed, [0x111725]).finish({
      cam: { target: [0, 0, 0], dist: DIST, yaw: 0, pitch: 0, projection: 'orthographic',
        sway: 0, fov: 2 * Math.atan(H * U / (2 * DIST)) },
      dither: 0, look: { composite: { world: { resolution: [W, H] },
        layers: [{ source, resolution: [W, H] }, markLayer] } }
    });
  }
});
