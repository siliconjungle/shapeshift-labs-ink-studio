const fs = require('node:fs'),
  path = require('node:path');
const files = require('./asset-files.js');
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

function topology([action,source,request,...extra], opt, api) {
  const edit=action==='edit';
  if ((!edit && action!=='inspect') || !source || (edit ? !request : request!==undefined) || extra.length ||
      Object.entries(opt).some(([key,value])=>typeof value!=='string' || !['out',...(edit ? ['report'] : [])].includes(key)))
    throw new TypeError('Use curve topology inspect <splines.json> or edit <splines.json> <operations.json>');
  const [input, operations, out, receipt]=[source,request,opt.out,opt.report].map(file=>file && path.resolve(file));
  if ([out,receipt].some(file=>file && (file===input || file===operations)) || out && out===receipt)
    throw new RangeError('Write spline documents and receipts separately from their inputs');
  const doc=read(input);
  if (!edit) {
    const report=api.inspect(doc);
    if (out) files.json(out,report);
    else process.stdout.write(JSON.stringify(report,null,2)+'\n');
    return;
  }
  const {document,report}=api.plan(doc,read(operations));
  if (out) files.json(out,document);
  if (receipt) files.json(receipt,report);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

module.exports = function curveCLI(pos, opt, kit) {
  const C=kit.KIT.curve;
  if (pos[0] === 'bend') {
    if (!C.bend) throw new Error('This toolkit has no retained spline bend support');
    return require('./geometry-authoring.js').bend(pos.slice(1), opt, C.bend);
  }
  if (pos[0]==='topology') {
    if (!C.retained) throw new Error('This toolkit has no retained spline support');
    return topology(pos.slice(1),opt,C.retained);
  }
  if (!pos[0]) throw Error('curve needs a curve family or retained spline JSON file');
  const definition=read(pos[0]), retained=C.retained && definition.format===C.retained.format;
  if (!retained && (opt.spline!==undefined || opt.station!==undefined))
    throw new TypeError('--spline and --station require a retained spline document');
  const curve=retained ? C.retained.compile(definition,opt.spline) : definition.points
    ? C.interpolate(definition.points,definition.options ?? {}) : C.create(definition);
  const report = {
    definition: curve.snapshot(),
    closed: curve.closed,
    length: curve.length,
    properties: curve.properties,
    sampling: curve.sampling,
    parameters: curve.parameters,
    points: curve.points,
    ...(curve.generation !== undefined && { generation: curve.generation, segments: curve.segments, cells: curve.cells })
  };
  if (retained) report.sections=curve.sections;
  if (opt.station !== undefined) {
    if (typeof opt.station!=='string') throw new TypeError('--station needs a normalized route position');
    report.anchor=curve.locate(Number(opt.station));
  }
  if (opt.distance !== undefined) report.sample = curve.at(Number(opt.distance));
  if (opt.closest !== undefined) report.closest = curve.closest(String(opt.closest).split(',').map(Number));
  if (opt.curvature !== undefined) report.curvature = curve.curvature(Number(opt.curvature));
  if (opt.text !== undefined) report.drawing = kit.KIT.curve.text(curve, String(opt.text), { fit: true });
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const file = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, json);
  } else process.stdout.write(json);
};
