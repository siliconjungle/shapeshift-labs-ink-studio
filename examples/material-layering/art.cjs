const width = 144, rows = 128;
const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => (n = clamp(n), n * n * (3 - 2 * n));
const ramp = (distance, spread = .8) => smooth(.5 + distance / spread);
const oval = (x, y, rx, ry) => (1 - Math.hypot(x / rx, y / ry)) * Math.min(rx, ry);
const bevel = (x, y, a, b, c) =>
  Math.min(a - Math.abs(x), b - Math.abs(y), (a + b - c - Math.abs(x) - Math.abs(y)) / Math.SQRT2);
const segment = (x, y, ax, ay, bx, by) => {
  const u = bx - ax, v = by - ay;
  const t = clamp(((x - ax) * u + (y - ay) * v) / (u * u + v * v));
  return Math.hypot(x - ax - t * u, y - ay - t * v);
};
const line = (x, y, points) =>
  Math.min(...points.slice(1).map(([a, b], i) => segment(x, y, ...points[i], a, b)));
const hash = (x, y) => {
  let n = Math.imul(x + 27, 0x1f123bb5) ^ Math.imul(y + 1, 0xb8e451ef);
  n = Math.imul(n ^ n >>> 15, 0x2c1b3c6d);
  return ((n ^ n >>> 13) >>> 0) / 0xffffffff;
};

function reliefMark(x, y) {
  const hull = 1.1 - line(x, y, [[-21, 22], [-16, 17], [-10, 19], [-2, 16], [5, 19], [10, 17], [16, 20], [23, 17]]);
  let tower = Math.min(y + 21, 17 - y, 3.4 + y * .062 - Math.abs(x + 5));
  tower = Math.min(tower, Math.max(Math.abs(x + 5) - .85, Math.abs(y + 6) - 1.75));
  const top = Math.min(y + 28, -19 - y, 6.9 - Math.abs(x + 5), (y + 32) * 1.65 - Math.abs(x + 5));
  const glass = Math.min(y + 25, -21 - y, Math.abs(x + 5) - 1.55, 4.0 - Math.abs(x + 5));
  const cornice = Math.min(y + 19, -17.4 - y, 7.0 - Math.abs(x + 5));
  const beams = [[4, -25, 21, -29], [5, -22, 25, -22], [4, -19, 21, -15]];
  const light = Math.max(...beams.map(p => .60 - segment(x, y, ...p)));
  const wave = .72 - line(x, y, [[-21, 27], [-16, 26], [-10, 28], [-2, 25], [5, 28], [13, 26], [21, 27]]);
  const star = Math.max(
    Math.min(.56 - Math.abs(x + 25), 2.5 - Math.abs(y + 13)),
    Math.min(2.5 - Math.abs(x + 25), .6 - Math.abs(y + 13)));
  return Math.max(tower, Math.min(top, -glass), cornice, hull, wave, light, star);
}

function plaque(x, y, grain, mottled) {
  const outer = bevel(x, y, 64, 55, 15);
  const shell = ramp(outer);
  const face = bevel(x, y, 58, 49, 14);
  const band = ramp(.84 - Math.abs(face - 1.9));
  const rim = oval(x, y, 47, 43);
  const edge = ramp(1.6 - Math.abs(rim)), inset = ramp(rim - 1.0);
  const inner = ramp(.62 - Math.abs(rim - 3.5));
  const mark = ramp(reliefMark(x, y), 1.5);
  const r = Math.hypot(Math.abs(x) - 52.4, Math.abs(y) - 38.4);
  const screw = ramp(3.5 - r), slot = screw * ramp(.46 - Math.abs(y % 38.4 - (Math.abs(y) >= 38.4 ? 0 : Math.sign(y) * 38.4)));
  const borderChip = grain > .94 && Math.abs(face - 1) < 1.3 ? .12 : 0;
  const lift = .17 + .38 * smooth(outer / 5) - .06 * ramp(face) + .22 * band +
    .22 * edge - .31 * inset + .33 * inner + .71 * mark + .22 * screw - .21 * slot;
  const brass = .70 + .22 * grain + .13 * mottled - .09 * inset + .21 * mark + .21 * band +
    .18 * edge + .23 * inner - .20 * slot - borderChip;
  const finish = clamp(.39 + .19 * grain + .12 * mottled - .22 * (mark + .7 * inner + .6 * band) + .21 * slot);
  return { shell, lift: lift * shell, brass, finish, metal: .84 - .09 * mottled,
    shadow: clamp(.57 + .34 * smooth(outer / 3) - .16 * ramp(2.4 - Math.abs(rim)) - .18 * slot), rim };
}

function enamel(x, y, grain, mottled, base) {
  const depth = Math.max(0, .11 * Math.sin(y * .37 + x * .092) + .09 * Math.sin(x * .22 - y * .067));
  const runs = Math.sin(y * .58 + 2.5 * Math.sin(x * .081)) * .022;
  const contour = base.rim - 1.6 + .7 * (mottled - .5);
  const loss = grain > .96 && contour < 2.4 ? 1.25 : 0;
  return { mask: ramp(contour - loss), lift: .46 + runs + .52 * depth,
    stain: .67 + .37 * (.5 + y / 99) + .15 * mottled + .10 * grain + depth * .20,
    roughness: .20 + .11 * mottled + .07 * grain, ao: .93 - .27 * depth };
}

function maker(x, y, grain) {
  const radius = Math.hypot(x, y);
  const outline = ramp(1.7 - Math.abs(radius - 16), 1.25);
  const axis = .9 - line(x,y,[[-8, 2], [0, -5], [8, 2], [0, 8], [-8, 2]]);
  const dot = 1.4 - Math.hypot(x, y - 1.6);
  const branches = .9 - line(x,y,[[-4,-5],[0,-10],[4,-5]]);
  const mask = Math.max(outline, ramp(Math.max(axis, dot, branches))) * (grain > .98 ? .62 : 1);
  return { mask, lift: .53 + .29 * mask };
}

function source(I) {
  const allocate = components => new Float32Array(width * rows * components);
  const create = (intent, pixels, channels, options) => I.declare({ width, height: rows, channels, data: pixels },
    { intent, sampling: 'linear', ...options });
  const data = n => create('data', n, 1);
  const mask = n => create('mask', n, 1, { sampling: 'nearest' });
  const color = n => create('color', n, 3, { colorSpace: 'srgb-linear' });
  const height = n => create('height', n, 1, { units: 'mm' });
  const B = { color: allocate(3), h: allocate(1), q: allocate(1), m: allocate(1), ao: allocate(1), opacity: allocate(1) };
  const E = { gain: allocate(1), h: allocate(1), q: allocate(1), m: allocate(1), ao: allocate(1), a: allocate(1) };
  const S = { color: allocate(3), h: allocate(1), q: allocate(1), m: allocate(1), a: allocate(1) };
  const brass = [.61, .366, .155], ink = [.88, .69, .40];
  for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < width; x++, i++) {
    const dx = x + .5 - width / 2, dy = y + .5 - rows / 2;
    const grain = hash(x,y), mottled = (hash(x >> 2, y >> 2) + hash(x >> 3, y >> 3)) * .5;
    const b = plaque(dx, dy, grain, mottled), e = enamel(dx, dy, grain, mottled, b), s = maker(dx, dy, grain);
    for (let c = 0; c < 3; c++) {
      B.color[i * 3 + c] = brass[c] * b.brass;
      S.color[i * 3 + c] = ink[c] * (.85 + .15 * grain);
    }
    B.h[i] = b.lift; B.q[i] = b.finish; B.m[i] = b.metal; B.ao[i] = b.shadow; B.opacity[i] = b.shell;
    E.gain[i] = e.stain; E.h[i] = e.lift; E.q[i] = e.roughness; E.m[i] = .11; E.ao[i] = e.ao; E.a[i] = e.mask;
    S.h[i] = s.lift; S.q[i] = .39 + .13 * grain; S.m[i] = .53; S.a[i] = s.mask;
  }
  const relief = (maps, strength) => ({
    height: height(maps.h),
    normal: I.normals.heightToNormal(height(maps.h), { strength }),
    roughness: data(maps.q), metalness: data(maps.m)
  });
  return {
    base: { ...relief(B, 7), baseColor: color(B.color), ao: data(B.ao), opacity: mask(B.opacity) },
    enamel: { ...relief(E, 6), ao: data(E.ao) },
    stamp: { ...relief(S, 3), baseColor: color(S.color) },
    glazeMask: mask(E.a), stampMask: mask(S.a),
    enamelGain: data(E.gain)
  };
}

module.exports = { source };
