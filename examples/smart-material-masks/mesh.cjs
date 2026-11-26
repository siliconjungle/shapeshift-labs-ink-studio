const { document } = require('../../cli/glb-file.js');

const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => (x = clamp((x - a) / (b - a)), x * x * (3 - 2 * x));
const profile = (distance, width) => smooth(-width, width, distance);
const peak = (x, w) => 1 - smooth(0, w, Math.abs(x));
const frame = (x, y, a, b, chamfer) =>
  Math.min(a - Math.abs(x), b - Math.abs(y), (a + b - chamfer - Math.abs(x) - Math.abs(y)) / Math.SQRT2);
const studs = [
  [-1.13, .76], [1.13, .76], [-1.13, -.76], [1.13, -.76],
  [-.46, .59], [.48, .59], [-.76, -.42], [.78, -.42]
];

function segment(x, y, [a, b], [c, d]) {
  const u = c - a, v = d - b, t = clamp(((x - a) * u + (y - b) * v) / (u * u + v * v));
  return Math.hypot(x - a - t * u, y - b - t * v);
}
function zebra(x, y, points) {
  return Math.min(...points.slice(1).map((end, i) => segment(x, y, points[i], end)));
}
const zero = [[-.31, .02], [-.42, .12], [-.42, .36], [-.31, .46],
  [-.18, .46], [-.07, .36], [-.07, .12], [-.18, .02], [-.31, .02]];
const nine = [[.14, .01], [.27, .01], [.39, .13], [.39, .36], [.29, .46], [.15, .46],
  [.045, .36], [.045, .26], [.15, .16], [.29, .16], [.39, .26]];
function insignia(x, y) {
  return .036 - Math.min(zebra(x, y, zero), zebra(x, y, nine));
}

function surface(x, y) {
  const edge = frame(x, y, 1.35, .94, .19);
  const inset = frame(x, y, 1.13, .72, .21);
  const border = .09 * profile(edge - .045, .052) - .042 * profile(inset, .024) +
    .052 * peak(edge - .145, .045) + .045 * peak(inset + .027, .037);
  const panel = frame(x, y - .205, .60, .356, .125);
  const plate = .075 * profile(panel, .032) + .026 * peak(panel - .042, .024);
  const relief = .077 * profile(insignia(x, y), .020);
  const rib = .078 * peak(y + .23 + .087 * x * x, .044) +
    .112 * peak(y + .57 + .06 * x * x, .062) - .021 * peak(y + .26 + .087 * x * x, .028);
  const rail = (.065 * peak(Math.abs(x) - .89 - .075 * y, .053) +
    .020 * peak(Math.abs(x) - .78 + .058 * y, .027)) * profile(.69 - Math.abs(y), .064);
  let fasteners = 0;
  for (const [u, v] of studs) {
    const r = Math.hypot(x - u, y - v);
    fasteners += .13 * profile(.067 - r, .026) + .024 * peak(r - .105, .023) -
      .039 * profile(.011 - Math.abs(y - v - .2 * (x - u)), .014) * profile(.052 - r, .02);
  }
  const cast = (.0033 * Math.sin(x * 52 + y * 48) * Math.sin(y * 83 - x * 33) +
    .0019 * Math.cos(x * 93 + y * 33)) * profile(inset, .06);
  return border + plate + relief + (rib + rail) * profile(inset, .035) + fasteners + cast;
}

function mesh() {
  const doc = document(), { gltf } = doc, divisions = 142, stride = divisions + 1;
  const positions = [], normals = [], uv = [], indices = [];
  const xAt = col => (col / divisions - .5) * 2.95;
  const yAt = row => (.5 - row / divisions) * 2.95;
  const inside = (col, row) => frame(xAt(col), yAt(row), 1.35, .94, .19) >= 0;
  for (let row = 0; row <= divisions; row++) for (let col = 0; col <= divisions; col++) {
    const x = xAt(col), y = yAt(row), h = surface(x, y), e = .002;
    const a = (surface(x - e, y) - surface(x + e, y)) / (2 * e);
    const b = (surface(x, y - e) - surface(x, y + e)) / (2 * e);
    const l = Math.hypot(a, b, 1);
    positions.push(x, y, h);
    normals.push(a / l, b / l, 1 / l);
    uv.push(col / divisions, row / divisions);
  }
  for (let row = 0; row < divisions; row++) for (let col = 0; col < divisions; col++) {
    const i = row * stride + col;
    const tl = inside(col, row), bl = inside(col, row + 1);
    const tr = inside(col + 1, row), br = inside(col + 1, row + 1);
    if (tl && bl && tr) indices.push(i, i + stride, i + 1);
    if (tr && bl && br) indices.push(i + 1, i + stride, i + stride + 1);
  }
  const f32 = (v, type, bounds) => doc.accessor(Float32Array.from(v), type, { bounds });
  gltf.materials = [{ name: 'Cast iron', pbrMetallicRoughness: {
    baseColorFactor: [.063, .26, .244, 1], metallicFactor: .83, roughnessFactor: .46 } }];
  gltf.meshes = [{ name: 'Cast gate', primitives: [{ material: 0,
    indices: doc.accessor(Uint32Array.from(indices), 'SCALAR'),
    attributes: { POSITION: f32(positions, 'VEC3', true), NORMAL: f32(normals, 'VEC3'), TEXCOORD_0: f32(uv, 'VEC2') }
  }] }];
  gltf.nodes = [{ name: 'Floodgate plate', mesh: 0 }];
  gltf.scenes[0].nodes = [0];
  return doc.finish();
}

function corrections(size) {
  const add = new Uint8Array(size * size), remove = new Uint8Array(add.length), source = new Uint8Array(add.length);
  for (let y = 0, p = 0; y < size; y++) for (let x = 0; x < size; x++, p++) {
    const u = ((x + .5) / size - .5) * 2.95, v = (.5 - (y + .5) / size) * 2.95;
    const oval = (a, b, rx, ry) => 1 - Math.hypot((u - a) / rx, (v - b) / ry);
    add[p] = Math.round(214 * profile(Math.max(oval(-.925, -.465, .113, .080), oval(-1.05, -.53, .065, .125)), .24));
    remove[p] = Math.round(255 * profile(insignia(u, v) + .024, .043));
    source[p] = Math.round(255 * profile(Math.max(
      oval(-.46, .52, .048, .058), oval(.48, .52, .042, .055), oval(.78, -.47, .033, .051),
      oval(-1.13, .72, .034, .074)), .47));
  }
  return { add, remove, source };
}

module.exports = { mesh, corrections };
