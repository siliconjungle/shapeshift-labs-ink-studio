const fs = require('node:fs'),
  path = require('node:path');
module.exports = function curveCLI(pos, opt, kit) {
  if (!pos[0]) throw Error('curve needs a curve-family JSON file');
  const curve = kit.KIT.curve.create(JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')));
  const report = {
    definition: curve.snapshot(),
    closed: curve.closed,
    length: curve.length,
    properties: curve.properties,
    points: curve.points
  };
  if (opt.distance !== undefined) report.sample = curve.at(Number(opt.distance));
  if (opt.text !== undefined) report.drawing = kit.KIT.curve.text(curve, String(opt.text), { fit: true });
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const file = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
  } else process.stdout.write(json);
};
