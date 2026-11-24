const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const names = ['out', 'report', 'materials', 'out-materials', 'settings', 'partial'];

function command(args, options, topology) {
  const { out, report, materials, settings, 'out-materials': outputMaterials, partial } = options;
  const inputs = [...args, materials, settings].filter(value => value !== undefined);
  const outputs = [out, outputMaterials, report].filter(value => value !== undefined);
  if (args.length !== 3 || [...inputs, ...outputs].some(file => typeof file !== 'string' || !file.trim()) ||
      Object.keys(options).some(key => !names.includes(key)) || partial !== undefined && partial !== 'on' ||
      outputMaterials && !out || out && materials && !outputMaterials)
    throw new TypeError('Use mesh-topology transfer-materials <before.json> <replacement.json> <map.json> with separate output paths for the mesh and material data');
  const inputPaths = new Set(inputs.map(file => path.resolve(file)));
  const outputPaths = outputs.map(file => path.resolve(file));
  if (outputPaths.some(file => inputPaths.has(file)) || new Set(outputPaths).size !== outputPaths.length)
    throw new RangeError('Write material transfer outputs separately from their inputs');
  const tuning = settings ? read(settings) : {};
  if (!tuning || Object.getPrototypeOf(tuning) !== Object.prototype || Object.keys(tuning).some(key =>
    !['maxDistance', 'minNormalDot', 'ambiguityDistance', 'maxUVError', 'maxChecks'].includes(key)))
    throw new TypeError('Material transfer settings need projection distance, alignment, UV error or work limits');
  const plan = topology.transferMaterials(...args.map(read), { ...tuning, ...(materials && { materials: read(materials) }) });
  if (report) files.json(path.resolve(report), plan.report);
  if (!out) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
    return;
  }
  if (!plan.report.complete && partial !== 'on')
    throw new RangeError('Material transfer needs review. Inspect the report or explicitly use --partial on.');
  if (outputMaterials) files.json(path.resolve(outputMaterials), plan.materials);
  files.json(path.resolve(out), plan.document);
}

module.exports = { command };
