const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./asset-references.js');
const { json } = require('./asset-files.js');

const format = 'ink-studio/scene-stage';
const layerFormat = 'ink-studio/scene-stage-layer';
const selectionFlags = ['stage-selection', 'stage-variants', 'stage-payloads'];
const kinds = new Set(['asset', 'rig', 'material', 'lighting', 'shot']);
const maxBytes = 32 * 1024 * 1024;

function fields(data, value, allowed, label) {
  if (!data.record(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new TypeError(label + ' has an invalid record or unknown field');
}

function choices(value, allowed, label, record) {
  if (!record(value)) throw new TypeError(label + ' needs a named map');
  for (const [key, choice] of Object.entries(value))
    if (!Object.hasOwn(allowed, key) || !allowed[key].includes(choice))
      throw new TypeError(label + ' has an unknown choice for ' + key + ' (' + choice + ')');
}

function pairs(value, label) {
  if (typeof value !== 'string' || !value.length) throw new TypeError(label + ' needs name=value pairs');
  const entries = new Map();
  for (const pair of value.split(',')) {
    const [key, setting, extra] = pair.split('=');
    if (!key || !setting || extra !== undefined || entries.has(key))
      throw new TypeError(label + ' has an invalid or repeated pair (' + pair + ')');
    entries.set(key, setting);
  }
  return Object.fromEntries(entries);
}

const pointer = parts => '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');

function resolve(filename, kit, { options = {}, at, onFile } = {}) {
  const data = kit.world.data, paths = kit.authoring.projectBundles;
  const file = path.resolve(filename), directory = path.dirname(file);
  const root = fs.realpathSync(directory), inputs = new Set([file]);
  const reads = new Map();
  let bytesLeft = maxBytes;
  function read(file, sha256) {
    if (!reads.has(file)) {
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile()) throw new Error('Missing stage input ' + path.relative(directory, file));
      if (stat.size > bytesLeft) throw new RangeError('Scene stage exceeds its input byte budget');
      const bytes = fs.readFileSync(file);
      bytesLeft -= bytes.length;
      if (bytesLeft < 0) throw new RangeError('Scene stage exceeds its input byte budget');
      reads.set(file, { bytes, sha256: hash(bytes) });
      onFile?.(file);
    }
    const entry = reads.get(file);
    if (sha256 !== undefined && sha256 !== entry.sha256)
      throw new Error('Stage input SHA-256 mismatch for ' + path.relative(directory, file));
    return entry;
  }
  const original = read(file), stage = { file: path.basename(file), sha256: original.sha256 };
  const document = JSON.parse(original.bytes.toString('utf8'));
  fields(data, document, ['format', 'version', 'id', 'base', 'variants', 'selections', 'layers'], 'Scene stage');
  if (document.format !== format || document.version !== 1 || !data.id(document.id) ||
      !Array.isArray(document.layers) || document.layers.length > 256)
    throw new TypeError('Expected a version 1 scene stage with an ID and up to 256 layers');
  function fileRef(ref, sha256) {
    const relative = paths.resolvePath('', ref);
    if (!/\.json$/i.test(relative) || sha256 !== undefined && (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)))
      throw new TypeError('Stage file references need a .json path and an optional lowercase SHA-256');
    const target = path.join(directory, relative);
    inputs.add(target);
    return relative;
  }
  function load(relative, sha256) {
    const target = path.join(directory, relative);
    let actual;
    try { actual = fs.realpathSync(target); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new Error('Missing stage input ' + relative);
      throw error;
    }
    const link = path.relative(root, actual);
    if (path.isAbsolute(link) || link === '..' || link.startsWith('..' + path.sep))
      throw new RangeError('Stage input leaves the stage directory (' + relative + ')');
    const entry = read(target, sha256);
    return { source: { file: relative, sha256: entry.sha256 }, value: JSON.parse(entry.bytes.toString('utf8')) };
  }
  function baseScene() {
    if (typeof document.base === 'string') return load(fileRef(document.base));
    if (data.record(document.base) && Object.hasOwn(document.base, 'file')) {
      fields(data, document.base, ['file', 'sha256'], 'Stage base reference');
      return load(fileRef(document.base.file, document.base.sha256), document.base.sha256);
    }
    return { source: { inline: true }, value: document.base };
  }

  const { variants = {}, selections = {} } = document;
  if (!data.record(variants) || !data.record(selections) || Object.keys(variants).length > 64 ||
      Object.keys(selections).length > 256)
    throw new TypeError('Scene stage needs bounded variant and selection maps');
  const allowed = Object.fromEntries(Object.entries(variants).map(([id, variant]) => {
    fields(data, variant, ['default', 'choices'], 'Variant ' + id);
    if (!data.id(id) || !Array.isArray(variant.choices) || variant.choices.length > 64 ||
        !variant.choices.every(data.id) || new Set(variant.choices).size !== variant.choices.length ||
        !variant.choices.includes(variant.default))
      throw new TypeError('Variant ' + id + ' needs distinct named choices and a default');
    return [id, variant.choices];
  }));

  const layerIds = new Set(), payloadDefaults = {};
  const layers = document.layers.map(layer => {
    fields(data, layer, ['id', 'kind', 'file', 'sha256', 'edits', 'when', 'payload'], 'Stage layer');
    const { id, kind, file, sha256, edits, when = {}, payload } = layer;
    if (!data.id(id) || layerIds.has(id) || !kinds.has(kind) || (file === undefined) === (edits === undefined) ||
        file === undefined && sha256 !== undefined || edits !== undefined && !Array.isArray(edits))
      throw new TypeError('Stage layer needs a distinct ID, a kind, and exactly one edit source (' + id + ')');
    layerIds.add(id);
    choices(when, allowed, 'Layer ' + id + ' variant gate', data.record);
    if (payload !== undefined) {
      fields(data, payload, ['default'], 'Payload ' + id);
      if (kind !== 'asset' || typeof payload.default !== 'boolean')
        throw new TypeError('Payload ' + id + ' needs an asset layer and a boolean default');
      payloadDefaults[id] = payload.default;
    }
    return { id, kind, edits, when, payload, sha256, relative: file === undefined ? undefined : fileRef(file, sha256) };
  });
  const payloadChoices = Object.fromEntries(Object.keys(payloadDefaults).map(id => [id, [true, false]]));
  for (const [id, selection] of Object.entries(selections)) {
    if (!data.id(id)) throw new TypeError('Invalid stage selection ID ' + id);
    fields(data, selection, ['variants', 'payloads'], 'Selection ' + id);
    const { variants = {}, payloads = {} } = selection;
    choices(variants, allowed, 'Selection ' + id, data.record);
    choices(payloads, payloadChoices, 'Selection ' + id, data.record);
  }
  const selected = options['stage-selection'];
  if (selected !== undefined && (typeof selected !== 'string' || !Object.hasOwn(selections, selected)))
    throw new TypeError('Unknown stage selection ' + selected);
  const explicitVariants = options['stage-variants'] === undefined ? {} :
    pairs(options['stage-variants'], '--stage-variants');
  const explicitPayloads = options['stage-payloads'] === undefined ? {} :
    Object.fromEntries(Object.entries(pairs(options['stage-payloads'], '--stage-payloads')).map(([id, value]) => {
      if (value !== 'on' && value !== 'off') throw new TypeError('Use on or off for payload ' + id);
      return [id, value === 'on'];
    }));
  choices(explicitVariants, allowed, '--stage-variants', data.record);
  choices(explicitPayloads, payloadChoices, '--stage-payloads', data.record);
  const preset = selected === undefined ? {} : selections[selected];
  function decisions(defaults, named = {}, explicit) {
    return Object.fromEntries(Object.entries(defaults).map(([id, value]) => [id, Object.hasOwn(explicit, id) ?
      { value: explicit[id], from: 'override' } : Object.hasOwn(named, id) ?
        { value: named[id], from: 'selection' } : { value, from: 'default' }]));
  }
  const variantValues = decisions(Object.fromEntries(Object.entries(variants).map(([id, value]) => [id, value.default])),
    preset.variants, explicitVariants);
  const payloadValues = decisions(payloadDefaults, preset.payloads, explicitPayloads);

  const base = baseScene();
  if (!data.record(base.value) || base.value.format !== undefined)
    throw new TypeError('A stage base needs a native JSON diorama');
  let scene = kit.procedural.data.freeze(data.copy(base.value));
  const watched = at === undefined ? undefined : data.selector(at);
  let evidenceLeft = 8 * 1024 * 1024;
  function observed(value) {
    if (value === undefined) return { exists: false };
    evidenceLeft -= Buffer.byteLength(JSON.stringify(value));
    if (evidenceLeft < 0) throw new RangeError('Scene stage value history exceeds its byte budget. Query a smaller value.');
    return { exists: true, value };
  }
  const initial = watched && observed(data.read(scene, watched));
  const history = [];
  let budget = 2048;
  const layerReports = layers.map(layer => {
    const { id, kind, relative, when } = layer;
    const failures = Object.entries(when).flatMap(([name, required]) => {
      const actual = variantValues[name].value;
      return actual === required ? [] : [{ variant: name, required, actual }];
    });
    const unloaded = layer.payload !== undefined && !payloadValues[id].value;
    const report = { id, kind, status: failures.length ? 'variant-mismatch' : unloaded ? 'payload-unloaded' : 'applied',
      source: relative === undefined ? { inline: true } : { file: relative },
      ...(failures.length > 0 && { mismatches: failures }),
      ...(layer.payload !== undefined && { payloadLoaded: !failures.length && !unloaded }) };
    if (failures.length || unloaded) return report;

    try {
      let edits = layer.edits;
      if (relative !== undefined) {
        const { source, value } = load(relative, layer.sha256);
        fields(data, value, ['format', 'version', 'edits'], 'Stage layer file');
        if (value.format !== layerFormat || value.version !== 1) throw new TypeError('Expected a version 1 stage layer file');
        report.source = source;
        edits = value.edits;
      }
      if (!Array.isArray(edits) || edits.length > budget) throw new RangeError('Scene stage exceeds its edit budget');
      budget -= edits.length;
      report.edits = edits.map((edit, index) => {
        fields(data, edit, ['op', 'path', 'value'], 'Edit ' + (index + 1));
        if (!['set', 'merge', 'remove', 'test'].includes(edit.op) ||
            Object.hasOwn(edit, 'value') === (edit.op === 'remove'))
          throw new TypeError('Invalid stage operation at edit ' + (index + 1));
        const target = data.selector(edit.path);
        if (target[0] === 'format') throw new TypeError('Stage edits must preserve the native scene format');
        return { index: index + 1, op: edit.op, path: pointer(target) };
      });
      if (!watched) {
        scene = kit.world.apply(scene, edits, { validate: null }).world;
      } else {
        for (const [index, edit] of edits.entries()) {
          const before = data.read(scene, watched);
          try { scene = kit.world.apply(scene, [edit], { validate: null }).world; }
          catch (error) { throw new Error('Operation ' + (index + 1) + ' failed (' + error.message + ')', { cause: error }); }
          const after = data.read(scene, watched);
          if (!data.equal(before, after)) history.push({ layer: id, ...report.edits[index],
            before: observed(before), after: observed(after) });
        }
      }
    } catch (error) {
      throw new Error('Scene stage layer ' + id + ' (' + (relative ?? 'inline') + '): ' + error.message, { cause: error });
    }
    return report;
  });

  const winner = history.at(-1);
  const report = { format: 'ink-studio/scene-stage-resolution', version: 1, id: document.id, stage, base: base.source,
    selection: selected ?? null, variants: variantValues, payloads: payloadValues, layers: layerReports,
    ...(watched && { query: { path: pointer(watched), base: initial, resolved: observed(data.read(scene, watched)),
      source: winner ? { layer: winner.layer, index: winner.index, path: winner.path, op: winner.op } :
        initial.exists ? { base: true } : null, history } }) };
  return { scene, report, inputs };
}

function protectOutput(out, inputs) {
  const destination = path.resolve(out), stat = fs.statSync(destination, { throwIfNoEntry: false });
  for (const input of inputs) {
    if (input === destination) throw new Error('Choose an output separate from stage inputs');
    if (!stat) continue;
    const source = fs.statSync(input, { throwIfNoEntry: false });
    if (source && stat.dev === source.dev && stat.ino === source.ino)
      throw new Error('Choose an output separate from stage inputs');
  }
}

function command(pos, options, kit) {
  const [mode, file] = pos;
  const usage = 'Use scene-stage resolve <stage.json> --out bundle.json [--root directory] or scene-stage explain <stage.json> [--at /path --out report.json]';
  if (!['resolve', 'explain'].includes(mode) || pos.length !== 2 || !/\.json$/i.test(file) ||
      mode === 'resolve' && !/\.json$/i.test(typeof options.out === 'string' ? options.out : '') ||
      Object.keys(options).some(key => ![...selectionFlags, 'out', mode === 'explain' ? 'at' : 'root'].includes(key)) ||
      [options.out, options.at, options.root].some(value => value !== undefined && (typeof value !== 'string' || !value.trim())))
    throw new TypeError(usage);
  const input = path.resolve(file);
  const result = resolve(input, kit, { options, at: options.at });
  if (options.out) protectOutput(options.out, result.inputs);
  if (mode === 'resolve') {
    const { file, project } = require('./project-bundle.js').packStage(input, result.scene,
      { out: options.out, root: options.root });
    console.log('wrote', file, project.files().length, 'file(s)');
  } else if (options.out) json(path.resolve(options.out), result.report);
  else process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
}

module.exports = { format, resolve, command };
