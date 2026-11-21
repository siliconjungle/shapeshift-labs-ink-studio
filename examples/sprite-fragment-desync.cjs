const fs = require('node:fs');
const path = require('node:path');
const { KIT } = require('..').load();
const PNG = require('../cli/png');
const { drawing2d, graph, raster } = KIT.procedural;

const width = 144, height = 100, fps = 12, cels = 16;
const plateWidth = 474, plateHeight = 180, panelX = [13, 165, 317], panelY = 48;
const paper = '#f7e3b1', mint = '#92e5d2', lilac = '#e2a3e4', brass = '#f4b75e';
const dark = '#162436', frameInk = '#33485d', muted = '#a1b2be';
const draw = (w, h, commands) => drawing2d.render({ width: w, height: h, commands, edges: 'hard' });
const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
const poly = (points, fill) => ({ type: 'polygon', points, fill });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (x, y, value, color, scale = 1) => ({ type: 'text', at: [x, y], text: value, color, scale });

function pose(index) {
  const angle = 2 * Math.PI * index / cels;
  const stride = Math.round(18 * Math.sin(angle));
  const lift = Math.round(11 * Math.cos(angle));
  const bob = Math.round(4 * Math.cos(2 * angle));
  const hx = 72 + Math.round(5 * Math.sin(angle)), hy = 20 + bob;
  const shoulder = [65, 49 + bob], elbow = [66 - Math.round(stride / 2), 63 + bob];
  const hand = [74 - stride, 52 + bob + Math.round(lift / 2)];
  const bodyPanel = (points, fill) => poly(points.map(([x, y]) => [x, y + bob]), fill);
  const leg = (x, swing, raised, shade, light) => {
    const knee = [x + Math.round(swing / 2) + 1, 72 + Math.round(bob / 2) - raised];
    const boot = [x + swing, 89 - raised];
    const points = [[x, 62 + bob], knee, boot];
    return [
      line(points, dark, 13), line(points, shade, 9), line([knee, boot], light, 3),
      rect(boot[0] - 6, boot[1] - 4, 16, 8, dark),
      rect(boot[0] - 5, boot[1] - 3, 14, 4, shade),
      rect(boot[0] + 1, boot[1] - 3, 8, 2, light)
    ];
  };
  return {
    farLeg: leg(74, -stride, Math.max(0, -lift), '#535a75', '#8d87a1'),
    nearLeg: leg(63, stride, Math.max(0, lift), '#6ca299', '#b1d9be'),
    body: [
      bodyPanel([[57, 42], [74, 39], [84, 48], [83, 65], [73, 71], [60, 70], [54, 61]], dark),
      bodyPanel([[51, 44], [62, 42], [63, 62], [49, 63], [46, 58], [46, 49]], '#5e597b'),
      bodyPanel([[59, 46], [73, 42], [80, 49], [79, 61], [72, 66], [60, 64], [56, 57]], '#d68d49'),
      rect(47, 48 + bob, 9, 2, lilac), rect(49, 51 + bob, 2, 8, '#8983a1'),
      line([[62, 46 + bob], [73, 45 + bob], [78, 49 + bob]], paper, 2),
      rect(68, 62 + bob, 13, 4, '#746186'), rect(76, 62 + bob, 4, 2, lilac)
    ],
    head: [
      poly([[hx - 13, hy + 7], [hx - 8, hy + 1], [hx + 7, hy], [hx + 16, hy + 7],
        [hx + 16, hy + 17], [hx + 8, hy + 23], [hx - 7, hy + 23], [hx - 13, hy + 17]], dark),
      poly([[hx - 11, hy + 8], [hx - 7, hy + 3], [hx + 6, hy + 2], [hx + 14, hy + 8],
        [hx + 14, hy + 16], [hx + 7, hy + 20], [hx - 8, hy + 20], [hx - 11, hy + 15]], brass),
      line([[hx - 7, hy + 5], [hx + 6, hy + 4], [hx + 10, hy + 7]], paper, 2),
      poly([[hx - 3, hy + 9], [hx + 16, hy + 9], [hx + 16, hy + 14], [hx + 12, hy + 17], [hx, hy + 17]], '#243b4b'),
      rect(hx + 5, hy + 11, 9, 2, mint), rect(hx + 10, hy + 13, 3, 2, '#c7ffde'),
      rect(hx - 10, hy + 11, 4, 7, '#a56350'),
      line([[hx - 8, hy + 4], [hx - 12, hy - 4], [hx - 16, hy - 4]], '#8090b3'),
      rect(hx - 17, hy - 5, 3, 2, lilac)
    ],
    nearArm: [
      line([shoulder, elbow, hand], dark, 11), line([shoulder, elbow, hand], '#ad755f', 7),
      line([elbow, hand], '#d8b273', 4),
      ellipse(shoulder[0] - 5, shoulder[1] - 5, 10, 10, '#f4b75e'),
      rect(shoulder[0] - 3, shoulder[1] - 3, 5, 2, paper),
      rect(hand[0] - 3, hand[1] - 3, 8, 7, '#634e66'),
      rect(hand[0], hand[1] - 4, 5, 4, '#ffd798')
    ]
  };
}

const poses = Array.from({ length: cels }, (_, i) => pose(i));
const sprite = graph.raster({
  width, height, fps, tags: { stride: { start: 0, end: cels } },
  layers: Object.fromEntries(Object.keys(poses[0]).map(name => [
    name, { frames: poses.map(parts => draw(width, height, parts[name])) }
  ]))
});
const controls = {
  sync: { tag: 'stride' },
  parts: { tag: 'stride', parts: { head: { hold: 3 }, nearArm: { offset: 5 }, nearLeg: { offset: -4 } } },
  strips: { tag: 'stride', strips: [{ rect: [45, 24, 60, 11], offset: -6 }, { rect: [35, 66, 68, 13], offset: 6 }] }
};
const modes = Object.keys(controls);
const session = graph.create({
  inputs: { sprite: 'any' },
  nodes: Object.fromEntries(modes.map(name => [name, { op: 'anim.spriteDesync', inputs: {
    source: { input: 'sprite' }, options: { value: controls[name] }
  } }])),
  outputs: Object.fromEntries(modes.flatMap(name => [
    [name, { node: name }], [name + 'Frames', { node: name, port: 'frames' }]
  ]))
});

const backdrop = draw(width, height, [
  rect(0, 0, width, height, '#203044'), rect(0, 41, width, 48, '#273e52'),
  rect(0, 69, width, 1, '#3a5567'), rect(0, 89, width, 11, '#345062'),
  ...[18, 37, 56, 75, 94, 113, 132].map(x => rect(x, 0, 1, 89, '#2c4256')),
  ...[11, 126].flatMap(x => [rect(x, 6, 6, 2, '#8aacb6'), rect(x + 1, 9, 3, 19, '#425d72')]),
  ...[5, 28, 51, 74, 97, 120].map(x => rect(x, 96, 9, 1, '#5b7988')),
  ellipse(40, 86, 66, 7, '#23374a')
]);
const plate = draw(plateWidth, plateHeight, [
  rect(0, 0, plateWidth, plateHeight, dark), rect(13, 10, 3, 15, brass),
  text(23, 10, 'SPRITE FRAGMENT DESYNC', paper, 2),
  ...panelX.map(x => rect(x - 1, panelY - 1, width + 2, height + 2, frameInk)),
  ...['SYNC', 'PART DESYNC', 'STRIP DESYNC'].map((label, i) => text(panelX[i], 34, label, [mint, brass, lilac][i])),
  ...['ALL PARTS TOGETHER', 'HOLD  ARM +5  LEG -4', 'UPPER -6  LOWER +6'].map((label, i) =>
    text(panelX[i], 154, label, muted))
]);
const pad = n => String(n).padStart(2, '0');
function render(index) {
  const { outputs } = session.evaluate({ sprite }, { time: index / fps });
  const { head, nearArm, nearLeg } = outputs.partsFrames.parts;
  const [upper, lower] = outputs.stripsFrames.strips;
  const overlay = draw(plateWidth, plateHeight, [
    text(panelX[0], 165, 'FRAME ' + pad(outputs.syncFrames.base), mint),
    text(panelX[1], 165, 'H ' + pad(head) + '  A ' + pad(nearArm) + '  L ' + pad(nearLeg), brass),
    text(panelX[2], 165, 'FRAMES ' + pad(upper) + '  ' + pad(lower), lilac),
    ...controls.strips.strips.flatMap(({ rect: [x, y, w, h] }) => {
      const start = panelX[2] + x, end = start + w - 1, top = panelY + y, bottom = top + h - 1;
      return [line([[start + 4, top], [start, top], [start, bottom], [start + 4, bottom]], lilac),
        line([[end - 4, top], [end, top], [end, bottom], [end - 4, bottom]], lilac)];
    })
  ]);
  return raster.stack({ width: plateWidth, height: plateHeight, layers: [
    { source: plate },
    ...modes.flatMap((name, i) => [
      { source: backdrop, x: panelX[i], y: panelY }, { source: outputs[name], x: panelX[i], y: panelY }
    ]),
    { source: overlay }
  ] }).value;
}

const directory = process.argv[2];
if (!directory) throw new Error('Usage: node examples/sprite-fragment-desync.cjs <frame-directory>');
fs.mkdirSync(directory, { recursive: true });
for (let index = 0; index < cels; index++) {
  const { width, height, data } = render(index);
  fs.writeFileSync(path.join(directory, 'fragment-' + String(index).padStart(3, '0') + '.png'), PNG.encode(width, height, data, 4));
}
