const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const R = require('./render.js');
const Compose = require('../src/frame-composite.js');
const { viewSettings, worldFor } = require('./mesh-native-view.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const options = {
  layout: ['object', 'out'], select: ['object', 'out', 'view', 'preview'],
  edit: ['object', 'out', 'view', 'preview', 'report', 'selection']
};
const imageNames = ['atlas-before.png', 'model-before.png', 'atlas-after.png', 'model-after.png', 'comparison.png'];
const ink = { seam: '#f391a6', pin: '#ffcb78', selected: '#75e2c8', boundary: '#7393ac',
  continuous: '#456578', 'material-boundary': '#859cad', 'non-manifold': '#ed8c70' };
const tints = ['#25495a', '#413950', '#574232', '#335344', '#403c57'];
const name = v => typeof v === 'string' && Boolean(v.trim());
const rect = (rect, color) => ({ type: 'rect', rect, color });
const line = (points, color, width = 1) => ({ type: 'path', points, color, width });
const text = (text, at, color = '#dce8ee', size = 10) => ({ type: 'text', text, at, size, color });
const center = (p, n) => [Math.round(p[0]) - n, Math.round(p[1]) - n, n * 2 + 1, n * 2 + 1];

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

function atlas(layout, material, selection, settings, kit) {
  const { h } = settings, w = h, margin = 8, extent = w - margin * 2;
  const at = uv => uv.map(n => margin + n * (extent - 1));
  const corners = new Map(layout.corners.map(row => [row.id, row]));
  const faces = new Set(layout.faces.filter(row => row.material === material).map(row => row.id));
  const selected = new Set(selection?.faces), selectedEdges = new Set(selection?.domain === 'edges' ? selection.edges : []);
  const selectedCorners = new Set(selection?.domain === 'corners' ? selection.corners : []);
  const chartColors = new Map(layout.islands.map((row, i) => [row.id, tints[i % tints.length]]));
  const sampleEvery = Math.max(1, Math.ceil(faces.size / 4000));
  const draw = [rect([margin, margin, extent, extent], '#152634')];
  for (let i = 0; i <= 8; i++) {
    draw.push(line([at([i / 8, 0]), at([i / 8, 1])], '#29404f'));
    draw.push(line([at([0, i / 8]), at([1, i / 8])], '#29404f'));
  }
  let step = 0;
  for (const row of layout.faces) if (faces.has(row.id) && (step++ % sampleEvery === 0 || selected.has(row.id))) {
    draw.push({ type: 'polygon', points: row.corners.map(id => at(corners.get(id).uv)),
      fill: selected.has(row.id) ? '#357c75' : chartColors.get(row.island) });
  }
  for (const [i, edge] of layout.edges.entries()) if (i % sampleEvery === 0 || selectedEdges.has(edge.id) || edge.authored) {
    const color = selectedEdges.has(edge.id) ? ink.selected : ink[edge.kind];
    for (const side of edge.sides) if (faces.has(side.face)) draw.push(line(side.uv.map(at), color, selectedEdges.has(edge.id) ? 2 : 1));
  }
  for (const corner of corners.values()) if (faces.has(corner.face) && (corner.pinned || selectedCorners.has(corner.id)))
    draw.push(rect(center(at(corner.uv), corner.pinned ? 2 : 1), corner.pinned ? ink.pin : ink.selected));
  return composite(w, h, [], draw, kit);
}

function model(layout, { frame, mesh, camera }, selection, kit) {
  const { w, h } = frame, K = kit.KIT, UV = K.meshTopology.uv;
  const mapped = UV.modelFaces(mesh, frame), selected = new Set(selection?.faces);
  const rgb = frame.rgb.slice();
  for (let i = 0; i < mapped.faceAt.length; i++) if (selected.has(mapped.faces[mapped.faceAt[i]]))
    [93, 205, 179].forEach((n, channel) => {
      rgb[i * 3 + channel] = Math.round((rgb[i * 3 + channel] * 2 + n) / 3);
    });
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
  const selectedCorners = new Set(selection?.domain === 'corners' ? selection.corners : []);
  for (const edge of layout.edges) if (edge.kind === 'seam' || selectedEdges.has(edge.id)) {
    const [a, b] = edge.vertices.map(id => points.get(id));
    if (!a || !b) continue;
    const faces = edge.sides.map(row => row.face), color = selectedEdges.has(edge.id) ? [117, 226, 200] : [243, 145, 166];
    const steps = Math.min((w + h) * 2, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))));
    for (let j = 0; j <= steps; j++) {
      const x = Math.round(a[0] + (b[0] - a[0]) * j / steps), y = Math.round(a[1] + (b[1] - a[1]) * j / steps);
      if (x >= 0 && x < w && y >= 0 && y < h && visible(x, y, faces)) rgb.set(color, (x + y * w) * 3);
    }
  }
  const draw = [];
  for (const corner of layout.corners) if (corner.pinned || selectedCorners.has(corner.id)) {
    const p = points.get(corner.vertex);
    if (p && visible(Math.round(p[0]), Math.round(p[1]), [corner.face]))
      draw.push(rect(center(p, corner.pinned ? 2 : 1), corner.pinned ? ink.pin : ink.selected));
  }
  return composite(w, h, [{ source: { w, h, rgb } }], draw, kit);
}

function review(before, after, nativeBefore, nativeAfter, selected, settings, kit, paths, readability) {
  if (settings.h < 32) throw new RangeError('UV review needs at least 32 native rows');
  const UV = kit.KIT.meshTopology.uv;
  const layouts = [UV.inspect(before), UV.inspect(after)];
  const material = settings.material ?? layouts[0].faces.find(face => selected?.faces.includes(face.id))?.material ??
    layouts[0].faces[0]?.material;
  if (!layouts[0].faces.some(row => row.material === material)) throw new RangeError('Choose an authored UV material');
  const captures = [nativeBefore, nativeAfter], views = [];
  for (const [i, layout] of layouts.entries()) {
    views.push(atlas(layout, material, selected, settings, kit), model(layout, captures[i], selected, kit));
  }
  const gap = 6, { w, h } = settings, width = h + w + 3 * gap, height = h * 2 + 64;
  const layers = [], draw = [text('Atlas', [h / 2 + gap, 13]), text('Native model', [h + 2 * gap + w / 2, 13])];
  const rowNames = before === after ? ['Selection', 'Selection'] : ['Before', 'After'];
  for (const [i, image] of views.entries()) {
    const x = i % 2 ? h + 2 * gap : gap, y = 33 + Math.floor(i / 2) * (h + 15);
    layers.push({ source: image, rect: [x, y, image.w, image.h] });
    if (i % 2 === 0) draw.push(text(rowNames[Math.floor(i / 2)], [x + h / 2, y - 7], '#9fb9c3', 8));
  }
  draw.push(text('Cut seam', [width * .18, height - 8], ink.seam, 8),
    text('Pinned corner', [width * .49, height - 8], ink.pin, 8),
    text('Linked selection', [width * .80, height - 8], ink.selected, 8));
  views.push(composite(width, height, layers, draw, kit));
  for (const [i, image] of views.entries()) files.write(paths[i], PNG.encode(image.w, image.h, image.rgb));
  const evidence = readability && {
    time: settings.t, camera: nativeBefore.camera,
    before: UV.readability(nativeBefore.mesh, nativeBefore.frame, readability),
    after: UV.readability(nativeAfter.mesh, nativeAfter.frame, readability)
  };
  return { material, grid: [w, h], files: imageNames, ...(evidence && { readability: evidence }) };
}

function command([action, file, input, ...rest], opt, kit, openEditor) {
  if (!file || rest.length || (action === 'layout' ? input !== undefined : !input) ||
      Object.entries(opt).some(([key, value]) => !options[action].includes(key) || !name(value)) ||
      opt.selection && !opt.preview)
    throw new TypeError('Use mesh-uv layout, select, or edit on a retained mesh topology document');
  const { object, out, report, preview } = opt;
  const inputs = [file, input, opt.view, opt.selection].filter(Boolean).map(value => path.resolve(value));
  const paths = preview ? imageNames.map(name => path.resolve(preview, name)) : [];
  const outputs = [...[out, report].filter(Boolean).map(value => path.resolve(value)), ...paths];
  if (new Set(outputs).size !== outputs.length || outputs.some(value => inputs.includes(value)))
    throw new RangeError('Write UV reports and edited documents separately from the source and request');
  if (object && action === 'edit' && out && path.dirname(path.resolve(out)) !== path.dirname(inputs[0]))
    throw new RangeError('Write the revised scene beside its source so relative assets still resolve');
  const source = read(file), { meshTopology: topology } = kit.KIT, UV = topology.uv;
  if (source.topologyMeshes && !object) throw new TypeError('Choose a scene mesh with --object');
  const editor = object && openEditor(file);
  const document = topology.create(editor ? editor.meshTopology(object).document : source);
  let result, value;
  if (action === 'layout') result = value = UV.inspect(document);
  else {
    const request = read(input), settings = view(opt.view ? read(opt.view) : {}, !editor);
    const old = (preview || action === 'select' && request?.model !== undefined) && capture(document, settings, kit, editor, object);
    if (action === 'select') {
      if (request?.model !== undefined) {
        if (!request.model || Object.keys(request).some(key => !['domain', 'model'].includes(key)) ||
            Object.keys(request.model).some(key => key !== 'pixel'))
          throw new TypeError('Use a UV model query with a domain and native pixel');
        result = UV.pickModel(old.mesh, old.frame, request.model.pixel, request.domain);
      } else result = UV.select(document, request);
      value = result;
      if (preview) result.preview = review(document, document, old, old, result, settings, kit, paths, settings.readability);
    } else {
      const plan = editor ? editor.planMeshUV(object, request) : UV.plan(document, request);
      result = { ...plan.report };
      if (preview) {
        const selected = opt.selection ? (() => {
          const saved = read(opt.selection);
          return UV.select(document, { domain: saved.domain, from: saved });
        })() : UV.select(document, { domain: 'faces', ids: [...new Set(plan.report.corners.map(row => row.face))] });
        const draft = editor && Object.keys(plan.patch).length ? editor.fork() : editor;
        if (draft && draft !== editor) draft.editMeshTopology(object, plan.patch);
        const revised = plan.report.canCommit && settings.afterMaterials ? { ...settings, materials: settings.afterMaterials } : settings;
        const next = plan.document === document && revised === settings ? old : capture(plan.document, revised, kit, draft, object);
        const budget = [...plan.report.operations].reverse().find(row => row.op === 'texel-budget' && row.evidence?.features);
        const readability = settings.readability ?? (budget && { atlas: budget.evidence.atlas,
          features: budget.evidence.features.map(({ id, faces }) => ({ id, faces })) });
        result.preview = review(document, plan.document, old, next, selected, settings, kit, paths, readability);
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
