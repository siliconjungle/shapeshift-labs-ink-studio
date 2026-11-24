// A painted signal sail with mesh-bound stitches, frayed threads, and residual splats.
function buildSail({ KIT: K, makeBuilder }, seed = 91) {
  const palette = [0x111e29, 0x213743, 0x304a52, 0x51706a, 0x79a18c, 0x944839,
    0xc76845, 0xe69355, 0xfacf83, 0xffecb2, 0x599c9b, 0x95c6ad];
  const B = makeBuilder(seed, palette), meshId = 'sail-canvas';
  const nx = 48, ny = 24, positions = [], uvs = [], indices = [], faces = new Map();
  const opening = (x, y) => x >= 18 && x < 30 && y >= (x === 18 || x === 29 ? 11 : 10) &&
    y < (x === 18 || x === 29 ? 13 : 14);
  const inset = x => x < 3 ? 3 - x : x > 37 ? Math.floor((x - 36) * .58) : 0;
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
    const u = x / nx, v = y / ny;
    positions.push(5.6 * (u - .5), 2.76 * (v - .5), .035 * Math.sin(u * 9) * Math.sin(v * 3));
    uvs.push(u, v);
    if (x === nx || y === ny || y < inset(x) || y >= ny - inset(x) || opening(x, y)) continue;
    const a = y * (nx + 1) + x, b = a + 1, c = a + nx + 1, d = c + 1;
    faces.set(y * nx + x, indices.length / 3);
    indices.push(a, b, c, c, b, d);
  }
  // Remove the unused grid vertices so the live geometry follows the authored silhouette.
  const used = [...new Set(indices)].sort((a, b) => a - b);
  const remap = new Map(used.map((index, at) => [index, at]));
  const width = 144, height = 72, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = Math.floor(x / 3), gy = Math.floor(y / 3), edge = Math.min(gy, ny - 1 - gy) - inset(gx);
    const rim = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].some(([a, b]) => opening(a, b));
    const border = edge < .8 || gx === 0 || gx === 47;
    const seam = edge === 1 || gx === 1 || gx === 46;
    const band = gy < 5 || gy >= 19;
    const linear = x - 20, heightFromCenter = Math.abs(y - 36);
    const chevron = gx >= 5 && gx < 15 && heightFromCenter <= 16 &&
      Math.abs(linear - Math.floor((16 - heightFromCenter) * .92)) < 4;
    const lozenge = (center, yy, r) => Math.abs(x - center) + Math.abs(y - yy) < r;
    const arrow = gx >= 31 && gx <= 41 && Math.abs(y - 36) < 3 && x <= 124 ||
      gx >= 35 && gx < 43 && Math.abs((126 - x) * .66 - heightFromCenter) < 2;
    const studs = (gy === 3 || gy === 20) && x % 9 < 3 && gx > 2 && gx < 40;
    const bar = (gy === 6 || gy === 17) && x > 15 && x < 118;
    const wear = ((x * 127 + y * 183) % 29 < 3 ? -8 : 0) + ((x + y) % 3) * 3;
    const color = border ? [28, 55, 57] : rim || seam ? [227, 150, 83] :
      chevron || arrow || lozenge(18, 36, 6) || lozenge(102, 36, 4) || studs ? [248, 201, 123] :
      bar ? [124, 76, 60] : band ? [54, 110, 108] :
      (Math.floor((x + y * 2) / 9) % 4 === 0 ? [180, 86, 58] : [193, 95, 65]);
    pixels.set([...color.map(n => n + wear), 255], (y * width + x) * 4);
  }
  const mesh = K.sceneMeshes.create({
    id: meshId, objectId: 'signal-sail', partId: 'canvas',
    positions: used.flatMap(i => positions.slice(i * 3, i * 3 + 3)),
    uvs: used.flatMap(i => uvs.slice(i * 2, i * 2 + 2)), indices: indices.map(i => remap.get(i)),
    materials: [{ id: 'registered-canvas', texture: { width, height, pixels } }]
  });
  const chart = K.sceneMeshes.uvAnchors(mesh, K);
  function probe(x, y, u, v) {
    const triangle = faces.get(y * nx + x) + Number(u + v > 1);
    return { uv: [(x + u) / nx, (y + v) / ny], triangle };
  }
  function anchor({ uv, triangle }) {
    const { weights } = chart.bind(uv, triangle);
    return { triangle, weights };
  }
  const carrier = { kind: 'uv', mesh }, grow = K.curveSplats.grow;
  const stitches = [];
  for (const row of [5, 18]) for (let x = 4; x < 42; x += 2) {
    if (!faces.has(row * nx + x)) continue;
    stitches.push({ id: 'seam-' + row + '-' + x, from: probe(x, row, .12, .25),
      to: probe(x, row, .84, .75), lift: .016 });
  }
  const seams = grow(B, carrier, { stitches, segments: 4, offset: .012 },
    { object: 'waxed-stitching', width: .025, edge: 'hard', color: '#ffecb2' });
  const roots = Array.from({ length: 35 }, (_, i) => {
    const x = i + 4, y = ny - 1 - inset(x);
    return { id: 'fray-' + i, ...probe(x, y, .26 + .21 * (i % 3), .84),
      heading: Math.PI * .55 + (i % 6 - 2) * .12, length: .048 + (i * 7 % 11) * .009 };
  });
  const fringe = grow(B, carrier, { roots, segments: 5, lean: 1.8, bend: -.23, offset: .01 },
    { object: 'sail-fringe', width: .026, edge: 'hard', taper: [[0, 1], [1, .26]],
      color: ({ index }) => ['#95c6ad', '#79a18c', '#facf83', '#ffecb2'][index % 4] });

  const residuals = [];
  for (let i = 0; i < 48; i++) {
    const x = (i % 2 ? 33 : 11) + (i * 5 % 9 - 4);
    const y = 8 + (i * 7 % 9);
    const bind = probe(x, y, .15 + (i * 7 % 9) * .083, .15 + (i * 11 % 9) * .083);
    const surface = anchor(bind), site = chart.sample(chart.bind(bind.uv, bind.triangle));
    const id = 'pigment-fleck-' + i, p = K.V.mad(site.p, site.n, .022 + (i % 4) * .012);
    const r = .027 + (i * 17 % 9) * .0035;
    B.dab(...p, site.n, K.V.norm(site.tangent), r * 1.3, r * .87, r * .36,
      B.P[[4, 7, 8, 9][i % 4]], .61, { nd: true, splatId: id });
    residuals.push({ id, surface });
  }
  const probes = [20, 22, 24, 26, 28].map(x => ({
    from: { triangle: faces.get(9 * nx + x) + 1, weights: [.53, 0, .47] },
    to: { triangle: faces.get(14 * nx + x), weights: [.53, .47, 0] }
  }));
  return B.finish({ id: 'hybrid-cage-sail', meshes: [mesh], radius: 7, dither: 0,
    cam: { target: [0, .08, 0], yaw: -.25, pitch: .14, dist: 8.7, fov: .54, sway: 0 },
    fog: { c: 0, start: 1, max: 0 }, outline: { c: 0, edge: 0 },
    hybridCage: { id: 'sail-cage', mesh: meshId, size: [5, 3, 2],
      bounds: { min: [-2.98, -1.52, -.25], max: [2.98, 1.52, .30] }, stretchLimit: 1.19,
      growth: [{ id: 'stitched-seams', binding: seams }, { id: 'frayed-edge', binding: fringe }], residuals,
      gaps: [{ id: 'signal-slot', minWidth: .34, probes }] }
  });
}

module.exports = kit => ({ id: 'hybrid-cage-sail', name: 'Signal sail', seed: 91, build: seed => buildSail(kit, seed) });
module.exports.buildSail = buildSail;
