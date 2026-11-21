const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { KIT: K }) => {
  if (!pos[0]) throw new Error('render-grid needs hex, triangle, diamond or a settings JSON file');
  const api = K.renderGrid;
  const definition = api.modes.includes(pos[0])
    ? {
        mode: pos[0],
        size: +(opt.size ?? 8),
        angle: +(opt.angle ?? 0),
        aspect: +(opt.aspect ?? 1),
        gap: +(opt.gap ?? 0)
      }
    : JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8'));
  const plan = api.prepare(definition);
  if (!plan) throw new Error('render-grid needs an enabled grid');
  const w = +(opt.w ?? 900),
    h = +(opt.h ?? 620),
    resources = api.dimensions(plan, w, h);
  const point = opt.point === undefined ? [w / 2, h / 2] : String(opt.point).split(',').map(Number);
  if (point.length !== 2) throw new Error('--point needs x,y');
  const report = {
    mode: plan.mode,
    size: plan.size,
    origin: plan.origin,
    angle: plan.angle,
    aspect: plan.aspect,
    gap: plan.gap,
    gapColor: plan.gapColor,
    width: w,
    height: h,
    resources,
    cell: api.cellAt(plan, ...point)
  };
  if (opt.bounds !== undefined) {
    const bounds = String(opt.bounds).split(',').map(Number);
    report.cells = api.cells(plan, bounds, { maxCells: +(opt['max-cells'] ?? 4096) });
  }
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const file = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
    console.log('wrote ' + file);
  } else process.stdout.write(json);
};
