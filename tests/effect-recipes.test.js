'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Ink = require('..');
const PNG = require('../cli/png.js');
const api = require('../examples/effect-recipes/runtime.js');
const recipes = require('../cli/effect-recipes.js');
const saved = require('./effect-recipe-frames.json');

const cli = (...args) => execFileSync(process.execPath, [path.resolve(__dirname,'../cli/ink-studio.js'),...args], {
  encoding:'utf8'
});
const fingerprint = bytes => createHash('sha256').update(Buffer.from(PNG.raster(bytes).data)).digest('hex');
const entries = recipes.library();

test('recipe discovery combines intent, input and renderer filters and is part of tool search', () => {
  assert(entries.length >= 5);
  const index = JSON.parse(cli('effect-recipe','search','water ripple','--input','mask','--renderer','webgl2,headless','--json'));
  assert.deepEqual(index.entries.map(entry => entry.id), ['tide-reflection']);
  const [tide] = index.entries;
  assert.deepEqual(tide.renderers, ['webgl2','headless']);
  assert.equal(tide.inputs.find(input => input.id === 'wave-height').default, 3);
  assert.deepEqual(JSON.parse(cli('effect-recipe','search','water ripple','--input','lights','--json')).entries, []);
  const result = JSON.parse(cli('catalog','--all','cast shadow sprite-map','--json')).entries
    .find(entry => entry.kind === 'effect-recipe');
  assert.equal(result.id, 'lantern-relight');
  assert.equal(result.source, 'examples/effect-recipes/lantern-relight.json');
});

test('registered recipe frames and sample edits retain their exported pixels', () => {
  const kit = Ink.load();
  assert.deepEqual(Object.keys(saved), entries.map(({recipe}) => recipe.id));
  for (const { recipe } of entries) {
    const alternate = api.edited(recipe,api.exampleEdit(recipe));
    assert.deepEqual(recipes.exportFrames(recipe,kit).map(fingerprint),saved[recipe.id].original,recipe.id);
    assert.deepEqual(recipes.exportFrames(alternate,kit).map(fingerprint),saved[recipe.id].edited,recipe.id);
    assert.notDeepEqual(saved[recipe.id].original,saved[recipe.id].edited,recipe.id);
    assert.deepEqual(api.edited(alternate,api.exampleEdit(alternate)).graph,recipe.graph,recipe.id);
  }
});

test('the CLI copies an editable example and exports a named edit at the chosen sample time', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-effect-recipe-'));
  t.after(() => fs.rmSync(directory, { recursive:true,force:true }));
  const copy = path.join(directory,'water-effect.json'), inputs = path.join(directory,'inputs.json'),
    png = path.join(directory,'reflection.png');
  cli('effect-recipe','open','tide-reflection','--out',copy);
  const original = fs.readFileSync(copy,'utf8');
  const recipe = JSON.parse(original);
  assert.equal(recipe.graph.passes.at(-1).type,'distortion');
  fs.writeFileSync(inputs, JSON.stringify({ 'wave-height':9 }));
  cli('effect-recipe','render',copy,'--inputs',inputs,'--sample','1','--out',png);
  assert.equal(fingerprint(fs.readFileSync(png)),saved['tide-reflection'].edited[1]);
  assert.equal(fs.readFileSync(copy,'utf8'),original);
  assert.throws(() => api.edited(recipe, { 'unknown-field':0 }), /Unknown recipe input/);
  assert.throws(() => api.validate({...recipe,inputs:[{...recipe.inputs[0],path:['layer','missing']}, ...recipe.inputs.slice(1)]}),/Missing field/);
});

test('the actual WebGL preview and decoded PNG agree for every recipe, sample and example edit',
  { skip:!process.env.INK_TEST_CHROME }, () => {
    const report = recipes.check(entries);
    assert.equal(report.recipes.length,entries.length);
    for (const item of report.recipes) {
      assert(item.pass, JSON.stringify(item));
      assert(item.editVisible, item.id);
      assert(item.frames.some(frame => frame.variant === 'original'));
      assert(item.frames.some(frame => frame.variant === 'edited'));
      assert(item.frames.every(frame => frame.pixels > 0));
    }
  });
