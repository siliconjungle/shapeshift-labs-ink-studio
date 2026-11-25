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

function moveVertex(file, input, rest, opt, meshTopology, openEditor) {
  const {object,part,vertex,by,expect,out} = opt;
  const allowed = ['object','part','vertex','by','expect','out'];
  const name = value => typeof value === 'string' && value.trim();
  const components = typeof by === 'string' ? by.split(',').map(value=>value.trim()) : [];
  const offset = components.map(Number);
  if (!name(file) || input !== undefined || rest.length || !name(vertex) ||
      components.length !== 3 || !components.every(value=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) ||
      !offset.every(Number.isFinite) || part !== undefined && object === undefined ||
      Object.entries(opt).some(([key,value])=>!allowed.includes(key) || !name(value)))
    throw new TypeError('Use mesh-topology move <mesh-or-scene.json> [--object id] [--part id] --vertex id --by X,Y,Z [--expect revision] [--out file.json]');
  const source = path.resolve(file), output = out && path.resolve(out);
  if (output && (!/\.json$/i.test(output) || output === source || object && path.dirname(output) !== path.dirname(source)))
    throw new RangeError('Write a separate JSON output beside the input for scene edits');

  const editor = object && openEditor(source);
  const raw = editor ? editor.meshTopology(object,part).document : read(source);
  if (!editor && raw?.topologyMeshes) throw new TypeError('Choose an editable mesh with --object');
  const document = meshTopology.create(raw), revision = meshTopology.revision(document);
  if (expect !== undefined && expect !== revision)
    throw new RangeError('Vertex move expected topology revision '+expect+' but found '+revision);
  const selection = meshTopology.select(document,{domain:'vertices',ids:[vertex]});
  const operation = {kind:'move',offset};
  const request = {selection,operation};
  let report;
  if (editor && output) {
    report = editor.transformMeshTopology(object,request,{part,label:'Move vertex '+vertex}).transform;
    files.publishJson(output,editor.snapshot(),'A different scene already exists at '+output);
  } else {
    const plan = editor ? editor.planMeshTransform(object,request,{part}) : meshTopology.planTransform(document,request);
    report = plan.report;
    if (output) files.publishJson(output,plan.document,'A different mesh already exists at '+output);
  }
  process.stdout.write(JSON.stringify({...report,operation,...(object && {object}),...(part && {part})},null,2)+'\n');
}

function maintenance(action, file, input, rest, opt, meshTopology, openEditor) {
  const { object, out, report, pieces } = opt, cutting = action === 'cut', editing = action !== 'health';
  const filenames = [file, input, out, report].filter(value => value !== undefined);
  if (!file || editing && !input || rest.length || filenames.some(value => typeof value !== 'string' || !value.trim()) ||
      object !== undefined && (typeof object !== 'string' || !object.trim()) || report && (!editing || !out) ||
      pieces !== undefined && (!cutting || typeof pieces !== 'string' || !pieces.trim()) ||
      ['selection', 'from', 'view', 'visibility', 'projection', 'lineage', 'match-ids'].some(key => opt[key] !== undefined))
    throw new TypeError('Use mesh-topology health <mesh-or-scene.json> [settings.json] or repair|cut|face-region|edge-edit <mesh-or-scene.json> <request.json>');
  const inputs = [file, input].filter(Boolean).map(name => path.resolve(name));
  const outputs = [out, report].filter(Boolean).map(name => path.resolve(name));
  if (new Set(outputs).size !== outputs.length || outputs.some(name => inputs.includes(name)))
    throw new RangeError('Write mesh topology outputs separately from their inputs');
  const source = read(file), settings = input === undefined ? {} : read(input);
  const rows = source?.topologyMeshes ?? {};
  const row = object && Object.hasOwn(rows, object) && rows[object];
  if (object && !row) throw new RangeError('No editable topology for scene object ' + object);
  if (!object && source?.topologyMeshes) throw new TypeError('Choose an editable mesh with --object');
  const doc = row ? row.document : source;
  const write = (file, value) => file ? files.json(path.resolve(file), value) :
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (!editing) return write(out, meshTopology.health(doc, settings));

  if (object && out && path.dirname(path.resolve(file)) !== path.dirname(path.resolve(out)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const editor = object && openEditor(file);
  const operations = {
    cut: ['planCut', 'planMeshCut', 'cutMeshTopology'],
    repair: ['planRepair', 'planMeshRepair', 'repairMeshTopology', 'Repair would create or worsen a non-manifold edge'],
    'face-region': ['planFaceRegion', 'planMeshFaceRegion', 'editMeshFaceRegion', 'Face-region edit failed geometry or wall clearance checks'],
    'edge-edit': ['planEdgeEdit', 'planMeshEdgeEdit', 'editMeshEdges', 'Edge edit failed geometry checks']
  };
  const [planMesh, planScene, commitScene, blocked] = operations[action];
  const plan = editor ? editor[planScene](object, settings) : meshTopology[planMesh](doc, settings);
  const exports = pieces ? plan.pieces.map((_, i) => path.resolve(pieces, 'piece-' + (i + 1) + '.json')) : [];
  if (exports.some(file => [...inputs, ...outputs].includes(file)))
    throw new RangeError('Write cut pieces separately from the input and other outputs');
  if (plan.report.canCommit === false && out) {
    if (report) write(report, plan.report);
    throw new RangeError(blocked);
  }
  const result = out && editor && editor[commitScene](object, settings);
  for (const [i, file] of exports.entries()) write(file, plan.pieces[i].document);
  if (!out) return write(undefined, { patch: plan.patch, report: plan.report });
  write(out, editor ? editor.snapshot() : plan.document);
  if (report) write(report, result || plan.report);
}

function command([action, file, input, ...rest], opt, toolkit, { build, openEditor } = {}) {
  const { KIT: { meshTopology } } = toolkit;
  if (action === 'transfer-attachments')
    return require('./mesh-attachment-transfer.js').command([file,input,...rest],opt,toolkit);
  if (action === 'transfer-materials')
    return require('./mesh-material-transfer.js').command([file, input, ...rest], opt, meshTopology);
  if (action === 'modifiers')
    return require('./mesh-modifiers.js').command([file, input, ...rest], opt, toolkit, openEditor);
  if (action === 'shading') return require('./mesh-shading-preview.js').command(file, input, rest, opt, toolkit, openEditor);
  if (action === 'shape-keys') return require('./mesh-shape-keys.js').command(file,input,rest,opt,toolkit,openEditor);
  if (action === 'skin') return require('./mesh-skin-preview.js').command(file, input, rest, opt, toolkit, openEditor);
  if (action === 'retopology') return require('./mesh-retopology-preview.js').command(file, input, rest, opt, toolkit, openEditor);
  if (action === 'boolean') return require('./mesh-boolean-preview.js').command(file, input, rest, opt, toolkit, openEditor);
  if (action === 'bevel') return require('./mesh-bevel-preview.js').command(file, input, rest, opt, toolkit, openEditor);
  if (action === 'move') return moveVertex(file,input,rest,opt,meshTopology,openEditor);
  if (opt.preview !== undefined) throw new TypeError('Use --preview with mesh-topology bevel or shading');
  if (opt.subdivision !== undefined) throw new TypeError('Use --subdivision with mesh-topology shading');
  const { out, report, projection, lineage, 'match-ids': matchIds } = opt;
  if (action === 'select') {
    const result = select(file, input, rest, opt, meshTopology, build);
    if (out) files.json(path.resolve(out), result);
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (['health', 'repair', 'cut', 'face-region', 'edge-edit'].includes(action))
    return maintenance(action, file, input, rest, opt, meshTopology, openEditor);
  if (opt.pieces !== undefined) throw new TypeError('Use --pieces with mesh-topology cut');
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
