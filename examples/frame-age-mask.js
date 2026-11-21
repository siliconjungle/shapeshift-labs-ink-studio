const studio = require('..');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id: 'frame-age-mask',
  name: 'Tideline Repeater',
  seed: 63,
  build(seed) {
    const B = makeBuilder(seed, [
      0x141d32, 0x233353, 0x364966, 0x536984, 0x82a2a6, 0xadc6b6,
      0x493655, 0x805171, 0xae7486, 0xe7a694, 0xffd9a1, 0xfff1c6,
      0x205b62, 0x338880, 0x80c8a9, 0xc9f5c1
    ]);
    const S = K.sculpt(makeSculpt(B));
    Object.assign(S, { pixel: true, amb: .45, sky: .3, sun: K.V.norm([-.64, .65, .42]), sunK: .78 });
    const indigo = { r: [1, 2, 3, 4] }, copper = { r: [6, 7, 8, 9] };
    const ivory = { r: [8, 9, 10, 11] }, lamp = { r: [13, 14, 15], em: true };
    const box = (at, half, material, res = .1, rd = .027) => S.box(at, half, material, { res, rd });
    const tube = (points, material, radius = .038) => S.tube(points, radius, radius, material, { res: .062 });
    const ring = (y, rx, rz, material, phase) => tube(Array.from({ length: 33 }, (_, i) => {
      const a = i * Math.PI / 16;
      return [rx * Math.cos(a), y + .21 * Math.sin(a + phase), rz * Math.sin(a)];
    }), material, .045);

    box([0, -.19, 0], [5.7, .18, 2.5], indigo, .17, .08);
    box([0, .025, 0], [1.44, .11, 1.05], copper);
    box([0, .13, 0], [1.19, .07, .84], ivory);
    box([0, 1.99, 0], [.14, 1.95, .13], copper);
    for (let j = 0; j < 3; j++) {
      const y = .8 + j * 1.28, radius = 1.05 - j * .11;
      S.ball([0, y, 0], [.28, .24, .28], lamp, { res: .052 });
      ring(y - .22, radius, radius * .79, copper, j * .7);
      ring(y + .12, radius - .12, radius * .62, ivory, 1.4 + j * .7);
      for (const sign of [-1, 1]) tube([
        [0, y - .48, 0], [sign * radius, y - .22, 0],
        [sign * (radius - .22), y + .18, 0], [0, y + .55, 0]
      ], ivory);
    }
    S.ball([0, 3.91, 0], .13, lamp, { res: .05 });
    for (let i = -5; i <= 5; i++) {
      box([i * .92, .12, 1.6], [.035, .13, .034], indigo, .08);
      if (i % 2 === 0) box([i * .92, .24, 1.6], [.08, .027, .042], lamp, .038);
    }
    const skyline = [.62, 1.36, .86, 1.53, .93, 1.19, .77, 1.56, 1.02];
    for (const [i, y] of skyline.entries()) {
      const x = (i - 4) * 1.12;
      box([x, y / 2, -1.9], [.39, y / 2, .17], { r: [1, 2, 3] }, .123, .009);
      box([x, y + .03, -1.9], [.27, .023, .14], { r: [3, 4, 5] }, .087, .008);
    }
    S.bake();
    const cameraWorld = B.finish({ radius: 7, dither: .08, look: { splatCoverage: 'continuous', pixelSize: 1 } });

    const width = 452, height = 215, tileWidth = 162, tileHeight = 132, fps = 12;
    const liveBox = [14, 51, tileWidth, tileHeight], ageBox = [188, 51, tileWidth, tileHeight];
    const colors = ['#8ceacf', '#ffd78d', '#dda6e9'], paper = '#f8edca', blue = '#9db5cc';
    const groups = [
      { mode: 'delay', frames: 6 },
      { mode: 'hold', start: 8 },
      { mode: 'replay', start: 9, frames: 9 }
    ];
    const atlas = studio.createCameraAtlas({
      width: tileWidth, height: tileHeight, views: [{
        id: 'lighthouse', rect: [0, 0, tileWidth, tileHeight], fps,
        frame: ({ time }) => {
          const phase = time * Math.PI * 2 / 2.5;
          return {
            camera: { target: [1.42 * Math.sin(phase), 1.93, 0], dist: 7.1, pitch: .135,
              yaw: .28 * Math.cos(phase), fov: .65 },
            outline: false
          };
        }
      }]
    });
    const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
    const label = (x, y, text, color, scale = 1) => ({ type: 'text', at: [x, y], text, color, scale });
    const pad = n => String(n).padStart(2, '0');
    const face = {
      resolution: [width, height],
      source({ time }) {
        const tick = Math.floor(time * fps + 1e-8);
        const sampled = [tick - 6, tick >= 8 ? 8 : -1, tick >= 18 ? 9 + (tick - 18) % 9 : -1];
        const { data } = K.procedural.drawing2d.render({ width, height, edges: 'hard', commands: [
          rect(0, 0, width, height, '#131d2d'), rect(14, 11, 3, 15, colors[0]),
          label(24, 11, 'TIDELINE REPEATER', paper, 2),
          label(14, 35, 'LIVE CAMERA', colors[0]), label(188, 35, 'FRAME AGE MASK', paper),
          ...[liveBox, ageBox].map(([x, y, w, h]) => rect(x - 1, y - 1, w + 2, h + 2, '#45596d')),
          label(14, 194, 'INPUT FRAME ' + pad(tick), blue),
          label(188, 194, '12 FPS CAPTURE', blue),
          ...groups.flatMap(({ mode }, i) => {
            const y = 51 + 44 * i, value = sampled[i];
            return [rect(355, y + 2, 2, 39, colors[i]), label(364, y + 5, mode.toUpperCase(), colors[i]),
              label(364, y + 17, ['MINUS 6', 'LOCK 08', '09 TO 17'][i], blue),
              label(364, y + 30, value >= 0 ? 'FRAME ' + pad(value) : 'LIVE', paper)];
          })
        ] });
        return { w: width, h: height, rgba: data };
      }
    };
    const passes = [
      { id: 'display', type: 'composite', layer: face },
      { id: 'live', type: 'composite', input: 'display', layer: atlas.layer('lighthouse', { rect: liveBox }) },
      { id: 'feed', type: 'composite', isolated: true, layer: atlas.layer('lighthouse', { rect: ageBox }) },
      ...groups.map(({ mode }, i) => ({ id: mode, type: 'mask', rect: [188, 51 + 44 * i, tileWidth, 44] })),
      { id: 'repeater', type: 'frameAge', input: 'feed', fps, cameraMotion: 'keep',
        regions: groups.map(group => ({ ...group, mask: group.mode })) },
      { id: 'monitor', type: 'composite', input: 'live', source: 'repeater' }
    ];
    const display = makeBuilder(seed, [0x131d2d]).finish({
      cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 },
      look: { pixelSize: 1, renderGraph: { passes } }
    });
    atlas.capture(cameraWorld, { time: 0 });
    K.stage(display).add({ update(_dt, time) { atlas.capture(cameraWorld, { time }); } });
    return display;
  }
});
