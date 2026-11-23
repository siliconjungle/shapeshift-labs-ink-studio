const path = require('node:path');
const { createHash } = require('node:crypto');
const WAV = require('./wav.js');
const { graphOutputs } = require('./graph-outputs.js');
const { stageAt } = require('./recorded-presentation.js');
const { readSoundDocument } = require('./sound-source.js');

const usage = 'music sound render <recipe.json> --out directory';
const mutationUsage = 'music sound mutate <recipe.json> [settings.json] --out directory';
const replayUsage = 'music sound replay <audition.json> --out directory';
const files = { audio: 'sound.wav', recipe: 'recipe.sound.json', report: 'report.json' };

function artifacts({ value, recipe, report }) {
  const bytes = WAV.encode(value, { encoding: recipe.render.encoding });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { sha256, entries: [
    { file: files.audio, bytes },
    { file: files.recipe, document: recipe },
    { file: files.report, document: { format: 'ink-studio/sound-recipe-render', version: 1, ...report,
      id: recipe.id, family: recipe.family, seed: recipe.seed, render: recipe.render, audio: files.audio, recipe: files.recipe, sha256 } }
  ] };
}

function render(sound, source, input, output) {
  graphOutputs([input]).write(output, artifacts(sound.render(source)).entries);
  return Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path.join(output, file)]));
}

function mutate(sound, source, settings, inputs, output) {
  const { value, plan } = sound.mutate(source, settings);
  const stage = stageAt(output);
  try {
    const variants = value.map(recipe => {
      const { sha256, entries } = artifacts(sound.render(recipe));
      const revision = createHash('sha256').update(JSON.stringify(recipe)).update(sha256).digest('hex');
      const folder = recipe.id + '/' + revision;
      for (const { file, bytes, document } of entries) {
        const at = folder + '/' + file;
        if (bytes) stage.save(at, bytes);
        else stage.json(at, document);
      }
      const refs = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, folder + '/' + file]));
      return { id: recipe.id, ...refs, sha256 };
    });
    stage.json('manifest.json', { format: 'ink-studio/sound-family', version: 1, ...plan, variants });
    stage.publish(new Set(inputs));
    return { manifest: path.join(output, 'manifest.json'), count: variants.length };
  } finally {
    stage.close();
  }
}

function command(pos, opt, kit) {
  const [mode, input, config] = pos;
  if(mode==='pack')return require('./world-sound-pack.js').command(pos.slice(1),opt,kit);
  if (!input || !((mode === 'render' || mode === 'replay') && pos.length === 2 || mode === 'mutate' && pos.length <= 3) ||
      typeof opt.out !== 'string' || !opt.out.trim() || Object.keys(opt).some(key => key !== 'out'))
    throw new TypeError('Use ' + usage + ', ' + mutationUsage + ', or ' + replayUsage);
  const sound = kit.KIT.procedural.mediaGraph.soundRecipe, output = path.resolve(opt.out);
  if (mode === 'replay') {
    const summary = require('./music-sound-keep.js').replay(kit, input, output);
    process.stdout.write(JSON.stringify(summary) + '\n');
    return summary;
  }
  const source = readSoundDocument(input);
  const summary = mode === 'render' ? render(sound, source, input, output) :
    mutate(sound, source, config && readSoundDocument(config), config ? [input, config] : [input], output);
  process.stdout.write(JSON.stringify(summary) + '\n');
  return summary;
}

module.exports = { command, usage, mutationUsage, replayUsage };
