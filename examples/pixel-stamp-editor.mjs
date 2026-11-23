import { mountPixelGridCanvas } from '../src/pixel-grid-canvas.mjs';

const stamp = KIT.pixelStamps;
const { stonePaint, flowingInk, bubble, glint, starTwinkle, line, fill, rect } = InkPixelStudies;
const $ = name => document.getElementById(name);
const view = mountPixelGridCanvas($('canvas-view')), art = view.canvas;
const state = { frame:0, swatch:0, tool:'pencil', points:[], undo:[] };
let drawingPointer;
const limit = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const notify = message => { $('status').textContent = message; };
const saveUndo = () => {
  state.undo.push({ data:structuredClone(state.doc), frame:state.frame });
  if (state.undo.length > 24) state.undo.shift();
};

function load(data) {
  const { width, height, palette } = stamp.prepare(data);
  if (width > 512 || height > 512 || !palette || palette.length > 48 ||
      !palette.every(color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color)))
    throw new RangeError('Open a stamp up to 512 × 512 with 1–48 hex swatches.');
  stop();
  if (state.doc) saveUndo();
  const { slots, rows, strokes, frames, ...rest } = data;
  state.doc = { ...rest, frames:frames ?? [{ slots, rows, strokes, duration:1 / (data.fps ?? 12) }] };
  state.frame = 0;
  state.swatch = 0;
  state.points = [];
  update();
}

function activeStrokes() {
  const { points, tool } = state;
  const brushWidth = limit(Number($('width').value) || 1,1,24);
  const slot = tool === 'erase' ? null : state.swatch;
  if (!points.length) return [];
  if (tool === 'pencil') return points.map(([x,y])=>rect(slot,x,y,1,1));
  if (tool === 'polygon') {
    return points.length === 1 ? [rect(slot,points[0][0],points[0][1],1,1)] :
      points.length === 2 ? [line(slot,points)] : [fill(slot,points.map(([x,y]) => [x+.5,y+.5]))];
  }
  if (points.length > 1) return [line(slot,points,brushWidth)];
  const [x,y] = points[0], inset = Math.floor((brushWidth-1)/2);
  return [rect(slot,x-inset,y-inset,brushWidth,brushWidth)];
}

function frameSlots(current) {
  const { width,height } = state.doc;
  const marks=activeStrokes();
  const slotData=stamp.paint(width,height,current);
  return marks.length ? stamp.paint(width,height,{slots:slotData,strokes:marks}) : slotData;
}

function draw() {
  const { width, height, palette } = state.doc;
  const current = state.doc.frames[state.frame];
  view.setFrame(stamp.image({ width,height,palette,slots:frameSlots(current) }));
  const count = state.doc.frames.length;
  $('scrub').max = count;
  $('scrub').value = state.frame+1;
  $('current').value = `Frame ${state.frame+1} / ${count}`;
  $('duration').value = +(current.duration ?? 1/(state.doc.fps ?? 12)).toFixed(4);
  $('width').disabled = state.tool === 'pencil' || state.tool === 'polygon';
  $('remove').disabled = count === 1;
  $('duplicate').disabled = count >= 2048 || (count+1)*width*height > 2**20;
  $('finish-shape').disabled = state.tool !== 'polygon' || state.points.length < 3;
}

function selectSwatch(index) {
  state.swatch = index;
  document.querySelectorAll('.swatch').forEach((button,i) => button.setAttribute('aria-pressed',i === index));
  const color = state.doc.palette[index];
  $('color').value = color;
  $('swatch-label').textContent = `${state.doc.swatchRoles?.[index] ?? `Swatch ${index+1}`} · ${color}`;
  draw();
}

function update() {
  $('palette').replaceChildren(...state.doc.palette.map((color,index) => {
    const b=document.createElement('button');
    b.className='swatch';
    b.style.setProperty('--swatch',color);
    b.setAttribute('aria-label',`Swatch ${index+1}, ${color}`);
    b.addEventListener('click',()=>selectSwatch(index));
    return b;
  }));
  $('undo').disabled = !state.undo.length;
  $('canvas-width').value = state.doc.width;
  $('canvas-height').value = state.doc.height;
  $('add-color').disabled = state.doc.palette.length >= 48;
  $('playback').value = state.doc.playback ?? 'loop';
  selectSwatch(Math.min(state.swatch,state.doc.palette.length-1));
}

function stop() {
  if (state.play === undefined) return;
  cancelAnimationFrame(state.play);
  state.play = undefined;
  $('play').textContent = 'Play';
}

function edit(callback) {
  stop();
  saveUndo();
  callback();
  update();
}

function commitStroke() {
  if (!state.points.length) return;
  const current = state.doc.frames[state.frame], slots = frameSlots(current);
  edit(() => {
    state.doc.frames[state.frame] = { slots,duration:current.duration ?? 1/(state.doc.fps ?? 12) };
    state.points = [];
  });
}

function resizeCanvas(width,height) {
  const doc = state.doc;
  if (![width,height].every(size => Number.isSafeInteger(size) && size >= 1 && size <= 512) ||
      width * height * doc.frames.length > 2 ** 20)
    throw new RangeError('Canvas size exceeds the stamp grid or animation budget.');
  if (width === doc.width && height === doc.height) return;
  const columns = Math.min(width,doc.width), rows = Math.min(height,doc.height);
  const frames = doc.frames.map(({ slots,rows:sourceRows,strokes,...hold }) => {
    const before = stamp.paint(doc.width,doc.height,{ slots,rows:sourceRows,strokes });
    const resized = Array(width * height).fill(null);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) resized[y * width + x] = before[y * doc.width + x];
    return { ...hold, slots:resized };
  });
  edit(() => {
    state.doc = { ...doc,width,height,frames };
    state.points = [];
  });
}

function pencilSegment([x,y],[toX,toY]) {
  const dx=Math.abs(toX-x),dy=-Math.abs(toY-y),sx=Math.sign(toX-x),sy=Math.sign(toY-y);
  let error=dx+dy;
  while (x!==toX || y!==toY) {
    const twice=2*error;
    if (twice>=dy) { error+=dy; x+=sx; }
    if (twice<=dx) { error+=dx; y+=sy; }
    if (state.points.length>=4096) return;
    state.points.push([x,y]);
  }
}

art.addEventListener('pointerdown',event => {
  if (event.button !== 0 || drawingPointer !== undefined) return;
  const at = view.pixelAt(event.clientX,event.clientY);
  if (!at) return;
  stop();
  if (state.tool === 'polygon') {
    if (state.points.length < 120) state.points.push(at);
  } else {
    art.setPointerCapture(event.pointerId);
    drawingPointer = event.pointerId;
    state.points = [at];
  }
  draw();
});
art.addEventListener('pointermove',event => {
  if (drawingPointer !== event.pointerId || state.points.length >= (state.tool === 'pencil' ? 4096 : 120)) return;
  const at=view.pixelAt(event.clientX,event.clientY,{ clamp:true }), last=state.points.at(-1);
  if (!at || !last || last[0]===at[0] && last[1]===at[1]) return;
  if (state.tool === 'pencil') pencilSegment(last,at);
  else state.points.push(at);
  draw();
});
art.addEventListener('pointerup',event => {
  if (drawingPointer !== event.pointerId) return;
  drawingPointer = undefined;
  commitStroke();
});
art.addEventListener('lostpointercapture',event => {
  if (drawingPointer !== event.pointerId) return;
  drawingPointer = undefined;
  state.points = [];
  draw();
});
$('finish-shape').addEventListener('click',commitStroke);
$('canvas-size').addEventListener('submit',event => {
  event.preventDefault();
  try {
    const width = $('canvas-width').valueAsNumber, height = $('canvas-height').valueAsNumber;
    resizeCanvas(width,height);
    notify(`Canvas ${width} × ${height} px`);
  } catch (error) { notify(error.message); }
});
$('tools').addEventListener('click',event => {
  const { tool } = event.target.dataset;
  if (!tool) return;
  state.tool=tool;
  state.points=[];
  $('tools').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',button.dataset.tool===tool));
  notify(tool === 'polygon' ? 'Click the corners, then close the shape.' : '');
  draw();
});
$('play').addEventListener('click',() => {
  if (state.play !== undefined) { stop(); return; }
  state.points=[];
  const { entries, at } = stamp.prepare(state.doc), start=performance.now();
  const elapsed=entries.slice(0,state.frame).reduce((sum, entry)=>sum+entry.duration,0);
  const stopAt=entries.reduce((sum, entry)=>sum+entry.duration,0);
  $('play').textContent='Pause';
  const step=now=>{
    const time=(now-start)/1000+elapsed;
    const frame=at(time-(state.doc.phase ?? 0));
    if (frame !== state.frame) { state.frame=frame; draw(); }
    if (state.doc.playback === 'once' && time >= stopAt) { stop(); return; }
    state.play=requestAnimationFrame(step);
  };
  draw();
  state.play=requestAnimationFrame(step);
});
$('scrub').addEventListener('input',()=>{ stop(); state.frame=Number($('scrub').value)-1; state.points=[]; draw(); });
$('duration').addEventListener('change',()=>edit(()=>{
  state.doc.frames[state.frame].duration=limit(Number($('duration').value) || .01,.01,60);
}));
$('playback').addEventListener('change',()=>edit(()=>{state.doc.playback=$('playback').value;}));
$('duplicate').addEventListener('click',()=>edit(()=>{
  const copy=structuredClone(state.doc.frames[state.frame]);
  state.doc.frames.splice(++state.frame,0,copy);
}));
$('remove').addEventListener('click',()=>edit(()=>{
  state.doc.frames.splice(state.frame,1);
  state.frame=Math.min(state.frame,state.doc.frames.length-1);
}));
$('undo').addEventListener('click',()=>{
  stop();
  const snapshot=state.undo.pop();
  state.doc=snapshot.data;
  state.frame=snapshot.frame;
  state.points=[];
  update();
});
$('color').addEventListener('change',()=>edit(()=>{ state.doc.palette[state.swatch]=$('color').value; }));
$('add-color').addEventListener('click',()=>edit(()=>{ state.swatch=state.doc.palette.push('#ffffff')-1; }));

const ink=flowingInk();
const presets={stone:stonePaint,glint,star:starTwinkle,bubble,library:stamp.clip,body:()=>ink.body,eye:()=>ink.eye,
  blank:()=>({width:48,height:48,palette:['#273a47','#5c8277','#e6dbb6'],strokes:[]})};
const sparkleSizes=['7x7','5x4','5x3','4x3','3x3'];
const sizes={glint:sparkleSizes,star:sparkleSizes,bubble:['9x9','6x5','5x5']};
const library=stamp.catalog().clips.map(({id,label})=>[id,label]);
$('preset').addEventListener('change',()=>{
  const name=$('preset').value;
  const options=name==='library' ? library : (sizes[name] ?? []).map(size=>[size,size.replace('x',' × ')]);
  $('size-label').hidden=!options.length;
  $('variant-label').textContent=name==='library' ? 'Clip' : 'Size';
  $('size').replaceChildren(...options.map(([value,label])=>new Option(label,value)));
  load(presets[name]($('size').value || undefined));
  notify('');
});
$('size').addEventListener('change',()=>{ load(presets[$('preset').value]($('size').value)); notify(''); });
$('import').addEventListener('change',async event=>{
  const [file]=event.target.files;
  if (!file) return;
  try { load(JSON.parse(await file.text())); notify(`Opened ${file.name}`); }
  catch (error) { notify(error.message); }
  finally { event.target.value=''; }
});
$('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(state.doc,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=`${$('preset').value}-stamp.json`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify(`Saved ${link.download}`);
});
load(stonePaint());
