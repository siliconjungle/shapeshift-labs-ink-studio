'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ink = require('../index.js');
const PNG = require('./png.js');
const files = require('./asset-files.js');
const api = require('../examples/effect-recipes/runtime.js');

const directory = 'examples/effect-recipes';
const root = path.resolve(__dirname, '..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const commandOptions = {
  search: ['input','renderer','json'],
  open: ['out'],
  render: ['inputs','sample','out'],
  check: ['chrome','out']
};

function library() {
  return fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.json')).sort().map(file => {
    const source = directory + '/' + file;
    const recipe = api.validate(read(path.join(root, source)));
    if (file !== recipe.id + '.json') throw new Error('Recipe filename must match its ID: ' + source);
    return { recipe, source };
  });
}

function describe({ recipe, source }) {
  const { id, title, intent, tags, inputs, renderers, size, times, check } = recipe;
  return { id, title, intent, tags, renderers, size, times, inputs:inputs.map(input => ({
    ...input, ...(input.control && { default:api.inputValue(recipe,input) })
  })), source, check };
}

function resolve(id, entries = library()) {
  const builtIn = entries.find(entry => entry.recipe.id === id);
  if (builtIn) return builtIn;
  const source = path.resolve(id);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new RangeError('Unknown effect recipe: ' + id);
  return { recipe:api.validate(read(source)), source };
}

function exportFrames(recipe, kit) {
  const [w, h] = recipe.size, world = api.renderWorld(kit);
  const renderGraph = kit.KIT.renderGraph.create(recipe.graph), renderHistory = kit.KIT.renderGraph.history();
  return recipe.times.map(t => {
    const frame = Ink.render(world, { w, h, t, px:1, raw:true, transparent:true, renderGraph, renderHistory });
    return PNG.encodeFrame(PNG.packFrame(frame));
  });
}

function check(entries, { chrome } = {}) {
  const kit = Ink.load();
  const cases = entries.map(({ recipe }) => {
    const edited = api.edited(recipe, api.exampleEdit(recipe));
    const pngs = [exportFrames(recipe, kit), exportFrames(edited, kit)];
    return {
      id:recipe.id, size:recipe.size, times:recipe.times, rules:recipe.check,
      pngs, graphs:[recipe.graph, edited.graph]
    };
  });
  const comparisons = cases.map(({ size, times, graphs }) => ({ size, times, graphs }));
  const allPixels = cases.reduce((sum, { size:[w,h], times }) => sum + w*h*times.length*2, 0);
  const maxBuffer = 8 * 1024 * 1024 + Buffer.byteLength(JSON.stringify(comparisons)) + allPixels*8;
  const browser = require('./look-webgl.js')({ chrome, maxBuffer }, api.renderWorld, (toolkit, build, backend, cases) => {
    const runners = new Map();
    try {
      return { images:cases.map(({ size:[w,h], times, graphs }) => {
        const key = w + 'x' + h;
        if (!runners.has(key)) runners.set(key, backend(w,h,{ raw:true,offscreen:true,transparent:true }));
        const runner = runners.get(key);
        return graphs.map(definition => {
          const world = build(toolkit), renderGraph = toolkit.KIT.renderGraph.create(definition);
          return times.map((time, i) => {
            runner.draw(world, { time, renderGraph, resetRenderHistory:i === 0 });
            return runner.image({ alpha:true });
          });
        });
      }) };
    } finally { for (const runner of runners.values()) runner.close(); }
  }, comparisons);
  const recipes = cases.map(({ id, times, pngs, rules }, index) => {
    const [original, edited] = pngs.map(sequence => sequence.map(png => PNG.raster(png).data));
    const frames = times.flatMap((time, sample) => [original,edited].map((variant, i) => {
      const statistics = api.compare(Buffer.from(browser.images[index][i][sample], 'base64'),variant[sample],original[sample]);
      return { time, variant:i ? 'edited' : 'original', ...statistics,
        pass:statistics.maxChannelDelta <= rules.maxChannelDelta };
    }));
    const editVisible = frames.some(frame => frame.changedPixels >= rules.minChangedPixels);
    return { id, maxChannelDelta:rules.maxChannelDelta, minChangedPixels:rules.minChangedPixels,
      editVisible, pass:editVisible && frames.every(frame => frame.pass), frames };
  });
  return { format:'ink-studio/effect-recipe-check',version:1,preview:'webgl2',export:'headless-png',
    pass:recipes.every(recipe => recipe.pass),recipes };
}

function command(pos, opt) {
  const [action, id] = pos;
  if (!Object.hasOwn(commandOptions, action) || Object.keys(opt).some(key => !commandOptions[action].includes(key)) ||
      Object.entries(opt).some(([key,value]) => key !== 'json' && typeof value !== 'string') ||
      (action !== 'search' && (pos.length > 2 || !id && ['open','render'].includes(action))))
    throw new TypeError('Use effect-recipe search, open, render or check. See ink-studio help.');
  const entries = library();
  const out = opt.out && path.resolve(opt.out);
  if (out && [...entries.map(({source}) => path.resolve(root,source)), ...(id ? [path.resolve(id)] : []),
      ...(opt.inputs ? [path.resolve(opt.inputs)] : [])].includes(out))
    throw new TypeError('Write recipe output to a separate file');
  function report(value) {
    if (out) files.json(out,value);
    else process.stdout.write(JSON.stringify(value,null,2)+'\n');
  }
  if (action === 'search') {
    const renderers = opt.renderer?.split(',').map(name => name.trim().toLowerCase()) ?? [];
    if (renderers.some(renderer => !['headless','webgl2'].includes(renderer)))
      throw new RangeError('Recipe renderer must be webgl2 or headless');
    const results = api.search(entries.map(entry => entry.recipe),pos.slice(1).join(' '),opt.input?.toLowerCase(),renderers)
      .map(recipe => describe(entries.find(entry => entry.recipe === recipe)));
    if (opt.json) report({ format:'ink-studio/effect-recipe-index',version:1,entries:results });
    else for (const { id, title, intent, inputs, renderers } of results)
      console.log(id + '  ' + title + '\n  ' + intent + '\n  ' +
        inputs.map(input => input.id + ' (' + input.kind + ')').join(', ') + ' · ' + renderers.join(', '));
    if (!opt.json && !results.length) console.log('No effect recipes match.');
    return;
  }
  const entry = id && resolve(id,entries);
  if (action === 'open') return report(entry.recipe);
  if (action === 'check') {
    const result = check(entry ? [entry] : entries,{ chrome:opt.chrome });
    report(result);
    if (!result.pass) process.exitCode = 1;
    return;
  }
  if (!out || !/\.png$/i.test(out)) throw new TypeError('Effect recipe render needs --out <frame.png>');
  const recipe = opt.inputs ? api.edited(entry.recipe, read(path.resolve(opt.inputs))) : entry.recipe;
  const sample = opt.sample === undefined ? 0 : /^\d+$/.test(opt.sample) ? Number(opt.sample) : NaN;
  if (!Number.isInteger(sample) || sample < 0 || sample >= recipe.times.length)
    throw new RangeError('Recipe sample is a zero-based index into the sample times');
  files.write(out,exportFrames({ ...recipe, times:recipe.times.slice(0,sample+1) },Ink.load())[sample]);
}

module.exports = { command, commandOptions, library, describe, exportFrames, check };
