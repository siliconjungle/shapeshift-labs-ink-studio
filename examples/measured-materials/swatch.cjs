/* An original ceramic relief used to generate controlled scan inputs. */
const Color = require('../../src/color-space.js');
const clamp = n => Math.max(0, Math.min(1, n));
const linear = Color.prepare('srgb', 'srgb-linear');
const rgb = hex => linear([hex >> 16, (hex >> 8) & 255, hex & 255].map(n => n / 255));
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const width = 184, height = 142, pitch = .36;
const dark = rgb(0x133e46), water = rgb(0x377e79), turquoise = rgb(0x76ada0);
const bronze = rgb(0x882f29), copper = rgb(0xca7646), cream = rgb(0xf6d99f);
const deep = rgb(0x1a282e), white = rgb(0xf2ddbe), buff = rgb(0xa77c58);
const bird = [[39, 71], [29, 61], [49, 70], [61, 77], [56, 68], [81, 79], [93, 80], [103, 75], [111, 62],
  [112, 52], [117, 44], [125, 41], [132, 45], [151, 47], [133, 51], [124, 51], [123, 62], [119, 81],
  [110, 92], [99, 97], [87, 99], [83, 113], [72, 114], [74, 111], [79, 110], [80, 99], [67, 95], [55, 86]];
const wing = [[53, 78], [65, 82], [77, 86], [91, 85], [104, 79], [102, 88], [92, 93], [80, 94], [68, 90]];
const stars = [[60, 35], [74, 40], [43, 47], [94, 31], [88, 48], [27, 40], [50, 54]];

function signedPolygon(x, y, points) {
  let inside = false, d = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i], dx = bx - ax, dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
    d = Math.min(d, (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2);
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
  }
  return (inside ? 1 : -1) * Math.sqrt(d);
}

function plate(x, y) {
  const dx = Math.abs(x - 91.5) - 75, dy = Math.abs(y - 70.5) - 54;
  const edge = 11.5 - Math.hypot(Math.max(0, dx), Math.max(0, dy)) - Math.min(0, Math.max(dx, dy));
  const alpha = clamp(edge + .4), noise = Math.sin(x * 2.172 + y * 1.681) * Math.cos(y * 1.08 - x * 1.513);
  if (!alpha) return { alpha, z: 0, color: deep };
  const fascia = clamp((edge - 2.5) / 3.2);
  const ring = clamp(1.4 - Math.abs(edge - 7.1)), inset = clamp((edge - 8) / 2);
  let z = -.44 + .76 * fascia + .24 * ring - .43 * inset + noise * .023;
  let color = mix(mix(bronze, copper, fascia), cream, ring * .7);
  const striation = .4 + .18 * Math.sin(y * .075 + x * .06) + .09 * Math.sin(x * .21 - y * .09);
  const wave = y > 89 && [0, 11, 22, 31].some((offset, i) =>
    Math.abs(y - (91 + offset + 3.2 * Math.sin(x * .078 + i * .9))) < .9 && x > 13 + i * 5 && x < 173 - i * 5);
  let field = mix(dark, water, striation + (wave ? .36 : 0));
  if (wave && edge > 11) z -= .08;
  const sunShape = clamp((23 - Math.hypot(x - 131, y - 47)) / 2.1);
  const ray = stars.some(([u, v]) => Math.abs(x - u) + Math.abs(y - v) < 1.65);
  field = mix(field, mix(copper, cream, clamp((63 - y + noise * 4) / 42)), sunShape);
  if (ray) field = mix(field, cream, .88);
  z += .42 * sunShape;
  const carve = clamp((signedPolygon(x, y, bird) + .55) / 2);
  const mantle = clamp((signedPolygon(x, y, wing) + .25) / 1.6);
  const eye = clamp(1.8 - Math.hypot(x - 124.5, y - 46.3));
  let feathers = mix(white, buff, clamp((y - 62) / 85) + mantle * .26);
  feathers = mix(feathers, deep, eye);
  if (x > 132 && y < 54) feathers = mix(cream, copper, .49);
  field = mix(field, feathers, carve);
  z += carve * .72 + .31 * mantle;
  color = mix(color, field, inset);
  const glaze = Math.max(0, .97 + noise * .027 + .035 * Math.sin(x * .045 + y * .072));
  return { alpha, z, color: color.map(n => n * glaze), roughness: .52 - .22 * inset + .13 * carve + .06 * ring };
}
const unit = tuple => {
  const scale = Math.hypot(...tuple);
  return tuple.map(n => n / scale);
};
function normal(x, y) {
  return unit([(plate(x - 1, y).z - plate(x + 1, y).z) / (2 * pitch),
    (plate(x, y + 1).z - plate(x, y - 1).z) / (2 * pitch), 1]);
}
const black = [.015, .009, .013];
const responses = [[.91, .13, .76, .09, .93], [1.08, .08, .88, .045, .7], [.79, .15, 1.02, .04, .88]];
const patches = [[.75, .12, .12], [.15, .72, .12], [.16, .15, .72], [.76, .7, .63], [.22, .34, .55], [.43, .34, .16]];
const poses = [
  { id: 'front', width, height, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], light: [-.82, .47, .66], ambient: [.19, .25, .3] },
  { id: 'port', width: 242, height: 190, matrix: [1.06, .12, 14, -.09, 1.015, 32, .00059, -.00028, 1],
    light: [.96, .13, .61], ambient: [.22, .19, .17] },
  { id: 'starboard', width: 242, height: 192, matrix: [1.04, -.12, 33, .1, 1.07, 12, -.00032, .00035, 1],
    light: [.10, -.92, .72], ambient: [.31, .24, .21] }
];
const mul = (m, x, y) => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};
function adjugate([a, b, c, d, e, f, g, h, i]) {
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g,
    c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}

function observation(pose, index) {
  const size = pose.width * pose.height, inverse = adjugate(pose.matrix);
  const color = new Float32Array(size * 4), relief = new Float32Array(size);
  const mask = new Uint8Array(size), coverage = new Uint8Array(size), roughness = new Uint8Array(size);
  const energy = [[1.52, 1.12, .75], [1.1, 1.29, 1.58], [.92, 1.16, 1.29]][index];
  const direction = unit(pose.light);
  const [a, b, c, d, e] = responses[index];
  const camera = ([r, g, bValue]) => [a * r + b * g + black[0], c * g + d * bValue + black[1], e * bValue + black[2]];
  for (let y = 0, p = 0; y < pose.height; y++) for (let x = 0; x < pose.width; x++, p++) {
    const [u, v] = mul(inverse, x, y), sample = plate(u, v);
    if (!sample.alpha) continue;
    const n = normal(u, v), facing = Math.max(0, n.reduce((sum, value, lane) => sum + value * direction[lane], 0));
    const flare = index === 1 ? .22 * Math.exp(-((u - 57) ** 2 + (v - 70) ** 2) / 140) :
      index === 2 ? .77 * Math.exp(-((u - 138) ** 2 + (v - 66) ** 2) / 170) : 0;
    const light = energy.map((n, c) => pose.ambient[c] + facing * n);
    const measured = camera(sample.color.map((n, c) => n * light[c] + flare));
    color.set([...measured.map(n => Math.min(1.25, n)), sample.alpha], p * 4);
    const bubble = ((u - 121) / 14) ** 2 + ((v - 106) / 8) ** 2;
    relief[p] = sample.z + (index === 2 ? .48 * Math.max(0, 1 - bubble) : 0);
    mask[p] = (index === 1 && (u - 53) ** 2 + (v - 103) ** 2 < 56) ? 0 : 255;
    coverage[p] = Math.round(sample.alpha * 255);
    roughness[p] = Math.round(sample.roughness * 255);
  }
  const landmarks = [[10, 10], [171, 11], [171, 129], [12, 129], [88, 49], [65, 104]]
    .map(target => ({ target, source: mul(pose.matrix, ...target) }));
  return { id: pose.id, width: pose.width, height: pose.height, color, relief, mask, coverage, roughness, landmarks,
    lighting: { ambient: pose.ambient, lights: [{ direction, strength: energy }] },
    calibration: { black, patches: patches.map(reference => ({ measured: camera(reference), reference })) } };
}
module.exports = { width, height, pitch, plate, poses, observation };
