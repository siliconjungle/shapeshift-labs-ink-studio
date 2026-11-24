const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');

const usage = 'Use mesh-topology inspect|triangulate <mesh.json>, edit <mesh.json> <patch.json>, correspond <before.json> <after.json>, select <mesh-or-scene.json> <query.json>, or transform <mesh-or-scene.json> <request.json>';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function select(file, input, rest, opt, meshTopology, build) {
  const { object, view, visibility, from, out } = opt;
  const args = [file, input, view, visibility, from].filter(value => value !== undefined);
  if (!file || !input || rest.length || args.some(value => typeof value !== 'string' || !value.trim()) ||
      [object, out].some(value => value !== undefined && (typeof value !== 'string' || !value.trim())) ||
      view && (!object || visibility) || ['report', 'projection', 'lineage', 'match-ids'].some(key => opt[key] !== undefined))
    throw new TypeError('Use mesh-topology select <mesh-or-scene.json> <query.json> [--object id] [--from file] [--view file | --visibility file]');
  if (out && args.some(arg => path.resolve(arg) === path.resolve(out)))
    throw new RangeError('Write the selection to a separate file from its inputs');
  const source = read(file), query = read(input);
  const rows = source?.topologyMeshes ?? {};
  const document = object && Object.hasOwn(rows, object) ? rows[object].document : source;
  if (object && document === source) throw new RangeError('No editable topology for scene object ' + object);
  if (!object && source?.topologyMeshes) throw new TypeError('Choose an editable mesh with --object');
  if (from) {
    if (!query || Object.getPrototypeOf(query) !== Object.prototype || Object.hasOwn(query, 'from'))
      throw new TypeError('Give one saved selection with --from or in the query');
    query.from = read(from);
  }
  const evidence = view ? require('./mesh-topology-visibility.js').captureMeshTopologyVisibility(build(file), object, read(view)).visibility :
    visibility && read(visibility);
  return meshTopology.select(document, query, { visibility: evidence });
}

function transform(file, input, rest, opt, meshTopology, openEditor) {
  const { object, selection, out, report } = opt;
  const filenames = [file, input, selection, out, report].filter(value => value !== undefined);
  if (!file || !input || rest.length || filenames.some(name => typeof name !== 'string' || !name.trim()) ||
      object !== undefined && (typeof object !== 'string' || !object.trim()) || report && !out ||
      ['from', 'view', 'visibility', 'projection', 'lineage', 'match-ids'].some(key => opt[key] !== undefined))
    throw new TypeError('Use mesh-topology transform <mesh-or-scene.json> <request.json> [--object id] [--selection file] [--out file] [--report file]');
  const inputs = [file, input, selection].filter(Boolean).map(name => path.resolve(name));
  const outputs = [out, report].filter(Boolean).map(name => path.resolve(name));
  if (outputs.some(name => inputs.includes(name)) || new Set(outputs).size !== outputs.length)
    throw new RangeError('Write transform outputs to separate files from the inputs');
  const source = read(file), request = read(input);
  if (selection) {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.hasOwn(request, 'selection'))
      throw new TypeError('Give one saved selection with --selection or in the request');
    request.selection = read(selection);
  }
  if (!object) {
    if (source?.topologyMeshes) throw new TypeError('Choose an editable mesh with --object');
    const plan = meshTopology.planTransform(source, request);
    return { document: plan.document, patch: plan.patch, evidence: plan.report };
  }
  if (out && path.dirname(path.resolve(file)) !== path.dirname(path.resolve(out)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const editor = openEditor(file);
  if (!out) {
    const plan = editor.planMeshTransform(object, request);
    return { patch: plan.patch, evidence: plan.report };
  }
  const evidence = editor.transformMeshTopology(object, request);
  return { document: editor.snapshot(), evidence };
}

function command([action, file, input, ...rest], opt, { KIT: { meshTopology } }, { build, openEditor } = {}) {
  const { out, report, projection, lineage, 'match-ids': matchIds } = opt;
  if (action === 'select') {
    const result = select(file, input, rest, opt, meshTopology, build);
    if (out) files.json(path.resolve(out), result);
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (action === 'transform') {
    const result = transform(file, input, rest, opt, meshTopology, openEditor);
    if (out) files.json(path.resolve(out), result.document);
    else process.stdout.write(JSON.stringify({ patch: result.patch, report: result.evidence }, null, 2) + '\n');
    if (report) files.json(path.resolve(report), result.evidence);
    return;
  }
  if (opt.selection !== undefined) throw new TypeError('Use --selection with mesh-topology transform');
  if (['object', 'view', 'visibility', 'from'].some(key => opt[key] !== undefined))
    throw new TypeError('Object, visibility and saved selection options require mesh-topology select');
  const paired = action === 'edit' || action === 'correspond';
  if (!file || !['inspect', 'triangulate', 'edit', 'correspond'].includes(action) ||
      (paired ? !input : input !== undefined) || rest.length ||
      [out, report, projection, lineage].some(value => value !== undefined && typeof value !== 'string'))
    throw new Error(usage);
  if (report !== undefined && action !== 'edit' ||
      [projection, lineage].some(value => value !== undefined && action !== 'correspond' && !(action === 'edit' && report)))
    throw new Error('Use --report on edit or use correspond for topology mapping');
  if (matchIds !== undefined && (action !== 'correspond' || !['on', 'off'].includes(matchIds)))
    throw new Error('Use --match-ids on|off with correspond');
  const filenames = [file, input, projection, lineage].filter(Boolean).map(value => path.resolve(value));
  if (report && [...filenames, ...(out ? [path.resolve(out)] : [])].includes(path.resolve(report)) ||
      out && action === 'correspond' && filenames.includes(path.resolve(out)))
    throw new Error('Choose a different file for the correspondence report');

  const document = meshTopology.create(read(file));
  let result;
  if (paired) {
    const next = read(input);
    const options = { ...(projection && { projection: read(projection) }), ...(lineage && { lineage: read(lineage) }), ...(matchIds && { matchIds: matchIds === 'on' }) };
    if (action === 'correspond') result = meshTopology.correspond(document, next, options);
    else if (report) {
      const edited = meshTopology.editWithCorrespondence(document, next, options);
      files.json(path.resolve(report), edited.correspondence);
      result = edited.document;
    } else result = meshTopology.edit(document, next);
  } else result = meshTopology[action](document);

  if (out) files.json(path.resolve(out), result);
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { command };
