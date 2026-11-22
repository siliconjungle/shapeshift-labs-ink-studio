const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const WAV = require('./wav.js');
const { hash } = require('./asset-references.js');
const { graphOutputs } = require('./graph-outputs.js');
const { stageAt } = require('./recorded-presentation.js');
const { openSampleLibrary } = require('./sample-library.js');

const format = 'ink-studio/sound-audition';
const encoding = 'pcm24';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const encode = value => WAV.encode(value, { encoding });

function render(P, source, settings, assets) {
  const I = P.musicInstruments, { check, fields, integer, finite } = I;
  if (source.kind === 'recipe') {
    check(fields(settings, []), 'Edit a seeded sound in its recipe to change its audition');
    return P.mediaGraph.soundRecipe.render(source.recipe).value;
  }
  check(source.kind === 'instrument' && fields(settings, ['midi', 'velocity', 'gate', 'roundRobin', 'seed', 'sampleRate']),
    'Invalid instrument audition settings');
  const { midi, velocity, gate, roundRobin, seed, sampleRate } = settings;
  check(integer(midi, 0, 127) && finite(velocity, .001, 1) && finite(gate, .01, 2) &&
    integer(roundRobin, 0, 255) && Number.isSafeInteger(seed) && integer(sampleRate, 8000, 96000),
  'An audition needs a MIDI note, velocity, gate, round robin, seed and sample rate');
  const voice = I.compile(source.patch, assets).prepare({
    midi, velocity, frequency: I.hz(midi), salt: I.hash(['browser-audition', seed]), roundRobin, play: {}
  }, sampleRate, gate);
  check(finite(voice.duration, 1 / sampleRate, 8), 'This instrument has no bounded audition at that note and velocity');
  const frames = Math.ceil(voice.duration * sampleRate), channels = voice.stereo ? 2 : 1;
  const samples = new Float64Array(frames * channels);
  let peak = 0;
  for (let frame = 0; frame < frames; frame++) for (let ch = 0; ch < channels; ch++) {
    const sample = voice.signal(frame / sampleRate, frame, ch);
    samples[frame * channels + ch] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  check(Number.isFinite(peak) && peak > 0, 'This audition is silent or invalid');
  if (peak > 1) for (let i = 0; i < samples.length; i++) samples[i] /= peak;
  return { sampleRate, channels, samples };
}

function preview(P, candidate, context, settings) {
  const { source, title, assets, settings: defaults } = candidate;
  const { check, fields } = P.musicInstruments;
  check(settings === undefined || fields(settings, source.kind === 'recipe' ? [] :
    ['midi', 'velocity', 'gate', 'roundRobin', 'seed']), 'Invalid one-shot preview settings');
  const audition = { ...defaults, ...settings };
  const bytes = encode(render(P, source, audition, assets));
  return { source, title, assets, audition, bytes, context };
}

function replay(kit, input, out) {
  const P = kit.KIT.procedural, { check, record, id } = P.musicInstruments;
  const document = read(input), { source, audition } = document;
  check(document.format === format && document.version === 1 && record(source), 'Expected a saved Ink sound audition');
  const files = source.kind === 'instrument' ? source.assets : {};
  check(record(files) && Object.entries(files).every(([name, ref]) => id(name) && kit.KIT.authoring.assetReferences.localFile(ref)),
    'Invalid audition source media');
  const paths = Object.fromEntries(Object.entries(files).map(([name, ref]) => [name, path.resolve(path.dirname(input), ref)]));
  const assets = Object.fromEntries(Object.entries(paths).map(([name, file]) => [name, WAV.read(file)]));
  const bytes = encode(render(P, source, audition, assets));
  check(hash(bytes) === document.sha256, 'Rebuilt audio disagrees with the saved audition hash');
  graphOutputs([input, ...Object.values(paths)]).write(out, [{ file: 'sound.wav', bytes }]);
  return { audio: path.resolve(out, 'sound.wav'), sha256: document.sha256 };
}

function sample(stage, kit, name, shot) {
  const { sampleCatalog } = kit.KIT.procedural.mediaGraph, value = WAV.decode(shot.bytes);
  const library = openSampleLibrary(stage.at('samples'), { kit });
  const { entry } = library.add(sampleCatalog.capture(value, {
    sample: { id: name, label: shot.title, tags: ['sound-browser', 'one-shot'] },
    source: { kind: shot.source.kind === 'recipe' ? 'file' : 'instrument', name: shot.title,
      reference: '../audition.json', ...(shot.source.recipe && { recipe: shot.source.recipe }) }
  }));
  const midi = shot.audition.midi ?? 60;
  stage.json('kit.json', { kit: { id: name, pads: {
    hit: { notes: [midi, midi], attack: 0, articulations: { default: [{ id: 'body', takes: [{ asset: 'hit' }] }] } }
  } }, assets: { hit: { sample: entry.id, asset: entry.asset } } });
  stage.json('performance.json', { events: [{ pad: 'hit', time: 0, velocity: 1 }], options: { sampleRate: value.sampleRate } });
  return { library: 'samples', sample: entry.id, kit: 'kit.json', performance: 'performance.json' };
}

function family(stage, kit, ref, shot, sha256) {
  const P = kit.KIT.procedural, sound = P.mediaGraph.soundRecipe, api = kit.KIT.authoring.assetReferences;
  const members = [{ ref: { ...ref, sha256 }, audio: 'sound.wav', ...(shot.source.recipe && { recipe: 'recipe.sound.json' }) }];
  if (shot.source.recipe) {
    const { value, plan } = sound.mutate(shot.source.recipe, { count: 4, locks: ['duration', 'attack'] });
    stage.json('mutation.json', plan.settings);
    for (const [index, recipe] of value.entries()) {
      const id = 'v0' + (index + 1), audio = 'variants/' + id + '.wav', source = 'variants/' + id + '.sound.json';
      const bytes = encode(sound.render(recipe).value);
      stage.json(source, recipe);
      stage.save(audio, bytes);
      members.push({ ref: { asset: ref.asset + '/' + id, revision: ref.revision, sha256: hash(bytes) }, audio, recipe: source });
    }
  }
  const registry = { format: api.format, version: 1, entries: members.map(row => ({ ...row.ref, kind: 'sound', file: row.audio })) };
  api.compile(registry);
  stage.json('assets.json', registry);
  return { registry: 'assets.json', ref: members[0].ref, members, ...(shot.source.recipe && { mutation: 'mutation.json' }) };
}

function publish(kit, root, shot, options) {
  const { check, fields, id, integer } = kit.KIT.procedural.musicInstruments;
  check(fields(options, ['kind', 'name', 'revision']) && ['cue', 'sample', 'family'].includes(options.kind),
    'Keep this sound as a cue, sample or family');
  const { kind, revision = 1 } = options;
  const label = options.name ?? shot.context.id.replace(/^(stock|session|recipe)-/, '').slice(0, 48);
  check(id(label) && integer(revision, 1, 999999) && (kind === 'family' || options.revision === undefined),
    'Choose a sound name and, for families, a positive revision');
  const name = label.toLowerCase();
  const target = path.join(root, kind, name, ...(kind === 'family' ? ['r' + revision] : []));
  const stage = stageAt(target), sha256 = hash(shot.bytes);
  try {
    const source = { ...shot.source };
    if (shot.assets) {
      source.assets = Object.fromEntries(Object.entries(shot.assets).map(([id, pcm]) => {
        const file = 'sources/' + id + '.wav';
        stage.save(file, WAV.encode(pcm, { encoding: 'float64' }));
        return [id, file];
      }));
    }
    if (source.recipe) stage.json('recipe.sound.json', source.recipe);
    stage.save('sound.wav', shot.bytes);
    const audition = { format, version: 1, title: shot.title, candidate: shot.context, audition: shot.audition, source, sha256 };
    stage.json('audition.json', audition);
    const extra = kind === 'sample' ? sample(stage, kit, name, shot) :
      kind === 'family' ? family(stage, kit, { asset: 'event/' + name, revision }, shot, sha256) : {};
    const manifest = { format: 'ink-studio/kept-sound', version: 1, name, kind, title: shot.title, audio: 'sound.wav',
      audition: 'audition.json', sha256, ...(source.recipe && { recipe: 'recipe.sound.json' }), ...extra };
    stage.json('manifest.json', manifest);
    if (!fs.existsSync(target)) {
      try { fs.renameSync(stage.at(''), target); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    }
    check(isDeepStrictEqual(read(path.join(target, 'manifest.json')), manifest) &&
      isDeepStrictEqual(read(path.join(target, 'audition.json')), audition) &&
      hash(fs.readFileSync(path.join(target, manifest.audio))) === sha256,
    'A different sound already uses that name or revision');
    return { name, kind, ...(kind === 'family' && { revision }), directory: target,
      manifest: path.join(target, 'manifest.json'), audio: path.join(target, manifest.audio) };
  } finally { stage.close(); }
}

module.exports = { preview, publish, replay };
