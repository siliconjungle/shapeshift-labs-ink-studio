'use strict';

const fs = require('node:fs');
const path = require('node:path');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const R = require('./render.js');
const { viewSettings } = require('./mesh-native-view.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const name = value => typeof value === 'string' && value.trim();

function command(file, input, rest, opt, kit, openEditor) {
  const { out, preview, view } = opt;
  if (!name(file) || !name(input) || rest.length ||
      Object.entries(opt).some(([key, value]) => !['out', 'preview', 'view'].includes(key) || !name(value)) ||
      view && !preview || preview && !/\.png$/i.test(preview) || out && !/\.json$/i.test(out))
    throw new TypeError('Use mesh-topology isolate-prefab <scene.json> <request.json> [--out scene.json] [--preview image.png] [--view settings.json]');
  const source = path.resolve(file);
  const inputs = [source, path.resolve(input), ...(view ? [path.resolve(view)] : [])];
  const outputs = [out, preview].filter(Boolean).map(value => path.resolve(value));
  if (new Set(outputs).size !== outputs.length || outputs.some(destination => inputs.includes(destination)) ||
      out && path.dirname(path.resolve(out)) !== path.dirname(source))
    throw new RangeError('Write a separate scene beside the source and use separate preview and input paths');
  const editor = openEditor(source), request = read(input);
  const settings = preview && viewSettings(view ? read(view) : {}, false);
  const capture = preview && editor.previewPrefabIsolation(request, { time: settings.t });
  const report = capture ? capture.report : editor.planPrefabIsolation(request);
  let evidence;
  if (capture) {
    const { world, renderOptions } = capture, { w, h, t, camera, raw } = settings;
    require('./diarama-pose.js').pose(world, t, { kit, maxSteps: 7200 });
    const frame = R.render(world, { w, h, t, camera, raw, px: 1, ...renderOptions,
      passes: ['objectId'], renderGrid: false, composite: false, renderGraph: false, shutter: false, cameraGuides: false });
    if (frame.w !== w || frame.h !== h || frame.passes?.objectId?.length !== w * h)
      throw new RangeError('Prefab isolation needs a matching native-grid object capture');
    const owners = new Map();
    for (const slot of frame.passes.objectId) {
      const id = frame.passes.objects[slot];
      if (id) owners.set(id, (owners.get(id) ?? 0) + 1);
    }
    evidence = { grid: [w, h], visible: [...owners].sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([object, pixels]) => ({ object, pixels })) };
    files.write(path.resolve(preview), PNG.encode(w, h, frame.rgb));
  }
  if (out && report.canCommit) {
    editor.editIsolatedPrefab(request);
    files.publishJson(path.resolve(out), editor.snapshot(), 'A different scene already exists at ' + out);
  }
  process.stdout.write(JSON.stringify({ ...report, ...(evidence && { preview: evidence }) }, null, 2) + '\n');
  if (out && !report.canCommit) process.exitCode = 1;
}

module.exports = { command };
