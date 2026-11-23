import { decodeGaussianPly } from '../../webgpu.mjs';
import { samplePly } from '../webgpu-graphs/sample.mjs';

const sh0 = .28209479177387814;
const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity',
  'f_dc_0', 'f_dc_1', 'f_dc_2'];
export const cameras = {
  detail: { target: [.1, -.2, 9.8], dist: 14.3, yaw: -.05, pitch: -.045, fov: .44 },
  wide: { target: [0, 0, -3], dist: 39, yaw: -.11, pitch: -.08, fov: .66 }
};

export function reefPly() {
  const jelly = decodeGaussianPly(samplePly());
  const forms = [
    { x: -1.7, y: .45, z: 2.4, size: 1.45, color: [.32, 1.06, 1.03] },
    { x: 1.4, y: -.09, z: 1.1, size: 1.14, color: [1.09, .68, .57] },
    { x: 3.5, y: 1.8, z: -3.3, size: .67, color: [.75, .61, 1.0] },
    { x: -4.1, y: 1.4, z: -3.6, size: .78, color: [.36, .76, 1.0] }
  ];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 12; col++) {
      forms.push({
        x: (col - 5.5) * 3.5 + .9 * Math.cos(row * 3 + col),
        y: Math.sin(col * 2.1 + row) * (1.3 + row * .47) + .5,
        z: -9 - row * 4.1 + Math.cos(col * 1.2) * 2,
        size: .39 + .45 * (.5 + .5 * Math.sin(row * 3.2 + col * 1.8)),
        color: col % 3 === 0 ? [.68, .40, .69] : [.26, .68, .78]
      });
    }
  }
  const count = forms.length * jelly.count;
  const header = new TextEncoder().encode(['ply', 'format binary_little_endian 1.0', 'element vertex ' + count,
    ...fields.map(name => 'property float ' + name), 'end_header', ''].join('\n'));
  const bytes = new Uint8Array(header.length + count * fields.length * 4);
  bytes.set(header);
  const data = new DataView(bytes.buffer, header.length);
  let cursor = 0;
  for (const [i, form] of forms.entries()) {
    const twist = .45 * Math.sin(i * 4.1), roll = .17 * Math.sin(i * 1.6);
    const cos = Math.cos(twist), sin = Math.sin(twist), rx = Math.cos(roll), ry = Math.sin(roll);
    const warmth = i === 1;
    for (let n = 0; n < jelly.count; n++) {
      const j = n * 3, alpha = jelly.opacity[n] * (i < 4 ? .88 : .55);
      const x = jelly.positions[j], y = jelly.positions[j + 1], z = jelly.positions[j + 2];
      const px = x * cos + z * sin, pz = z * cos - x * sin;
      const tide = .07 * Math.sin(4.1 * y + 1.8 * z + i);
      const values = [
        form.x + form.size * (px * rx - y * ry + tide),
        form.y + form.size * (px * ry + y * rx),
        form.z + form.size * pz,
        ...[0, 1, 2].map(axis => Math.log(jelly.scales[j + axis] * form.size * .88)),
        1, 0, 0, 0, Math.log(alpha / (1 - alpha)),
        ...form.color.map((gain, axis) => {
          const source = .5 + sh0 * jelly.dc[j + (warmth ? [2, 1, 0][axis] : axis)];
          return (Math.min(1, source * gain) - .5) / sh0;
        })
      ];
      for (const value of values) {
        data.setFloat32(cursor, value, true);
        cursor += 4;
      }
    }
  }
  return bytes;
}
