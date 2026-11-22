const sh0 = 0.28209479177387814;
const degree = 2, terms = (degree + 1) ** 2 - 1;

export const pelagicPalette = [
  0x0b1523, 0x132a3c, 0x24465c, 0x376981, 0x4089a8, 0x60acc1, 0x86d3d3, 0xbaebe4,
  0x302b4e, 0x50467a, 0x79609a, 0xa18abc, 0xc9acd4, 0xead7ed,
  0x402c42, 0x674659, 0xa15d67, 0xcd7e7b, 0xedac94, 0xffd5b0
];

function harmonics([x, y, z]) {
  const longitude = Math.atan2(z, x);
  const ripple = .7 + .27 * Math.cos(5 * longitude + 2 * y);
  return [
    [.12, .17, .20], [.08, -.22, .22], [.96 * ripple, -.54 * ripple, -.85 * ripple],
    [.04, -.10, .19], [.10, .06, -.08], [.03, .12, -.03], [.15, -.12, -.17],
    [-.08, .21 * Math.sin(longitude * 3), .20]
  ];
}

function points() {
  const cloud = [];
  for (let ring = 0; ring < 31; ring++) {
    const t = ring / 30;
    const radius = .19 + 1.1 * Math.sin(t * 2.7) ** .8;
    for (let dot = 0; dot < 104; dot++) {
      const a = 2 * Math.PI * dot / 104 + t * .65;
      const ridges = 1 + Math.cos(a * 11) * .095 * t;
      const shimmer = (.5 + .5 * Math.sin(a * 3 - t * 4)) ** 2;
      const edge = t ** 4;
      cloud.push([
        radius * ridges * Math.cos(a), .95 - 1.75 * t * t + .13 * t ** 2 * Math.cos(a * 11),
        radius * ridges * Math.sin(a), .030 + .013 * t, .036, .031, .62,
        .27 + .51 * edge + .14 * shimmer, .48 + .37 * shimmer + .07 * edge, .78 + .18 * shimmer
      ]);
    }
  }
  for (let strand = 0; strand < 15; strand++) {
    const a = strand * Math.PI * 2 / 15;
    for (let dot = 0; dot < 65; dot++) {
      const t = dot / 64;
      const sway = Math.sin(t * 6 + strand) * t * .23, spread = 1.16 - .5 * t + sway;
      cloud.push([spread * Math.cos(a + t * .52), -.76 - 1.28 * t, spread * Math.sin(a + t * .52),
        .018 + .02 * (1 - t), .034, .020, .75 - .45 * t, .71, .79 + .16 * Math.cos(a), .97]);
    }
  }
  return cloud;
}

function pelagicTangent(index, [x, y, z]) {
  const bell = index < 31 * 104;
  const radial = Math.hypot(x, z);
  const t = bell ? Math.floor(index / 104) / 30 : 0;
  const slope = bell ? 1.9 * Math.cos(t * 2.7) : .18;
  const side = bell ? Math.max(.12, 2.8 * t) : 1;
  const length = Math.hypot(side, slope);
  const nx = side / length * x / radial, ny = slope / length, nz = side / length * z / radial;
  if (nz < -.999999) return [0, 1, 0, 0];
  const norm = Math.hypot(nx, ny, 1 + nz);
  return [(1 + nz) / norm, -ny / norm, nx / norm, 0];
}

export function samplePly({ materialSurface = false } = {}) {
  const cloud = points();
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2',
    ...Array.from({ length: terms * 3 }, (_, i) => 'f_rest_' + i)];
  const header = new TextEncoder().encode(['ply', 'format binary_little_endian 1.0', 'element vertex ' + cloud.length,
    ...fields.map(name => 'property float ' + name), 'end_header', ''].join('\n'));
  const result = new Uint8Array(header.length + cloud.length * fields.length * 4);
  result.set(header);
  const data = new DataView(result.buffer);
  let offset = header.length;
  for (const [index, point] of cloud.entries()) {
    const [x, y, z, sx, sy, sz, alpha, r, g, b] = point;
    const sh = harmonics(point);
    const rotation = materialSurface ? pelagicTangent(index, point) : [1, 0, 0, 0];
    const values = [x, y, z, Math.log(sx), Math.log(sy), Math.log(materialSurface ? sz * .48 : sz), ...rotation,
      Math.log(alpha / (1 - alpha)), ...[r, g, b].map(c => (c - .5) / sh0),
      ...[0, 1, 2].flatMap(channel => sh.map(row => row[channel]))];
    for (const value of values) {
      data.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  return result;
}

export function pelagicMaterialMasks(count) {
  return [[0, 24 * 104], [24 * 104, 31 * 104], [31 * 104, count]].map(([start, end]) => ({
    count, indices: Array.from({ length: end - start }, (_, index) => start + index)
  }));
}

export async function sampleSpz() {
  const cloud = points(), count = cloud.length;
  const bytes = new Uint8Array(16 + count * (20 + terms * 3)), data = new DataView(bytes.buffer);
  const alphaStart = 16 + count * 9, colorStart = alphaStart + count;
  const scaleStart = colorStart + count * 3, rotationStart = scaleStart + count * 3;
  const shStart = rotationStart + count * 4;
  data.setUint32(0, 0x5053474e, true);
  data.setUint32(4, 3, true);
  data.setUint32(8, count, true);
  bytes[12] = degree;
  bytes[13] = 12;
  for (let i = 0; i < count; i++) {
    const point = cloud[i];
    for (let j = 0; j < 3; j++) {
      const fixed = Math.round(point[j] * 4096);
      const p = 16 + i * 9 + j * 3;
      bytes[p] = fixed & 255;
      bytes[p + 1] = fixed >> 8 & 255;
      bytes[p + 2] = fixed >> 16 & 255;
      bytes[scaleStart + i * 3 + j] = Math.round((Math.log(point[3 + j]) + 10) * 16);
      bytes[colorStart + i * 3 + j] = Math.round((.5 + .15 * (point[7 + j] - .5) / sh0) * 255);
    }
    for (const [term, rgb] of harmonics(point).entries()) {
      for (let channel = 0; channel < 3; channel++)
        bytes[shStart + (i * terms + term) * 3 + channel] = Math.round(128 + rgb[channel] * 128);
    }
    bytes[alphaStart + i] = Math.round(point[6] * 255);
    data.setUint32(rotationStart + i * 4, 0xc0000000, true);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
