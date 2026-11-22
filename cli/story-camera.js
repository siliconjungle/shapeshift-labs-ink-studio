const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { resolveCheckpoint } = require('./checkpoint-file.js');
const { readProjectBundle } = require('./project-bundle.js');
const { readRecording } = require('./story-exchange.js');
const { graphOutputs } = require('./graph-outputs.js');
const { write } = require('./asset-files.js');
const { render } = require('../index.js');
const PNG = require('./png.js');
const { grid, resize } = require('./render.js');

const suggestionUsage = 'story shots <recording> [--timeline file --story document/story --from-tick N --to-tick N --limit N --out plan.json]';
const reviewUsage = 'story shots-review <recording> <plan.json> --out directory [--all --w N --h N]';
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const int = (value, a, b) => Number.isSafeInteger(value) && value >= a && value <= b;
const pathArg = value => typeof value === 'string' && value.trim();
const uintArg = value => typeof value === 'string' && /^\d+$/.test(value);
const numeric = value => value === undefined ? undefined : Number(value);

function recording(K, file, inputs) {
  const document = load(file), bundles = K.authoring.projectBundles;
  const value = document?.format === bundles.format && document.version === bundles.storyVersion ?
    readRecording(readProjectBundle(file)) :
    resolveCheckpoint(path.resolve(file), document, { onBlock: block => inputs.push(block) });
  if (value?.format !== K.world.runtime.runFormat)
    throw new TypeError('Camera suggestions need a native run recording or a story run bundle with a native recording');
  return value;
}

function fingerprint(source) {
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

async function suggest(file, opt, kit) {
  const inputs = [file, ...(opt.timeline ? [opt.timeline] : [])], K = kit.KIT, W = K.world;
  const source = recording(K, file, inputs), destination = opt.out && path.resolve(opt.out);
  if (destination) graphOutputs(inputs).protect(fs.statSync(destination, { throwIfNoEntry: false }));
  const result = await W.storyCamera.suggest(source, {
    definition: opt.timeline && load(opt.timeline), story: opt.story,
    fromTick: numeric(opt['from-tick']), toTick: numeric(opt['to-tick']), limit: numeric(opt.limit),
    scene: (frame, query) => W.visual(kit, frame, query)
  });
  const output = JSON.stringify({ ...result, recording: fingerprint(source) }, null, 2) + '\n';
  if (destination) write(destination, output);
  else process.stdout.write(output);
}

async function review(file, planFile, opt, kit) {
  const K = kit.KIT, W = K.world, api = W.storyCamera;
  const w = Number(opt.w ?? 240), h = Number(opt.h ?? 150);
  if (!int(w, 32, 768) || !int(h, 32, 768)) throw new RangeError('Story preview dimensions must be 32–768 pixels');
  const inputs = [file, planFile], source = recording(K, file, inputs), plan = load(planFile);
  if (plan?.recording !== fingerprint(source) || plan.world !== source.origin.world.id)
    throw new TypeError('Shot plan was generated for a different recording');
  const writer = graphOutputs(inputs), { rig, program } = api.read(plan), byBeat = new Map(), previews = [];
  const destination = path.resolve(opt.out);
  for (const row of plan.beats) {
    for (const shot of row.shots) {
      if (!opt.all && row.selected !== shot.id) continue;
      const name = row.id + '-' + shot.id, frame = 'frames/' + name + '.png';
      const cutaway = shot.cutaway && 'cutaways/' + name + '.json';
      const preview = { row, shot, name, frame, cutaway };
      if (!byBeat.has(row.beatId)) byBeat.set(row.beatId, []);
      byBeat.get(row.beatId).push(preview);
      previews.push(preview);
      writer.protect(fs.statSync(path.join(destination, frame), { throwIfNoEntry: false }));
      if (cutaway) writer.protect(fs.statSync(path.join(destination, cutaway), { throwIfNoEntry: false }));
    }
  }
  if (previews.length > 64 || previews.length * w * h > 16000000)
    throw new RangeError('Story previews exceed the image budget. Use fewer shots or smaller frames.');
  for (const name of ['report.json', 'camera-rig.json', ...(previews.length ? ['contact.png'] : [])])
    writer.protect(fs.statSync(path.join(destination, name), { throwIfNoEntry: false }));
  await W.storySceneTimeline.scan(source, (event, frame, query) => {
    const matching = byBeat.get(W.inspectionLinks.identify(event));
    if (!matching?.length || !frame) return;
    const scene = W.visual(kit, frame, query);
    for (const preview of matching) {
      const { row, shot, name } = preview;
      if (!api.eventMatch(row, event, frame.world)) throw new TypeError('Shot plan beat does not match the recording');
      const camera = program.sample(frame.time, { base: scene.cam, shot: name }).camera;
      const subjects = row.subjects.filter(subject => W.data.id(subject?.entity) && shot.subjects.includes(subject.ref))
        .map(subject => ({ id: subject.entity, select: { entity: subject.entity } }));
      const view = { ...scene, cam: camera, cameraRig: undefined };
      const image = render(view, { w, h, px: 1, lockCamera: true, colored: true, t: frame.time, cutaway: shot.cutaway ?? false,
        cameraStaging: { subjects }, cameraGuides: false });
      preview.image = resize(image, w, h);
      preview.visible = image.cameraStaging?.subjects ?? [];
    }
    byBeat.delete(W.inspectionLinks.identify(event));
  });
  if (byBeat.size) throw new TypeError('A reviewed shot has no committed pose in the recording');
  const entries = [{ file: 'camera-rig.json', document: rig }];
  if (previews.length) {
    const sheet = grid(previews.map(value => value.image), Math.min(3, previews.length),
      previews.map((_, index) => String(index + 1).padStart(2, '0')));
    entries.push({ file: 'contact.png', bytes: PNG.encode(sheet.w, sheet.h, sheet.rgb) });
  }
  for (const { frame, cutaway, image, shot } of previews) {
    entries.push({ file: frame, bytes: PNG.encode(image.w, image.h, image.rgb) });
    if (cutaway) entries.push({ file: cutaway, document: shot.cutaway });
  }
  const cuts = plan.beats.filter(row => row.selected !== null).sort((a, b) => a.time - b.time).map(row => {
    const shot = row.shots.find(shot => shot.id === row.selected);
    return { beatId: row.beatId, shot: row.id + '-' + shot.id, time: row.time, tick: row.source.tick,
      ...(shot.cutaway && { cutaway: shot.cutaway }) };
  });
  const report = { format: 'ink-studio/story-shot-review', version: 1, world: plan.world, rig: 'camera-rig.json', cuts,
    ...(previews.length && { contact: 'contact.png' }),
    previews: previews.map(({ row, shot, frame, cutaway, visible }, index) => ({
      cell: index + 1,
      beatId: row.beatId, tick: row.source.tick, source: row.source, time: row.time, category: row.category,
      shot: row.id + '-' + shot.id, selected: shot.id === row.selected, file: frame, visible, ...(cutaway && { cutaway })
    })) };
  writer.write(destination, [...entries, { file: 'report.json', document: report }]);
}

function command(mode, file, plan, rest, opt, library) {
  if (mode === 'shots') {
    if (!file || plan || rest.length || Object.keys(opt).some(key => !['timeline', 'story', 'from-tick', 'to-tick', 'limit', 'out'].includes(key)) ||
      [opt.timeline, opt.story, opt.out].some(value => value !== undefined && !pathArg(value)) ||
      [opt['from-tick'], opt['to-tick'], opt.limit].some(value => value !== undefined && !uintArg(value)))
      throw new TypeError('Use ' + suggestionUsage);
    return suggest(file, opt, library());
  }
  if (!file || !plan || rest.length || !pathArg(opt.out) || Object.keys(opt).some(key => !['all', 'out', 'w', 'h'].includes(key)) ||
      opt.all !== undefined && opt.all !== true || [opt.w, opt.h].some(value => value !== undefined && !uintArg(value)))
    throw new TypeError('Use ' + reviewUsage);
  return review(file, plan, opt, library());
}

module.exports = { command, suggestionUsage, reviewUsage };
