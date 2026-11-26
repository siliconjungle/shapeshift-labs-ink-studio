const fs = require('node:fs');
const path = require('node:path');
const MaterialUV = require('../src/material-uv.js');
const files = require('./asset-files.js');

const bundleFormat = 'ink-studio/uv-layout-bundle';
const batchFormat = 'ink-studio/uv-density-batch';
const name = value => typeof value === 'string' && Boolean(value.trim());
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => names.includes(key));
function need(ok, message) {
  if (!ok) throw new RangeError('Mesh UV: ' + message);
}

function read(file, limit = 64 * 1024 * 1024) {
  const stat = fs.statSync(file);
  need(stat.isFile() && stat.size <= limit, 'input exceeds the file byte budget');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function open(kit, file, object, openEditor) {
  const { KIT: K } = kit, input = read(file);
  if (!input?.topologyMeshes) {
    need(object === undefined, 'use --object with an editable scene');
    return { meshes: [{ document: K.meshTopology.create(input) }] };
  }
  const snapshot = openEditor(file).snapshot();
  const objects = object === undefined ? Object.keys(snapshot.topologyMeshes).sort()
    : (need(Object.hasOwn(snapshot.topologyMeshes, object), 'unknown editable mesh ' + object), [object]);
  need(objects.length >= 1 && objects.length <= 32, 'expected 1 to 32 retained editable meshes');
  return { snapshot, meshes: objects.map(id => ({ object: id, ...snapshot.topologyMeshes[id] })) };
}

function context(K, scene, mesh, selector) {
  if (!scene) return {};
  const { uv, create } = K.meshTopology, set = MaterialUV.resolve(mesh.document.uvBindings, selector);
  const tooling = K.authoring.meshTopologyScene;
  const channels = ['pigment', 'normal', 'metallicRoughness', 'emission'].filter(channel =>
    MaterialUV.resolve(mesh.document.uvBindings, channel) === set);
  const lookups = channels.map(channel => tooling.uvAtlases(scene, mesh, channel)).filter(Boolean);
  const lockedMaterials = new Set((mesh.bakes ?? []).filter(row => !row.invalidated).map(row => row.material));
  const retained = (mesh.bindings ?? []).filter(row => !row.review && (row.data?.uvSet === undefined || row.data.uvSet === set));
  const lockedFaces = new Set();
  if (retained.length) {
    const layout = uv.inspect(create(mesh.document), set);
    const faces = new Set(layout.faces.map(row => row.id)), edges = new Map(layout.edges.map(row => [row.id, row]));
    const corners = new Map(layout.corners.map(row => [row.id, row.face]));
    for (const row of retained) {
      if (row.domain === 'faces' && faces.has(row.element)) lockedFaces.add(row.element);
      if (row.domain === 'edges') for (const { face } of edges.get(row.element)?.sides ?? []) lockedFaces.add(face);
      if (row.domain === 'corners' && corners.has(row.element)) lockedFaces.add(corners.get(row.element));
    }
  }
  return { lockedMaterials, lockedFaces: [...lockedFaces], materialIds: (mesh.materials ?? []).map(row => row.id),
    atlasFor(id) {
      for (const lookup of lookups) {
        const atlas = lookup(id);
        if (atlas) return atlas;
      }
    } };
}

function storeMesh(mesh, result) {
  const definitions = new Map((mesh.materials ?? []).map(row => [row.id, row]));
  for (const tile of result.layout.tiles) if (tile.material !== tile.sourceMaterial)
    definitions.set(tile.material, { ...definitions.get(tile.sourceMaterial), id: tile.material });
  const { object, ...row } = mesh;
  return { ...row, document: result.document, materials: [...definitions.values()] };
}

function prepare(kit, source, request, opt, openEditor) {
  const { KIT: K } = kit, api = K.meshTopology.uvPreparation, opened = open(kit, source, opt.object, openEditor);
  const { snapshot, meshes } = opened;
  need(meshes.length === 1 || request?.revision === undefined && request?.protect === undefined,
    'use --object to scope a topology revision or named protection');
  need(!snapshot || !opt.out || path.dirname(source) === path.dirname(path.resolve(opt.out)),
    'write the revised scene beside its source to retain relative assets');
  let triangleWork = 0;
  const plans = meshes.map(mesh => {
    const plan = api.prepare(mesh.document, request, context(K, snapshot, mesh, request?.uvSet ?? 'pigment'));
    triangleWork += plan.report.before.triangles;
    need(triangleWork <= 120000, 'asset exceeds its triangle budget');
    return { mesh, ...plan, object: mesh.object ?? null };
  });
  const canCommit = plans.every(plan => plan.report.canCommit);
  const report = { canCommit, meshes: plans.map(row => ({ object: row.object, ...row.report })) };
  let updated;
  if (canCommit && snapshot) {
    const topologyMeshes = { ...snapshot.topologyMeshes };
    for (const row of plans) topologyMeshes[row.object] = storeMesh(row.mesh, row);
    try {
      // Reuse native scene validation for the composed material pages.
      const registry = K.authoring.tilesets.prepare(snapshot.tilesets, snapshot.tilesetDefaults);
      K.authoring.meshTopologyScene.prepare(topologyMeshes, registry);
      updated = { ...snapshot, topologyMeshes };
    } catch (error) {
      report.canCommit = false;
      report.failure = { code: 'native-scene-rejected', message: error.message };
    }
  } else if (canCommit) updated = plans[0].document;
  if (opt.report) files.json(path.resolve(opt.report), report);
  if (report.canCommit && opt.out) files.json(path.resolve(opt.out), updated);
  if (report.canCommit && opt['layout-out']) files.json(path.resolve(opt['layout-out']), {
    format: bundleFormat, version: 1, meshes: plans.map(row => ({ object: row.object, layout: row.layout }))
  });
  if (!report.canCommit && (opt.out || opt['layout-out'])) process.exitCode = 1;
  return report;
}

function layoutFor(bundle, object, api) {
  if (!bundle) return undefined;
  if (bundle.format === api.format) return bundle;
  need(bundle.format === bundleFormat && bundle.version === 1 && Array.isArray(bundle.meshes),
    'expected a native UV layout bundle');
  const rows = bundle.meshes.filter(row => row.object === object);
  need(rows.length === 1, 'layout bundle has no unique entry for ' + (object ?? 'the mesh'));
  return rows[0].layout;
}

function batch(kit, manifestFile, request, opt, openEditor) {
  const { KIT: K } = kit, api = K.meshTopology.uvPreparation, limits = ['uvSet', 'atlas', 'texelsPerUnit',
    'densityTolerance', 'maxStretch', 'acceptHeldDensity', 'maxChecks'];
  need(fields(request, ['format', 'version', 'settings', 'assets']) && request.format === batchFormat && request.version === 1 &&
    fields(request.settings ?? {}, limits) && Array.isArray(request.assets) && request.assets.length > 0 &&
    request.assets.length <= 32, 'expected a bounded version 1 UV density batch');
  const dir = path.dirname(manifestFile), ids = new Set();
  const reportPath = opt.out && path.resolve(opt.out);
  for (const row of request.assets) {
    need(fields(row, ['id', 'file', 'layout', 'object', 'settings']) && name(row.id) && !ids.has(row.id) &&
      name(row.file) && (row.layout === undefined || name(row.layout)) && (row.object === undefined || name(row.object)) &&
      fields(row.settings ?? {}, limits), 'batch assets need distinct IDs, paths and valid settings');
    ids.add(row.id);
    need([row.file, row.layout].filter(Boolean).every(file => path.resolve(dir, file) !== reportPath),
      'write the batch report separately from asset and layout inputs');
  }
  let triangles = 0;
  const assets = request.assets.map(row => {
    try {
      const input = path.resolve(dir, row.file), { meshes, snapshot } = open(kit, input, row.object, openEditor);
      const bundle = row.layout && read(path.resolve(dir, row.layout), 8 * 1024 * 1024);
      const settings = { ...request.settings, ...row.settings };
      const reviews = meshes.map(mesh => {
        const layout = layoutFor(bundle, mesh.object ?? null, api), selector = settings.uvSet ?? layout?.uvSet ?? 'pigment';
        const result = api.validate(mesh.document, settings, { ...context(K, snapshot, mesh, selector), layout });
        triangles += result.triangles;
        need(triangles <= 120000, 'batch exceeds its triangle budget');
        return { object: mesh.object ?? null, ...result };
      });
      return { id: row.id, file: row.file, clean: reviews.every(review => review.clean), meshes: reviews };
    } catch (error) {
      return { id: row.id, file: row.file, clean: false, error: error.message };
    }
  });
  const clean = assets.every(row => row.clean);
  if (!clean) process.exitCode = 1;
  return { clean, passed: assets.filter(row => row.clean).length, failed: assets.filter(row => !row.clean).length, assets };
}

module.exports = function command([action, ...args], opt, kit, openEditor) {
  const preparation = action === 'prepare';
  need((preparation && args.length === 2 || action === 'validate-batch' && args.length === 1) &&
    Object.entries(opt).every(([key, value]) => name(value) &&
      (preparation ? ['object', 'out', 'report', 'layout-out'] : ['out']).includes(key)), 'use prepare or validate-batch');
  const inputs = args.map(file => path.resolve(file)), outputs = [opt.out, opt.report, opt['layout-out']].filter(Boolean).map(file => path.resolve(file));
  need(new Set(outputs).size === outputs.length && outputs.every(file => !inputs.includes(file)),
    'write results and layouts separately from their inputs');
  const result = preparation ? prepare(kit, inputs[0], read(inputs[1], 4 * 1024 * 1024), opt, openEditor)
    : batch(kit, inputs[0], read(inputs[0], 4 * 1024 * 1024), opt, openEditor);
  if (!preparation && opt.out) files.json(path.resolve(opt.out), result);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
};
