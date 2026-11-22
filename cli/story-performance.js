const fs = require('node:fs');
const path = require('node:path');
const Assets = require('./asset-references.js');
const { readProjectBundle } = require('./project-bundle.js');
const { readRecording } = require('./story-exchange.js');
const { resolveCheckpoint } = require('./checkpoint-file.js');
const { graphOutputs } = require('./graph-outputs.js');
const Fixture = require('./simulation-fixture.js');

const usage = 'story performance <recording|fixture|events|cue-sheet> <plan.json> --out directory [--asset-registry catalog.json]';

function read(file, limit = 128 * 1024 * 1024) {
  if (fs.statSync(file).size > limit) throw new RangeError('Performance input exceeds its byte budget');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sourceOf(file, K, onFile) {
  const document = read(file), bundles = K.authoring.projectBundles;
  if (document?.format === bundles.format && document.version === bundles.storyVersion) {
    const project = readProjectBundle(file);
    if (!project.storyEvents) throw new TypeError('Use a recorded story run bundle for actor performance');
    return { source: readRecording(project) ?? project.storyEvents(), project };
  }
  return { source: resolveCheckpoint(path.resolve(file), document, { onBlock: onFile }) };
}

function pinned(sheet, resolve) {
  function pin(ref, kind) {
    if (!resolve) throw new TypeError('Performance asset references need --asset-registry or a pinned story run bundle');
    return { ...ref, sha256: resolve(ref, kind).sha256 };
  }
  return {
    ...sheet,
    cast: Object.fromEntries(Object.entries(sheet.cast).map(([id, row]) =>
      [id, { ...row, ...(row.rig && { rig: pin(row.rig, 'rig') }), ...(row.voice && { voice: pin(row.voice, 'voice') }) }])),
    props: Object.fromEntries(Object.entries(sheet.props).map(([id, row]) =>
      [id, row.scene ? { ...row, scene: pin(row.scene, 'scene') } : row])),
    presentationCues: { ...sheet.presentationCues, cues: sheet.presentationCues.cues.map(row => row.assets ?
      { ...row, assets: Object.fromEntries(Object.entries(row.assets).map(([kind, ref]) => [kind, pin(ref, kind)])) } : row) }
  };
}

function timestamp(ms) {
  const parts = [ms / 3600000n, ms / 60000n % 60n, ms / 1000n % 60n].map(value => String(value).padStart(2, '0'));
  return parts.join(':') + '.' + String(ms % 1000n).padStart(3, '0');
}

function captions(lines, T) {
  const thousand = T.read(1000), negative = T.read(-1000);
  const escape = value => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
  return 'WEBVTT\n\n' + lines.map(row => {
    const start = T.roundDown(T.mul(T.read(row.timecode), thousand));
    const end = -T.roundDown(T.mul(T.read(row.endTimecode), negative));
    const body = row.text.split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean).join('\n');
    return row.id + '\n' + timestamp(start) + ' --> ' + timestamp(end) + '\n' + escape(row.speaker + ': ' + body) + '\n\n';
  }).join('');
}

async function command(file, planFile, rest, opt, library) {
  const registry = opt['asset-registry'];
  if (!file || !planFile || rest.length || Object.keys(opt).some(key => !['out', 'asset-registry'].includes(key)) ||
    typeof opt.out !== 'string' || !opt.out.trim() || registry !== undefined && (typeof registry !== 'string' || !registry.trim()))
    throw new TypeError('Use ' + usage);
  const kit = library(), K = kit.KIT, W = K.world, api = W.actorPerformance;
  const inputs = new Set([file, planFile]), onFile = source => inputs.add(source);
  const { source, project } = sourceOf(file, K, onFile), plan = read(planFile, 8 * 1024 * 1024);
  const input = source?.format === Fixture.format ? W.storyEvents.envelopes(Fixture.eventRecording(W, source), {
    stream: source.checkpoint.eventStream, simulationRate: source.checkpoint.world.takeClock?.simulationRate
  }) : source;
  const draft = input?.format === W.runtime.runFormat ? await api.replay(input, plan) : api.project(input, plan);
  const resolve = registry === undefined ? project?.resolveStoryAsset :
    Assets.open(K.authoring.assetReferences, path.resolve(registry), { onFile }).resolve;
  const sheet = pinned(draft, resolve), adapter = api.open(sheet);
  const entries = [
    { file: 'performance.json', document: sheet },
    { file: 'timeline.json', document: adapter.timeline() },
    { file: 'lettering.json', document: { format: 'ink-studio/actor-lettering', version: 1, lines: adapter.dialogue } },
    { file: 'captions.vtt', bytes: Buffer.from(captions(adapter.dialogue, K.procedural.takeTime)) }
  ];
  graphOutputs([...inputs]).write(path.resolve(opt.out), entries);
}

module.exports = { command, usage, captions };
