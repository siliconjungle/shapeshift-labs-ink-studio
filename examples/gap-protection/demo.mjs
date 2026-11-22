import { createRenderer } from '../../src/webgl/renderer.mjs';

const $ = id => document.getElementById(id);
const width = 48, height = 40, distance = 7;
const pixel = 2 * distance * Math.tan(19 * Math.PI / 180) / height;
const colors = [0x101d2a, 0x1a3642, 0x27525b, 0x387881, 0x50a49e, 0x81d6b4, 0xc7eac9, 0xf3bd77, 0xffe1a1];
const ink = { d: 1, s: 2, m: 3, t: 4, h: 5, l: 6, e: 7, w: 8, a: 4, b: 5 };
const rows = [
  [12, 't'],
  [11, 'thm'],
  [10, 'mhltt'],
  [9,  'sthlhtms'],
  [8,  'sthlhhtmms'],
  [7,  'smtlhlhttmmd'],
  [6,  'dmttlhhlttmmsd'],
  [5,  'sdmttlhhhlttmmsds'],
  [5,  'stsmttllhlttmmsds'],
  [4,  'smtdmthllhttmmsdms'],
  [4,  'smtmdttllhttmsdmms'],
  [5,  'stmdmthhlttmsdmd'],
  [5,  'sdmdsthlhttmsdsd'],
  [6,  'sdmsdhtttmsdsd'],
  [7,  'dsstdsetewsds'],
  [8,  'mdmstdwwmsd'],
  [7,  'dmmsmtlmtsdmd'],
  [7,  'msdsmttbmtsds'],
  [6,  'msd.mta btm.dsd'],
  [6,  'md..sta btm..ds'],
  [5,  'msd..mha bhm...ds'],
  [4,  'mms...tha bhs....ds'],
  [3,  'mmd....tha bhs.....ds'],
  [3,  'ms.....mha bh.......sd'],
  [2,  'ms......mha b........ds'],
  [2,  's......tm. s..........s'],
  [1,  's......ts..s...........d'],
  [8,  'ms...s'],
  [7,  'ms.....s'],
  [7,  's'],
];
const rule = { select: { tag: 'middle-tentacle-gap' }, protectGaps: true };
function specimen(foreground) {
  const b = makeBuilder(89, colors);
  function dab(x, y, z, color, size = .24) {
    b.disc((x + .5 - width / 2) * pixel, (height / 2 - y - .5) * pixel, z,
      [0, 0, 1], size * pixel, .008, b.P[color], 3);
  }
  // Small distant glints give the opening the same color as the surrounding water.
  for (const [x, y, color] of [[5, 8, 2], [10, 18, 1], [9, 31, 2], [36, 11, 2], [38, 20, 1],
    [40, 16, 3], [30, 5, 1], [6, 22, 1], [34, 33, 2], [26, 36, 1], [24, 28, 2]]) dab(x, y, -.85, color);
  rows.slice().reverse().forEach(([left, row], index) => {
    const y = rows.length - 1 - index + 4;
    for (const [column, glyph] of [...row].entries()) {
      if (!ink[glyph]) continue;
      const x = left + column + 11, start = b.count();
      dab(x, y, glyph === 'a' || glyph === 'b' ? 0 : .08, ink[glyph]);
      if (glyph === 'a' || glyph === 'b') {
        b.describeSplats(start, b.count(), {
          object: glyph === 'a' ? 'left tentacle' : 'right tentacle',
          target: { tags: ['middle-tentacle-gap'] }
        });
      }
    }
  });
  if (foreground) {
    for (const [x, y, c] of [[23, 26, 7], [24, 26, 8], [23, 27, 7], [24, 27, 7], [25, 27, 3], [24, 28, 3]])
      dab(x, y, .55, c);
  }
  return b.finish({ cam: { target: [0, 0, 0], yaw: 0, pitch: 0, dist: distance, ortho: true },
    radius: 8, dither: 0, fog: { start: 1, max: 0 } });
}

const offscreen = document.createElement('canvas');
const panels = ['standard', 'protected'].map(id => ({
  view: $(id).getContext('2d', { alpha: false }),
  detail: $(id + '-detail').getContext('2d', { alpha: false })
}));
const source = [false, true].map(foreground => {
  const world = specimen(foreground);
  return [world, { ...world, look: { detailBudgets: [rule] } }];
});
const result = $('result');
try {
  const renderer = createRenderer(offscreen, { toolkit: { PixelLook, KIT } });
  const draw = () => {
    const worlds = source[+$('foreground').checked], degrees = Number($('orbit').value);
    const camera = { ...worlds[0].cam, yaw: degrees * Math.PI / 180 };
    document.querySelector('output[for=orbit]').value = degrees + '°';
    for (const [i, { view, detail }] of panels.entries()) {
      renderer.render(worlds[i],
        { width, height, camera, dither: 0, colored: false, damp: false, clean: $('clean').checked });
      view.drawImage(offscreen, 0, 0);
      detail.drawImage(offscreen, 20, 22, 9, 9, 0, 0, 9, 9);
    }
    result.textContent = 'Insets show the same 9 × 9 art pixels.';
  };
  for (const id of ['orbit', 'clean', 'foreground']) $(id).addEventListener('input', draw);
  draw();
} catch (error) {
  result.textContent = error.message;
}
