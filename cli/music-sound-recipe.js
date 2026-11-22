const path = require('node:path');
const { createHash } = require('node:crypto');
const WAV = require('./wav.js');
const { graphOutputs } = require('./graph-outputs.js');
const { readSoundRecipe } = require('./sound-source.js');

const usage = 'music sound render <recipe.json> --out directory';

function command(pos, opt, kit) {
  const [mode, file] = pos;
  if (mode !== 'render' || !file || pos.length !== 2 || typeof opt.out !== 'string' || !opt.out.trim() ||
      Object.keys(opt).some(key => key !== 'out')) throw new TypeError('Use ' + usage);
  const { value, recipe, report } = readSoundRecipe(file, kit.KIT.procedural);
  const bytes = WAV.encode(value, { encoding: recipe.render.encoding });
  const output = path.resolve(opt.out);
  const result = { audio: 'sound.wav', recipe: 'recipe.sound.json', report: 'report.json' };
  graphOutputs([file]).write(output, [
    { file: result.audio, bytes },
    { file: result.recipe, document: recipe },
    { file: result.report, document: { format: 'ink-studio/sound-recipe-render', version: 1, ...report, id: recipe.id, family: recipe.family, seed: recipe.seed,
      render: recipe.render, audio: result.audio, recipe: result.recipe, sha256: createHash('sha256').update(bytes).digest('hex') } }
  ]);
  const summary = Object.fromEntries(Object.entries(result).map(([key, file]) => [key, path.join(output, file)]));
  process.stdout.write(JSON.stringify(summary) + '\n');
  return summary;
}

module.exports = { command, usage };
