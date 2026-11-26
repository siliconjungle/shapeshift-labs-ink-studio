const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const R = require('./render.js');
const Compose = require('../src/frame-composite.js');
const MaterialUV = require('../src/material-uv.js');
const { viewSettings, worldFor } = require('./mesh-native-view.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const options = {
  layout: ['object','out','uv-set','channel','atlas'],
  select: ['object','out','topology-out','topology-domain','view','preview','uv-set','channel'],
  edit: ['object','out','view','preview','report','selection','uv-set','channel']
};
const imageNames = ['atlas-before.png', 'model-before.png', 'atlas-after.png', 'model-after.png', 'comparison.png'];
const ink = { seam: '#f391a6', pin: '#ffcb78', pivot: '#f0b8ff', snap: '#ffe181', selected: '#75e2c8', held: '#a8beff', boundary: '#7393ac',
  continuous: '#456578', 'material-boundary': '#859cad', 'non-manifold': '#ed8c70' };
const tints = ['#25495a', '#413950', '#574232', '#335344', '#403c57'];
const name = v => typeof v === 'string' && Boolean(v.trim());
const rect = (rect, color) => ({ type: 'rect', rect, color });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (text, at, color = '#dce8ee', size = 10) => ({ type: 'text', text, at, size, color });
const center = (p, n) => [Math.round(p[0]) - n, Math.round(p[1]) - n, n * 2 + 1, n * 2 + 1];
const regionSelection = selection=>selection?.domain === 'faces' || selection?.domain === 'islands';
function cornerMarkers(corners,selection,project) {
  const selected = new Set(selection?.domain === 'corners' ? selection.corners : []);
  const held = new Set(selection?.heldCorners), marks = [], active = [];
  for (const corner of corners) {
    const chosen = selected.has(corner.id), stationary = held.has(corner.id);
    if (!chosen && !stationary && !corner.pinned) continue;
    const point = project(corner);
    if (!point) continue;
    if (stationary) {
      const [x,y] = point.map(Math.round), r = 4;
      marks.push(line([[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]],ink.held));
    }
    if (chosen) active.push(rect(center(point,2),ink.selected));
    else if (corner.pinned) marks.push(rect(center(point,2),ink.pin));
  }
  return marks.concat(active);
}

const sideSelection = selection=>{
  const sides = new Map();
  for (const {edge,face} of selection?.edgeSides ?? []) {
    if (!sides.has(edge)) sides.set(edge,[]);
    sides.get(edge).push(face);
  }
  return sides;
};

function composite(w, h, layers, draw, kit) {
  const plan = kit.KIT.frameComposite.prepare({ layers: [...layers, { draw }] }, w, h, 1);
  return Compose.compose({ w: 1, h: 1, rgb: Uint8Array.of(13, 24, 33) },
    kit.KIT.frameComposite.layers(plan, {}, 0), w, h, 'nearest');
}

function view(input, standalone) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some(key => !['w', 'h', 't', 'camera', 'raw', 'materials', 'material', 'readability', 'afterMaterials'].includes(key)) ||
      input.material !== undefined && !name(input.material) ||
      input.afterMaterials !== undefined && (!standalone || !Array.isArray(input.afterMaterials)))
    throw new TypeError('Use UV review camera, grid and optional atlas material settings');
  return { ...viewSettings({ w: 220, h: 180, raw: true, ...input }, standalone), material: input.material,
    readability: input.readability, afterMaterials: input.afterMaterials };
}

function capture(document, settings, kit, editor, object) {
  let world, mesh;
  if (editor) {
    const scene = editor.snapshot(), row = scene.topologyMeshes[object];
    // The atlas is edited on authored corners. Capture those same corners in the scene.
    const source = row.modifiers?.length ? editor.fork({ ...scene,
      topologyMeshes: { ...scene.topologyMeshes, [object]: { ...row, modifiers: [] } } }) : editor;
    world = source.build();
    mesh = world.topologyMeshes[object].mesh;
  } else {
    world = worldFor(document, settings, kit);
    [mesh] = world.meshes;
  }
  require('./diarama-pose.js').pose(world, settings.t, { kit, maxSteps: 7200 });
  let camera;
  const { w, h, t, raw } = settings;
  const frame = R.render(world, { w, h, t, raw, px: 1, camera: settings.camera, passes: ['sourceSurface'],
    edges: false, composite: false, renderGraph: false, renderGrid: false, inspection: false, shutter: false, cameraGuides: false,
    ...R.cameraCapture(null, (raster, sample) => {
      if (raster.width === w && raster.height === h) camera = { ...raster, focal: sample.focal };
    }) });
  if (!camera || frame.w !== w || frame.h !== h)
    throw new RangeError('UV review needs a native camera and matching source pixel passes');
  return { frame, mesh, camera };
}

function atlas(layout, material, selection, settings, kit, paint) {
  const { h } = settings, w = h, margin = 8, extent = w - margin * 2;
  const factor = paint ? extent / Math.max(paint.w, paint.h) : 1;
  const size = paint ? [paint.w, paint.h].map(n => Math.max(1, Math.round(n * factor))) : [extent, extent];
  const start = size.map(n => Math.floor((h - n) / 2));
  const at = uv => uv.map((n, axis) => start[axis] + .5 + n * (size[axis] - 1));
  const corners = new Map(layout.corners.map(row => [row.id, row]));
  const faces = new Set(layout.faces.filter(row => row.material === material).map(row => row.id));
  const selected = new Set(selection?.faces), selectedEdges = new Set(selection?.domain === 'edges' ? selection.edges : []);
  const selectedSides = sideSelection(selection);
  const chartColors = new Map(layout.islands.map((row, i) => [row.id, tints[i % tints.length]]));
  const sampleEvery = Math.max(1, Math.ceil(faces.size / 4000));
  const layers = paint ? [{ source: paint, rect: [...start, ...size] }] : [];
  const draw = paint ? [] : [rect([...start, ...size], '#152634')], highlights = [];
  for (let i = 0; !paint && i <= 8; i++) {
    draw.push(line([at([i / 8, 0]), at([i / 8, 1])], '#29404f'));
    draw.push(line([at([0, i / 8]), at([1, i / 8])], '#29404f'));
  }
  let step = 0;
  for (const row of layout.faces) if (faces.has(row.id) && (step++ % sampleEvery === 0 || selected.has(row.id))) {
    const points = row.corners.map(id => at(corners.get(id).uv));
    if (selected.has(row.id) && regionSelection(selection)) {
      highlights.push({ type: 'polygon', points, fill: paint ? '#75e2c84d' : '#357c75' },
        line([...points, points[0]], ink.selected, 2));
    } else if (!paint) draw.push({ type: 'polygon', points, fill: chartColors.get(row.island) });
  }
  for (const [i, edge] of layout.edges.entries()) if (i % sampleEvery === 0 || selectedEdges.has(edge.id) || edge.authored) {
    for (const side of edge.sides) if (faces.has(side.face)) {
      const marked = selectedEdges.has(edge.id) && (selectedSides.get(edge.id)?.includes(side.face) ?? true);
      draw.push(line(side.uv.map(at),marked ? ink.selected : ink[edge.kind],marked ? 2 : 1));
    }
  }
  for (const highlight of highlights) draw.push(highlight);
  for (const guide of selection?.snapGuides ?? []) if (guide.material===material) {
    const points = guide.points.map(at);
    draw.push(points.length===2 ? line(points,ink.snap,2) : rect(center(points[0],4),ink.snap));
  }
  const marks = cornerMarkers(corners.values(),selection,corner=>faces.has(corner.face) ? at(corner.uv) : undefined);
  const pivot = settings.pivot ?? layout.pivot;
  const basis = selection?.scaling ?? selection?.orientation;
  const inMaterial = row=>row.face===undefined ? basis.faces.some(id=>faces.has(id)) : faces.has(row.face);
  if (selection?.scaling?.snapBounds) for (const [i,row] of basis.bounds.entries()) {
    if (!row.applied || !inMaterial(row)) continue;
    const [sw,sh] = basis.pivots[i].atlas, [l,t,r,b] = row.applied.map((n,j)=>n/(j%2 ? sh-1 : sw-1));
    draw.push(line([[l,t],[r,t],[r,b],[l,b],[l,t]].map(at),ink.snap,2));
  }
  const pivots = basis ? basis.pivots.filter(inMaterial).map(row=>row.uv) : pivot ? [pivot] : [];
  for (const applied of pivots) {
    const [x,y] = at(applied).map(Math.round), r = 6;
    marks.push(line([[x-r,y],[x+r,y]],ink.pivot),line([[x,y-r],[x,y+r]],ink.pivot));
  }
  return composite(w, h, layers, draw.concat(marks), kit);
}

function model(layout, { frame, mesh, camera }, selection, kit, visiblePixels) {
  const { w, h } = frame, K = kit.KIT, UV = K.meshTopology.uv;
  const mapped = UV.modelFaces(mesh, frame), selected = new Set(selection?.faces);
  const rgb = frame.rgb.slice();
  const selectedAt = i => selected.has(mapped.faces[mapped.faceAt[i]]);
  for (let i = 0; i < mapped.faceAt.length; i++) if (selectedAt(i)) {
    const face = mapped.faces[mapped.faceAt[i]], x = i % w;
    if (visiblePixels) visiblePixels.set(face, visiblePixels.get(face) + 1);
    if (!regionSelection(selection)) continue;
    const outline = visiblePixels && (x === 0 || x === w - 1 ||
      !selectedAt(i - 1) || !selectedAt(i + 1) || !selectedAt(i - w) || !selectedAt(i + w));
    const tint = outline ? [117, 226, 200] : [93, 205, 179];
    for (const [channel, n] of tint.entries())
      rgb[i * 3 + channel] = outline ? n : Math.round((rgb[i * 3 + channel] * 2 + n) / 3);
  }
  const { eye, right, up, back } = kit.CameraLens.fromView(camera.view);
  function project(p) {
    const relative = K.V.sub(p, eye), depth = -K.V.dot(relative, back);
    if (depth < camera.clipNear || depth > camera.clipFar) return;
    const scale = camera.focal / (camera.ortho ? 1 : depth);
    return [w / 2 + K.V.dot(relative, right) * scale - .5, h / 2 - K.V.dot(relative, up) * scale - .5];
  }
  function visible(x, y, faces) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = x + dx, b = y + dy;
      if (a >= 0 && b >= 0 && a < w && b < h && faces.includes(mapped.faces[mapped.faceAt[a + b * w]]))
        return true;
    }
    return false;
  }
  const points = new Map(K.meshTopology.sourceDocument(mesh).vertices.map(row => [row.id, project(row.position)]));
  const selectedEdges = new Set(selection?.domain === 'edges' ? selection.edges : []);
  const selectedSides = sideSelection(selection);
  for (const edge of layout.edges) if (edge.kind === 'seam' || selectedEdges.has(edge.id)) {
    const [a, b] = edge.vertices.map(id => points.get(id));
    if (!a || !b) continue;
    const faces = edge.sides.map(row => row.face);
    const markedFaces = selectedEdges.has(edge.id) ? selectedSides.get(edge.id) ?? faces : [];
    const steps = Math.min((w + h) * 2, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))));
    for (let j = 0; j <= steps; j++) {
      const x = Math.round(a[0] + (b[0] - a[0]) * j / steps), y = Math.round(a[1] + (b[1] - a[1]) * j / steps);
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      if (markedFaces.length && visible(x,y,markedFaces)) rgb.set([117,226,200],(x+y*w)*3);
      else if (edge.kind === 'seam' && visible(x,y,faces)) rgb.set([243,145,166],(x+y*w)*3);
    }
  }
  const draw = cornerMarkers(layout.corners,selection,corner=>{
    const p = points.get(corner.vertex);
    return p && visible(Math.round(p[0]),Math.round(p[1]),[corner.face]) ? p : undefined;
  });
  return composite(w, h, [{ source: { w, h, rgb } }], draw, kit);
}

function atlasPaint(mesh, material, layout, kit) {
  if ((layout.uvSet ?? 0) !== MaterialUV.resolve(layout.uvBindings, 'pigment')) return;
  const layer = kit.KIT.sceneMeshes.layer(mesh);
  const region = layer.surfaceCharts?.find(row => row.materialId === material)?.region;
  if (!region || region.width === 1 && region.height === 1) return;
  const { x, y, width: w, height: h } = region, rgba = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const at = ((y + row) * layer.width + x) * 4;
    rgba.set(layer.pixels.subarray(at, at + w * 4), row * w * 4);
  }
  return { w, h, rgba };
}

function review(before, after, nativeBefore, nativeAfter, selected, settings, kit, paths, readability, selectionOutput) {
  if (settings.h < 32) throw new RangeError('UV review needs at least 32 native rows');
  const UV = kit.KIT.meshTopology.uv;
  const layouts = [UV.inspect(before,selected?.uvSet ?? 0), UV.inspect(after,selected?.uvSet ?? 0)];
  const material = settings.material ?? layouts[0].faces.find(face => selected?.faces.includes(face.id))?.material ??
    layouts[0].faces[0]?.material;
  if (!layouts[0].faces.some(row => row.material === material)) throw new RangeError('Choose an authored UV material');
  const captures = [nativeBefore, nativeAfter], views = [];
  const {orientation,scaling} = selected ?? {};
  const basis = scaling ?? orientation;
  const useAtlasPaint = basis || selected?.cornerScope || selected?.snapGuides || settings.pivot || layouts.some(layout=>layout.pivot);
  let crossHighlight;
  if (selectionOutput) {
    const layout = layouts[0], byId = new Map(layout.faces.map(row => [row.id, row]));
    const visible = new Map(selected.faces.map(id => [id, 0]));
    const materials = [...new Set([material, ...selected.faces.map(id => byId.get(id).material).sort()])];
    const sheets = materials.map((id, i) => ({ material: id, file: i ? 'atlas-' + (i + 1) + '.png' : imageNames[0] }));
    const extra = sheets.slice(1).map(row => path.resolve(selectionOutput.directory, row.file));
    selectionOutput.guard(extra);
    const atlasImage = id => atlas(layout, id, selected, settings, kit, atlasPaint(nativeBefore.mesh, id, layout, kit));
    const sheet = atlasImage(material), scene = model(layout, nativeBefore, selected, kit, visible);
    views.push(sheet, scene, sheet, scene);
    for (const [i, file] of extra.entries()) {
      const image = atlasImage(sheets[i + 1].material);
      files.write(file, PNG.encode(image.w, image.h, image.rgb));
    }
    crossHighlight = { sheets, faces: selected.faces.map(id => ({ id, material: byId.get(id).material, visiblePixels: visible.get(id) })) };
  } else for (const [i, layout] of layouts.entries()) {
    const paint = useAtlasPaint ? atlasPaint(captures[i].mesh,material,layout,kit) : undefined;
    views.push(atlas(layout, material, selected, settings, kit, paint), model(layout, captures[i], selected, kit));
  }
  const gap = 6, { w, h } = settings, width = h + w + 3 * gap, height = h * 2 + 64;
  const layers = [], draw = [text('Atlas', [h / 2 + gap, 13]), text('Native model', [h + 2 * gap + w / 2, 13])];
  const rowNames = before === after ? ['Selection', 'Selection'] : ['Before', 'After'];
  for (const [i, image] of views.entries()) {
    const x = i % 2 ? h + 2 * gap : gap, y = 33 + Math.floor(i / 2) * (h + 15);
    layers.push({ source: image, rect: [x, y, image.w, image.h] });
    if (i % 2 === 0) draw.push(text(rowNames[Math.floor(i / 2)], [x + h / 2, y - 7], '#9fb9c3', 8));
  }
  const scope = selected?.cornerScope;
  const [pivotBefore,pivotAfter] = layouts.map(layout=>basis ? null : settings.pivot ?? layout.pivot ?? null);
  const hasPivot = basis || pivotBefore || pivotAfter, snapGuide = scaling?.snapBounds ? 'Snapped bounds' : selected?.snapGuides && 'Snap target';
  draw.push(text(snapGuide || 'Cut seam', [width * .18, height - 8], snapGuide ? ink.snap : ink.seam, 8),
    text(scope ? 'Held overlap' : 'Pinned corner', [width * .49, height - 8], scope ? ink.held : ink.pin, 8),
    text(scope ? 'Move scope' : hasPivot ? 'UV pivot' : 'Linked selection', [width * .80, height - 8],
      !scope && hasPivot ? ink.pivot : ink.selected, 8));
  views.push(composite(width, height, layers, draw, kit));
  for (const [i, image] of views.entries()) files.write(paths[i], PNG.encode(image.w, image.h, image.rgb));
  const evidence = readability && {
    time: settings.t, camera: nativeBefore.camera,
    before: UV.readability(nativeBefore.mesh, nativeBefore.frame, readability),
    after: UV.readability(nativeAfter.mesh, nativeAfter.frame, readability)
  };
  return { material, grid: [w, h], files: [...imageNames, ...crossHighlight?.sheets.slice(1).map(row => row.file) ?? []],
    ...(scope && {cornerScope:scope}), ...(orientation && {orientation}), ...(scaling && {scaling}),
    ...((pivotBefore || pivotAfter) && {pivot:{before:pivotBefore,after:pivotAfter}}),
    ...(crossHighlight && { crossHighlight }), ...(evidence && { readability: evidence }) };
}

function editSelection(UV,document,plan,selectionFile) {
  const uvSet = plan.report.uvSet ?? 0;
  const guides = plan.report.operations.flatMap(row=>row.op==='snap' ? row.evidence.guides : []);
  const basis = plan.report.operations.findLast(row=>row.op==='orient' || row.op==='scale');
  const applied = basis?.evidence;
  const inspection = {...(guides.length && {snapGuides:guides}),
    ...(applied && {[basis.op==='orient' ? 'orientation' : 'scaling']:{
      mode:applied.mode,faces:applied.faces,pivotSource:applied.pivotSource,pivots:applied.pivots,
      ...(basis.op==='scale' && {snapBounds:applied.snapBounds,bounds:applied.bounds})
    }})};
  if (selectionFile) {
    const saved = read(selectionFile);
    return {...UV.select(document,{domain:saved.domain,from:saved,uvSet}),...inspection};
  }
  const scopes = plan.report.operations.filter(row=>row.evidence?.scope!==undefined && row.evidence.moving).map(row=>row.evidence);
  if (scopes.length) {
    const moving = new Set(scopes.flatMap(row=>row.moving.map(corner=>corner.id)));
    const held = [...new Set(scopes.flatMap(row=>row.held.map(corner=>corner.id)))].filter(id=>!moving.has(id)).sort();
    const selected = UV.select(document,{domain:'corners',uvSet,ids:[...moving]});
    return {...selected,...inspection,heldCorners:held,cornerScope:{modes:scopes.map(row=>row.scope),moving:selected.ids,held}};
  }
  const ids = [...new Set([...plan.report.corners.map(row=>row.face),...applied?.faces ?? []])];
  return {...UV.select(document,{domain:'faces',uvSet,ids}),...inspection};
}

function command([action, file, input, ...rest], opt, kit, openEditor) {
  if (!file || rest.length || (action === 'layout' ? input !== undefined : !input) ||
      Object.entries(opt).some(([key, value]) => !options[action].includes(key) || !name(value)) ||
      opt.selection && !opt.preview)
    throw new TypeError('Use mesh-uv layout, select, or edit on a retained mesh topology document');
  const { object, out, report, preview, 'topology-out': topologyOut } = opt;
  const topologyDomain = opt['topology-domain'];
  if (topologyDomain !== undefined && (!topologyOut || !['match','faces','edges','vertices'].includes(topologyDomain)))
    throw new TypeError('Use --topology-domain match, faces, edges, or vertices with --topology-out');
  const inputs = [file, input, opt.view, opt.selection].filter(Boolean).map(value => path.resolve(value));
  const paths = preview ? imageNames.map(name => path.resolve(preview, name)) : [];
  const outputs = [...[out, report, topologyOut].filter(Boolean).map(value => path.resolve(value)), ...paths];
  const separate = filenames => {
    if (new Set(filenames).size !== filenames.length || filenames.some(value => inputs.includes(value)))
      throw new RangeError('Write UV reports and edited documents separately from the source and request');
  };
  separate(outputs);
  if (object && action === 'edit' && out && path.dirname(path.resolve(out)) !== path.dirname(inputs[0]))
    throw new RangeError('Write the revised scene beside its source so relative assets still resolve');
  const source = read(file), { meshTopology: topology } = kit.KIT, UV = topology.uv;
  if (source.topologyMeshes && !object) throw new TypeError('Choose a scene mesh with --object');
  const editor = object && openEditor(file);
  const document = topology.create(editor ? editor.meshTopology(object).document : source);
  const numeric=opt['uv-set'];
  if (numeric!==undefined && (!/^\d+$/.test(numeric)||!MaterialUV.layout(+numeric)) ||
      opt.channel!==undefined && (!MaterialUV.channel(opt.channel)||numeric!==undefined))
    throw new RangeError('Choose --channel or --uv-set');
  const selector=opt.channel ?? (numeric!==undefined ? +numeric : undefined);
  let result, value;
  if (action === 'layout') {
    if (opt.atlas !== undefined && !/^\d+,\d+$/.test(opt.atlas))
      throw new TypeError('Use --atlas width,height for an explicit UV inspection atlas');
    const atlas = opt.atlas?.split(',').map(Number);
    result = value = editor ? editor.inspectMeshUV(object,{uvSet:selector,atlas}) : UV.inspect(document,selector,{atlas});
  }
  else {
    const authored=read(input);
    if (selector!==undefined && authored?.uvSet!==undefined)
      throw new TypeError('Choose a UV layout in the request or on the command line');
    const request=selector===undefined ? authored : {...authored,uvSet:selector};
    const settings = view(opt.view ? read(opt.view) : {}, !editor);
    const old = (preview || action === 'select' && request?.model !== undefined) && capture(document, settings, kit, editor, object);
    if (action === 'select') {
      if (request?.model !== undefined) {
        if (!request.model || Object.keys(request).some(key => !['domain', 'model','uvSet'].includes(key)) ||
            Object.keys(request.model).some(key => key !== 'pixel'))
          throw new TypeError('Use a UV model query with a domain and native pixel');
        result = UV.pickModel(old.mesh, old.frame, request.model.pixel, request.domain,request.uvSet);
      } else result = editor ? editor.selectMeshUV(object,request) : UV.select(document,request);
      value = result;
      if (preview) result.preview = review(document, document, old, old, result, settings, kit, paths, settings.readability,
        { directory: preview, guard: extra => separate([...outputs, ...extra]) });
      if (topologyOut) {
        const selection = UV.toTopologySelection(document,result,topologyDomain ?? 'faces');
        files.publishJson(path.resolve(topologyOut), selection, 'A different topology selection already exists at ' + topologyOut);
      }
    } else {
      const plan = editor ? editor.planMeshUV(object, request) : UV.plan(document, request);
      result = { ...plan.report };
      if (preview) {
        const selected = editSelection(UV,document,plan,opt.selection);
        const draft = editor && Object.keys(plan.patch).length ? editor.fork() : editor;
        if (draft && draft !== editor) draft.editMeshTopology(object, plan.patch);
        const revised = plan.report.canCommit && settings.afterMaterials ? { ...settings, materials: settings.afterMaterials } : settings;
        const next = plan.document === document && revised === settings ? old : capture(plan.document, revised, kit, draft, object);
        const budget = [...plan.report.operations].reverse().find(row => row.op === 'texel-budget' && row.evidence?.features);
        const readability = settings.readability ?? (budget && { atlas: budget.evidence.atlas,
          features: budget.evidence.features.map(({ id, faces }) => ({ id, faces })) });
        const lastTransform = plan.report.operations.findLast(row=>row.op==='transform');
        const pivot = lastTransform?.evidence.pivotSource === 'island-center' ? undefined : lastTransform?.evidence.pivots[0]?.uv;
        result.preview = review(document, plan.document, old, next, selected, {...settings,pivot}, kit, paths,readability);
      }
      if (out && plan.report.canCommit) {
        if (editor) result.transaction = editor.editMeshUV(object, request).topology;
        value = editor ? editor.snapshot() : plan.document;
      }
    }
  }
  if (report) files.json(path.resolve(report), result);
  if (out && value !== undefined) files.json(path.resolve(out), value);
  process.stdout.write(JSON.stringify(out && value !== undefined && action !== 'edit' ? { output: path.resolve(out) } : result, null, 2) + '\n');
  if (out && action === 'edit' && value === undefined) process.exitCode = 1;
}

module.exports = { command, capture };
