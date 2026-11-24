const api = EffectRecipes, el = id => document.getElementById(id);
const recipes = entries.map(entry => entry.recipe), world = api.renderWorld(toolkit);
const nav = el('recipes'), canvas = el('preview'), warning = el('warning');
const sample = el('sample'), sliderPanel = el('controls'), fallback = el('fallback');
let renderer, rendererError, current, values = {};
try { renderer = createRenderer(canvas, { toolkit, contextAttributes:{ preserveDrawingBuffer:true, antialias:false } }); }
catch (error) {
  rendererError = error.message;
  canvas.hidden = true;
  fallback.hidden = false;
  el('preview-label').textContent = 'Stored preview';
}
function option(value, text) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = text;
  return element;
}
const kinds = [...new Set(recipes.flatMap(recipe => recipe.inputs.map(input => input.kind)))].sort();
for (const kind of kinds) el('input-filter').append(option(kind, kind.replaceAll('-',' ')));

function draw() {
  const { recipe, check } = current;
  const [width,height] = recipe.size, frame = Number(sample.value);
  const edited = api.edited(recipe, values), selected = recipe.check.edit.input;
  const editedValue = api.exampleEdit(recipe)[selected];
  const unchanged = Object.entries(values).every(([id,value]) =>
    value === api.inputValue(recipe, recipe.inputs.find(input => input.id === id)));
  const checkedEdit = Object.keys(values).length === 1 && values[selected] === editedValue;
  const variant = checkedEdit ? 'edited' : 'original';
  if (renderer) {
    const renderGraph = toolkit.KIT.renderGraph.create(edited.graph);
    for (let i = 0; i <= frame; i++)
      renderer.render(world,{ width,height,time:recipe.times[i],raw:true,transparent:true,renderGraph,resetRenderHistory:i===0 });
  } else fallback.src = current[variant][frame];
  const reference = current[variant][frame];
  el('reference').src = reference;
  el('export').href = reference;
  el('export').download = recipe.id + '-' + variant + '-' + frame + '.png';
  const stats = check.frames.find(item => item.time === recipe.times[frame] && item.variant === variant);
  el('evidence').textContent = unchanged || checkedEdit
    ? stats.maxChannelDelta === 0 ? 'Exact RGBA match · ' + stats.pixels.toLocaleString('en-US') + ' pixels' :
      'Verified · max channel difference ' + stats.maxChannelDelta
    : 'Showing the verified original export';
  for (const input of recipe.inputs.filter(input => input.control)) {
    const value = values[input.id] ?? api.inputValue(recipe,input);
    el('slider-' + input.id).value = value;
    el('value-' + input.id).value = value;
  }
  el('reset').disabled = unchanged;
  el('edit').disabled = checkedEdit;
  // The range controls require WebGL for arbitrary intermediate values.
  for (const control of sliderPanel.querySelectorAll('input')) control.disabled = !renderer;
}
function select(entry) {
  current = entry;
  values = {};
  const { recipe } = entry;
  el('recipe').hidden = false;
  el('title').textContent = recipe.title;
  el('purpose').textContent = recipe.intent;
  el('support').textContent = 'WebGL2 / Headless PNG';
  el('size').textContent = recipe.size.join(' × ');
  sample.replaceChildren(...recipe.times.map((time,i) => option(i,time+' s')));
  sample.hidden = el('sample-label').hidden = recipe.times.length === 1;
  sliderPanel.replaceChildren();
  const sources = document.createElement('ul');
  for (const input of recipe.inputs) {
    const item = document.createElement('li');
    item.textContent = input.label + ' · ' + input.kind.replaceAll('-',' ');
    sources.append(item);
    if (!input.control) continue;
    const label = document.createElement('label'), readout = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'slider-' + input.id;
    Object.assign(slider, input.control);
    label.htmlFor = slider.id;
    readout.id = 'value-' + input.id;
    label.textContent = input.label;
    label.append(readout);
    slider.addEventListener('input', () => {
      values[input.id] = Number(slider.value);
      draw();
    });
    sliderPanel.append(label,slider);
  }
  const caption = document.createElement('div');
  caption.className = 'label';
  caption.textContent = 'Editable inputs';
  el('inputs').replaceChildren(caption,sources);
  nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-current', String(button.dataset.id===recipe.id)));
  draw();
}
function filter() {
  const query = el('search').value, kind = el('input-filter').value, rendererType = el('renderer-filter').value;
  const found = api.search(recipes, query, kind, rendererType ? [rendererType] : []);
  nav.replaceChildren(...found.map(recipe => {
    const entry = entries.find(item => item.recipe === recipe);
    const button = document.createElement('button'), image = document.createElement('img');
    button.type = 'button';
    button.className = 'recipe';
    button.dataset.id = recipe.id;
    button.setAttribute('aria-current', String(current === entry));
    image.alt = '';
    image.src = entry.original[0];
    button.append(image,document.createTextNode(recipe.title));
    button.addEventListener('click', () => select(entry));
    return button;
  }));
  warning.textContent = found.length ? rendererError ? 'WebGL2 unavailable. Showing the verified PNGs.' : '' : 'No recipes match.';
  warning.hidden = !warning.textContent;
  if (!found.includes(current?.recipe)) {
    if (found.length) select(entries.find(entry => entry.recipe === found[0]));
    else { current = undefined; el('recipe').hidden = true; }
  }
}
el('search').addEventListener('input',filter);
el('input-filter').addEventListener('change',filter);
el('renderer-filter').addEventListener('change',filter);
sample.addEventListener('change',draw);
el('edit').addEventListener('click', () => { values = api.exampleEdit(current.recipe); draw(); });
el('reset').addEventListener('click', () => { values = {}; draw(); });
el('save').addEventListener('click', () => {
  const recipe = api.edited(current.recipe, values);
  const url = URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)+'\n'], { type:'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = recipe.id + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
});
current = entries.find(entry => entry.recipe.id === 'tide-reflection');
filter();
select(current);
