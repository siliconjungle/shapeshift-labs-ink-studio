/* CLI one-shot capture and project import. Graph evaluation consumes local snapshots. */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const files = require('./asset-files.js');
const PNG = require('./png.js');
const WAV = require('./wav.js');
const { inspectPxc, maxPxcBytes } = require('./pxc.js');
const { createGraphHost } = require('./graph-host.js');
const { createGraphProject } = require('./graph-project.js');

const commands = Object.freeze({
  capture: ['out', 'adapters', 'json'],
  'inspect-pxc': ['out', 'json'],
  'import-pxc': ['out', 'adapters', 'using', 'translate', 'json'],
  'verify-pxc': ['out', 'json']
});
const hash = raw => createHash('sha256').update(raw).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

async function adapters(file, settings) {
  if (file === undefined) return settings;
  if (typeof file !== 'string' || !file.trim()) throw new TypeError('--adapters needs a local Node module');
  const adapterFile = path.resolve(file);
  const imported = await import(pathToFileURL(adapterFile).href);
  return { ...settings, adapterFile, adapters: imported.default ?? imported };
}

function distinct(file, sources) {
  const existing = fs.statSync(file, { throwIfNoEntry: false });
  if (!existing) return;
  if (!existing.isFile() || sources.some(source => {
    const stat = fs.statSync(source);
    return existing.ino === stat.ino && existing.dev === stat.dev;
  })) throw new Error('Host output must be a file separate from its inputs');
}

function readPxc(file) {
  if (fs.statSync(file).size > maxPxcBytes) throw new RangeError('PXC file exceeds the import budget');
  return fs.readFileSync(file);
}

function readValue(file, type) {
  if (type === 'audio') return WAV.read(file);
  if (type === 'raster') {
    const { w, h, data, max } = PNG.raster(file);
    return { width: w, height: h, data: max === 255 ? data : Uint8Array.from(data, n => Math.round(n * 255 / max)) };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function encodeValue(value, type) {
  if (type === 'audio') return WAV.encode(value, { encoding: 'float64' });
  if (type === 'raster') return PNG.encode(value.width, value.height, value.data, 4);
  return json(value);
}

function compareFrame(actual, file) {
  if (!actual || !Number.isSafeInteger(actual.width) || !Number.isSafeInteger(actual.height) ||
      actual.data?.length !== actual.width * actual.height * 4)
    throw new TypeError('Frame verification needs an editable RGBA raster target');
  if (fs.statSync(file).size > 16 * 1024 * 1024) throw new RangeError('Reference PNG exceeds the verification budget');
  const bytes = fs.readFileSync(file), { w, h } = PNG.layout(bytes);
  if (w !== actual.width || h !== actual.height)
    return { passed: false, actualSize: [actual.width, actual.height], referenceSize: [w, h] };
  const { data, max } = PNG.raster(bytes);
  let differentPixels = 0, maxChannelError = 0;
  for (let i = 0; i < data.length; i += 4) {
    let pixelError = 0;
    for (let c = i; c < i + 4; c++)
      pixelError = Math.max(pixelError, Math.abs(actual.data[c] - Math.round(data[c] * 255 / max)));
    if (pixelError) differentPixels++;
    maxChannelError = Math.max(maxChannelError, pixelError);
  }
  return { passed: differentPixels === 0, size: [w, h], differentPixels, maxChannelError };
}

async function verifyPxc(file, manifest, output, settings) {
  if (fs.statSync(manifest).size > 128 * 1024) throw new RangeError('Reference manifest exceeds the verification budget');
  const { frames } = JSON.parse(fs.readFileSync(manifest, 'utf8')) ?? {};
  if (!Array.isArray(frames) || !frames.length || frames.length > 128)
    throw new TypeError('Reference manifest needs 1 to 128 frame checks');
  const bytes = readPxc(file);
  const host = createGraphHost(undefined, { kit: settings.kit });
  const { project, report, sourceFiles = [] } = await host.importPxc(bytes, { translate: true, file });
  const { fps, frames: frameCount } = report.timeline;
  if (!fps || !frameCount) throw new RangeError('Frame verification needs a saved project frame rate and count');
  const translated = new Map(report.translated.map(row => [row.id, row.node]));
  const cases = frames.map((entry, i) => {
    const { frame, source, output: name, node } = entry ?? {};
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= frameCount ||
        typeof source !== 'string' || !source.trim() || name !== undefined && node !== undefined)
      throw new TypeError('Check ' + (i + 1) + ' needs a saved frame index, source PNG, and at most one output or node');
    let target = name ?? 'image';
    let address = { output: target };
    if (node !== undefined) {
      const mapped = translated.get(node);
      if (!mapped || mapped === 'saved-preview') throw new RangeError('No editable translation for PXC node ' + node);
      address = { node };
      target = 'verify-' + (i + 1);
      project.outputs[target] = { node: mapped };
    }
    if (typeof target !== 'string' || target === 'saved-preview' || !Object.hasOwn(project.outputs, target))
      throw new RangeError('No editable PXC output ' + target);
    return { frame, source, reference: path.resolve(path.dirname(manifest), source), target, address };
  });
  if (output) distinct(output, [file, manifest, ...sourceFiles, ...cases.map(row => row.reference)]);
  const graph = createGraphProject(project, { kit: settings.kit, baseDir: path.dirname(file) });
  const checks = cases.map(({ frame, source, reference, target, address }) => {
    const time = frame / fps;
    const { value } = graph.inspect({ output: target }, { time });
    return { frame, time, source, ...address, ...compareFrame(value, reference) };
  });
  const result = { format: 'ink-studio/pxc-frame-verification', version: 1, passed: checks.every(row => row.passed),
    sourceHash: hash(bytes), timeline: report.timeline, complete: report.complete, checks };
  if (output) files.json(output, result);
  return result;
}

async function execute(pos, opt, settings) {
  const [mode, source] = pos;
  if (pos.length !== (mode === 'verify-pxc' ? 3 : 2) || Object.entries(opt).some(([key, value]) => !commands[mode].includes(key) ||
      (['json', 'translate'].includes(key) ? value !== true : typeof value !== 'string' || !value.trim())) ||
      mode === 'import-pxc' && opt.out === undefined || opt.translate && opt.using !== undefined)
    throw new TypeError('Use graph capture|inspect-pxc|import-pxc <file> or graph verify-pxc <project.pxc> <references.json>');
  const file = path.resolve(source), output = opt.out && path.resolve(opt.out);
  if (mode === 'verify-pxc') return verifyPxc(file, path.resolve(pos[2]), output, settings);
  settings = await adapters(opt.adapters, settings);
  const sources = [file, ...(settings.adapterFile ? [settings.adapterFile] : [])];
  if (output) distinct(output, sources);

  if (mode === 'inspect-pxc') {
    const { report } = inspectPxc(readPxc(file));
    if (output) files.json(output, report);
    return report;
  }

  const host = createGraphHost(settings.adapters, { kit: settings.kit });
  if (mode === 'import-pxc') {
    const data = readPxc(file);
    const { project, report, sourceFiles = [] } = await host.importPxc(data, { using: opt.using, translate: opt.translate, file });
    const graph = createGraphProject(project, { ...settings, baseDir: path.dirname(output) });
    distinct(output, [...sources, ...sourceFiles, ...graph.sourceFiles()]);
    files.json(output, project);
    return { ...report, kind: 'import-pxc', output, sourceHash: hash(data), projectHash: graph.validate().projectHash };
  }

  const request = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { kind, direction, adapter, type, file: input } = host.request(request);
  if (direction === 'read' && !output) throw new TypeError('A capture read needs --out for the local snapshot');
  const inputFile = input && path.resolve(path.dirname(file), input);
  if (output && inputFile) distinct(output, [inputFile]);
  const value = await host.exchange(request, { ...(inputFile && { value: readValue(inputFile, type) }) });
  const encoded = encodeValue(value, direction === 'read' ? type : 'json');
  if (output) files.write(output, encoded);
  return { format: 'ink-studio/host-receipt', version: 1, kind, adapter, direction, type,
    bytes: encoded.length, sha256: hash(encoded), ...(output && { output }) };
}

module.exports = { commands, adapters, execute };
