const $ = id => document.getElementById(id);
const P = KIT.procedural, Bitmap = BitmapResources;
const { saved, spec, flows } = demo, original = spec.inputs.session.default;
const plate = $('plate'), overlay = $('overlay'), ctx = overlay.getContext('2d');
const kind = { baseColor:'Glaze', height:'Height', emission:'Emission', roughness:'Roughness', flow:'UV flow' };
const settings = { baseColor:['Opacity',.7,0,1,.05], height:['Height (mm)',.52,-.2,.8,.01], emission:['Energy',2,0,5,.05],
  roughness:['Roughness',.21,0,1,.01], flow:['Speed (UV/s)',.7,0,2,.05] };
const marquee = { type:'rectangle', rect:[224, 156, 576, 330] };
const toLinear = ColorSpace.prepare('srgb','srgb-linear');
let graph, editor, results, before, shown, active = 'lit', inspectAt, pointer = null;
const byId = new Map();
for (const layer of original.layers) {
  const row = document.createElement('div'), button = document.createElement('button'), label = document.createElement('span');
  const channel = document.createElement('span'), visible = document.createElement('input');
  row.className = 'layer';
  button.type = 'button';
  button.dataset.layer = layer.id;
  label.textContent = layer.label;
  channel.className = 'unit';
  channel.textContent = kind[layer.channel];
  button.append(label, channel);
  visible.type = 'checkbox';
  visible.setAttribute('aria-label', 'Show ' + layer.label);
  row.append(button, visible);
  $('layers').append(row);
  byId.set(layer.id, { button, visible, channel:layer.channel });
  button.addEventListener('click', () => {
    active = layer.id;
    selectBrush();
    controls();
    inspect();
  });
  visible.addEventListener('change', () => transact(() => editor.editLayer(layer.id, { visible:visible.checked })));
}
const engraving = KIT.pixelBrushes.capture({
  width: 7, height: 7, rect: [0,0,7,7],
  read: (x,y) => (x+y === 3 || x+y===6 || x+y===9) && Math.abs(x-y)<=5 ? { color:'#ffffff' } : null
});
function selectBrush() {
  const [label, value, min, max, step] = settings[byId.get(active).channel];
  $('amountLabel').textContent = label;
  Object.assign($('amount'), { min,max,step,value });
  $('amountValue').value = value;
  $('color').hidden = !['baseColor','emission'].includes(byId.get(active).channel);
}
function controls() {
  if (!editor) return;
  for (const layer of editor.snapshot().layers) {
    const row = byId.get(layer.id);
    row.button.setAttribute('aria-pressed', String(layer.id === active));
    row.visible.checked = layer.visible !== false;
  }
  const { undo,redo } = editor.history();
  $('undo').disabled = !undo; $('redo').disabled = !redo;
  const receipt = results.report.channels[byId.get(active).channel];
  $('edits').value = (receipt?.changed ?? 0).toLocaleString() + ' texels';
}
function draw() {
  if (!results) return;
  const target = $('before').getAttribute('aria-pressed') === 'true' ? before : results;
  shown = TideglassPreview.render(target, $('view').value, $('light').valueAsNumber,
    $('zoom').getAttribute('aria-pressed') === 'true' ? 2 : 1);
  plate.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(shown.data), shown.width, shown.height), 0, 0);
  const { width,height } = results.color.raster;
  $('canvasInfo').value = width + ' × ' + height + ' · float32';
  $('lightValue').value = $('light').value + '°';
  inspect();
  marks();
}
function inspect() {
  if (!inspectAt || !results) {
    $('sample').value = '—';
    return;
  }
  const output = $('before').getAttribute('aria-pressed') === 'true' ? before : results;
  const type = byId.get(active).channel;
  const image = P.materialChannels.channel(output.material, type).raster;
  const { width,height,data,channels } = image.raster;
  const [x,y] = [Math.min(width-1,Math.floor(inspectAt[0]*width)),Math.min(height-1,Math.floor(inspectAt[1]*height))];
  const at = (y*width+x)*channels;
  const values = Array.from(data.subarray(at, at+channels), n => n.toFixed(3)).join(' / ');
  $('sample').value = x + ',' + y + ' · ' + values + (type==='height'?' mm':'');
}
function marks() {
  ctx.clearRect(0,0,overlay.width,overlay.height);
  if (!shown) return;
  const [u,v,du,dv] = shown.crop, { width,height } = results.color.raster;
  const toCanvas = ([s,t]) => [(s-u)/du*overlay.width,(t-v)/dv*overlay.height];
  if ($('selection').checked) {
    const [x,y,w,h] = marquee.rect;
    const [left,top] = toCanvas([x/width,y/height]);
    const [right,bottom] = toCanvas([(x+w)/width,(y+h)/height]);
    ctx.strokeStyle = '#f3c182';
    ctx.setLineDash([2,2]);
    ctx.strokeRect(left,top,right-left,bottom-top);
  }
  if ($('mirror').checked) {
    ctx.strokeStyle = '#a8e7d5b3';
    ctx.setLineDash([5,3]);
    ctx.beginPath();ctx.moveTo(overlay.width/2,0);ctx.lineTo(overlay.width/2,overlay.height);ctx.stroke();
  }
  if (pointer?.points.length) {
    ctx.strokeStyle = '#d4fff3';
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const point of pointer.points) ctx.lineTo(...toCanvas(point.uv));
    ctx.stroke();
  }
}
function transact(edit) {
  if (!editor) return;
  try {
    edit();
    results = graph.evaluate({ session: editor.snapshot() }).outputs;
    $('before').setAttribute('aria-pressed','false');
    $('notice').textContent = '';
    controls(); draw();
  } catch (error) {
    $('notice').textContent = error.message;
    controls();
  }
}
function uvAt(event) {
  const rect = plate.getBoundingClientRect();
  const x = (event.clientX-rect.left)/rect.width, y = (event.clientY-rect.top)/rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const [u,v,du,dv] = shown.crop;
  return [u+x*du,v+y*dv];
}
function stroke(path) {
  const { width,height } = results.color.raster, layer = byId.get(active), space = $('space').value;
  const radius = $('radius').valueAsNumber, strength = $('amount').valueAsNumber;
  const sample = ([u,v]) => space === 'texel' ? [Math.min(width-1,Math.floor(u*width)),Math.min(height-1,Math.floor(v*height))] :
    space === 'world' ? [6+u*3.2,0,-2+v*2] : space === 'rest' ? [u*3.2,0,v*2] : [u,v];
  const samples = path.map(({uv,pressure,time},i) => ({at:sample(uv),pressure,time:Math.max(0,time-path[0].time)+i*.001}));
  const style = $('brush').value, erase = $('erase').checked;
  const brush = style === 'engraved' ? { kind:'tip', definition:{...engraving,settings:{...engraving.settings,
    size:[radius*2,radius*2], dynamics:{pressure:[.25,1]}}} } : { kind:'round',radius,hardness:.62,aspect:style==='flow'?.33:1 };
  const rgb = $('color').value.slice(1).match(/../g).map(n=>parseInt(n,16)/255);
  const value = layer.channel === 'baseColor' ? [...rgb,strength] : layer.channel==='emission' ?
    toLinear(rgb).map(n=>n*strength) : strength;
  const pigment = layer.channel === 'flow' ? (style === 'engraved' || path.length === 1 ?
    { velocity:[strength*.82,strength*.57] } : { velocity:'stroke',speed:strength }) :
    { value,...(layer.channel==='baseColor'&&{colorSpace:'srgb'}) };
  return { space, samples, brush,
    ...(space==='world'&&{chart:'world-panel'}),...(space==='rest'&&{chart:'rest-panel'}),
    ...(style==='flow'&&{flow:'current'}),...($('mirror').checked&&{symmetry:{mirrorX:(width-1)/2}}),
    ...($('selection').checked&&{selection:marquee}),...(erase?{mode:'erase'}:pigment) };
}

function samplePoint(event) {
  const uv = uvAt(event);
  inspectAt = uv;
  if (!uv || pointer?.id !== event.pointerId) return;
  const old = pointer.points.at(-1);
  if (!old || Math.hypot(old.uv[0]-uv[0],old.uv[1]-uv[1]) > .0008) {
    pointer.points.push({ uv,pressure:event.pointerType==='pen' ? event.pressure : 1,time:event.timeStamp });
  }
}
plate.addEventListener('pointerdown', event => {
  if (!shown || event.button !== 0 || pointer) return;
  plate.setPointerCapture(event.pointerId);
  pointer = { id:event.pointerId,points:[] };
  samplePoint(event);
});
plate.addEventListener('pointermove', event => {
  if (!shown) return;
  samplePoint(event);
  inspect(); marks();
});
plate.addEventListener('pointerleave', () => { inspectAt=null;inspect(); });
plate.addEventListener('pointerup', event => {
  if (pointer?.id !== event.pointerId) return;
  samplePoint(event);
  const { points } = pointer;
  pointer = null;
  if (points.length) transact(() => editor.stroke(active, stroke(points)));
});
plate.addEventListener('lostpointercapture', () => { pointer=null;marks(); });
for (const id of ['before','zoom']) $(id).addEventListener('click', () => {
  $(id).setAttribute('aria-pressed', String($(id).getAttribute('aria-pressed') !== 'true'));
  draw();
});
for (const id of ['view','light']) $(id).addEventListener('input', draw);
for (const id of ['mirror','selection']) $(id).addEventListener('change', marks);
$('radius').addEventListener('input',()=>$('radiusValue').value=$('radius').value+' px');
$('amount').addEventListener('input',()=>$('amountValue').value=$('amount').value);
$('undo').addEventListener('click',()=>transact(()=>editor.undo()));
$('redo').addEventListener('click',()=>transact(()=>editor.redo()));
$('download').addEventListener('click', () => {
  const file = structuredClone(saved);
  file.graph.inputs.session.definition.default = editor.snapshot();
  const url = URL.createObjectURL(new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'}));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'tideglass.material.json'; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

async function start() {
  const assets = new Map(), png = globalThis[Symbol.for('ink-studio.png-raster')];
  for (const [id,{definition}] of Object.entries(saved.resources)) {
    const { source } = definition, from = Uint8Array.from(atob(source.base64),c=>c.charCodeAt(0));
    let raw;
    if (source.encoding === 'pfm') raw = Bitmap.pfm(from,source);
    else {
      const stream = png.decode(from), { parts } = stream.next().value;
      const unpack = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'));
      raw = Bitmap.png(stream.next(new Uint8Array(await new Response(unpack).arrayBuffer())).value);
    }
    assets.set(id,Bitmap.compile(definition,new Map([['single',raw]]),P.graphImages.declare));
  }
  graph = P.graph.create(spec, { operations:{bitmapAsset:Bitmap.operation(name=>assets.get(name))} });
  before = graph.evaluate({session:{...original,layers:[]}}).outputs;
  editor = P.materialPaint.create(before.source,original,{flows});
  results = graph.evaluate({session:editor.snapshot()}).outputs;
  $('download').disabled = false;
  selectBrush(); controls(); draw();
}
start().catch(error => { $('notice').textContent=error.message; });
