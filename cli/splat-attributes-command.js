'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Plan = require('./splat-attribute-plan.js');
const Exchange = require('./splat-exchange.js');
const Fit = require('./splat-fit-asset.js');
const Render = require('./render.js');
const PNG = require('./png.js');
const { graphOutputs } = require('./graph-outputs.js');
const { claim } = require('./graph-batch.js');

const hasFile = file => fs.statSync(file, { throwIfNoEntry: false })?.isFile();
const viewChannels = ['coverage', 'depth', 'geometricNormal', 'inkShadow'];
const record = row => row && Object.getPrototypeOf(row) === Object.prototype;
const label = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
const pathFrom = (folder, file) => {
  if (typeof file !== 'string' || !file.trim() || file.length > 4096 || file.includes('\0'))
    throw new TypeError('Expected a splat attribute input filename');
  return path.resolve(folder, file);
};

function write(directory, assets, files, busy = false) {
  const guard = graphOutputs([...new Set(files)].filter(Boolean));
  const release = busy && claim(directory, 'splat attribute pipeline');
  try { guard.write(directory, assets); }
  finally { if (release) release(); }
}

function viewSpecs(source) {
  if (!Array.isArray(source) || !source.length || source.length > 8)
    throw new RangeError('Splat verification needs 1 to 8 registered views');
  const keys = new Set();
  return source.map(input => {
    const { id, w = 144, h = 112, camera, liveSun } = input ?? {};
    if (!record(input) || Object.keys(input).some(k => !['id', 'w', 'h', 'camera', 'liveSun'].includes(k)) ||
        !label(id) || keys.has(id.toLowerCase()) || ![w,h].every(v => Number.isSafeInteger(v) && v >= 8 && v <= 512) ||
        camera !== undefined && !record(camera) || liveSun !== undefined && typeof liveSun !== 'boolean' && !record(liveSun))
      throw new RangeError('Invalid or duplicate splat verification view');
    keys.add(id.toLowerCase());
    return { id, w, h, camera, liveSun };
  });
}

function difference(a, b, tolerance = 0) {
  if (!a || !b || a.length !== b.length) throw new RangeError('Splat verification buffers are missing or misregistered');
  let count = 0, max = 0, nonfinite = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) { nonfinite++; count++; continue; }
    const error = Math.abs(a[i] - b[i]);
    max = Math.max(max, error);
    if (error > tolerance) count++;
  }
  return { count, max, nonfinite };
}

function frameOptions(spec) {
  return { ...spec, px: 1, raw: true, lockCamera: true, snap: false, renderGrid: false,
    scanAppearance: 1, passes: viewChannels };
}

function checkView(world, asset, exported, view) {
  const settings = frameOptions(view), before = Render.render(world, settings);
  const live = Render.render(world, { ...settings, splatFit: asset });
  const reopen = Render.render(exported, settings);
  const staticColor = Render.render(exported, { ...settings, scanAppearance: 0, passes: [] });
  const passes = Object.fromEntries(viewChannels.map(k => [k, difference(live.passes[k], reopen.passes[k], 1e-5)]));
  const changed = Object.fromEntries(viewChannels.map(k => [k, difference(before.passes[k], live.passes[k], 1e-5)]));
  const rgb = difference(live.rgb, reopen.rgb), directional = difference(staticColor.rgb, reopen.rgb);
  return { report: { ...view, rgb, passes, changed, directionalChannels: directional.count,
    passed: !rgb.count && Object.values(passes).every(pass => !pass.count) },
    frames: [['source', before], ['live', live], ['export', reopen]].map(([suffix, frame]) => ({
      file: 'views/' + view.id + '-' + suffix + '.png', bytes: PNG.encode(frame.w, frame.h, frame.rgb)
    })) };
}

function exportTable(world, native, data, kit) {
  const rows = Plan.catalog(native, kit);
  const original = Plan.catalog(world, kit), targetIds = new Set(original.map(row => row.id));
  if (data.entities.length !== original.length || data.entities.some(({id}) => !targetIds.has(id)))
    throw new RangeError('Retained attributes do not match the source rows');
  return Plan.attributes(rows, kit, data);
}

const sizedCommands = {
  inspect: 'splat-attributes inspect <scene> --out attributes.json',
  plan: 'splat-attributes plan <scene> <plan.json> --out directory',
  export: 'splat-attributes export <scene> <plan directory> --out cloud.inksplats',
  verify: 'splat-attributes verify <scene> <plan directory> <cloud.inksplats> --views views.json --out directory'
};

async function command(pos, opt, kit, build) {
  const [action, scene, input, exportedFile] = pos;
  const size = { inspect: 2, plan: 3, export: 3, verify: 4 }[action];
  if (!size || pos.length !== size || Object.keys(opt).some(k => !['out', 'size', 'up', ...(action === 'verify' ? ['views'] : [])].includes(k)) ||
      typeof opt.out !== 'string' || !opt.out.trim() || action === 'verify' && typeof opt.views !== 'string')
    throw new TypeError('Use ' + (sizedCommands[action] ?? 'ink-studio help for splat attribute commands'));
  const out = path.resolve(opt.out), sourceFiles = hasFile(scene) ? [path.resolve(scene)] : [];
  const world = build(scene);
  const split = file => [path.dirname(file), path.basename(file)];

  if (action === 'inspect') {
    const data = Plan.attributes(Plan.catalog(world, kit), kit, world.proceduralSplatAttributes);
    const [directory, file] = split(out);
    write(directory, [{ file, document: data }], sourceFiles);
    console.log('Wrote ' + data.entities.length + ' retained splat rows to ' + out);
    return;
  }
  if (action === 'plan') {
    const file = path.resolve(input), inputs = [...sourceFiles, file], parent = path.dirname(file);
    const loaded = new Map();
    const result = Plan.plan(world, Exchange.read(file, 6_000_000), kit, name => {
      const location = pathFrom(parent, name);
      if (!loaded.has(location)) {
        inputs.push(location);
        loaded.set(location, Exchange.read(location, 48 * 1024 ** 2));
      }
      return loaded.get(location);
    });
    result.report.inputs = inputs.slice(sourceFiles.length + 1).map(input => ({
      file: path.relative(parent, input), sha256: Plan.hash(loaded.get(input))
    }));
    write(out, [{ file: 'fit.json', document: result.asset }, { file: 'attributes.json', document: result.data },
      { file: 'report.json', document: result.report }], inputs, true);
    console.log('Planned ' + result.report.removed.length + ' removals and ' + result.report.deformation.changedRows + ' deformed rows in ' + out);
    return;
  }

  const fitFile = path.resolve(input, 'fit.json'), tableFile = path.resolve(input, 'attributes.json');
  const asset = Exchange.read(fitFile), data = Exchange.read(tableFile);
  if (asset?.format !== Fit.format || asset.version !== 2 || typeof asset.sourceSignature !== 'string' ||
      asset.retainedAttributesSha256 !== Plan.hash(data))
    throw new RangeError('Splat exchange needs a matching procedural fit and retained attribute table');
  const inputs = [...sourceFiles, fitFile, tableFile], baked = Fit.bake(world, asset);
  const table = exportTable(world, baked, data, kit);
  const document = Exchange.serialize(baked, table);
  if (action === 'export') {
    if (!Exchange.suffix.test(out)) throw new RangeError('Splat exchange output needs a .inksplats extension');
    const [directory, file] = split(out);
    const bytes = Buffer.from(JSON.stringify(document) + '\n');
    if (bytes.length > 96 * 1024 ** 2) throw new RangeError('Splat exchange exceeds its byte limit');
    write(directory, [{ file, bytes }], inputs);
    console.log('Exported ' + baked.count + ' fitted splats to ' + out);
    return;
  }

  const exportedPath = path.resolve(exportedFile), viewPath = path.resolve(opt.views);
  const views = viewSpecs(Exchange.read(viewPath, 1_000_000));
  const exported = await Exchange.load(exportedPath, kit);
  const exact = Plan.hash(document) === Plan.hash(Exchange.serialize(exported, exported.proceduralSplatAttributes));
  const checks = views.map(view => checkView(world, asset, exported, view)), passed = exact && checks.every(row => row.report.passed);
  const report = { format: 'ink-studio/splat-exchange-verification', version: 1, passed, exactPayload: exact,
    sourceRows: world.count, exportedRows: exported.count, harmonicDegree: exported.gaussianHarmonics?.degree ?? null,
    passTolerance: 1e-5, views: checks.map(row => row.report) };
  write(out, [...checks.flatMap(check => check.frames), { file: 'report.json', document: report }],
    [...inputs, exportedPath, viewPath], true);
  if (!passed) process.exitCode = 2;
  console.log((passed ? 'Verified ' : 'Differences in ') + views.length + ' registered render and export views in ' + out);
}

module.exports = { command, difference };
