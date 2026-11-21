const sh0 = 0.28209479177387814;

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

export function samplePly() {
  const cloud = points();
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2',
    'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  const header = new TextEncoder().encode(['ply', 'format binary_little_endian 1.0', 'element vertex ' + cloud.length,
    ...fields.map(name => 'property float ' + name), 'end_header', ''].join('\n'));
  const result = new Uint8Array(header.length + cloud.length * fields.length * 4);
  result.set(header);
  const data = new DataView(result.buffer);
  let offset = header.length;
  for (const [x, y, z, sx, sy, sz, alpha, r, g, b] of cloud) {
    const values = [x, y, z, Math.log(sx), Math.log(sy), Math.log(sz), 1, 0, 0, 0,
      Math.log(alpha / (1 - alpha)), ...[r, g, b].map(c => (c - .5) / sh0)];
    for (const value of values) {
      data.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  return result;
}

export async function sampleSpz() {
  const cloud = points(), count = cloud.length;
  const bytes = new Uint8Array(16 + count * 20), data = new DataView(bytes.buffer);
  const alphaStart = 16 + count * 9, colorStart = alphaStart + count;
  const scaleStart = colorStart + count * 3, rotationStart = scaleStart + count * 3;
  data.setUint32(0, 0x5053474e, true);
  data.setUint32(4, 3, true);
  data.setUint32(8, count, true);
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
    bytes[alphaStart + i] = Math.round(point[6] * 255);
    data.setUint32(rotationStart + i * 4, 0xc0000000, true);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
