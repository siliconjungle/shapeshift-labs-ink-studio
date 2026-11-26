const width = 128, height = 128, pitch = .26;
const clamp = n => Math.min(1, Math.max(0, n));
const smooth = (a, b, n) => (n = clamp((n - a) / (b - a)), n * n * (3 - 2 * n));
const ridge = (d, w) => 1 - smooth(0, w, Math.abs(d));
const roundMask = (d, w = .023) => smooth(-w, w, d);
const color = (source, target, gain) => source.map((n, c) => n + (target[c] - n) * gain);
const noise = (x, y) => {
  let n = Math.imul(1957 + x, 0xbf58a21d) ^ Math.imul(9650 + y, 0x966e6da5);
  n = Math.imul(n ^ n >>> 13, 0xc2b2ae35);
  return ((n ^ n >>> 16) >>> 0) / 0xffffffff;
};

function petal(x, y, x0, y0, theta, w, h) {
  const dx = x - x0, dy = y - y0, cos = Math.cos(theta), sin = Math.sin(theta);
  const u = dx * cos + dy * sin, v = dy * cos - dx * sin;
  return { shape: roundMask((1 - Math.hypot(u / w, v / h)) * h), vein: ridge(v, h * .16) * roundMask(w * .83 - Math.abs(u)) };
}

function finish(px, py) {
  const x = (px + .5) / width * 2 - 1, y = (py + .5) / height * 2 - 1;
  const ox = Math.abs(x), oy = Math.abs(y), diamond = ox + oy;
  const interior = roundMask(.94 - diamond, .026);
  const border = ridge(diamond - .989, .036), borderInner = ridge(diamond - .897, .025);
  const dot = roundMask(.048 - Math.hypot(ox - .81, oy - .11));
  const trimAxis = 1 - Math.min(ox, oy);
  const edgeRelief = ridge(trimAxis - .16, .028);
  const hub = Math.hypot(x, y);
  const petals = [[-.27, 0, 0], [.27, 0, 0], [0, .27, Math.PI / 2], [0, -.27, Math.PI / 2],
    [.16, .16, Math.PI / 4], [-.16, -.16, Math.PI / 4],
    [-.16, .16, -Math.PI / 4], [.16, -.16, -Math.PI / 4]]
    .map(([a, b, angle], i) => petal(x, y, a, b, angle, i < 4 ? .235 : .14, i < 4 ? .083 : .078));
  let leaf = 0, groove = 0;
  for (const { shape, vein } of petals) {
    leaf = Math.max(leaf, shape);
    groove = Math.max(groove, shape * vein);
  }
  const center = roundMask(.102 - hub, .014), jewel = roundMask(.055 - hub, .012);
  const corner = Math.hypot(1 - ox, 1 - oy);
  const cornerBand = ridge(corner - .24, .025), cornerDisc = roundMask(.139 - corner);
  const grains = noise(Math.floor(px + 179), Math.floor(py + 179));
  const glaze = .5 + .23 * Math.sin(x * 13 + y * 8.2) + .12 * Math.sin(x * 32 - y * 27 + 1.5 * Math.cos(13 * y));
  const gain = .86 + .18 * (y + 1) * .5 + .11 * (x + 1) / 2 + .06 * grains;
  let pigment = color([.023, .075, .082], [.073, .26, .218], .15 + .75 * glaze);
  pigment = color(pigment, [.036, .195, .165], interior * .76);
  pigment = color(pigment, [.34, .243, .1], border * .74);
  pigment = color(pigment, [.095, .36, .274], borderInner * .75);
  pigment = color(pigment, [.63, .52, .278], leaf * (.88 - .34 * groove));
  pigment = color(pigment, [.51, .136, .044], center * .87);
  pigment = color(pigment, [.86, .53, .226], jewel * .93);
  pigment = color(pigment, [.49, .36, .14], .83 * Math.max(dot, cornerBand));
  pigment = color(pigment, [.075, .32, .256], cornerDisc * .85);
  pigment = pigment.map(n => n * gain * (.86 + .21 * glaze));
  const relief = .12 + .041 * x - .022 * y + .012 * (glaze - .5) +
    .095 * interior + .074 * border + .027 * borderInner + .169 * leaf - .039 * groove +
    .215 * center + .052 * jewel + .064 * dot + .057 * cornerBand + .057 * cornerDisc + .017 * edgeRelief;
  const roughness = clamp(.37 + .15 * glaze + .033 * (grains - .5) - .13 * leaf - .12 * jewel + .09 * border);
  return { pigment, relief, roughness };
}

function normal(px, py, relief) {
  const step = .26;
  const dx = (relief(px + step, py) - relief(px - step, py)) / (2 * pitch * step);
  const dy = (relief(px, py + step) - relief(px, py - step)) / (2 * pitch * step);
  const grain = .021 * Math.sin(px * 2.15 + py * 1.14), length = Math.hypot(-dx + grain, dy - grain, 1);
  return [(-dx + grain) / length, (dy - grain) / length, 1 / length];
}

const planes = {
  baseColor: { width: 150, height: 146, angle: .124, dx: 2.8, dy: -1.6, zoom: 1 },
  height: { width: 146, height: 146, angle: -.081, dx: -3.5, dy: 2.4, zoom: 1.018 },
  normal: { width: 151, height: 147, angle: .052, dx: 4.5, dy: -2.4, zoom: .998 },
  roughness: { width: 144, height: 146, angle: -.054, dx: .5, dy: 3.1, zoom: 1.011 }
};
function coordinateTransform(spec) {
  const cos = Math.cos(spec.angle), sin = Math.sin(spec.angle), s = spec.zoom;
  const tx = (width - 1) * .5, ty = (height - 1) * .5;
  const sx = (spec.width - 1) * .5 + spec.dx, sy = (spec.height - 1) * .5 + spec.dy;
  return {
    forward(x, y) { return [sx + ((x - tx) * cos - (y - ty) * sin) * s, sy + ((x - tx) * sin + (y - ty) * cos) * s]; },
    inverse(u, v) { return [tx + ((u - sx) * cos + (v - sy) * sin) / s, ty + ((v - sy) * cos - (u - sx) * sin) / s]; }
  };
}

const scratches = [[80, 43, 2.5, 10], [32, 86, 3.4, 3.4], [91, 94, 4.3, 4.8]];
const broken = (x, y) => scratches.some(([u, v, a, b]) => Math.hypot((x - u) / a, (y - v - (x - u) * .48) / b) < 1);
const punch = (x, y) => Math.hypot(x - 56, y - 45.5) < 3.5;

function captures() {
  const source = {}, settings = {};
  const evalZ = (x, y) => finish(x, y).relief;
  const depth = new Float32Array(width * height);
  const defect = Uint8Array.from(depth, (_, p) => broken(p % width, Math.floor(p / width)) ? 255 : 0);
  for (const [name, spec] of Object.entries(planes)) {
    const coord = coordinateTransform(spec), count = spec.width * spec.height;
    const stride = name === 'baseColor' || name === 'normal' ? 3 : 1, values = new Float32Array(stride * count);
    const irradiance = name === 'baseColor' && new Float32Array(values.length);
    const coverage = name === 'height' && new Uint8Array(count).fill(255);
    for (let y = 0, i = 0; y < spec.height; y++) for (let x = 0; x < spec.width; x++, i++) {
      const [u, v] = coord.inverse(x, y);
      const f = finish(u, v), damaged = broken(u, v);
      if (name === 'baseColor') {
        const n = normal(u, v, evalZ);
        const light = .58 * Math.max(0, -.48 * n[0] + .54 * n[1] + .70 * n[2]);
        const exposure = .52 + .34 * Math.cos((u - 15) * .021 + (v - 25) * .014);
        const tint = [1.2, .91, .62];
        for (let c = 0; c < 3; c++) {
          const l = (exposure + light) * tint[c];
          irradiance[3 * i + c] = l;
          values[3 * i + c] = damaged ? [.89, .89, .73][c] : f.pigment[c] * l;
        }
      } else if (name === 'normal') values.set(damaged ? [.85, -.35, .3873] : normal(u, v, evalZ), i * 3);
      else if (name === 'height') {
        if (punch(u, v)) coverage[i] = 0;
        values[i] = damaged || coverage[i] === 0 ? -.086 : f.relief;
      } else values[i] = damaged ? .94 : f.roughness;
    }
    source[name] = { width: spec.width, height: spec.height, channels: stride, data: values };
    if (coverage) source.validHeight = { width: spec.width, height: spec.height, channels: 1, data: coverage };
    if (irradiance) source.irradiance = { width: spec.width, height: spec.height, channels: 3, data: irradiance };
    settings[name] = [[1, 1], [width - 2, 1], [width - 2, height - 2], [1, height - 2], [37, 64], [92, 86]]
      .map(p => ({ target: p, source: coord.forward(...p) }));
  }
  source.defects = { width, height, channels: 1, data: defect };
  return { source, settings };
}

module.exports = { width, height, pitch, finish, captures, broken, punch };
