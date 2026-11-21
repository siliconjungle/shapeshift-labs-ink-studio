module.exports = ({ KIT: K, makeBuilder }) => ({
  id: 'motion-smear',
  name: 'Packet Drift',
  seed: 61,
  build(seed) {
    const width = 420, height = 204, w = 192, h = 126, fps = 12;
    const left = [12, 48, w, h], right = [216, 48, w, h];
    const mint = '#9fe9da', peach = '#ffc694', paper = '#ffedbe', steel = '#a8b7ca', dark = '#151d31';
    const render = (width, height, commands) => {
      const { data } = K.procedural.drawing2d.render({ width, height, commands, edges: 'hard' });
      return { w: width, h: height, rgba: data };
    };
    const rect = (x, y, w, h, fill) => ({ type: 'rect', rect: [x, y, w, h], fill });
    const poly = (points, fill) => ({ type: 'polygon', points, fill });
    const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
    const ellipse = (x, y, w, h, fill) => ({ type: 'ellipse', rect: [x, y, w, h], fill });
    const text = (x, y, text, color, scale = 1) => ({ type: 'text', at: [x, y], text, color, scale });
    const pad = n => String(n).padStart(2, '0');

    const towers = [
      [3, 43, 9], [19, 34, 12], [36, 55, 11], [52, 40, 8], [67, 50, 12], [85, 32, 12],
      [100, 63, 16], [122, 41, 9], [137, 36, 16], [157, 47, 12], [175, 59, 9]
    ];
    const city = [
      rect(0, 0, w, h, '#202940'), rect(0, 36, w, 22, '#2c354e'), rect(0, 60, w, 49, '#37445a'),
      ellipse(129, 22, 27, 27, '#7b586f'), ellipse(131, 24, 23, 23, '#ab727d'),
      rect(0, 43, w, 2, '#414762'), rect(0, 55, w, 3, '#49506a'),
      ...towers.flatMap(([x, top, span], i) => {
        const y = top + 24;
        const panels = Array.from({ length: 6 }, (_, j) => rect(x + 3, y + 4 + j * 4, span - 5, 1,
          (i + j) % 3 === 0 ? '#75908f' : '#425870'));
        return [rect(x, y, span, h - y, '#26374f'), rect(x + 2, y, span - 2, 2, '#55657a'),
          rect(x + span - 2, y + 2, 2, h - y - 2, '#3b4f66'), ...panels];
      }),
      poly([[0, 106], [112, 95], [192, 96], [192, 126], [0, 126]], '#202f47'),
      line([[0, 107], [112, 96], [192, 97]], '#6f7284'),
      line([[0, 117], [112, 104], [192, 105]], '#455b73'),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => rect(7 + i * 23, 105 - Math.round(Math.min(i, 5) * 1.8), 4, 2,
        i % 2 ? '#7cc2af' : '#d8a094')),
      rect(0, 0, w, 13, '#1a273c')
    ];

    const smooth = n => {
      const t = Math.min(1, Math.max(0, n));
      return t * t * (3 - 2 * t);
    };
    function position(time) {
      const route = smooth((time - .17) / 1.76) - smooth((time - 3.38) / 1.76);
      return [40 + route * 111, 71 - 22 * route];
    }
    function speed(time) {
      const a = position(time), b = position(time - 1 / fps);
      return a.map((p, axis) => (p - b[axis]) * fps);
    }
    let sampleTime, sample;
    function feed({ time }) {
      if (time === sampleTime) return sample;
      const [x, y] = position(time).map(Math.round);
      const moving = Math.abs(speed(time)[0]) > 3;
      const core = (points, color) => poly(points.map(([u, v]) => [x + u, y + v]), color);
      sample = render(w, h, [
        ...city,
        ellipse(x - 17, y + 8, 34, 9, '#5d647d'), ellipse(x - 11, y + 10, 22, 5, '#478788'),
        core([[-23, 0], [-16, -7], [-10, -8], [-6, -14], [1, -16], [8, -13], [13, -6],
          [21, -5], [24, 1], [19, 6], [-14, 7]], '#162237'),
        core([[-21, 0], [-13, -6], [17, -6], [23, 0], [16, 4], [-14, 5]], peach),
        core([[-9, -7], [-5, -13], [1, -15], [7, -12], [11, -7], [6, -4], [-5, -4]], '#78c3bd'),
        core([[-5, -11], [2, -13], [7, -9], [6, -7], [-2, -7]], '#c1f1d2'),
        core([[-14, 0], [18, -1], [21, 1], [15, 4], [-12, 5]], '#af7186'),
        rect(x - 15, y - 2, 29, 2, paper), rect(x - 10, y + 3, 19, 2, '#40647d'),
        rect(x - 15, y + 6, 7, 2, mint), rect(x + 9, y + 5, 7, 2, mint),
        rect(x + 13, y, 5, 1, '#ffe5a5'),
        ...(moving ? [rect(x - 19, y + 8, 5, 1, '#abdec8'), rect(x + 15, y + 9, 7, 1, '#7ebbb2')] : []),
        text(5, 2, 'PROBE 07', mint), text(147, 2, 'F ' + pad(Math.round(time * fps)), steel)
      ]);
      sampleTime = time;
      return sample;
    }

    const flowRange = [180, 100];
    const encode = (value, range) => Math.round(128 + 127 * Math.min(1, Math.max(-1, value / range)));
    const field = {
      rect: right, resolution: [16, 21], filter: 'nearest',
      source({ w, h, time }) {
        const rgba = new Uint8Array(w * h * 4);
        const [vx, vy] = speed(time);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const band = (y * 7 + (x >> 1) * 5) % 13;
          const dx = vx * (.21 + band * .115) * (band % 5 ? 1 : -.8);
          const dy = vy * .65 + vx * ((band % 3) - 1) * .31;
          const carry = y < 3 || y > 18 || band < 3 ? 0 : band < 5 ? 218 : 255;
          rgba.set([encode(dx, flowRange[0]), encode(dy, flowRange[1]), carry, 255], (y * w + x) * 4);
        }
        return { w, h, rgba };
      }
    };
    const housing = {
      resolution: [width, height],
      source({ time }) {
        const moving = Math.abs(speed(time)[0]) > 3;
        return render(width, height, [
          rect(0, 0, width, height, dark), rect(12, 10, 3, 15, peach),
          text(22, 10, 'PACKET DRIFT', paper, 2),
          text(12, 34, 'CLEAN FEED', mint), text(216, 34, 'MOTION SMEAR', peach),
          ...[left, right].map(([x, y, w, h]) => rect(x - 1, y - 1, w + 2, h + 2, '#52627b')),
          text(12, 185, 'CURRENT FRAME ' + pad(Math.round(time * fps)), steel),
          text(216, 185, moving ? 'DRAGGING 12 X 6 BLOCKS' : 'RECOVERING CLEAN FRAME', peach)
        ]);
      }
    };
    const passes = [
      { id: 'housing', type: 'composite', layer: housing },
      { id: 'clean', type: 'composite', input: 'housing', layer: { rect: left, resolution: [w, h], source: feed } },
      { id: 'flow', type: 'composite', isolated: true, layer: field },
      { id: 'corruptible', type: 'composite', isolated: true, layer: { rect: right, resolution: [w, h], source: feed } },
      { id: 'telemetry', type: 'mask', rect: [right[0], right[1], w, 13] },
      { id: 'decoder', type: 'motionSmear', input: 'corruptible', field: 'flow', refresh: 'telemetry',
        blockSize: [12, 6], fieldScale: flowRange, halfLife: .4, cameraMotion: 'keep' },
      { id: 'compare', type: 'composite', input: 'clean', source: 'decoder' }
    ];
    return makeBuilder(seed, [0x151d31]).finish({
      cam: { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 },
      look: { pixelSize: 1, renderGraph: { passes } }
    });
  }
});
