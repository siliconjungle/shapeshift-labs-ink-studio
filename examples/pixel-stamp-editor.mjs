import { mountPixelGridCanvas } from '../src/pixel-grid-canvas.mjs';

const stamp = KIT.pixelStamps, guideTool = KIT.pixelGuides, paintTools = KIT.pixelPaintTools;
const brushes = KIT.pixelBrushes;
const { stonePaint, flowingInk, bubble, glint, starTwinkle, line, rect } = InkPixelStudies;
const $ = name => document.getElementById(name);
const view = mountPixelGridCanvas($('canvas-view'),{ guideTool }), art = view.canvas;
const state = { frame:0, swatch:0, tool:'pencil', points:[], undo:[] };
let drawingPointer, pencilStroke, grid;
let brush, brushTip, brushStroke, selection;
const maxPencilPixels = 4096;
let sharedGuides, frameGuides, guideItems = [];
const limit = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const notify = message => { $('status').textContent = message; };
const dragShapes = new Set(['line','rect','ellipse']);
const vertexShapes = new Set(['curve','polygon']);
const shapeType = () => $('shape-type').value;
const rectangleBetween = ([x,y],[u,v]) => [Math.min(x,u),Math.min(y,v),Math.abs(x-u)+1,Math.abs(y-v)+1];
const saveUndo = () => {
  state.undo.push({ data:structuredClone(state.doc), frame:state.frame });
  if (state.undo.length > 24) state.undo.shift();
};

function resetStroke() {
  state.points = [];
  pencilStroke = brushStroke = undefined;
}

function load(data) {
  const { width, height, palette } = stamp.prepare(data);
  if (width > 512 || height > 512 || !palette || palette.length > 48 ||
      !palette.every(color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color)))
    throw new RangeError('Open a stamp up to 512 × 512 with 1–48 hex swatches.');
  if (data.drawing !== undefined) paintTools.drawingGrid(width,height,data.drawing);
  stop();
  if (state.doc) saveUndo();
  const { slots, rows, strokes, alpha, frames, ...rest } = data;
  const loaded = frames ?? [{ slots, rows, strokes, alpha, duration:1 / (data.fps ?? 12) }];
  state.doc = { ...rest, frames:loaded.map(frame => {
    if (!frame.alpha) return frame;
    const pixels = stamp.paint(width,height,frame);
    return { ...frame,alpha:frame.alpha.map((value,p)=>pixels[p] === null ? 255 : value) };
  }) };
  state.frame = 0;
  state.swatch = 0;
  selection = undefined;
  resetStroke();
  update();
}

function activeStrokes() {
  const { points, tool } = state;
  const brushWidth = limit(Number($('width').value) || 1,1,24);
  const slot = tool === 'erase' ? null : state.swatch;
  if (tool === 'pencil') {
    const tip = pencilStroke?.tip();
    return tip ? [...points,tip].map(([x,y])=>rect(slot,x,y,1,1)) : [];
  }
  if (!points.length) return [];
  if (points.length > 1) return [line(slot,points,brushWidth)];
  const [x,y] = points[0], inset = Math.floor((brushWidth-1)/2);
  return [rect(slot,x-inset,y-inset,brushWidth,brushWidth)];
}

function strokeCopies({ slot,shape }) {
  let bounds;
  if (shape.type === 'rect') {
    const [x,y,w,h] = shape.rect;
    bounds = [x,y,x+w,y+h];
  } else {
    const xs = shape.points.map(point=>point[0]), ys = shape.points.map(point=>point[1]);
    const pad = shape.width/2+1;
    bounds = [Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)+pad,Math.max(...ys)+pad];
  }
  return grid.copies(bounds).map(([[sx,tx],[sy,ty]]) => {
    if (shape.type !== 'rect') return { slot,shape:{ ...shape,points:shape.points.map(([x,y])=>[sx*x+tx,sy*y+ty]) } };
    const [x,y,w,h] = shape.rect;
    return rect(slot,sx*x+tx-(sx < 0 ? w : 0),sy*y+ty-(sy < 0 ? h : 0),w,h);
  });
}

function frameSlots(current) {
  const { width,height } = state.doc;
  const slotData=stamp.paint(width,height,current);
  if (state.tool === 'shape') {
    const draft = currentShape();
    if (draft) {
      try { paintShape(slotData,draft); }
      catch (error) { notify(error.message); }
    }
    return slotData;
  }
  if (state.tool === 'brush-select' || state.tool === 'brush-stamp') return slotData;
  if (grid && state.tool === 'pencil') {
    const tip = pencilStroke?.tip();
    if (tip) for (const [x,y] of [...state.points,tip])
      grid.pixels(x,y,p=>{ slotData[p] = state.swatch; });
    return slotData;
  }
  const marks = activeStrokes(), strokes = grid ? marks.flatMap(strokeCopies) : marks;
  return strokes.length ? stamp.paint(width,height,{slots:slotData,strokes}) : slotData;
}

function draw() {
  const { width,height } = state.doc;
  const current = state.doc.frames[state.frame];
  let palette = state.doc.palette, slots = frameSlots(current), alpha = current.alpha;
  if (state.tool === 'brush-stamp' && brush && (brushStroke || state.points.length)) {
    try { ({ palette,slots,alpha } = applyBrush(slots,alpha)); }
    catch (error) { notify(error.message); }
  }
  view.setFrame(stamp.image({ width,height,palette,slots,alpha }));
  const selected = selection?.frame === state.frame ? selection.bounds : null;
  view.setSelection(state.tool === 'brush-select' ? selected : null);
  $('capture-brush').disabled = !selected || state.tool !== 'brush-select' || drawingPointer !== undefined;
  drawGuides(current);
  const count = state.doc.frames.length;
  $('scrub').max = count;
  $('scrub').value = state.frame+1;
  $('current').value = `Frame ${state.frame+1} / ${count}`;
  $('duration').value = +(current.duration ?? 1/(state.doc.fps ?? 12)).toFixed(4);
  $('width').disabled = !['brush','erase'].includes(state.tool);
  $('pixel-perfect').disabled = state.tool !== 'pencil';
  $('remove').disabled = count === 1;
  $('duplicate').disabled = count >= 2048 || (count+1)*width*height > 2**20;
  showShapeControls();
}

function selectSwatch(index) {
  state.swatch = index;
  document.querySelectorAll('.swatch').forEach((button,i) => button.setAttribute('aria-pressed',i === index));
  const color = state.doc.palette[index];
  $('color').value = color;
  $('swatch-label').textContent = `${state.doc.swatchRoles?.[index] ?? `Swatch ${index+1}`} · ${color}`;
  draw();
}

function updateDrawing() {
  const { width,height,drawing } = state.doc;
  grid = drawing ? paintTools.drawingGrid(width,height,drawing) : undefined;
  for (const [axis,property,size,wrap] of [['x','mirrorX',width,'wrapX'],['y','mirrorY',height,'wrapY']]) {
    const position = drawing?.[property], input = $('mirror-'+axis+'-at');
    $('mirror-'+axis).checked = position !== undefined;
    input.value = position ?? (size-1)/2;
    input.max = size-.5;
    input.disabled = position === undefined;
    $('wrap-'+axis).checked = drawing?.[wrap] === true;
  }
  view.setDrawing(drawing);
}

function update() {
  updateDrawing();
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
  if (!state.points.length && !pencilStroke?.tip()) return;
  const current = state.doc.frames[state.frame], slots = frameSlots(current);
  savePixels(current,slots);
}

function savePixels(current,slots,palette = state.doc.palette,alpha = current.alpha) {
  edit(() => {
    const { rows,strokes,alpha:previousAlpha,...frame } = current;
    const keepAlpha = alpha?.some((value,p)=>value !== 255 && slots[p] !== null);
    state.doc.frames[state.frame] = { ...frame,slots,duration:current.duration ?? 1/(state.doc.fps ?? 12),
      ...(keepAlpha && { alpha:alpha.map((value,p)=>slots[p] === null ? 255 : value) }) };
    state.doc.palette = palette;
    resetStroke();
  });
}

function setBrush(next) {
  const tip = brushes.footprint(next);
  if (state.tool === 'brush-stamp' && drawingPointer !== undefined) {
    drawingPointer = undefined;
    resetStroke();
  }
  brush = next;
  brushTip = tip;
  $('brush-settings').hidden = false;
  $('save-brush').disabled = false;
  document.querySelector('[data-tool="brush-stamp"]').disabled = false;
  showBrushSettings();
}

function showBrushSettings() {
  [$('brush-x').value,$('brush-y').value] = brush.anchor;
  $('brush-x').max = brush.width-1;
  $('brush-y').max = brush.height-1;
  [$('brush-width').value,$('brush-height').value] = brush.settings.size;
  $('brush-angle').value = brush.settings.angle;
  $('brush-swatch').value = brush.settings.swatch.mode;
  $('brush-tint').value = brush.settings.swatch.color ?? state.doc.palette[state.swatch];
  $('brush-tint-controls').hidden = brush.settings.swatch.mode !== 'tint';
  const { dynamics } = brush.settings;
  $('brush-dynamics').checked = dynamics !== undefined;
  $('brush-dynamics-settings').hidden = dynamics === undefined;
  $('brush-stabilization').value = dynamics?.stabilization ?? (dynamics ? 0 : 40);
  [$('brush-light').value,$('brush-full').value] = dynamics?.pressure ?? (dynamics ? [1,1] : [.25,1]);
  $('brush-speed').value = dynamics?.velocity?.speed ?? 120;
  [$('brush-slow').value,$('brush-fast').value] = dynamics?.velocity?.size ?? (dynamics ? [1,1] : [1,.6]);
}

function updateBrushSettings() {
  const mode = $('brush-swatch').value, color = $('brush-tint').value;
  const saved = brush.settings.swatch;
  const dynamics = $('brush-dynamics').checked ? {
    stabilization:$('brush-stabilization').valueAsNumber,
    pressure:[$('brush-light').valueAsNumber,$('brush-full').valueAsNumber],
    velocity:{ speed:$('brush-speed').valueAsNumber,size:[$('brush-slow').valueAsNumber,$('brush-fast').valueAsNumber] }
  } : undefined;
  try {
    setBrush({ ...brush,anchor:[$('brush-x').valueAsNumber,$('brush-y').valueAsNumber],
      settings:{ angle:$('brush-angle').valueAsNumber,size:[$('brush-width').valueAsNumber,$('brush-height').valueAsNumber],
        swatch:mode === 'tint' ? { mode,color,...(saved.color?.toLowerCase() === color && saved.id && { id:saved.id }) } : { mode },
        ...(dynamics && { dynamics }) } });
    draw();
    notify('');
  } catch (error) {
    showBrushSettings();
    notify(error.message);
  }
}

const shadingControls = new Set(['brush-mode','brush-ramp','brush-ramp-step','brush-alpha']);
function brushShading() {
  const mode = $('brush-mode').value;
  $('brush-ramp-controls').hidden = mode !== 'ramp';
  $('brush-alpha-controls').hidden = mode !== 'alpha';
  if (mode === 'ramp') return { mode,step:$('brush-ramp-step').valueAsNumber,
    ramp:$('brush-ramp').value.split(',').map(n=>n.trim() ? Number(n)-1 : NaN) };
  if (mode === 'alpha') return { mode,value:$('brush-alpha').valueAsNumber };
  if (mode === 'recolor') return { mode };
}

function applyBrush(slots,alpha) {
  const { width,height,palette:colors } = state.doc, dabs = brushStroke?.dabs ?? new Map();
  if (!brushStroke) brushes.stroke(width,height,brushTip,state.points,(p,slot)=>{ dabs.set(p,slot); },grid);
  const shading = brushShading();
  if (shading) {
    const resolve = brushes.shade(shading,colors.map((_,slot)=>slot));
    const opacity = shading.mode === 'alpha' ? alpha?.slice() ?? Array(slots.length).fill(255) : alpha;
    let changed = false;
    for (const p of dabs.keys()) {
      const next = resolve(slots[p],opacity?.[p] ?? 255);
      if (next === undefined) continue;
      if (shading.mode === 'alpha') opacity[p] = next;
      else {
        const color = shading.mode === 'recolor' ? state.swatch : next;
        if (slots[p] === color) continue;
        slots[p] = color;
      }
      changed = true;
    }
    return { slots,palette:colors,alpha:opacity,changed };
  }

  const { palette,mapping } = brushes.resolvePalette(brush,colors.map(color=>({ color })),
    { limit:48,used:new Set(dabs.values()) });
  let changed = false;
  for (const [p,source] of dabs) {
    const next = mapping[source];
    if (slots[p] === next) continue;
    slots[p] = next;
    changed = true;
  }
  return { slots,palette:palette.map(entry=>entry.color),alpha,changed };
}

function commitBrush() {
  const { width,height } = state.doc, current = state.doc.frames[state.frame];
  try {
    brushStroke?.path.finish();
    const { slots,palette,alpha,changed } = applyBrush(stamp.paint(width,height,current),current.alpha);
    if (changed) savePixels(current,slots,palette,alpha);
    else { resetStroke(); draw(); }
    notify('');
  } catch (error) {
    resetStroke();
    draw();
    notify(error.message);
  }
}

$('capture-brush').addEventListener('click',() => {
  const { width,height,palette } = state.doc;
  const current = state.doc.frames[state.frame], slots = stamp.paint(width,height,current);
  try {
    setBrush(brushes.capture({ width,height,rect:selection.bounds,
      read(x,y) {
        const p = y*width+x, slot = slots[p];
        return slot === null || current.alpha?.[p] === 0 ? null : { color:palette[slot] };
      } }));
    chooseTool('brush-stamp');
    notify('Captured brush');
  } catch (error) { notify(error.message); }
});
$('brush-settings').addEventListener('change',event => {
  if (shadingControls.has(event.target.id)) {
    brushShading();
    if (state.tool === 'brush-stamp') resetStroke();
    draw();
    notify('');
  } else updateBrushSettings();
});
$('brush-ramp-add').addEventListener('click',() => {
  const input = $('brush-ramp'), swatch = String(state.swatch+1);
  const list = input.value.split(',').map(value=>value.trim()).filter(Boolean);
  if (!list.includes(swatch)) input.value = [...list,swatch].join(', ');
});
$('brush-active-color').addEventListener('click',() => {
  $('brush-tint').value = state.doc.palette[state.swatch];
  updateBrushSettings();
});
$('open-brush').addEventListener('change',async event => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    setBrush(JSON.parse(await file.text()));
    chooseTool('brush-stamp');
    notify('Opened '+file.name);
  } catch (error) { notify(error.message); }
  finally { event.target.value = ''; }
});
$('save-brush').addEventListener('click',() => saveJson('pixel-brush.json',brush));

function currentShape(points = state.points) {
  const [first] = points;
  if (!first) return;
  const type = shapeType(), last = points.at(-1), width = $('shape-width').valueAsNumber;
  const fill = $('shape-fill').value === 'filled';
  if (type === 'line' || (type === 'curve' || type === 'polygon') && points.length < 3)
    return { type:'line',from:first,to:last,width:type === 'polygon' && fill ? 1 : width };
  if (type === 'curve') return { type,points,width };
  if (type === 'polygon') return { type,points,fill,...(!fill && { width }) };
  if (type === 'text') return { type,at:first,text:$('shape-text').value,scale:$('shape-scale').valueAsNumber };
  if (type === 'staircase') return { type,from:first,axis:$('shape-axis').value,
    direction:[Number($('shape-dir-x').value),Number($('shape-dir-y').value)],
    lengths:$('shape-lengths').value.split(',').map(value=>Number(value.trim())) };
  return { type,rect:rectangleBetween(first,last),fill,...(!fill && { width }) };
}

function paintShape(slots,shape) {
  const { width,height } = state.doc, mask = KIT.pixelShapes.raster(width,height,shape,grid);
  let changed = false;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || slots[p] === state.swatch) continue;
    slots[p] = state.swatch;
    changed = true;
  }
  return changed;
}

function finishShape(shape) {
  const { width,height } = state.doc, current = state.doc.frames[state.frame];
  try {
    const slots = stamp.paint(width,height,current);
    if (paintShape(slots,shape)) savePixels(current,slots);
    else {
      resetStroke();
      draw();
    }
    notify('');
  } catch (error) {
    resetStroke();
    draw();
    notify(error.message);
  }
}

function showShapeControls() {
  const active = state.tool === 'shape';
  $('shape-controls').hidden = !active;
  if (!active) return;
  const type = shapeType(), vertices = vertexShapes.has(type), area = ['rect','ellipse','polygon'].includes(type);
  const required = type === 'curve' ? Number($('shape-curve').value) : 3;
  $('shape-fill-label').hidden = !area;
  $('shape-width-label').hidden = !(type === 'line' || type === 'curve' || area && $('shape-fill').value === 'outline');
  $('curve-label').hidden = type !== 'curve';
  $('shape-text-controls').hidden = type !== 'text';
  $('shape-step-controls').hidden = type !== 'staircase';
  $('finish-shape').hidden = $('cancel-shape').hidden = !vertices;
  $('finish-shape').disabled = state.points.length < required;
  $('cancel-shape').disabled = !state.points.length;
  if (type === 'curve') $('shape-hint').textContent = `Click ${required} points in order from start to end, including the controls.`;
  else if (type === 'polygon') $('shape-hint').textContent = 'Click the vertices, then apply the shape.';
  else if (type === 'text') $('shape-hint').textContent = 'Click the top-left pixel of the text.';
  else if (type === 'staircase') $('shape-hint').textContent = 'Click the first pixel of the staircase.';
  else $('shape-hint').textContent = 'Drag from the first pixel to the last.';
}

function pickOrFill(at) {
  const { width,height } = state.doc, current = state.doc.frames[state.frame];
  const slots = stamp.paint(width,height,current), p = grid ? grid.primary(at) : at[1]*width+at[0];
  const picked = slots[p];
  if (state.tool === 'eyedropper') {
    if (picked !== null) selectSwatch(picked);
    const opacity = current.alpha?.[p];
    notify(picked === null ? 'Transparent pixel' : 'Sampled '+state.doc.palette[picked]+
      (opacity === undefined ? '' : ' · alpha '+opacity));
    return;
  }
  if (!grid && picked === state.swatch) return;
  const region = grid ? paintTools.fillPixels(grid,at,(p,seed)=>slots[seed] !== state.swatch && slots[p] === slots[seed])
    : paintTools.region(width,height,at,p=>slots[p] === picked);
  if (!region.length) return;
  for (const p of region) slots[p] = state.swatch;
  savePixels(current,slots);
  notify(`Filled ${region.length} pixels`);
}

const guideMode = guide => guide.kind === 'axis' ? 'axis-' + guide.axis : guide.kind;
const guideLabels = { grid:'Grid origin', 'axis-x':'Vertical axis', 'axis-y':'Horizontal axis',
  pivot:'Pivot', registration:'Registration' };
const selectedGuide = () => guideItems.find(({ guide }) => guide.id === $('guide-item').value);

function guideFields() {
  const mode = $('guide-type').value;
  $('guide-x-label').hidden = mode === 'axis-y';
  $('guide-y-label').hidden = mode === 'axis-x';
  $('guide-steps').hidden = mode !== 'grid';
  $('guide-x').disabled = mode === 'axis-y';
  $('guide-y').disabled = mode === 'axis-x';
  $('guide-step-x').disabled = $('guide-step-y').disabled = mode !== 'grid';
}

function selectGuide() {
  const item = selectedGuide();
  $('guide-remove').disabled = !item;
  $('guide-scope').disabled = !!item;
  if (item) {
    const { guide,scope } = item, mode = guideMode(guide);
    $('guide-type').value = mode;
    $('guide-scope').value = scope;
    if (mode !== 'axis-y') $('guide-x').value = mode === 'axis-x' ? guide.at : guide.at[0];
    if (mode !== 'axis-x') $('guide-y').value = mode === 'axis-y' ? guide.at : guide.at[1];
    if (guide.step) [$('guide-step-x').value,$('guide-step-y').value] = guide.step;
  }
  guideFields();
}

function drawGuides(frame) {
  if (sharedGuides === state.doc.guides && frameGuides === frame.guides && $('guide-item').options.length) return;
  sharedGuides = state.doc.guides;
  frameGuides = frame.guides;
  guideItems = [
    ...(sharedGuides ?? []).map(guide => ({ guide,scope:'all' })),
    ...(frameGuides ?? []).map(guide => ({ guide,scope:'frame' }))
  ];
  view.setGuides(guideItems.map(({ guide }) => guide));
  const select = $('guide-item'), previous = select.value;
  select.replaceChildren(new Option('New guide',''),...guideItems.map(({ guide,scope }) => {
    const name = guide.label ?? `${guideLabels[guideMode(guide)]} ${[guide.at].flat().join(', ')}`;
    return new Option(name + (scope === 'frame' ? ' · this frame' : ' · all frames'),guide.id);
  }));
  if (guideItems.some(({ guide }) => guide.id === previous)) select.value = previous;
  selectGuide();
}

function saveGuides(scope,list) {
  guideTool.prepare(scope === 'all' ? list : [...(sharedGuides ?? []),...list]);
  if (scope === 'all') {
    for (const frame of state.doc.frames)
      if (frame.guides?.length) guideTool.prepare([...list,...frame.guides]);
  }
  edit(() => {
    const target = scope === 'all' ? state.doc : state.doc.frames[state.frame];
    target.guides = list;
    resetStroke();
  });
}

function guideId(kind) {
  const ids = new Set([...(sharedGuides ?? []),...state.doc.frames.flatMap(frame => frame.guides ?? [])]
    .map(guide => guide.id));
  let n = 1;
  while (ids.has(kind+'-'+n)) n++;
  return kind+'-'+n;
}

$('guide-type').addEventListener('change',guideFields);
$('guide-item').addEventListener('change',selectGuide);
$('guide-form').addEventListener('submit',event => {
  event.preventDefault();
  try {
    const item = selectedGuide(), scope = item?.scope ?? $('guide-scope').value;
    const mode = $('guide-type').value, kind = mode.startsWith('axis-') ? 'axis' : mode;
    const x = $('guide-x').valueAsNumber, y = $('guide-y').valueAsNumber;
    const axis = kind === 'axis' ? mode.slice(-1) : undefined;
    const id = item?.guide.id ?? guideId(kind);
    const guide = { id,kind,at:axis === 'x' ? x : axis === 'y' ? y : [x,y],
      ...(item?.guide.label && { label:item.guide.label }), ...(axis && { axis }),
      ...(kind === 'grid' && { step:[$('guide-step-x').valueAsNumber,$('guide-step-y').valueAsNumber] }) };
    const guides = (scope === 'all' ? sharedGuides : frameGuides) ?? [];
    saveGuides(scope,item ? guides.map(old => old.id === id ? guide : old) : [...guides,guide]);
    $('guide-item').value = id;
    selectGuide();
    notify('Saved guide ' + id);
  } catch (error) { notify(error.message); }
});
$('guide-remove').addEventListener('click',() => {
  const item = selectedGuide();
  if (!item) return;
  const guides = item.scope === 'all' ? sharedGuides : frameGuides;
  saveGuides(item.scope,guides.filter(guide => guide.id !== item.guide.id));
  notify('Removed guide ' + item.guide.id);
});

$('drawing-settings').addEventListener('change',() => {
  const { width,height } = state.doc, drawing = {};
  if ($('mirror-x').checked) drawing.mirrorX = $('mirror-x-at').valueAsNumber;
  if ($('mirror-y').checked) drawing.mirrorY = $('mirror-y-at').valueAsNumber;
  if ($('wrap-x').checked) drawing.wrapX = true;
  if ($('wrap-y').checked) drawing.wrapY = true;
  try {
    paintTools.drawingGrid(width,height,drawing);
    edit(() => {
      if (Object.keys(drawing).length) state.doc.drawing = drawing;
      else delete state.doc.drawing;
      resetStroke();
    });
    notify('');
  } catch (error) {
    updateDrawing();
    notify(error.message);
  }
});

function resizeCanvas(width,height) {
  const doc = state.doc;
  if (![width,height].every(size => Number.isSafeInteger(size) && size >= 1 && size <= 512) ||
      width * height * doc.frames.length > 2 ** 20)
    throw new RangeError('Canvas size exceeds the stamp grid or animation budget.');
  if (width === doc.width && height === doc.height) return;
  const columns = Math.min(width,doc.width), rows = Math.min(height,doc.height);
  const frames = doc.frames.map(({ slots,rows:sourceRows,strokes,alpha,...hold }) => {
    const before = stamp.paint(doc.width,doc.height,{ slots,rows:sourceRows,strokes });
    const resized = Array(width * height).fill(null), opacity = alpha && Array(width * height).fill(255);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const p = y*width+x, source = y*doc.width+x;
      resized[p] = before[source];
      if (opacity) opacity[p] = alpha[source];
    }
    return { ...hold, slots:resized, ...(opacity && { alpha:opacity }) };
  });
  edit(() => {
    const drawing = doc.drawing && { ...doc.drawing };
    if (drawing?.mirrorX !== undefined) drawing.mirrorX = Math.min(drawing.mirrorX,width-.5);
    if (drawing?.mirrorY !== undefined) drawing.mirrorY = Math.min(drawing.mirrorY,height-.5);
    state.doc = { ...doc,width,height,frames,...(drawing && { drawing }) };
    selection = undefined;
    resetStroke();
  });
}

function strokeAt(event,continuous = false) {
  const options = { clamp:true,
    ...(state.tool !== 'brush-select' && grid && { wrapX:grid.wrapX,wrapY:grid.wrapY }) };
  return continuous ? view.positionAt(event.clientX,event.clientY,options) : view.pixelAt(event.clientX,event.clientY,options);
}

function startPencil(at) {
  resetStroke();
  pencilStroke = paintTools.freehand((x,y) => {
    if (state.points.length >= maxPencilPixels-1) return false;
    state.points.push([x,y]);
  },{ pixelPerfect:$('pixel-perfect').checked });
  pencilStroke.add(at);
}

function extendPencil(event) {
  const tip = pencilStroke.tip();
  for (const sample of [...(event.getCoalescedEvents?.() ?? []),event]) {
    if (state.points.length >= maxPencilPixels-1) break;
    const at = strokeAt(sample);
    if (at) pencilStroke.add(at);
  }
  return pencilStroke.tip() !== tip;
}

function startDynamicBrush(event) {
  resetStroke();
  const { width,height } = state.doc, dabs = new Map();
  brushStroke = { dabs,start:event.timeStamp,
    path:brushes.beginDynamicStroke(width,height,brush,(p,slot)=>{ dabs.set(p,slot); },grid) };
  extendDynamicBrush(event);
}

function extendDynamicBrush(event) {
  try {
    for (const input of [...(event.getCoalescedEvents?.() ?? []),event]) {
      const at = strokeAt(input,true);
      if (!at) continue;
      const { last,start,path } = brushStroke, ending = event.type === 'pointerup';
      const samePosition = last && at[0] === last.at[0] && at[1] === last.at[1];
      if (ending && samePosition) continue;
      const pressure = event.pointerType === 'pen' ?
        (ending && input.pressure === 0 ? last?.pressure ?? 1 : input.pressure) : 1;
      const time = Math.max(last?.time ?? 0,input.timeStamp-start);
      if (samePosition && pressure === last.pressure && time === last.time) continue;
      const sample = { at,pressure,time };
      path.add(sample);
      brushStroke.last = sample;
    }
  } catch (error) {
    resetStroke();
    notify(error.message);
  }
}

art.parentElement.addEventListener('pointerdown',event => {
  if (event.button !== 0 || drawingPointer !== undefined) return;
  const central = event.target === art;
  if (!central && (!grid || state.tool === 'brush-select' || !event.target.matches('.ink-grid-repeats canvas'))) return;
  const at = central ? view.pixelAt(event.clientX,event.clientY,{ snap:state.tool !== 'eyedropper' }) : strokeAt(event);
  if (!at) return;
  stop();
  if (state.tool === 'eyedropper' || state.tool === 'fill') { pickOrFill(at); return; }
  if (state.tool === 'shape' && !dragShapes.has(shapeType())) {
    if (vertexShapes.has(shapeType())) {
      const max = shapeType() === 'curve' ? Number($('shape-curve').value) : 128;
      if (state.points.length < max) state.points.push(at);
      draw();
    } else finishShape(currentShape([at]));
    return;
  }
  art.setPointerCapture(event.pointerId);
  drawingPointer = event.pointerId;
  if (state.tool === 'pencil') startPencil(at);
  else if (state.tool === 'brush-stamp' && brush?.settings.dynamics) startDynamicBrush(event);
  else {
    state.points = [at];
    if (state.tool === 'brush-select') selection = { frame:state.frame,bounds:rectangleBetween(at,at) };
  }
  draw();
});
art.addEventListener('pointermove',event => {
  if (drawingPointer !== event.pointerId) return;
  if (pencilStroke) {
    if (extendPencil(event)) draw();
    return;
  }
  if (brushStroke) {
    extendDynamicBrush(event);
    draw();
    return;
  }
  if (state.points.length >= 120) return;
  const at=strokeAt(event), last=state.points.at(-1);
  if (!at || !last || last[0]===at[0] && last[1]===at[1]) return;
  if (state.tool === 'brush-select') {
    selection = { frame:state.frame,bounds:rectangleBetween(state.points[0],at) };
  } else if (state.tool === 'shape') state.points[1] = at;
  else state.points.push(at);
  draw();
});
art.addEventListener('pointerup',event => {
  if (drawingPointer !== event.pointerId) return;
  if (pencilStroke) extendPencil(event);
  drawingPointer = undefined;
  if (state.tool === 'brush-select' && state.points.length) {
    const at = strokeAt(event);
    if (at) selection = { frame:state.frame,bounds:rectangleBetween(state.points[0],at) };
    resetStroke();
    draw();
  } else if (brushStroke) {
    extendDynamicBrush(event);
    if (brushStroke) commitBrush();
    else draw();
  } else if (state.tool === 'brush-stamp' && state.points.length) {
    const at = strokeAt(event);
    if (at && state.points.length < 120) state.points.push(at);
    commitBrush();
  } else if (state.tool === 'shape' && state.points.length && dragShapes.has(shapeType())) {
    const at = strokeAt(event);
    if (at) state.points[1] = at;
    finishShape(currentShape());
  } else {
    if (grid && !pencilStroke && state.points.length && state.points.length < 120) {
      const at = strokeAt(event), last = state.points.at(-1);
      if (at && (at[0] !== last[0] || at[1] !== last[1])) state.points.push(at);
    }
    commitStroke();
  }
});
art.addEventListener('lostpointercapture',event => {
  if (drawingPointer !== event.pointerId) return;
  drawingPointer = undefined;
  if (state.tool === 'brush-select') selection = undefined;
  resetStroke();
  draw();
});
$('finish-shape').addEventListener('click',() => finishShape(currentShape()));
$('cancel-shape').addEventListener('click',() => { resetStroke(); draw(); });
$('shape-controls').addEventListener('change',event => {
  if (['shape-type','shape-curve'].includes(event.target.id)) resetStroke();
  draw();
});
$('canvas-size').addEventListener('submit',event => {
  event.preventDefault();
  try {
    const width = $('canvas-width').valueAsNumber, height = $('canvas-height').valueAsNumber;
    resizeCanvas(width,height);
    notify(`Canvas ${width} × ${height} px`);
  } catch (error) { notify(error.message); }
});
function chooseTool(tool) {
  state.tool=tool;
  resetStroke();
  document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed',button.dataset.tool===tool));
  notify('');
  draw();
}
for (const id of ['tools','brush-tools']) $(id).addEventListener('click',event => {
  if (event.target.dataset.tool) chooseTool(event.target.dataset.tool);
});
$('play').addEventListener('click',() => {
  if (state.play !== undefined) { stop(); return; }
  resetStroke();
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
$('scrub').addEventListener('input',()=>{ stop(); state.frame=Number($('scrub').value)-1; resetStroke(); draw(); });
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
  selection = undefined;
  resetStroke();
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
function saveJson(filename,data) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify(`Saved ${link.download}`);
}
$('export').addEventListener('click',()=>saveJson(`${$('preset').value}-stamp.json`,state.doc));
load(stonePaint());
