const $ = id => document.getElementById(id);
const P = KIT.procedural;
const outputLabels = { previewDisplay:'Lit',baseColor:'Base color',height:'Height',normal:'Normal',
  roughness:'Roughness',mask:'Mask',metalness:'Metalness' };
const cards = new Map(), filters = new Map(), mapButtons = new Map(), projects = new Map(), edits = new Map();
let selected, category = 'All', output = 'previewDisplay', result, renderedId, pending = 0;

function button(label, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click',handler);
  return element;
}

for (const name of ['All', ...new Set(recipeCatalog.map(entry=>entry.category))]) {
  const filter = button(name,()=>{
    category = name;
    if (name!=='All' && selected.category!==name) select(recipeCatalog.find(entry=>entry.category===name));
    syncCards();
  });
  filter.dataset.category = name;
  $('filters').append(filter);
  filters.set(name,filter);
}
for (const entry of recipeCatalog) {
  const card = button('',()=>select(entry));
  card.className = 'card';
  card.dataset.recipe = entry.id;
  const texture = new Image(), label = document.createElement('span');
  texture.src = entry.thumbnail;
  texture.alt = '';
  texture.width = 128;
  texture.height = 128;
  label.className = 'card-name';
  label.textContent = entry.label;
  card.append(texture,label);
  $('cards').append(card);
  cards.set(entry.id,card);
}
for (const [id,label] of Object.entries(outputLabels)) {
  const map = button(label,()=>{ output = id; paint(); });
  map.dataset.map = id;
  $('maps').append(map);
  mapButtons.set(id,map);
}

function syncCards() {
  for (const [name,filter] of filters) filter.setAttribute('aria-pressed', String(name===category));
  for (const entry of recipeCatalog) {
    const card = cards.get(entry.id);
    card.hidden = category!=='All' && entry.category!==category;
    card.setAttribute('aria-pressed',String(entry.id===selected.id));
  }
}

function select(entry) {
  selected = entry;
  if (!Object.hasOwn(entry.project.outputs,output)) output = 'previewDisplay';
  $('category').textContent = entry.category;
  $('title').textContent = entry.label;
  $('description').textContent = entry.summary;
  $('original').href = entry.file;
  $('original').download = entry.id + '.material.json';
  buildControls();
  syncCards();
  schedule();
}

function buildControls() {
  $('controls').replaceChildren();
  const graph = selected.document;
  const values = edits.get(selected.id) ?? {};
  const { parameters } = P.materialParameters.prepare({ ...graph.graph, controls:graph.controls }).inspect({ inputs:values });
  for (const spec of parameters) {
    const row = document.createElement('div'), label = document.createElement('label');
    const value = document.createElement('output');
    const field = document.createElement(spec.options ? 'select' : 'input');
    row.className = 'field';
    field.id = 'param-' + spec.input;
    label.htmlFor = field.id;
    value.htmlFor.add(field.id);
    label.textContent = spec.label;
    if (spec.options) for (const option of spec.options) field.add(new Option(option.label, option.value));
    else {
      field.type = 'range';
      field.min = spec.min;
      field.max = spec.max;
      field.step = spec.step;
    }
    field.value = spec.value;
    const update = () => { value.textContent = Number(field.value) + (spec.units ? ' ' + spec.units : ''); };
    field.addEventListener('input',()=>{
      edits.set(selected.id,{...edits.get(selected.id),[spec.input]:Number(field.value)});
      update();
      schedule();
    });
    if (!spec.options) { update(); row.append(label,value,field); }
    else row.append(label,field);
    $('controls').append(row);
  }
}

function schedule() {
  if (!pending) pending = requestAnimationFrame(draw);
}

function draw() {
  pending = 0;
  try {
    if (!projects.has(selected.id)) projects.set(selected.id,P.graph.create(selected.project));
    result = projects.get(selected.id).evaluate(edits.get(selected.id) ?? {}).outputs;
    renderedId = selected.id;
    paint();
    $('error').textContent = '';
  } catch (error) {
    $('error').textContent = error.message;
  }
}

function display(mode) {
  if (mode==='previewDisplay') return result[mode];
  if (mode==='baseColor') return P.graphImages.toDisplay(result[mode]);
  const { raster:{ width,height,channels,data },descriptor } = result[mode];
  const bytes = new Uint8ClampedArray(width*height*4);
  const divide = { unorm8:255,unorm16:65535 }[descriptor.precision] ?? 1;
  let reach = .001;
  if (mode==='height') for (const sample of data) reach = Math.max(Math.abs(sample),reach);
  for (let p=0;p<width*height;p++) {
    for (let c=0;c<3;c++) {
      const n = data[p*channels+(channels===1?0:c)]/divide;
      bytes[p*4+c] = 255*(mode==='height'?.5+.5*n/reach:mode==='normal'?n*.5+.5:n);
    }
    bytes[4*p+3] = 255;
  }
  return { width,height,data:bytes };
}

function paint() {
  for (const [key,map] of mapButtons) {
    map.hidden = !Object.hasOwn(selected.project.outputs,key);
    map.setAttribute('aria-pressed',String(output===key));
  }
  if (renderedId!==selected.id) return;
  const { width,height,data } = display(output), repeat = $('repeat').checked ? 2 : 1;
  const canvas = $('material');
  canvas.width = width*repeat;
  canvas.height = height*repeat;
  canvas.setAttribute('aria-label',selected.label+' '+outputLabels[output]);
  const pixels = new ImageData(new Uint8ClampedArray(data),width,height);
  const context = canvas.getContext('2d');
  for (let y=0;y<repeat;y++) for (let x=0;x<repeat;x++) context.putImageData(pixels,x*width,y*height);
}

$('repeat').addEventListener('input',paint);
$('reset').addEventListener('click',()=>{
  edits.delete(selected.id);
  buildControls();
  schedule();
});
$('save').addEventListener('click',()=>{
  const copy = structuredClone(selected.document);
  for (const [id,value] of Object.entries(edits.get(selected.id) ?? {}))
    copy.graph.inputs[id].definition.default = value;
  delete copy.metadata.thumbnail;
  const url = URL.createObjectURL(new Blob([JSON.stringify(copy,null,2)+'\n'],{type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = selected.id + '-edited.material.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

select(recipeCatalog.find(entry=>entry.id==='tile'));
