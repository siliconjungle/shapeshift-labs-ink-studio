const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('splat-footprints needs a shape name or profile JSON file');
  const F = K.splatFootprints,
    definition = F.types.includes(pos[0])
      ? {
          shape: pos[0],
          rotation: +(opt.rotation ?? 0),
          stretch: String(opt.stretch ?? '1,1')
            .split(',')
            .map(Number),
          softness: +(opt.softness ?? 0.08)
        }
      : JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
  const p = F.prepare(definition);
  if (!p) throw new Error('splat-footprints needs an enabled profile');
  const point = String(opt.point ?? '0,0')
    .split(',')
    .map(Number);
  if (point.length !== 2 || !point.every(Number.isFinite)) throw new Error('--point needs finite x,y');
  const report = {
    profile: p,
    point,
    distance: F.distance(p, ...point),
    coverage: F.coverage(p, ...point),
    sdf: { resolution: F.resolution, bytes: F.field(p).byteLength },
    supportSigma: p.reach
  };
  if (opt.preview) {
    const w = +(opt.w ?? 320),
      h = +(opt.h ?? 320);
    if (![w, h].every(n => Number.isInteger(n) && n >= 16 && n <= 2048))
      throw new RangeError('Footprint preview dimensions must be 16–2048');
    const rgb = new Uint8Array(w * h * 3),
      map = F.transform(p, 1, 0, 1);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const a = F.sample(p, map, ((x + 0.5 - w / 2) * 5) / w, ((h / 2 - y - 0.5) * 5) / h),
          check = (((x / 12) | 0) + ((y / 12) | 0)) & 1;
        const bg = check ? [18, 56, 68] : [8, 28, 41],
          fg = [255, 213, 139];
        for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = Math.round(bg[c] * (1 - a) + fg[c] * a);
      }
    const file = path.resolve(opt.preview);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    require('./png').write(file, w, h, rgb);
    report.preview = file;
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const file = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
    console.log('wrote ' + file);
  } else process.stdout.write(json);
};
