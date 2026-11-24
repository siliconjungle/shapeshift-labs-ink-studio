const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const approved = require('./turntable-shape-views.js');

const captureFormat = 'ink-studio/shape-capture';
const radians = degrees => degrees * Math.PI / 180;
const stem = index => 'view-' + String(index + 1).padStart(2, '0');
const filename = index => stem(index) + '.png';
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

const reviewColors = {
  background: [17, 28, 39], surface: [224, 182, 119], opening: [111, 216, 172],
  obscured: [105, 127, 210], missing: [255, 134, 102], extra: [252, 94, 140], unseen: [111, 122, 130]
};

function reviewImage(image) {
  const { width: w, height: h, mask, occluded, blocked, sampled, disagreement, protectedOpening } = image;
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) {
    const gap = protectedOpening?.[p], difference = disagreement[p];
    const color = difference === 1 ? 'missing' : difference === 2 ? 'extra' :
      mask[p] ? 'surface' : difference === 3 || occluded?.[p] || gap && blocked?.[p] ? 'obscured' :
      gap ? sampled?.[p] ? 'opening' : 'unseen' : 'background';
    rgb.set(reviewColors[color], p * 3);
  }
  return { w, h, rgb };
}

function writeReview(file, image) {
  const { w, h, rgb } = reviewImage(image);
  files.write(file, PNG.encode(w, h, rgb, 3));
}

function command([action, source, ...extra], opt, kit, { build } = {}) {
  const shapeFit = kit.KIT.turntableShape;
  const allowed = action === 'capture' ? ['out', 'yaw', 'pitch', 'w', 'h', 'cell', 'views'] : ['out', 'growth', 'review'];
  if (!['capture', 'fit'].includes(action) || !source || extra.length ||
      Object.entries(opt).some(([key, value]) => !allowed.includes(key) || value === true || !value.trim()))
    throw new Error('Use shape capture <source.js|shape.json> [--out dir] [--views plan.json | --yaw degrees,... --pitch degrees --w pixels --h pixels] [--cell size] or shape fit <dir> [--out shape.json] [--growth voxels] [--review dir]');

  if (action === 'capture') {
    if (opt.views && ['yaw', 'pitch', 'w', 'h'].some(key => opt[key] !== undefined))
      throw new Error('Approved perspective views supply their own framing and dimensions');
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
    const legacy = opt.views === undefined;
    const views = legacy ? yaws.map(yaw => shapeFit.camera(prior, { width, height, yaw: radians(yaw), pitch: radians(Number(opt.pitch ?? 0)) })) :
      approved.read(path.resolve(opt.views), kit, build);
    const directory = path.resolve(opt.out || 'studio/out/shape-capture');
    if (fs.existsSync(directory)) throw new Error('Capture destination already exists: ' + directory);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    const stage = fs.mkdtempSync(path.join(path.dirname(directory), '.ink-shape-'));
    try {
      const records = views.map((view, i) => {
        if (legacy) {
          const bytes = maskImage(shapeFit.silhouette(prior, view), view.width, view.height);
          fs.writeFileSync(path.join(stage, filename(i)), bytes);
          return view;
        }
        const { camera, occluderDepth, ...row } = view;
        const { mask, occluded } = shapeFit.observe(prior, camera, view);
        const { width, height } = camera;
        fs.writeFileSync(path.join(stage, filename(i)), maskImage(mask, width, height));
        const unseen = stem(i) + '-occluded.png';
        fs.writeFileSync(path.join(stage, unseen), maskImage(occluded, width, height));
        const depth = occluderDepth && stem(i) + '-depth.f32';
        const checksum = depth && approved.exportDepth(path.join(stage, depth), occluderDepth);
        return { ...row, camera, occluded: unseen, ...(depth && { depth, checksum }) };
      });
      files.json(path.join(stage, 'capture.json'), { format: captureFormat, version: legacy ? 1 : 2, prior, views: records });
      fs.renameSync(stage, directory);
    } finally {
      fs.rmSync(stage, { force: true, recursive: true });
    }
    console.log(directory);
    return;
  }

  const directory = path.resolve(source), capture = parse(path.join(directory, 'capture.json'));
  if (capture?.format !== captureFormat || ![1, 2].includes(capture.version) || !Array.isArray(capture.views) ||
      capture.views.length < 2 || capture.views.length > 12) throw new Error('Expected a shape capture directory');
  const inputs = new Set([path.join(directory, 'capture.json')]);
  const edits = capture.views.map((view, i) => {
    const image = path.join(directory, filename(i));
    inputs.add(image);
    if (capture.version === 1) return { camera: view, mask: readMask(image, view) };
    const { id, camera, depth, checksum, depthBias, openings } = view;
    let occluderDepth;
    if (depth !== undefined) {
      if (depth !== stem(i) + '-depth.f32' || typeof checksum !== 'string' || !/^[0-9a-f]{64}$/.test(checksum))
        throw new RangeError('Invalid recorded occluder depth');
      const file = path.join(directory, depth);
      inputs.add(file);
      occluderDepth = approved.depthFile(file, shapeFit.perspectiveCamera(camera), checksum);
    }
    if (view.occluded === stem(i) + '-occluded.png') inputs.add(path.join(directory, view.occluded));
    return { id, camera, mask: readMask(image, camera), occluderDepth, depthBias, openings };
  });
  const output = path.resolve(opt.out || path.join(directory, 'proxy.json'));
  const reviewDirectory = opt.review && path.resolve(opt.review);
  const reviewFiles = edits.map((_, i) => reviewDirectory && path.join(reviewDirectory, stem(i) + '-review.png'));
  if (inputs.has(output) || reviewFiles.some(file => file && (file === output || inputs.has(file))))
    throw new Error('Choose proxy and review outputs distinct from the capture and views');
  const { shape, report, review } = shapeFit.fit(capture.prior, edits,
    { maxGrowth: Number(opt.growth ?? 4), review: Boolean(reviewDirectory) });
  if (review) for (const [i, image] of review.entries()) writeReview(reviewFiles[i], image);
  files.json(output, shape);
  console.log(JSON.stringify({ output, ...report, views: report.views.map((view, i) =>
    ({ file: filename(i), ...view, ...(reviewDirectory && { review: reviewFiles[i] }) })) }, null, 2));
}

module.exports = { command, maskImage, readMask, reviewImage };
