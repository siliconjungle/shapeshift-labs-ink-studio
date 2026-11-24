'use strict';

const EffectRecipes = (() => {
  const format = 'ink-studio/effect-recipe';
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const name = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
  const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

  function field(graph, input) {
    let object = graph.passes.find(pass => pass?.id === input.pass);
    for (const key of input.path.slice(0, -1)) {
      if (!object || !Object.hasOwn(object, key)) throw new TypeError('Missing field for recipe input ' + input.id);
      object = object[key];
    }
    const key = input.path.at(-1);
    if (!object || !Object.hasOwn(object, key)) throw new TypeError('Missing field for recipe input ' + input.id);
    return { object, key };
  }

  function validate(recipe) {
    const { id, title, intent, tags, inputs, renderers, size, times, graph, check } = recipe ?? {};
    if (recipe?.format !== format || recipe.version !== 1 || !name(id) || typeof title !== 'string' || !title ||
        typeof intent !== 'string' || !intent || !Array.isArray(tags) || !tags.every(tag => typeof tag === 'string'))
      throw new TypeError('Expected a named ink-studio/effect-recipe version 1');
    if (!Array.isArray(renderers) || renderers.length !== 2 || !renderers.includes('webgl2') || !renderers.includes('headless') ||
        !Array.isArray(size) || size.length !== 2 || !size.every(n => integer(n, 1, 256)) ||
        !Array.isArray(times) || !times.length || times.length > 12 ||
        !times.every((t, i) => Number.isFinite(t) && t >= 0 && (!i || t > times[i-1])) ||
        !record(graph) || !Array.isArray(graph.passes))
      throw new TypeError('Recipe needs WebGL2 and headless support, a bounded size, ordered sample times, and a render graph');
    if (!Array.isArray(inputs) || !inputs.length || !inputs.every(input => input && name(input.id) && name(input.kind) &&
        name(input.pass) && typeof input.label === 'string' && Array.isArray(input.path) && input.path.length &&
        input.path.every(key => typeof key === 'string' && /^[A-Za-z0-9]+$/.test(key))) ||
        new Set(inputs.map(input => input.id)).size !== inputs.length)
      throw new TypeError('Recipe inputs need unique IDs, kinds, labels, and valid pass field paths');
    if (!record(check) || !record(check.edit) || !inputs.some(input => input.id === check.edit.input) ||
        !Object.hasOwn(check.edit, 'value') || !Object.hasOwn(check.edit, 'fallback') || !integer(check.maxChannelDelta, 0, 8) ||
        !integer(check.minChangedPixels, 1, size[0] * size[1]))
      throw new TypeError('Recipe needs an example edit and bounded preview/export assertions');
    for (const input of inputs) {
      const { object, key } = field(graph, input);
      if (input.control !== undefined) {
        const { min, max, step } = input.control ?? {};
        if (![min, max, step, object[key]].every(Number.isFinite) || min >= max || step <= 0 ||
            object[key] < min || object[key] > max)
          throw new RangeError('Recipe slider must cover its input and specify a positive step');
      }
    }
    return recipe;
  }

  function edited(recipe, values = {}) {
    if (!record(values)) throw new TypeError('Recipe edits must be a record keyed by input ID');
    const graph = structuredClone(recipe.graph);
    for (const [id, value] of Object.entries(values)) {
      const input = recipe.inputs.find(input => input.id === id);
      if (!input) throw new RangeError('Unknown recipe input: ' + id);
      const { object, key } = field(graph, input);
      object[key] = structuredClone(value);
    }
    return { ...recipe, graph };
  }

  function inputValue(recipe, input) {
    const { object, key } = field(recipe.graph, input);
    return object[key];
  }

  function exampleEdit(recipe) {
    const { input, value, fallback } = recipe.check.edit;
    const current = inputValue(recipe, recipe.inputs.find(field => field.id === input));
    return { [input]:JSON.stringify(current) === JSON.stringify(value) ? fallback : value };
  }

  function renderWorld({ makeBuilder }) {
    return makeBuilder(17, [0x121820]).finish({ radius: 3, dither: 0 });
  }

  function compare(preview, exported, baseline = exported) {
    if (preview.length !== exported.length || baseline.length !== exported.length || exported.length % 4)
      throw new RangeError('Recipe comparison requires matching RGBA rasters');
    let maxChannelDelta = 0, differentPixels = 0, changedPixels = 0;
    for (let i = 0; i < exported.length; i += 4) {
      const max = Math.max(Math.abs(preview[i] - exported[i]), Math.abs(preview[i+1] - exported[i+1]),
        Math.abs(preview[i+2] - exported[i+2]), Math.abs(preview[i+3] - exported[i+3]));
      maxChannelDelta = Math.max(maxChannelDelta, max);
      if (max) differentPixels++;
      if (baseline[i] !== exported[i] || baseline[i+1] !== exported[i+1] || baseline[i+2] !== exported[i+2] || baseline[i+3] !== exported[i+3])
        changedPixels++;
    }
    return { pixels:exported.length / 4, maxChannelDelta, differentPixels, changedPixels };
  }

  function search(entries, query, input, renderers = []) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = entries.filter(recipe => {
      const inputs = recipe.inputs.flatMap(({ id, label, kind }) => [id, label, kind]);
      const searchable = [recipe.id, recipe.title, recipe.intent, ...recipe.tags, ...recipe.renderers, ...inputs].join(' ').toLowerCase();
      return words.every(word => searchable.includes(word)) &&
        (!input || recipe.inputs.some(field => [field.id, field.kind].includes(input))) &&
        renderers.every(renderer => recipe.renderers.includes(renderer));
    });
    return found;
  }

  return Object.freeze({ format, validate, edited, exampleEdit, inputValue, renderWorld, compare, search });
})();

if (typeof module !== 'undefined') module.exports = EffectRecipes;
