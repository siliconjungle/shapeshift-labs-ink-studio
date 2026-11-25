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
  const { captureMeshTopologyVisibility, needsParticipation } = require('./mesh-topology-visibility.js');
  const evidence = view ? captureMeshTopologyVisibility(build(file), object, read(view),
    { participation: needsParticipation(query?.filter), region: query?.region }).visibility :
    visibility && read(visibility);
  return meshTopology.select(document, query, { visibility: evidence, object, part: object && rows[object].part });
}

function transform(file, input, rest, opt, toolkit, openEditor) {
  const { meshTopology } = toolkit.KIT;
  const { object, selection, out, report, view, pivot } = opt;
  const filenames = [file, input, selection, out, report, view, pivot].filter(value => value !== undefined);
  if (!file || !input || rest.length || filenames.some(name => typeof name !== 'string' || !name.trim()) ||
      object !== undefined && (typeof object !== 'string' || !object.trim()) || report && !out ||
      view && !object || pivot && object ||
      ['from', 'visibility', 'projection', 'lineage', 'match-ids', 'coincident', 'coincident-distance'].some(key => opt[key] !== undefined))
    throw new TypeError('Use mesh-topology transform <mesh-or-scene.json> <request.json> [--object id] [--selection file] [--view file | --pivot file] [--out file] [--report file]');
  const inputs = [file, input, selection, view, pivot].filter(Boolean).map(name => path.resolve(name));
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
    let context;
    if (pivot) {
      const saved = read(pivot);
      if (saved?.format !== 'ink-studio/mesh-pivot' || saved.version !== 1 || saved.object !== undefined ||
          saved.mesh !== source?.id || !Array.isArray(saved.after?.local) ||
          request?.pivot !== undefined || request?.planePivot !== undefined)
        throw new RangeError('Use one saved pivot for this mesh or specify the pivot in the transform request');
      context = { pivot: saved.after.local };
    }
    const plan = meshTopology.planTransform(source, request, context);
    return { document: plan.document, patch: plan.patch, evidence: plan.report };
  }
  if (out && path.dirname(path.resolve(file)) !== path.dirname(path.resolve(out)))
    throw new RangeError('Write the revised scene beside its source to preserve relative assets');
  const editor = openEditor(file);
  if (view) {
    if (request?.space !== 'camera' || request.camera !== undefined)
      throw new TypeError('Use --view with a camera-space transform or pin camera axes in the request');
    const { transformView, captureTransformCamera } = require('./mesh-transform-camera.js');
    request.camera = captureTransformCamera(editor, transformView(read(view)), toolkit);
  }
  if (!out) {
    const plan = editor.planMeshTransform(object, request);
    return { patch: plan.patch, evidence: plan.report };
  }
  const evidence = editor.transformMeshTopology(object, request);
  return { document: editor.snapshot(), evidence };
}

function pivot(file, input, rest, opt, meshTopology, openEditor) {
  const { object, part, selection, out } = opt;
  const name = value => typeof value === 'string' && value.trim();
  if (!name(file) || input !== undefined && !name(input) || rest.length || part !== undefined && object === undefined ||
      Object.entries(opt).some(([key,value]) => !['object','part','selection','out'].includes(key) || !name(value)))
    throw new TypeError('Use mesh-topology pivot <mesh-or-scene.json> [request.json] [--object id] [--part id] [--selection file] [--out file.json]');
  const source = path.resolve(file), destination = out && path.resolve(out);
  if (destination && (!/\.json$/i.test(out) || [file,input,selection].filter(Boolean).some(name => path.resolve(name) === destination) ||
      object && path.dirname(source) !== path.dirname(destination)))
    throw new RangeError('Write a separate pivot output and keep revised scenes beside their source');
  const request = input === undefined ? {} : read(input);
  if (selection) {
    if (request?.target?.kind !== 'center' || Object.hasOwn(request.target, 'selection'))
      throw new TypeError('Use --selection with a center pivot or put the selection in the request');
    request.target.selection = read(selection);
  }
  const editor = object && openEditor(source);
  const document = !editor && read(source);
  if (document?.topologyMeshes || document?.instances) throw new TypeError('Choose an editable mesh with --object');
  const report = editor ? (destination ? editor.setMeshPivot(object,request,{part}) : editor.planMeshPivot(object,request,{part})) :
    meshTopology.planPivot(document,request);
  if (destination) files.publishJson(destination,editor ? editor.snapshot() : report,'A different pivot output already exists at '+destination);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

function moveVertex(file, input, rest, opt, toolkit, openEditor) {
  const { meshTopology } = toolkit.KIT;
  const {object,part,vertex,by,expect,out,space,align,view,coincident,'coincident-distance':distance} = opt;
  const allowed = ['object','part','vertex','by','expect','out','space','align','view','coincident','coincident-distance'];
  const name = value => typeof value === 'string' && value.trim();
  if (!name(file) || input !== undefined || rest.length || !name(vertex) || part !== undefined && object === undefined ||
      space !== undefined && !['local','world','plane','camera'].includes(space) ||
      view !== undefined && (!object || space !== 'camera') ||
      align !== undefined && !['plane','grid'].includes(align) ||
      distance !== undefined && coincident !== true ||
      Object.entries(opt).some(([key,value])=>!allowed.includes(key) || (key === 'coincident' ? value !== true : !name(value))))
    throw new TypeError('Use mesh-topology move <mesh-or-scene.json> [--object id] [--part id] --vertex id --by X,Y,Z [--space local|world|plane|camera] [--view file] [--align plane|grid] [--coincident [--coincident-distance N]] [--expect revision] [--out file.json]');
  const { coordinates } = require('./construction-plane.js');
  const offset = coordinates(by,3,'--by');
  const source = path.resolve(file), output = out && path.resolve(out);
  if (output && (!/\.json$/i.test(output) || output === source || view && output === path.resolve(view) ||
      object && path.dirname(output) !== path.dirname(source)))
    throw new RangeError('Write a separate JSON output beside the input for scene edits');

  const editor = object && openEditor(source);
  const raw = editor ? editor.meshTopology(object,part).document : read(source);
  if (!editor && raw?.topologyMeshes) throw new TypeError('Choose an editable mesh with --object');
  const document = meshTopology.create(raw), revision = meshTopology.revision(document);
  if (expect !== undefined && expect !== revision)
    throw new RangeError('Vertex move expected topology revision '+expect+' but found '+revision);
  const selection = meshTopology.select(document,{domain:'vertices',ids:[vertex]});
  const operation = {kind:'move',offset};
  const request = {selection,operation,...(space && {space}),
    ...(coincident && {coincident: distance === undefined ? true : {tolerance:coordinates(distance,1,'--coincident-distance')[0]}}),
    ...(align && {snap:{kind:'construction-plane',mode:align,anchor:vertex}})};
  if (view) {
    const { transformView, captureTransformCamera } = require('./mesh-transform-camera.js');
    request.camera = captureTransformCamera(editor, transformView(read(view)), toolkit);
  }
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

function overlaps(file, input, rest, opt, meshTopology) {
  const { object, part, out, 'selection-out': selectionOut } = opt;
  const name = value => typeof value === 'string' && value.trim();
  if (!name(file) || input !== undefined && !name(input) || rest.length ||
      part !== undefined && object === undefined || out !== undefined && selectionOut !== undefined ||
      Object.entries(opt).some(([key, value]) => !['object', 'part', 'out', 'selection-out'].includes(key) || !name(value)))
    throw new TypeError('Use mesh-topology overlaps <mesh-or-scene.json> [settings.json] [--object id] [--part id] [--out report.json | --selection-out faces.json]');
  const destination = (out || selectionOut) && path.resolve(out || selectionOut);
  if (destination && [file, input].some(name => name && path.resolve(name) === destination))
    throw new RangeError('Write overlap review outputs separately from their inputs');
  const source = read(file), rows = source?.topologyMeshes ?? {};
  const row = object && Object.hasOwn(rows, object) && rows[object];
  if (object && (!row || part !== undefined && row.part !== part))
    throw new RangeError('No editable topology for scene object ' + object + (part === undefined ? '' : '/' + part));
  if (!object && source?.topologyMeshes) throw new TypeError('Choose an editable mesh with --object');
  const review = meshTopology.reviewOverlaps(row ? row.document : source, input === undefined ? {} : read(input));
  const report = row ? { ...review, object, ...(row.part !== undefined && { part: row.part }) } : review;
  if (destination) files.publishJson(destination, selectionOut ? review.selection : report,
    'A different overlap review output already exists at ' + destination);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
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

function command([action, file, input, ...rest], opt, toolkit, { build, openEditor, projectTexelsPerUnit } = {}) {
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
  if (action === 'plane')
    return require('./construction-plane.js').command(file,input === undefined ? rest : [input,...rest],opt,toolkit,openEditor,projectTexelsPerUnit);
  if (action === 'move') return moveVertex(file,input,rest,opt,toolkit,openEditor);
  if (action === 'pivot') return pivot(file,input,rest,opt,meshTopology,openEditor);
  if (action === 'overlaps') return overlaps(file,input,rest,opt,meshTopology);
  if (action === 'isolate-prefab')
    return require('./prefab-edit-isolation.js').command(file,input,rest,opt,toolkit,openEditor);
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
    const result = transform(file, input, rest, opt, toolkit, openEditor);
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
