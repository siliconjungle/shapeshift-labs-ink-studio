/* Two materials, one tile-pulse layout tool. All artwork uses native pixels. */
const { rect, line, fill, pixel } = require('./pixel-stamp-studies.js');
const W = 280, H = 174;
const modulo = (n, length) => ((n % length) + length) % length;
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function plate(K, palette) {
  const marks = [];
  const slot = name => Object.keys(palette).indexOf(name);
  const font = K.inspection.font({});
  return {
    box: (name, ...bounds) => marks.push(rect(slot(name), ...bounds)),
    path: (name, points, width) => marks.push(line(slot(name), points, width)),
    poly: (name, points) => marks.push(fill(slot(name), points)),
    dot: (name, x, y) => marks.push(pixel(slot(name), x, y)),
    text(name, caption, x, y) {
      for (const [i, ch] of [...caption].entries()) {
        const ink = font.get(ch);
        for (let v = 0; v < 8; v++) for (let u = 0; u < 6; u++)
          if (ink[v * 6 + u]) marks.push(pixel(slot(name), x + i * 6 + u, y + v));
      }
    },
    image: () => K.pixelStamps.image({ width: W, height: H, palette: Object.values(palette), strokes: marks }).rgba
  };
}

function blit(target, source, left, top, amount = 1, under) {
  const { w, h, rgba } = source;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const pixels = under && bayer[(y % 4) * 4 + x % 4] + .5 > amount * 16 ? under.rgba : rgba;
    if (pixels[i + 3]) target.set(pixels.subarray(i, i + 4), ((y + top) * W + left + x) * 4);
  }
}

function circuit(K, seed) {
  const LOOP = 6, START = .84, left = 84, top = 42;
  const terminal = [1, 4];
  const network = K.pixelTiles.create({
    width: 18, height: 12, style: 'copper', forkHold: .13,
    paths: [
      [terminal, [6, 4], [6, 5], [10, 5], [10, 8], [14, 8]],
      [[6, 4], [6, 1], [11, 1]], [[9, 5], [9, 3], [14, 3]],
      [[10, 8], [10, 10], [15, 10]], [[12, 3], [12, 6], [15, 6]]
    ],
    cues: [{ at: terminal, time: START }]
  });
  const art = plate(K, {
    shell: '#101522', seam: '#18181e', bevel: '#32303e', edge: '#4e4954', brass: '#ad7852',
    panel: '#152628', lighter: '#1a3032', shadow: '#0b151b', track: '#253d3c', pad: '#52736b',
    glass: '#0a1520', glassEdge: '#192c37', grid: '#1b293b', pale: '#aec7c1', ink: '#cc9768',
    copper: '#6f4637', lit: '#e09958', spark: '#fff2c3'
  });
  const { box, path, poly, dot } = art;
  const rand = K.grow.dice(seed);
  box('shell', 0, 0, W, H);
  art.text('pale', 'COPPER RELAY', 15, 11);
  path('bevel', [[15, 23], [264, 23]]);
  poly('edge', [[13, 33], [20, 27], [251, 27], [271, 45], [271, 146], [252, 165], [16, 165], [9, 158], [9, 39]]);
  poly('bevel', [[14, 35], [21, 29], [250, 29], [269, 46], [269, 146], [252, 163], [17, 163], [11, 157], [11, 40]]);
  poly('shadow', [[16, 36], [23, 32], [248, 32], [265, 48], [265, 143], [250, 159], [19, 159], [14, 154], [14, 40]]);
  poly('panel', [[23, 35], [246, 35], [263, 49], [263, 143], [248, 157], [23, 157]]);
  poly('lighter', [[144, 35], [245, 35], [263, 50], [263, 69], [255, 78], [184, 78]]);
  poly('lighter', [[101, 137], [125, 115], [167, 115], [184, 130], [244, 130], [257, 148], [248, 157], [101, 157]]);
  for (let y = 41; y < 153; y += 5) for (let x = 100; x < 256; x += 5)
    if (rand() > .32) dot('track', x, y);
  for (const [x, y] of [[22, 42], [253, 48], [22, 149], [248, 148]]) {
    box('seam', x - 2, y - 2, 5, 5);
    path('brass', [[x - 1, y - 1], [x + 1, y + 1]]);
  }
  box('glassEdge', 26, 37, 64, 46);
  box('glass', 28, 38, 60, 44);
  for (let y = 40; y < 82; y += 4) for (let x = 29; x < 88; x += 4) dot('grid', x, y);
  box('copper', 27, 84, 65, 7);
  path('brass', [[28, 84], [90, 84], [95, 88], [101, 88]]);
  path('shadow', [[30, 89], [88, 89], [96, 93], [106, 93]]);
  path('copper', [[29, 90], [29, 137], [65, 137], [75, 147], [95, 147]]);
  path('brass', [[33, 91], [33, 134], [65, 134], [75, 144], [89, 144]]);
  for (let i = 0; i < 8; i++) {
    box('seam', 39 + i * 5, 102, 3, 22);
    box(i % 3 === 0 ? 'brass' : 'track', 39 + i * 5, 104, 2, 17);
  }
  path('track', [[109, 59], [118, 51], [132, 51]]);
  path('track', [[115, 150], [127, 139], [153, 139], [162, 147], [175, 147]]);
  path('pad', [[235, 43], [240, 47], [240, 57], [248, 64]]);
  path('track', [[230, 43], [236, 49], [236, 58], [245, 67], [254, 67]]);
  path('pad', [[207, 100], [215, 91], [241, 91], [252, 81], [255, 81]]);
  for (const y of [99, 136]) for (let x = 110; x < 148; x += 4) box('track', x, y, 2, 4);
  for (const { x, y, kind } of network.cells) {
    if (kind !== 'cap' && kind !== 'fork') continue;
    const px = left + x * 10 + 5, py = top + y * 10 + 5;
    poly('shadow', [[px - 6, py - 3], [px - 3, py - 6], [px + 3, py - 6], [px + 6, py - 3],
      [px + 6, py + 3], [px + 3, py + 6], [px - 3, py + 6], [px - 6, py + 3]]);
    path('pad', [[px - 5, py - 3], [px - 3, py - 5], [px + 3, py - 5]]);
  }
  const base = art.image();
  const glyphs = ['cross', 'ring', 'four-dot', 'outline-cross', 'split-cross'].map(id => {
    const spec = K.pixelStamps.clip('glyph-' + id, { swatches: {
      residue: '#283747', dim: '#638693', lit: '#b7c8bc', peak: '#fff4d8'
    } });
    let elapsed = 0;
    return spec.frames.map(({ duration }) => {
      const { width: w, height: h, rgba } = K.pixelStamps.image(spec, { time: elapsed + duration / 2 });
      elapsed += duration;
      return { w, h, rgba };
    });
  });
  return time => {
    const t = modulo(time, LOOP), rgba = base.slice();
    for (let col = 0; col < 6; col++) for (let row = 0; row < 5; row++) {
      const age = modulo(t * (6 + col) + 2.3 * col - row, 6 + col);
      const art = glyphs[(row * 2 + col) % glyphs.length][age < 1 ? 1 : age < 2.3 ? 2 : 3];
      blit(rgba, art, 32 + col * 8, 38 + row * 9);
    }
    // The leading packet crosses the tray on the same clock that starts the route.
    for (let i = 0; i < 5; i++) {
      const y = Math.floor(78 + (t - START) * 60 - i * 8);
      if (y >= 38 && y <= 78) blit(rgba, glyphs[i][i === 0 ? 1 : 2], 74, y);
    }
    if (t >= START && t < START + .31) {
      const edge = Math.min(31, Math.floor((t - START) * 150));
      for (let x = 79; x < 79 + edge; x++) if (x < 102)
        rgba.set([255, 216, 130, 255], ((x < 92 ? 85 : 87) * W + x) * 4);
    }
    blit(rgba, network.raster(t), left, top);
    return { w: W, h: H, rgba };
  };
}

function frost(K, seed) {
  const LOOP = 8, left = 27, top = 37;
  const network = K.pixelTiles.create({
    width: 22, height: 10, style: 'frost', after: 'hold', forkHold: .14,
    paths: [
      [[0, 9], [20, 9], [20, 0], [2, 0], [2, 9]],
      [[10, 0], [10, 9]], [[2, 4], [20, 4]], [[2, 7], [1, 7], [1, 5]],
      [[15, 9], [15, 7], [16, 7]], [[20, 3], [21, 3], [21, 1]]
    ],
    cues: [{ at: [0, 9], time: .48 }]
  });
  const art = plate(K, {
    room: '#121522', roomLight: '#1a2130', wall: '#222939', woodDark: '#2a2632', wood: '#483439',
    woodLight: '#754f4a', copper: '#b77a59', light: '#e8c699', shade: '#253949', glass: '#15263b',
    sky: '#1e384e', horizon: '#335064', star: '#79989e', moon: '#e5dec4', halo: '#b9beb1',
    distant: '#405e6b', snow: '#758f93', snowLight: '#b3b8aa', tree: '#182d3a', needles: '#2a4955',
    ink: '#a3bec4'
  });
  const { box, path, poly, dot } = art;
  const rand = K.grow.dice(seed + 7);
  box('room', 0, 0, W, H);
  box('roomLight', 0, 30, W, 126);
  for (let x = 10; x < W; x += 16) path('wall', [[x, 32], [x, 156]]);
  art.text('ink', 'RIME WINDOW', 15, 11);
  path('wall', [[15, 23], [264, 23]]);
  poly('woodDark', [[34, 32], [46, 27], [242, 27], [252, 36], [252, 142], [237, 152], [34, 152]]);
  box('wood', 39, 29, 207, 116);
  box('woodLight', 43, 34, 199, 106);
  box('shade', 48, 37, 189, 98);
  box('glass', 53, 42, 179, 90);
  box('sky', 53, 62, 179, 70);
  box('horizon', 53, 79, 179, 53);
  poly('halo', [[175, 49], [180, 46], [188, 46], [194, 51], [195, 59], [190, 65], [181, 66], [174, 61], [173, 54]]);
  poly('moon', [[177, 50], [182, 47], [187, 47], [192, 51], [193, 57], [190, 61], [184, 63], [178, 60], [175, 56]]);
  for (let i = 0; i < 75; i++) {
    const x = 55 + Math.floor(rand() * 174), y = 44 + Math.floor(rand() * 53);
    if (x > 174 && x < 195 && y < 66) continue;
    dot(i % 7 === 0 ? 'halo' : 'star', x, y);
  }
  poly('distant', [[53, 90], [72, 74], [94, 63], [110, 83], [119, 79], [142, 101], [158, 86], [176, 74],
    [187, 83], [205, 71], [232, 92], [232, 132], [53, 132]]);
  poly('snow', [[60, 87], [78, 75], [94, 63], [109, 82], [101, 78], [97, 79], [93, 75], [82, 80], [77, 80]]);
  poly('snowLight', [[80, 75], [94, 63], [103, 75], [95, 71], [91, 76]]);
  poly('snow', [[186, 85], [205, 71], [222, 84], [205, 77], [199, 83]]);
  poly('snow', [[53, 115], [81, 105], [102, 108], [126, 100], [153, 104], [170, 101],
    [196, 106], [212, 101], [232, 104], [232, 132], [53, 132]]);
  path('snowLight', [[93, 116], [116, 112], [128, 114], [151, 112], [163, 113]]);
  path('snowLight', [[153, 124], [177, 120], [196, 121], [206, 117]]);
  for (const [x, y, h] of [[59, 126, 26], [68, 128, 21], [79, 125, 16], [92, 131, 18],
    [166, 129, 14], [196, 129, 18], [208, 128, 24], [222, 131, 29], [228, 131, 22]]) {
    poly('tree', [[x, y - h], [x + 3, y - h / 2], [x + 6, y - 3], [x + 1, y - 3],
      [x + 1, y], [x - 1, y], [x - 1, y - 3], [x - 6, y - 3], [x - 3, y - h / 2]]);
    path('needles', [[x, y - h + 4], [x - 2, y - h / 2], [x - 3, y - 5]]);
  }
  box('woodDark', 129, 40, 7, 94);
  box('shade', 131, 40, 4, 94);
  box('woodDark', 50, 78, 185, 8);
  box('shade', 50, 80, 185, 4);
  path('woodLight', [[51, 38], [51, 133], [232, 133]]);
  path('woodDark', [[232, 42], [232, 133]]);
  poly('woodLight', [[26, 138], [249, 138], [260, 146], [253, 151], [28, 151], [19, 145]]);
  box('wood', 26, 146, 224, 5);
  path('copper', [[28, 140], [248, 140]]);
  path('woodDark', [[35, 143], [106, 143], [117, 141], [170, 141], [177, 143], [244, 143]]);
  box('woodDark', 29, 151, 221, 5);
  poly('woodDark', [[18, 150], [33, 150], [36, 153], [32, 156], [18, 156], [15, 154]]);
  box('copper', 22, 139, 7, 12);
  box('light', 22, 139, 1, 11);
  poly('copper', [[25, 137], [22, 134], [26, 128], [28, 134], [27, 137]]);
  poly('light', [[25, 136], [24, 134], [26, 130], [26, 136]]);
  const base = art.image(), dry = network.raster(0);
  return time => {
    const t = modulo(time, LOOP), rgba = base.slice();
    const hold = Math.max(0, Math.min(1, (7.92 - t) / 1.12));
    blit(rgba, network.raster(t), left, top, hold, dry);
    return { w: W, h: H, rgba };
  };
}

module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'tile-pulse-studies', name: 'Tile Pulse Studies', seed: 39,
  build(seed, { controls: { study = 'copper' } = {} } = {}) {
    if (!['copper', 'frost'].includes(study)) throw new RangeError('Choose the copper or frost tile study');
    const image = (study === 'copper' ? circuit : frost)(K, seed);
    return makeBuilder(seed, [0x101522]).finish({ dither: 0,
      look: { composite: { world: { resolution: [8, 8] },
        layers: [{ source: ({ time }) => image(time), resolution: [W, H], filter: 'nearest' }] } }
    });
  }
});
