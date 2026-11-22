const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const files = require('./asset-files.js');

const captureFormat = 'ink-studio/shape-capture';
const radians = degrees => degrees * Math.PI / 180;
const filename = index => 'view-' + String(index + 1).padStart(2, '0') + '.png';
const parse = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function maskImage(mask, width, height) {
  const data = new Uint8Array(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) data.set([239, 225, 192, 255], i * 4);
  }
  return PNG.encode(width, height, data, 4);
}

function readMask(file, camera) {
  const bytes = fs.readFileSync(file), { w, h } = PNG.layout(bytes);
  if (w !== camera?.width || h !== camera?.height || w * h > 262144)
    throw new Error(path.basename(file) + ' must keep its exported dimensions');
  const { data, max } = PNG.raster(bytes);
  return Uint8Array.from({ length: w * h }, (_, index) => data[index * 4 + 3] >= max / 2 ? 1 : 0);
}

function command([action, source, ...extra], opt, kit) {
  const shapeFit = kit.KIT.turntableShape;
  const allowed = action === 'capture' ? ['out', 'yaw', 'pitch', 'w', 'h', 'cell'] : ['out', 'growth'];
  if (!['capture', 'fit'].includes(action) || !source || extra.length ||
      Object.entries(opt).some(([key, value]) => !allowed.includes(key) || value === true || !value.trim()))
    throw new Error('Use shape capture <source.js|shape.json> [--out dir] [--yaw degrees,...] [--pitch degrees] [--w pixels] [--h pixels] [--cell size] or shape fit <dir> [--out shape.json] [--growth voxels]');

  if (action === 'capture') {
    const width = Number(opt.w ?? 96), height = Number(opt.h ?? 96);
    const yaws = (opt.yaw ?? '-55,0,55').split(',').map(angle => angle.trim() ? Number(angle) : NaN);
    if (yaws.length < 2 || yaws.length > 12 || !yaws.every(Number.isFinite))
      throw new Error('Capture needs 2–12 yaw angles in degrees');
    const input = path.resolve(source);
    const saved = path.extname(input).toLowerCase() === '.json';
    if (!saved && path.extname(input).toLowerCase() !== '.js' && path.extname(input).toLowerCase() !== '.cjs')
      throw new Error('Capture needs a shape recipe (.js or .cjs) or a saved shape (.json)');
    if (saved && opt.cell !== undefined) throw new Error('--cell is only for a source recipe');
    const prior = saved ? parse(input) : (() => {
      const recipe = require(input)(kit);
      return shapeFit.fromSdf(recipe.distance, {
        bounds: recipe.bounds, cell: opt.cell === undefined ? recipe.cell : Number(opt.cell)
      });
    })();
    const views = yaws.map(yaw => shapeFit.camera(prior, { width, height, yaw: radians(yaw), pitch: radians(Number(opt.pitch ?? 0)) }));
    const directory = path.resolve(opt.out || 'studio/out/shape-capture');
    if (fs.existsSync(directory)) throw new Error('Capture destination already exists: ' + directory);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    const stage = fs.mkdtempSync(path.join(path.dirname(directory), '.ink-shape-'));
    try {
      for (const [i, camera] of views.entries()) {
        const bytes = maskImage(shapeFit.silhouette(prior, camera), width, height);
        fs.writeFileSync(path.join(stage, filename(i)), bytes);
      }
      files.json(path.join(stage, 'capture.json'), { format: captureFormat, version: 1, prior, views });
      fs.renameSync(stage, directory);
    } finally {
      fs.rmSync(stage, { force: true, recursive: true });
    }
    console.log(directory);
    return;
  }

  const directory = path.resolve(source), capture = parse(path.join(directory, 'capture.json'));
  if (capture?.format !== captureFormat || capture.version !== 1 || !Array.isArray(capture.views) ||
      capture.views.length < 2 || capture.views.length > 12) throw new Error('Expected a shape capture directory');
  const edits = capture.views.map((camera, i) => ({ camera, mask: readMask(path.join(directory, filename(i)), camera) }));
  const { shape, report } = shapeFit.fit(capture.prior, edits, { maxGrowth: Number(opt.growth ?? 4) });
  const output = path.resolve(opt.out || path.join(directory, 'proxy.json'));
  if (output === path.join(directory, 'capture.json') || edits.some((_, i) => output === path.join(directory, filename(i))))
    throw new Error('Choose a proxy output path distinct from the capture and views');
  files.json(output, shape);
  console.log(JSON.stringify({ output, ...report, views: report.views.map((view, i) => ({ file: filename(i), ...view })) }, null, 2));
}

module.exports = { command, maskImage, readMask };
