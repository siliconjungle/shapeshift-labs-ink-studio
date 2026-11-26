'use strict';

const { hypot, PI, sin, cos, sqrt } = Math;
const unit = p => p.map(n => n / hypot(...p));
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const display = n => n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055;
const sh0 = .28209479177387814;
const captureLight = { direction: unit([-.55, .75, .47]), ambient: .37, key: .63 };

function spiral(count) {
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - 2 * (i + .5) / count, a = PI * (3 - sqrt(5)) * i, r = sqrt(1 - y * y);
    return [r * cos(a), y, r * sin(a)];
  });
}

function rows() {
  const data = [];
  function part(center, radii, count, scale, material) {
    for (const uv of spiral(count)) {
      const position = center.map((n, k) => n + uv[k] * radii[k]);
      const normal = unit(uv.map((n, k) => n / radii[k]));
      const [pigment, roughness, specular] = material(...uv);
      data.push({ position, normal, scale, pigment, roughness, specular });
    }
  }
  const ochre = [.64, .24, .044], teal = [.035, .34, .31], navy = [.026, .08, .13], ivory = [.67, .58, .32];
  part([0, 0, 0], [.86, 1.04, .66], 1600, .047, (x, y, z) => {
    if (y < -.69 || y > .74) return [navy, .77, .27];
    if (Math.abs(y - .63 + .13 * x) < .078 || Math.abs(y + .61 + .13 * x) < .061) return [ivory, .68, .3];
    if (Math.abs(x) < .56 && y > -.18 && y < .49 && z > .57) return [teal, .58, .55];
    return [ochre, .49, .63];
  });
  part([0, .07, .59], [.45, .24, .17], 330, .037, (x, y, z) => {
    if (z < .5 || x < -.70 || x > .70 || Math.abs(y) > .49) return [navy, .81, .22];
    return [[.11, .62, .48], .62, .54];
  });
  part([-.78, .25, -.02], [.23, .27, .18], 175, .036, () => [teal, .72, .4]);
  part([.76, .26, -.015], [.26, .29, .19], 190, .035, () => [ivory, .45, .61]);
  part([-.24, .95, -.04], [.10, .28, .09], 124, .023, () => [navy, .73, .27]);
  part([-.24, 1.19, -.04], [.15, .15, .15], 180, .026, () => [ochre, .52, .63]);
  for (const x of [-.28, 0, .28])
    part([x, -.44, .59], [.053, .052, .059], 36, .019, () => [ivory, .66, .38]);
  return data;
}

function ply(points, shBasis, degree = 4) {
  const terms = (degree + 1) ** 2 - 1;
  const samples = spiral(480).map(view => ({ view, sh: shBasis(view.map(n => -n), degree) }));
  const fields = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
    'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2', ...Array.from({ length: 3 * terms }, (_, i) => 'f_rest_' + i)];
  const header = Buffer.from(['ply', 'format binary_little_endian 1.0', 'element vertex ' + points.length,
    ...fields.map(name => 'property float ' + name), 'end_header', ''].join('\n'));
  const bytes = Buffer.alloc(points.length * fields.length * 4);
  let at = 0;
  for (const row of points) {
    const { position, normal, scale, pigment, roughness, specular } = row;
    const light = captureLight.direction, facing = Math.max(0, dot(light, normal));
    const reflection = normal.map((n, k) => 2 * facing * n - light[k]);
    const direct = captureLight.key * facing, diffuse = pigment.map(n => n * (captureLight.ambient + direct));
    const dc = diffuse.map(display), constants = dc.slice(), harmonics = new Float64Array(3 * terms);
    for (const { view, sh } of samples) {
      const bounce = direct * specular * Math.max(0, dot(reflection, view)) ** (2 / roughness ** 2 - 1);
      for (let c = 0; c < 3; c++) {
        const delta = display(Math.min(1, diffuse[c] + bounce)) - dc[c];
        constants[c] += delta / samples.length;
        for (let j = 0; j < terms; j++) harmonics[c * terms + j] += delta * sh[j] * (4 * PI / samples.length);
      }
    }
    // Rotate the shortest local axis (+Z) onto the authored surface normal.
    const [x, y, z] = normal, [q0, q1, q2, q3] = z < -.999999 ? [0, 1, 0, 0] : unit([1 + z, -y, x, 0]);
    const values = [...position, Math.log(scale), Math.log(scale), Math.log(scale * .30), q0, q1, q2, q3,
      2.94, ...constants.map(n => (n - .5) / sh0), ...harmonics];
    for (const n of values) { bytes.writeFloatLE(n, at); at += 4; }
  }
  return Buffer.concat([header, bytes]);
}

module.exports = { rows, ply, captureLight };
