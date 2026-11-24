import { mountPixelGridCanvas } from '../src/pixel-grid-canvas.mjs';
import { mountPixelOnionSkin } from '../src/pixel-onion-skin.mjs';
import { mountPixelRangePlayer } from '../src/pixel-range-player.mjs';
import * as playbackModule from '../src/pixel-playback-ranges.js';
import * as directionalModule from '../src/pixel-directional-views.js';
import * as tilemapModule from '../src/pixel-tilemap.js';
import { mountTilemap } from './pixel-stamp-tilemap.mjs';
import { mountPixelMotionPanel } from '../src/pixel-motion-panel.mjs';
import { mountPixelCraftPanel } from '../src/pixel-craft-panel.mjs';
import { mountPixelInspector } from '../src/pixel-inspector.mjs';
import * as paletteModule from '../src/pixel-palette.js';
import { colors,openPNG,readPNG,savePNG,saveRasterPNG } from './pixel-stamp-png.mjs';

const palettes = paletteModule.default ?? globalThis[Symbol.for('ink-studio.pixel-palette')];
const ranges = playbackModule.default ?? globalThis[Symbol.for('ink-studio.pixel-playback-ranges')];
const directional = directionalModule.default ?? globalThis[Symbol.for('ink-studio.pixel-directional-views')];
const Tilemap = tilemapModule.default ?? globalThis[Symbol.for('ink-studio.pixel-tilemap')];
const stamp = KIT.pixelStamps, guideTool = KIT.pixelGuides, paintTools = KIT.pixelPaintTools;
const brushes = KIT.pixelBrushes, selections = KIT.pixelSelections, transforms = KIT.pixelSelectionTransforms;
const canvasTransforms = KIT.pixelCanvasTransforms, adjustments = KIT.pixelAdjustments;
const protection = KIT.pixelProtection, layerStack = KIT.pixelLayerStack, stackFormat = 'ink-studio/pixel-layer-deck';
const { stonePaint, flowingInk, bubble, glint, starTwinkle, line, rect } = InkPixelStudies;
const $ = name => document.getElementById(name);
const view = mountPixelGridCanvas($('canvas-view'),{ guideTool }), art = view.canvas;
const onionSkin = mountPixelOnionSkin($('onion-skin'),view);
const nativePlayer = mountPixelRangePlayer(view.playbackHost,view,ranges);
let nativeSourceKey, tagFormKey, tagFormDoc;
let placementSource, placementsByTile = new Map();
let readInspection;
const inspector = mountPixelInspector($('pixel-inspection'),view,at=>readInspection?.(at));
const craft = KIT.pixelCraft, artRules = KIT.pixelArtRules, cleanup = KIT.pixelCleanup;
const craftPanel = mountPixelCraftPanel($('craft-diagnostics'),view,artRules.kinds,{
  inspect(at) {
    stop();
    inspector.focus(at);
  },
  select(finding) {
    if (drawingPointer !== undefined || selectionDraft || transformDraft || adjustmentDraft) {
      notify('Finish the current gesture before selecting a finding');
      return;
    }
    stop();
    const { width,height } = state.doc, mask = new Uint8Array(width*height);
    for (const [y,x,length] of finding.editableRuns ?? finding.runs) mask.fill(1,y*width+x,y*width+x+length);
    setActiveSelection(selectionFromMask(mask));
    drawSelection();
  }
});
const motion = KIT.pixelMotionChecks;
let motionFrame;
const motionPanel = mountPixelMotionPanel($('motion-checks'),{
  showSample(index,at,finding) {
    if (drawingPointer !== undefined) return;
    stop();
    resetStroke();
    state.frame = index;
    draw();
    motionFrame = index;
    view.setDiagnostic(finding,'motion');
    view.focusRegion(finding.bounds,'motion');
    inspector.focus(at);
  },
  clear() {
    motionFrame = undefined;
    view.setDiagnostic(null,'motion');
  }
});
let craftRevision = 0, artRulePlan;
$('art-shot').addEventListener('change',draw);
const flatStack = layerStack.prepare([{ id:'paint',label:'Paint' }]);
const state = { frame:0, swatch:0, tool:'pencil', points:[], undo:[] };
let drawingPointer, pencilStroke, grid;
let brush, brushTip, brushStroke, selection, selectionDraft, shownMasks;
let clipboard, transformDraft, adjustmentDraft, shownProtection, shownCleanup;
const maxPencilPixels = 4096;
let sharedGuides, frameGuides, guideItems = [];
const limit = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const notify = message => { $('status').textContent = message; };
const dragShapes = new Set(['line','rect','ellipse']);
const vertexShapes = new Set(['curve','polygon']);
const shapeType = () => $('shape-type').value;
const rectangleBetween = ([x,y],[u,v]) => [Math.min(x,u),Math.min(y,v),Math.abs(x-u)+1,Math.abs(y-v)+1];
const saveUndo = (selectionOnly = false) => {
  state.undo.push({ ...(selectionOnly ? {} : { data:structuredClone(state.doc) }),
    frame:state.frame,layer:state.layer,swatch:state.doc.swatchIds[state.swatch],selection });
  if (state.undo.length > 24) state.undo.shift();
};

function resetStroke() {
  state.points = [];
  pencilStroke = brushStroke = selectionDraft = transformDraft = adjustmentDraft = undefined;
}

const selectionId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);

function validateSavedMasks(width,height,rows) {
  if (rows === undefined) return;
  if (!Array.isArray(rows)) throw new TypeError('Saved masks need a list of IDs and native pixels');
  const ids = new Set();
  for (const row of rows) {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype ||
        Object.keys(row).some(key=>key !== 'id' && key !== 'pixels') || !selectionId(row.id) || ids.has(row.id))
      throw new TypeError('Saved masks need unique IDs and native pixels');
    selections.fromPixels(width,height,row.pixels);
    ids.add(row.id);
  }
}

function load(data) {
  const { width, height, palette } = stamp.prepare(data);
  if (width > 512 || height > 512 || !palette || palette.length > colors.limit ||
      !palette.every(color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color)))
    throw new RangeError('Open a stamp up to 512 × 512 with 1–255 hex swatches.');
  const swatchIds = colors.swatchIds(palette,data.swatchIds);
  palettes.fromStamp({ ...data,swatchIds });
  if (data.drawing !== undefined) paintTools.drawingGrid(width,height,data.drawing);
  if (data.sceneBindings !== undefined && (!Array.isArray(data.sceneBindings) ||
      data.sceneBindings.some(row=>!row || typeof row.id !== 'string' ||
        row.canvas !== undefined && !canvasTransforms.registered(row.canvas))))
    throw new TypeError('The stamp needs valid scene bindings and canvas registration');
  const { slots,rows,strokes,alpha,knockouts,frames,selections:saved,...rest } = data;
  if (frames !== undefined && saved !== undefined)
    throw new TypeError('Save animation masks on their own frames');
  const sourceFrames = frames ?? [{ slots,rows,strokes,alpha,knockouts,duration:1 / (data.fps ?? 12),
    ...(saved !== undefined && { selections:saved }) }];
  const stack = data.layers === undefined ? undefined : layerStack.prepare(data.layers);
  if (stack && (data.format !== stackFormat || data.version !== 1 || !frames))
    throw new TypeError('Layered artwork needs a version 1 deck with frames');
  function validateCel(cel) {
    if (!cel.alpha && !cel.knockouts) return cel;
    const pixels = stamp.paint(width,height,cel);
    if (cel.knockouts !== undefined && (!Array.isArray(cel.knockouts) ||
        !Array.from(cel.knockouts).every((p,i)=>Number.isInteger(p) && pixels[p] === null &&
          (i === 0 || p > cel.knockouts[i-1]))))
      throw new TypeError('Knockouts must be sorted locations of transparent pixels');
    if (!cel.alpha) return cel;
    return { ...cel,alpha:cel.alpha.map((value,p)=>pixels[p] === null ? 255 : value) };
  }
  const loaded = sourceFrames.map(frame => {
    validateSavedMasks(width,height,frame.selections);
    if (!stack) return validateCel(frame);
    const cels = Object.fromEntries(Object.entries(frame.cels ?? {}).map(([id,cel])=>{
      const layer = stack.rows.get(id);
      if (!layer || layer.kind === 'group') throw new RangeError('Invalid cel layer '+id);
      stamp.prepare({ width,height,palette,frames:[cel] });
      return [id,validateCel(cel)];
    }));
    return { ...frame,cels };
  });
  const revised = { ...rest,swatchIds,frames:loaded };
  directional.prepare(revised.directional,new Set(loaded.map(frame=>frame.id)),new Set(swatchIds));
  if (revised.tilemap !== undefined && !stack) throw new TypeError('Open tilemaps as a pixel layer deck');
  if (stack) validateStackDeck(revised,stack);
  else { validateProtection(revised); workshopRules(revised); }
  stop();
  if (state.doc) saveUndo();
  state.doc = revised;
  state.layer = stack && [...stack.rows.values()].reverse().find(row=>row.kind === 'paint' || row.kind === 'surface')?.id;
  $('canvas-binding-policy').value = '';
  state.frame = 0;
  state.swatch = 0;
  selection = undefined;
  resetStroke();
  update();
  tilePanel.show(revised.tilemap ? 'map' : 'pixels',{ clearPick:true });
  showPaletteRamp();
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

const activeSelection = () => selection?.frame === state.frame ? selection : undefined;
const selectionType = () => $('selection-type').value;
const colorSelection = type => type === 'wand' || type === 'range';
const pointSelection = type => colorSelection(type) || type === 'swatch' || type === 'cluster';
const savedMasks = () => state.doc.frames[state.frame].selections;

function selectionFromMask(mask) {
  return { frame:state.frame,mask,pixelCount:mask.reduce((sum,selected)=>sum+selected,0) };
}

function setActiveSelection(next) {
  saveUndo(true);
  selection = next;
  $('undo').disabled = false;
}

function selectPixels(query) {
  const { width,height,palette } = state.doc;
  let read, meaning;
  if (pointSelection(query.type)) {
    const current = activeCel(), slots = stamp.paint(width,height,current);
    if (query.type === 'wand') {
      const colors = palette.map(color=>Number.parseInt(color.slice(1),16));
      read = p => slots[p] === null ? 0 : (colors[slots[p]]<<8) | (current.alpha?.[p] ?? 255);
    } else meaning = selection=>selections.swatch(width,selection,slots,current.alpha);
  }
  const operand = selections.mask(width,height,query,read,undefined,meaning), mode = $('selection-mode').value;
  if (mode === 'replace') return selectionFromMask(operand);
  const base = activeSelection()?.mask ?? new Uint8Array(operand.length);
  return selectionFromMask(selections.combine(mode,base,operand));
}

function drawSelection() {
  const active = activeSelection(), draft = transformDraft?.preview?.selection ?? selectionDraft?.preview;
  const displayed = draft ?? active, busy = drawingPointer !== undefined || !!selectionDraft || !!transformDraft || !!adjustmentDraft;
  view.setSelection(displayed?.mask ?? null);
  const type = selectionType(), choosing = state.tool === 'brush-select';
  $('selection-tolerance-label').hidden = !colorSelection(type);
  $('selection-connectivity-label').hidden = type !== 'cluster';
  $('polygon-selection-actions').hidden = !choosing || type !== 'polygon';
  $('selection-close').disabled = (selectionDraft?.points.length ?? 0) < 3;
  $('selection-cancel').disabled = !selectionDraft;
  $('selection-clear').disabled = (!!adjustmentDraft || !!transformDraft || !active && !selectionDraft);
  $('selection-count').value = displayed ? `${displayed.pixelCount} pixels selected` : '';
  $('capture-brush').disabled = !active?.pixelCount || busy;
  $('cleanup-preview').disabled = !active?.pixelCount || !layerWritable() || drawingPointer !== undefined ||
    !!transformDraft || !!selectionDraft || !!adjustmentDraft && adjustmentDraft.scope !== 'cleanup';
  for (const button of $('selection-modifiers').querySelectorAll('button'))
    button.disabled = busy || !active && button.dataset.selectionModifier !== 'invert';
  const rows = savedMasks(), menu = $('selection-saved');
  if (shownMasks !== rows) {
    const previous = menu.value;
    menu.replaceChildren(new Option('Choose a mask',''),...(rows ?? []).map(({ id })=>new Option(id,id)));
    if (rows?.some(row=>row.id === previous)) menu.value = previous;
    shownMasks = rows;
  }
  const id = $('selection-name').value.trim();
  $('selection-save').disabled = !active || busy || !selectionId(id);
  $('selection-save').textContent = rows?.some(row=>row.id === id) ? 'Update mask' : 'Save mask';
  $('selection-recall').disabled = busy || !menu.value;
  drawProtection(active,busy);
  $('transform-begin').disabled = busy || !layerWritable() || !active?.pixelCount;
  $('transform-copy').disabled = busy || !active?.pixelCount;
  $('transform-paste').disabled = busy || !layerWritable() || !clipboard;
  $('transform-fields').hidden = !transformDraft;
  $('transform-duplicate-label').hidden = !transformDraft?.fromSelection;
  $('transform-protection-label').hidden = !transformDraft?.fromSelection ||
    $('transform-duplicate').checked || !frameProtection(state.doc,state.frame).length;
  $('transform-apply').disabled = !transformDraft?.preview || drawingPointer !== undefined;
  $('canvas-fit-selection').disabled = busy || !active?.pixelCount;
  $('swatch-replace').disabled = busy || !layerWritable() || !active?.pixelCount || !$('swatch-replace-target').value;
}

function refreshSelection() {
  const { type,points } = selectionDraft;
  const query = type === 'rectangle' || type === 'ellipse'
    ? { type,rect:rectangleBetween(points[0],points.at(-1)) }
    : { type:type === 'polygon' && points.length >= 3 ? 'polygon' : 'lasso',points };
  selectionDraft.preview = selectPixels(query);
}

function beginSelection(event,at) {
  const type = selectionType();
  art.closest('.ink-grid-viewport').focus({ preventScroll:true });
  if (pointSelection(type)) {
    try {
      const query = colorSelection(type)
        ? { type:'wand',at,connected:type === 'wand',tolerance:$('selection-tolerance').valueAsNumber }
        : { type,at,...(type === 'cluster' && { connectivity:Number($('selection-connectivity').value) }) };
      setActiveSelection(selectPixels(query));
      notify('');
      drawSelection();
    } catch (error) { notify(error.message); }
    return;
  }
  if (type === 'polygon') {
    selectionDraft ??= { type,points:[] };
    const { points } = selectionDraft, last = points.at(-1);
    if (points.length < 128 && (!last || last[0] !== at[0] || last[1] !== at[1])) points.push(at);
  } else {
    selectionDraft = { type,points:[at] };
    art.setPointerCapture(event.pointerId);
    drawingPointer = event.pointerId;
  }
  refreshSelection();
  drawSelection();
}

function extendSelection(event) {
  const { type,points } = selectionDraft;
  let changed = false;
  if (type === 'lasso') {
    for (const sample of [...(event.getCoalescedEvents?.() ?? []),event]) {
      const at = strokeAt(sample), last = points.at(-1);
      if (!at || (at[0] === last[0] && at[1] === last[1])) continue;
      changed = true;
      if (points.length < 4096) points.push(at);
      else points[points.length-1] = at;
    }
  } else {
    const at = strokeAt(event), last = points.at(-1);
    changed = !!at && (at[0] !== last[0] || at[1] !== last[1]);
    if (changed) points[1] = at;
  }
  if (changed) refreshSelection();
  return changed;
}

function finishSelection() {
  if (!selectionDraft?.preview || selectionDraft.type === 'polygon' && selectionDraft.points.length < 3) return;
  setActiveSelection(selectionDraft.preview);
  selectionDraft = undefined;
  drawSelection();
}

function clearSelection() {
  selectionDraft = undefined;
  if (activeSelection()) setActiveSelection(undefined);
  draw();
}

function modifySelection(type) {
  const { width,height } = state.doc;
  const base = activeSelection()?.mask ?? new Uint8Array(width*height);
  const amount = $('selection-amount').valueAsNumber;
  const operation = { type,...(type !== 'invert' && { amount }),
    ...(type === 'outline' && { side:$('selection-side').value }) };
  try {
    stop();
    setActiveSelection(selectionFromMask(selections.modify(width,height,base,operation)));
    resetStroke();
    notify('');
    draw();
  } catch (error) { notify(error.message); }
}

function saveSelection() {
  const id = $('selection-name').value.trim(), active = activeSelection(), { width } = state.doc;
  if (!active || !selectionId(id)) return;
  const frame = state.doc.frames[state.frame], pixels = selections.pixels(width,active.mask);
  const rows = [...(savedMasks() ?? [])], index = rows.findIndex(row=>row.id === id);
  if (index < 0) rows.push({ id,pixels });
  else rows[index] = { id,pixels };
  edit(() => { frame.selections = rows; resetStroke(); });
  $('selection-saved').value = id;
  drawSelection();
  notify(`Saved mask ${id}`);
}

function recallSelection() {
  const id = $('selection-saved').value, saved = savedMasks()?.find(row=>row.id === id);
  if (!saved) return;
  stop();
  const { width,height } = state.doc;
  setActiveSelection(selectionFromMask(selections.fromPixels(width,height,saved.pixels)));
  $('selection-name').value = id;
  resetStroke();
  notify(`Recalled mask ${id}`);
  draw();
}

function activeCel(index = state.frame) {
  const frame = state.doc.frames[index];
  return state.stack ? (Object.hasOwn(frame.cels,state.layer) ? frame.cels[state.layer] : {}) : frame;
}

const frameIds = doc=>doc.frames.map(frame=>frame.id);
const frameProtection = (doc,i)=>doc.protectedDetails?.length ? protection.active(doc.protectedDetails,frameIds(doc),i) : [];

function drawProtection(active,busy) {
  const doc = state.doc, rows = doc.protectedDetails, menu = $('protection-saved');
  if (shownProtection !== rows) {
    const previous = menu.value;
    menu.replaceChildren(new Option('Choose a detail',''),...(rows ?? []).map(row=>
      new Option(row.id+' · '+(row.kind ?? 'pixel'),row.id)));
    if (rows?.some(row=>row.id === previous)) menu.value = previous;
    shownProtection = rows;
  }
  const id = $('protection-id').value.trim();
  $('protection-lock').disabled = busy || !active?.pixelCount || !selectionId(id);
  $('protection-lock').textContent = rows?.some(row=>row.id === id) ? 'Update detail' : 'Lock selected pixels';
  $('protection-show').disabled = busy || !frameProtection(doc,state.frame).some(row=>row.id === menu.value);
  $('protection-unlock').disabled = busy || !menu.value;
  $('protection-range').hidden = $('protection-scope').value !== 'range';
  $('protection-first').max = $('protection-last').max = doc.frames.length;
}

for (const id of ['protection-id','protection-scope','protection-saved'])
  $(id).addEventListener(id === 'protection-id' ? 'input' : 'change',drawSelection);
$('protection-lock').addEventListener('click',()=>{
  const doc = state.doc, { width,height } = doc, selected = activeSelection();
  if (!selected?.pixelCount) return;
  const id = $('protection-id').value.trim(), kind = $('protection-kind').value;
  const scope = $('protection-scope').value, used = new Set(frameIds(doc));
  const frames = [...doc.frames];
  const key = index=>{
    const frame = frames[index];
    if (frame.id !== undefined) return frame.id;
    const id = colors.uniqueId(used,'frame-'+(index+1));
    used.add(id);
    frames[index] = { ...frame,id };
    return id;
  };
  try {
    const [first,last] = ['protection-first','protection-last'].map(id=>$(id).valueAsNumber-1);
    if (scope === 'range' && (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= frames.length))
      throw new RangeError('Choose a valid first and last frame');
    const row = { id,kind,pixels:selections.pixels(width,selected.mask),
      ...(scope === 'frame' && { frame:key(state.frame) }),...(scope === 'range' && { frames:[key(first),key(last)] }) };
    const details = new Map((doc.protectedDetails ?? []).map(row=>[row.id,row]));
    details.set(id,row);
    const revised = { ...doc,frames,protectedDetails:[...details.values()] };
    validateProtection(revised,state.stack);
    edit(()=>{ state.doc = revised; });
    $('protection-saved').value = id;
    drawSelection();
    notify('Protected '+id);
  } catch (error) { notify(error.message); }
});
$('protection-show').addEventListener('click',()=>{
  const row = frameProtection(state.doc,state.frame).find(row=>row.id === $('protection-saved').value);
  if (!row) return;
  const { width,height } = state.doc;
  const mask = selections.fromPixels(width,height,row.pixels);
  setActiveSelection(selectionFromMask(mask));
  drawSelection();
});
$('protection-unlock').addEventListener('click',()=>{
  const id = $('protection-saved').value;
  if (!id) return;
  edit(()=>{ state.doc.protectedDetails = state.doc.protectedDetails.filter(row=>row.id !== id); });
  notify('Unlocked '+id);
});

function layerWritable() {
  const layer = state.stack?.rows.get(state.layer);
  return !state.stack || layer && layer.kind !== 'group' && layer.kind !== 'reference' && !layer.effectiveLock;
}

function renderStack(doc,stack,frame,palette = doc.palette,override,references = false,capture) {
  const { width,height } = doc, packed = palette.map(color=>Number.parseInt(color.slice(1),16));
  const composite = layerStack.compose(width,height,packed,stack,id=>{
    const cel = override?.id === id ? override.cel : Object.hasOwn(frame.cels,id) ? frame.cels[id] : {};
    const slots = stamp.paint(width,height,cel);
    for (const p of cel.knockouts ?? []) if (slots[p] === null) slots[p] = -2;
    return { slots,alpha:cel.alpha };
  },{ references,capture });
  return { ...composite,packed };
}

function layerConflict(slots,alpha,knockouts,index = state.frame,carried) {
  if (!layerWritable()) throw new RangeError('Choose an unlocked paint, mask, or surface layer');
  const doc = state.doc, details = frameProtection(doc,index);
  if (!state.stack && !details.length) return;
  const previous = activeCel(index), before = rasterSlots(doc.width,doc.height,previous);
  const composed = state.stack && renderStack(doc,state.stack,doc.frames[index],doc.palette,undefined,false,state.layer);
  const clipping = composed?.layerSources.get(state.layer)?.clipping, erased = new Set(knockouts);
  const protectedPixels = carried?.locked ?? new Set();
  if (!carried) for (const detail of details) for (const [x,y] of detail.pixels) protectedPixels.add(y*doc.width+x);
  for (let p = 0; p < slots.length; p++) {
    const slot = erased.has(p) ? -2 : slots[p], opacity = alpha?.[p] ?? 255;
    if (slot === before[p] && (slot === null || slot < 0 || opacity === (previous.alpha?.[p] ?? 255))) continue;
    const protectedPixel = composed?.locks[p] || protectedPixels.has(p);
    if (protectedPixel || clipping && !clipping[p])
      throw new RangeError((protectedPixel ? 'Protected' : 'Clipped')+' pixel at '+[p%doc.width,Math.floor(p/doc.width)].join(', '));
  }
}

const indexedPalette = () => state.doc.palette.map((color,i)=>({ id:state.doc.swatchIds[i],color }));
function rasterSlots(width,height,frame) {
  const pixels = stamp.paint(width,height,frame);
  for (const p of frame.knockouts ?? []) pixels[p] = -2;
  return pixels;
}

function copyPixels() {
  const { width,height } = state.doc, current = activeCel();
  const active = activeSelection();
  return transforms.capture(width,height,{ slots:rasterSlots(width,height,current),
    alpha:current.alpha,palette:indexedPalette() },active.mask);
}

function copyActiveSelection() {
  const active = activeSelection();
  if (!active?.pixelCount || adjustmentDraft || transformDraft || selectionDraft || drawingPointer !== undefined) return;
  clipboard = copyPixels();
  notify(`Copied ${active.pixelCount} selected pixels`);
  drawSelection();
}

function startTransform(fromSelection) {
  if (!layerWritable() || adjustmentDraft || transformDraft || drawingPointer !== undefined ||
      (fromSelection ? !activeSelection()?.pixelCount : !clipboard)) return;
  const { width,height } = state.doc, clip = fromSelection ? copyPixels() : clipboard;
  stop();
  resetStroke();
  transformDraft = { clip,fromSelection };
  [$('transform-x').value,$('transform-y').value] = fromSelection ? clip.origin :
    [Math.min(clip.origin[0],width-1),Math.min(clip.origin[1],height-1)];
  $('transform-width').value = clip.width;
  $('transform-height').value = clip.height;
  $('transform-angle').value = 0;
  for (const id of ['transform-flip-x','transform-flip-y','transform-duplicate','transform-protection']) $(id).checked = false;
  updateTransform();
  art.closest('.ink-grid-viewport').focus({ preventScroll:true });
}

function repositionTransform(x,y) {
  const at = [limit(x,-4096,4096),limit(y,-4096,4096)];
  if (at[0] === $('transform-x').valueAsNumber && at[1] === $('transform-y').valueAsNumber) {
    drawSelection();
    return;
  }
  [$('transform-x').value,$('transform-y').value] = at;
  updateTransform();
}

function updateTransform() {
  if (!transformDraft) return;
  const { width,height } = state.doc, frame = activeCel();
  const slots = rasterSlots(width,height,frame), alpha = frame.alpha?.slice() ?? Array(width*height).fill(255);
  try {
    const settings = {
      at:[$('transform-x').valueAsNumber,$('transform-y').valueAsNumber],
      angle:$('transform-angle').valueAsNumber,size:[$('transform-width').valueAsNumber,$('transform-height').valueAsNumber],
      flipX:$('transform-flip-x').checked,flipY:$('transform-flip-y').checked,rotation:$('transform-rotation').value
    };
    const move = transformDraft.fromSelection && !$('transform-duplicate').checked;
    const carry = move && $('transform-protection').checked;
    const raster = transforms.stage(width,height,{ slots,alpha,palette:indexedPalette() },transformDraft.clip,settings,
      { move,named:true,limit:colors.limit,captureSources:carry });
    const doc = state.doc, index = state.frame;
    const carried = carry ? protection.carry(frameProtection(doc,index),doc.frames[index].id,width,
      activeSelection().mask,raster.sources) : undefined;
    for (const [p,pixel] of raster.writes) {
      slots[p] = pixel.slot === -1 ? null : pixel.slot;
      alpha[p] = pixel.alpha;
    }
    const knockouts = [];
    for (let p = 0; p < slots.length; p++) if (slots[p] === -2) { slots[p] = null; knockouts.push(p); }
    transformDraft.preview = { slots,alpha,knockouts,palette:raster.palette.map(entry=>entry.color),
      swatchIds:raster.palette.map(entry=>entry.id),selection:selectionFromMask(raster.mask),carried };
    $('transform-info').value = raster.clippedPixels ? `${raster.clippedPixels} selected pixels outside the canvas` : '';
  } catch (error) {
    transformDraft.preview = undefined;
    $('transform-info').value = error.message;
  }
  draw();
}

function finishTransform() {
  const preview = transformDraft?.preview;
  if (!preview || drawingPointer !== undefined) return;
  const { slots,palette,alpha,selection,swatchIds,knockouts,carried } = preview;
  if (savePixels(activeCel(),slots,palette,alpha,selection,swatchIds,knockouts,carried)) notify('Applied transform');
}

function cancelTransform() {
  if (!transformDraft) return;
  resetStroke();
  draw();
}

function beginTransformDrag(event) {
  const box = art.getBoundingClientRect(), { width,height } = state.doc;
  const x = $('transform-x').valueAsNumber, y = $('transform-y').valueAsNumber;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return;
  transformDraft.drag = { x,y,clientX:event.clientX,clientY:event.clientY,scaleX:width/box.width,scaleY:height/box.height };
  art.setPointerCapture(event.pointerId);
  drawingPointer = event.pointerId;
  art.closest('.ink-grid-viewport').focus({ preventScroll:true });
  drawSelection();
}

function extendTransformDrag(event) {
  const { x,y,clientX,clientY,scaleX,scaleY } = transformDraft.drag;
  repositionTransform(x+Math.round((event.clientX-clientX)*scaleX),y+Math.round((event.clientY-clientY)*scaleY));
}

function rgbaPencil() {
  return state.tool === 'pencil' && $('pencil-color-mode').value === 'rgba';
}

function rgbaStroke(current) {
  const tip = pencilStroke?.tip(), { width,height } = state.doc;
  const alphaByte = $('pencil-alpha').valueAsNumber;
  if (!Number.isInteger(alphaByte) || alphaByte < 0 || alphaByte > 255)
    throw new RangeError('Pencil alpha needs a whole value from 0 to 255');
  const raster = colors.paletteEditor(indexedPalette()), slots = stamp.paint(width,height,current);
  const alpha = current.alpha?.slice() ?? Array(slots.length).fill(255);
  const mask = activeSelection()?.mask;
  let changed = false;
  function paint(p) {
    if (mask && !mask[p]) return;
    const slot = raster.resolve($('pencil-rgb').value,undefined,slots[p] ?? state.swatch);
    changed ||= slots[p] !== slot || alpha[p] !== alphaByte;
    slots[p] = slot;
    alpha[p] = alphaByte;
  }
  if (tip) for (const [x,y] of [...state.points,tip]) {
    if (grid) grid.pixels(x,y,paint);
    else paint(y*width+x);
  }
  return { slots,alpha,changed,palette:raster.palette.map(row=>row.color),swatchIds:raster.palette.map(row=>row.id) };
}

function frameSlots(current) {
  const { width,height } = state.doc;
  const slotData = stamp.paint(width,height,current), selected = activeSelection()?.mask;
  if (state.tool === 'shape') {
    const draft = currentShape();
    if (draft) {
      try { paintShape(slotData,draft); }
      catch (error) { notify(error.message); }
    }
    return slotData;
  }
  if (['brush-select','brush-stamp'].includes(state.tool) || rgbaPencil()) return slotData;
  if (grid && state.tool === 'pencil') {
    const tip = pencilStroke?.tip();
    if (tip) for (const [x,y] of [...state.points,tip])
      grid.pixels(x,y,p=>{ if (!selected || selected[p]) slotData[p] = state.swatch; });
    return slotData;
  }
  const marks = activeStrokes(), strokes = grid ? marks.flatMap(strokeCopies) : marks;
  if (!strokes.length) return slotData;
  const painted = stamp.paint(width,height,{ slots:slotData,strokes });
  if (selected) for (let p = 0; p < selected.length; p++)
    if (!selected[p]) painted[p] = slotData[p];
  return painted;
}

function inspectionReader(doc,frame,index,{ palette,swatchIds,slots,alpha,knockouts,isolated }) {
  const { width,height } = doc, stack = state.stack ?? flatStack, active = state.stack ? state.layer : 'paint';
  const entries = palette.map((color,i)=>{
    const id = swatchIds[i] ?? 'rgb-'+color.slice(1);
    const label = doc.swatchLabels?.[id], locked = doc.lockedSwatches?.includes(id);
    return { id,color,...(typeof label === 'string' && { label }),...(locked && { locked }) };
  });
  const colors = palette.map(color=>Number.parseInt(color.slice(1),16)), cached = new Map();
  const erase = new Set(knockouts), details = frameProtection(doc,index);
  return ([x,y])=>{
    if (x >= width || y >= height) return;
    const p = y*width+x;
    const trace = layerStack.inspect(stack,colors,id=>{
      if (id === active) return { slot:slots[p] === null && erase.has(p) ? -2 : slots[p],alpha:alpha?.[p] };
      if (!cached.has(id)) {
        const cel = Object.hasOwn(frame.cels,id) ? frame.cels[id] : {};
        cached.set(id,{ slots:rasterSlots(width,height,cel),alpha:cel.alpha });
      }
      const source = cached.get(id);
      return { slot:source.slots[p],alpha:source.alpha?.[p] };
    },{ references:$('layer-references').checked });
    const result = KIT.pixelInspection.document(trace,entries,id=>frame.cels?.[id]?.id ?? null);
    const display = isolated && { layer:active,color:slots[p] != null && (alpha?.[p] ?? 255) > 0 ? palette[slots[p]] : null,
      alpha:slots[p] == null ? 0 : alpha?.[p] ?? 255 };
    return { ...result,protection:protection.at(details,x,y),...(display && { display }) };
  };
}

function workshopRules(doc) {
  if (doc.artRules === undefined) return;
  const { swatchIds, palette, ramps, layers, frames, sharedSelections = [] } = doc;
  return artRules.prepare(doc.artRules,{ swatches:swatchIds.map((id,i)=>({ id,color:palette[i] })),ramps,
    layers:layers ?? [{ id:'paint' }],frames:frames.map(frame=>frame.id),
    selections:[...sharedSelections,...frames.flatMap(frame=>
      (frame.selections ?? []).map(row=>({ ...row,frame:frame.id })))] });
}

function craftFrame(doc,index,layer) {
  const frame = doc.frames[index], { width,height } = doc, stack = state.stack;
  const composite = protectionRaster(doc,frame,stack);
  protection.paintLocks(frameProtection(doc,index),width,composite);
  if (layer === undefined && stack)
    return { width,height,...composite };
  const current = layer === undefined ? frame : frame.cels[layer] ?? {};
  const slots = rasterSlots(width,height,current);
  return { width,height,slots,opacity:current.alpha,colors:composite.colors,locks:composite.locks,swatches:doc.swatchIds,
    layerIds:[null,layer ?? 'paint'],owners:Uint8Array.from(slots,slot=>Number(slot !== null && slot >= 0)) };
}

function draw() {
  const { width,height } = state.doc;
  const frame = state.doc.frames[state.frame], current = activeCel();
  const preview = adjustmentDraft
    ? { palette:adjustmentDraft.palette,swatchIds:adjustmentDraft.swatchIds,...adjustmentDraft.frames.get(state.frame) }
    : transformDraft?.preview;
  let palette = preview?.palette ?? state.doc.palette, slots = preview?.slots ?? frameSlots(current);
  let alpha = preview?.alpha ?? current.alpha, swatchIds = preview?.swatchIds ?? state.doc.swatchIds;
  let knockouts = preview?.knockouts ?? current.knockouts;
  const { stack } = state, isolated = stack && $('layer-view').value === 'active';
  const references = $('layer-references').checked;
  if (!adjustmentDraft && !transformDraft && rgbaPencil() && pencilStroke?.tip()) {
    try { ({ palette,slots,alpha,swatchIds } = rgbaStroke(current)); }
    catch (error) { notify(error.message); }
  }
  if (!adjustmentDraft && !transformDraft && state.tool === 'brush-stamp' && brush && (brushStroke || state.points.length)) {
    try {
      const brushed = applyBrush(slots,alpha);
      ({ palette,slots,alpha } = brushed);
      swatchIds = brushed.swatchIds ?? swatchIds;
    } catch (error) { notify(error.message); }
  }
  let image;
  if (stack && !isolated) {
    try {
      const composed = renderStack(state.doc,state.stack,frame,palette,{ id:state.layer,cel:{ slots,alpha,knockouts } },references);
      image = layerStack.image(composed,composed.packed);
    } catch (error) {
      notify(error.message);
      const composed = renderStack(state.doc,state.stack,frame,state.doc.palette,undefined,references);
      image = layerStack.image(composed,composed.packed);
      palette = state.doc.palette;
      swatchIds = state.doc.swatchIds;
      slots = stamp.paint(width,height,current);
      ({ alpha,knockouts } = current);
    }
  } else image = stamp.image({ width,height,palette,slots,alpha });
  view.setFrame(image);
  const doc = state.doc, index = state.frame, activeLayer = state.layer;
  const sourceKey = JSON.stringify([craftRevision,isolated ? activeLayer : null,references]);
  function readFrame(i) {
    const neighbor = doc.frames[i];
    if (stack && !isolated) {
      const composite = renderStack(doc,stack,neighbor,doc.palette,undefined,references);
      return layerStack.image(composite,composite.packed);
    }
    const cel = isolated ? Object.hasOwn(neighbor.cels,activeLayer) ? neighbor.cels[activeLayer] : {} : neighbor;
    const { rows,slots,strokes,alpha } = cel;
    return stamp.image({ width,height,palette:doc.palette,rows,slots,strokes,alpha });
  }
  onionSkin.setSource({ key:sourceKey,index,count:doc.frames.length,rgba:image.rgba,readFrame:i=>readFrame(i).rgba });
  if (nativeSourceKey !== sourceKey) {
    nativeSourceKey = sourceKey;
    const frames = doc.frames.map(({ id,label,duration })=>({ id,label,durationMs:1000*(duration ?? 1/(doc.fps ?? 12)) }));
    const tags = ranges.resolve(doc.frames,doc.tags), loop = doc.playback !== 'once';
    nativePlayer.setSource({ key:sourceKey,document:doc,timingKey:JSON.stringify([frames,tags,loop]),frames,tags,loop,readFrame });
  }
  let reader;
  readInspection = at=>(reader ??= inspectionReader(doc,frame,index,{ palette,swatchIds,slots,alpha,knockouts,isolated }))(at);
  inspector.refresh();
  const scopedLayer = isolated ? state.layer : undefined, shot = $('art-shot').value || undefined;
  craftPanel.setSource(JSON.stringify([craftRevision,index,scopedLayer,shot]),()=>{
    const raster = craftFrame(doc,index,scopedLayer);
    return artRules.audit(raster,craft.analyze(raster),artRulePlan,{ frame:frame.id,layer:scopedLayer,shot }).diagnostics;
  });
  if (motionFrame !== index) view.setDiagnostic(null,'motion');
  motionPanel.setSource(JSON.stringify([craftRevision,scopedLayer]),()=>{
    motion.budget(width,height,doc.frames.length);
    let elapsed = 0;
    const ids = new Set(doc.frames.map(row=>row.id).filter(Boolean));
    const frames = doc.frames.map((row,i)=>{
      const id = row.id ?? colors.uniqueId(ids,'frame-'+(i+1));
      ids.add(id);
      const durationMs = (row.duration ?? 1/(doc.fps ?? 12))*1000;
      const sample = motion.fromRaster(craftFrame(doc,i,scopedLayer),{ id,label:row.label ?? id,
        durationMs,time:elapsed/1000,anchor:motion.registration([...(doc.guides ?? []),...(row.guides ?? [])]),
        gaps:frameProtection(doc,i).filter(row=>row.kind === 'gap').flatMap(row=>row.pixels) });
      elapsed += durationMs;
      return sample;
    });
    return motion.audit(frames);
  });
  drawSelection();
  drawGuides(frame);
  const count = state.doc.frames.length;
  $('scrub').max = count;
  $('scrub').value = state.frame+1;
  $('current').value = `Frame ${state.frame+1} / ${count}`;
  $('duration').value = +(frame.duration ?? 1/(state.doc.fps ?? 12)).toFixed(4);
  $('width').disabled = !['brush','erase'].includes(state.tool);
  $('pixel-perfect').disabled = $('pencil-color-mode').disabled = state.tool !== 'pencil';
  $('pencil-rgba').hidden = !rgbaPencil();
  const boundFrame = frame.id !== undefined && ((state.doc.sceneBindings ?? []).some(row=>row.frame === frame.id) ||
    (doc.protectedDetails ?? []).some(row=>row.frame === frame.id || row.frames?.includes(frame.id)) ||
    (doc.artRules?.bindings ?? []).some(row=>row.frame === frame.id));
  const boundSelection = doc.artRules?.profiles.some(profile=>profile.exceptions?.some(exception=>
    exception.selection && frame.selections?.some(selection=>selection.id === exception.selection)));
  const taggedEndpoint = !!frame.id && doc.tags?.some(tag=>tag.start === frame.id || tag.end === frame.id);
  const registeredView = doc.directional?.views.some(view=>view.frame === frame.id);
  if (placementSource !== doc.tilemap) {
    placementSource = doc.tilemap;
    placementsByTile = new Map();
    for (const { tile } of doc.tilemap?.cells ?? []) placementsByTile.set(tile,(placementsByTile.get(tile) ?? 0)+1);
  }
  const placements = placementsByTile.get(frame.id) ?? 0;
  $('remove').disabled = count === 1 || !!boundFrame || !!boundSelection || !!taggedEndpoint || !!registeredView || placements > 0;
  $('remove').title = placements ? 'Placed on the tilemap' :
    registeredView ? 'Registered directional view' : taggedEndpoint ? 'Used as a playback tag endpoint' : '';
  if (doc.tilemap) tilePanel.editing(frame.label ?? frame.id ?? 'Unregistered frame',placements);
  $('duplicate').disabled = count >= 2048 || (count+1)*width*height > 2**20;
  showShapeControls();
  showAdjustmentPreview();
  showCleanupPreview();
}

function selectSwatch(index) {
  state.swatch = index;
  document.querySelectorAll('.swatch').forEach((button,i) => button.setAttribute('aria-pressed',i === index));
  const { palette,swatchIds,swatchLabels,lockedSwatches } = state.doc, color = palette[index], id = swatchIds[index];
  const label = swatchLabels && Object.hasOwn(swatchLabels,id) ? swatchLabels[id] : undefined;
  const locked = lockedSwatches?.includes(id) ?? false;
  $('color').value = color;
  $('color').disabled = locked;
  $('swatch-label').textContent = `${label ?? state.doc.swatchRoles?.[index] ?? id} · ${color} · index ${index}`;
  $('swatch-name').value = label ?? '';
  $('swatch-lock').checked = locked;
  $('swatch-earlier').disabled = index === 0;
  $('swatch-later').disabled = index === palette.length-1;
  $('swatch-remap').disabled = locked || palette.length === 1;
  for (const menu of ['swatch-replace-target','swatch-remap-target']) {
    const target = $(menu), previous = target.value;
    target.replaceChildren(...swatchIds.flatMap((key,slot)=>key === id ? [] : [
      new Option(menu === 'swatch-remap-target' ? slot+' · '+swatchTitle(key) : swatchTitle(key),key)
    ]));
    if (swatchIds.includes(previous) && previous !== id) target.value = previous;
  }
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
  craftRevision++;
  artRulePlan = workshopRules(state.doc);
  const shot = $('art-shot'), previousShot = shot.value;
  const shots = [...new Set((state.doc.artRules?.bindings ?? []).flatMap(row=>row.shot ? [row.shot] : []))];
  shot.replaceChildren(new Option('Base rules',''),...shots.map(id=>new Option(id,id)));
  if (shots.includes(previousShot)) shot.value = previousShot;
  $('art-shot-control').hidden = !shots.length;
  updateDrawing();
  updateLayers();
  $('palette').replaceChildren(...state.doc.palette.map((color,index) => {
    const b=document.createElement('button');
    b.className='swatch';
    b.style.setProperty('--swatch',color);
    b.setAttribute('aria-label',`Swatch ${index+1}, ${color}`);
    b.title = swatchTitle(state.doc.swatchIds[index]);
    b.addEventListener('click',()=>selectSwatch(index));
    return b;
  }));
  $('undo').disabled = !state.undo.length;
  $('canvas-width').value = state.doc.width;
  $('canvas-height').value = state.doc.height;
  showCanvasControls();
  updateRampChoices();
  updateAdjustmentSwatches();
  const donor = $('cleanup-swatch'), before = donor.value;
  donor.replaceChildren(new Option('Auto',''),...state.doc.swatchIds.map(id=>new Option(swatchTitle(id),id)));
  donor.value = state.doc.swatchIds.includes(before) ? before : '';
  $('add-color').disabled = state.doc.palette.length >= colors.limit;
  $('playback').value = state.doc.playback ?? 'loop';
  updateTagForm();
  selectSwatch(Math.min(state.swatch,state.doc.palette.length-1));
  tilePanel.refresh();
}

function stop() {
  if (state.play === undefined) return;
  cancelAnimationFrame(state.play);
  state.play = undefined;
  $('play').textContent = 'Play canvas';
  onionSkin.setPlaying(false);
}

function edit(callback) {
  stop();
  saveUndo();
  transformDraft = adjustmentDraft = undefined;
  callback();
  update();
}

function commitStroke() {
  if (!state.points.length && !pencilStroke?.tip()) return;
  const { width,height } = state.doc, current = activeCel();
  if (rgbaPencil()) {
    try {
      const { slots,palette,alpha,swatchIds,changed } = rgbaStroke(current);
      if (changed) { savePixels(current,slots,palette,alpha,selection,swatchIds); return; }
    } catch (error) { notify(error.message); }
    resetStroke();
    draw();
    return;
  }
  const slots = frameSlots(current);
  if (activeSelection() && stamp.paint(width,height,current).every((slot,p)=>slot === slots[p])) {
    resetStroke();
    draw();
    return;
  }
  savePixels(current,slots);
}

function savePixels(current,slots,palette = state.doc.palette,alpha = current.alpha,nextSelection = selection,
    swatchIds = state.doc.swatchIds,knockouts = current.knockouts?.filter(p=>slots[p] === null),carried) {
  const { rows,strokes,alpha:previousAlpha,knockouts:previousKnockouts,...frame } = current;
  const keepAlpha = alpha?.some((value,p)=>value !== 255 && slots[p] !== null);
  const next = { ...frame,slots,
    ...(keepAlpha && { alpha:alpha.map((value,p)=>slots[p] === null ? 255 : value) }),
    ...(knockouts?.length && { knockouts }) };
  const doc = state.doc, frameBefore = doc.frames[state.frame];
  const frameAfter = state.stack ? { ...frameBefore,cels:{ ...frameBefore.cels,[state.layer]:next } } :
    { ...next,duration:current.duration ?? 1/(doc.fps ?? 12) };
  try {
    layerConflict(slots,alpha,knockouts,state.frame,carried);
    if (carried?.moved.size) {
      const before = protectionRaster(doc,frameBefore,state.stack);
      const after = protectionRaster({ ...doc,palette,swatchIds },frameAfter,state.stack);
      const change = protection.carriedChange(carried,doc.width,before,after);
      if (change) throw new RangeError('Transform would change protected detail '+change.id);
    } else if (state.stack) {
      renderStack(doc,state.stack,frameAfter,palette);
    }
  } catch (error) { resetStroke(); draw(); notify(error.message); return false; }
  edit(() => {
    doc.frames[state.frame] = frameAfter;
    if (carried?.moved.size) doc.protectedDetails = doc.protectedDetails.map(row=>carried.moved.get(row.id) ?? row);
    state.doc.palette = palette;
    state.doc.swatchIds = swatchIds;
    selection = nextSelection;
    resetStroke();
  });
  return true;
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

const shadingControls = new Set(['brush-mode','brush-ramp','brush-ramp-id','brush-ramp-step','brush-alpha']);
function brushShading() {
  const mode = $('brush-mode').value;
  $('brush-ramp-controls').hidden = mode !== 'ramp';
  $('brush-alpha-controls').hidden = mode !== 'alpha';
  const saved = state.doc.ramps?.find(row=>row.id === $('brush-ramp-id').value);
  $('brush-ramp').disabled = $('brush-ramp-add').disabled = !!saved;
  if (mode === 'ramp') return { mode,step:$('brush-ramp-step').valueAsNumber,
    ramp:saved ? saved.swatches.map(id=>state.doc.swatchIds.indexOf(id)) :
      $('brush-ramp').value.split(',').map(n=>n.trim() ? Number(n)-1 : NaN) };
  if (mode === 'alpha') return { mode,value:$('brush-alpha').valueAsNumber };
  if (mode === 'recolor') return { mode };
}

function applyBrush(slots,alpha) {
  const { width,height,palette:swatches } = state.doc;
  let dabs = brushStroke?.dabs ?? new Map();
  if (!brushStroke) brushes.stroke(width,height,brushTip,state.points,(p,slot)=>{ dabs.set(p,slot); },grid);
  const selected = activeSelection()?.mask;
  if (selected) dabs = new Map([...dabs].filter(([p])=>selected[p]));
  const shading = brushShading();
  if (shading) {
    const resolve = brushes.shade(shading,swatches.map((_,slot)=>slot));
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
    return { slots,palette:swatches,alpha:opacity,changed };
  }

  const { palette,mapping } = brushes.resolvePalette(brush,indexedPalette(),
    { limit:colors.limit,used:new Set(dabs.values()),named:true,preserveIds:true });
  let changed = false;
  for (const [p,source] of dabs) {
    const next = mapping[source];
    if (slots[p] === next) continue;
    slots[p] = next;
    changed = true;
  }
  return { slots,palette:palette.map(entry=>entry.color),swatchIds:palette.map(entry=>entry.id),alpha,changed };
}

function commitBrush() {
  const { width,height } = state.doc, current = activeCel();
  try {
    brushStroke?.path.finish();
    const { slots,palette,alpha,swatchIds,changed } = applyBrush(stamp.paint(width,height,current),current.alpha);
    if (changed && !savePixels(current,slots,palette,alpha,selection,swatchIds)) return;
    if (!changed) { resetStroke(); draw(); }
    notify('');
  } catch (error) {
    resetStroke();
    draw();
    notify(error.message);
  }
}

$('capture-brush').addEventListener('click',() => {
  const { width,height } = state.doc, palette = indexedPalette();
  const current = activeCel(), slots = stamp.paint(width,height,current);
  try {
    const pixels = selections.pixels(width,activeSelection().mask);
    setBrush(brushes.capture({ width,height,pixels,
      read(x,y) {
        const p = y*width+x, slot = slots[p];
        return slot === null || current.alpha?.[p] === 0 ? null : palette[slot];
      } }));
    clearSelection();
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
  const selected = activeSelection()?.mask;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || selected && !selected[p] || slots[p] === state.swatch) continue;
    slots[p] = state.swatch;
    changed = true;
  }
  return changed;
}

function finishShape(shape) {
  const { width,height } = state.doc, current = activeCel();
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
  const { width,height } = state.doc, current = activeCel();
  const slots = stamp.paint(width,height,current), p = grid ? grid.primary(at) : at[1]*width+at[0];
  const picked = slots[p];
  if (state.tool === 'eyedropper') {
    if (picked !== null) selectSwatch(picked);
    const opacity = current.alpha?.[p];
    notify(picked === null ? 'Transparent pixel' : 'Sampled '+state.doc.palette[picked]+
      (opacity === undefined ? '' : ' · alpha '+opacity));
    return;
  }
  const selected = activeSelection()?.mask, inside = p => !selected || selected[p];
  if (!grid && (picked === state.swatch || !inside(p))) return;
  const region = grid ? paintTools.fillPixels(grid,at,(p,seed)=>inside(p) && slots[seed] !== state.swatch && slots[p] === slots[seed])
    : paintTools.region(width,height,at,p=>inside(p) && slots[p] === picked);
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

function showCanvasControls() {
  const type = $('canvas-operation').value, size = ['resize','crop','resample'].includes(type);
  const crop = type === 'crop', pad = type === 'pad';
  $('canvas-crop-origin').hidden = $('canvas-fit-selection').hidden = !crop;
  $('canvas-x').disabled = $('canvas-y').disabled = !crop;
  $('canvas-dimensions').hidden = $('canvas-width').disabled = $('canvas-height').disabled = !size;
  $('canvas-anchor-label').hidden = type !== 'resize';
  $('canvas-filter-label').hidden = type !== 'resample';
  $('canvas-margins').hidden = !pad;
  for (const input of $('canvas-margins').querySelectorAll('input')) input.disabled = !pad;
  $('canvas-binding-label').hidden = $('canvas-binding-policy').disabled = !state.doc.sceneBindings?.length;
  $('canvas-apply').textContent = type[0].toUpperCase()+type.slice(1);
}

function canvasOperation() {
  const type = $('canvas-operation').value, number = id => $('canvas-'+id).valueAsNumber;
  const size = [number('width'),number('height')];
  if (type === 'crop') return { type,rect:[number('x'),number('y'),...size] };
  if (type === 'pad') return { type,margins:['left','top','right','bottom'].map(number) };
  if (type === 'resize') return { type,size,anchor:$('canvas-anchor').value };
  if (type === 'resample') return { type,size,filter:$('canvas-filter').value };
  return { type };
}

function transformCanvas(operation,bindingPolicy) {
  const doc = state.doc, trim = canvasTransforms.extent(doc.width,doc.height);
  if (operation.type === 'trim') {
    for (const frame of doc.frames) {
      const layerArt = state.stack && renderStack(doc,state.stack,frame);
      const slots = layerArt ? layerArt.slots : stamp.paint(doc.width,doc.height,frame);
      const alpha = layerArt ? layerArt.opacity : frame.alpha;
      for (let p = 0; p < slots.length; p++)
        if (layerArt?.locks[p] || slots[p] !== null && slots[p] >= 0 && alpha?.[p] !== 0)
          trim.include(p%doc.width,Math.floor(p/doc.width));
    }
    for (const detail of doc.protectedDetails ?? []) for (const [x,y] of detail.pixels) trim.include(x,y);
  }
  const map = canvasTransforms.plan(doc.width,doc.height,operation,trim), [width,height] = map.size;
  if (width*height*doc.frames.length > 2**20) throw new RangeError('Canvas size exceeds the stamp animation budget');
  const changesGrid = width !== doc.width || height !== doc.height || map.offset.some(Boolean);
  if (doc.sceneBindings?.length && !['preserve','reframe'].includes(bindingPolicy))
    throw new TypeError('Choose how the scene bindings map to the new canvas');
  if (!changesGrid && !(bindingPolicy === 'reframe' && doc.sceneBindings?.some(row=>row.canvas))) return;
  const revised = { ...doc,width,height };
  let updatedSelection = selection;
  if (changesGrid) {
    const mapping = protection.remap(map,doc.protectedDetails,canvasTransforms.region);
    function transformCel(cel,sampling) {
      const { rows,strokes,alpha,knockouts,...rest } = cel;
      const output = canvasTransforms.raster(sampling,rasterSlots(doc.width,doc.height,cel),alpha), erased = [];
      for (let p = 0; p < output.slots.length; p++)
        if (output.slots[p] === -2) { output.slots[p] = null; erased.push(p); }
      return { ...rest,...output,...(erased.length && { knockouts:erased }) };
    }
    revised.frames = doc.frames.map((frame,i) => {
      const active = frameProtection(doc,i).filter(row=>row.kind);
      const sampling = active.length ? mapping.forFrame(active,protectionRaster(doc,frame,state.stack)) : map;
      const { selections:saved,guides,cels,...hold } = frame;
      const adjusted = canvasTransforms.guides(map,guides);
      if (adjusted) guideTool.prepare(adjusted);
      const painted = cels ? { ...hold,cels:Object.fromEntries(
        Object.entries(cels).map(([id,cel])=>[id,transformCel(cel,sampling)])) } : transformCel(hold,sampling);
      return { ...painted,...(adjusted && { guides:adjusted }),
        ...(saved && { selections:saved.map(row=>({ ...row,pixels:canvasTransforms.region(map,row.pixels).pixels })) }) };
    });
    if (mapping.rows) revised.protectedDetails = mapping.rows;
    if (doc.directional) revised.directional = directional.remap(doc.directional,map);
    if (doc.sharedSelections) revised.sharedSelections = doc.sharedSelections.map(row=>
      ({ ...row,pixels:canvasTransforms.region(map,row.pixels).pixels }));
    if (doc.guides) revised.guides = guideTool.prepare(canvasTransforms.guides(map,doc.guides));
    if (doc.drawing) {
      revised.drawing = { ...doc.drawing };
      for (const [axis,key] of ['mirrorX','mirrorY'].entries()) {
        if (doc.drawing[key] !== undefined) revised.drawing[key] = limit(
          Math.round(canvasTransforms.coordinate(map,doc.drawing[key],axis)*2)/2,-.5,map.size[axis]-.5);
      }
    }
    if (selection) {
      const mask = Uint8Array.from(map.index,p=>selection.mask[p] ?? 0);
      updatedSelection = { ...selectionFromMask(mask),frame:selection.frame };
    }
  }
  if (doc.sceneBindings?.length) {
    revised.sceneBindings = doc.sceneBindings.map(({ canvas,...binding }) => {
      const next = bindingPolicy === 'preserve' ? canvasTransforms.preserve(map,canvas) : undefined;
      return { ...binding,...(next && { canvas:next }) };
    });
  }
  if (state.stack) validateStackDeck(revised,state.stack);
  else validateProtection(revised);
  edit(() => {
    state.doc = revised;
    selection = updatedSelection;
    $('canvas-x').value = $('canvas-y').value = 0;
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
  if (event.button !== 0 || drawingPointer !== undefined || adjustmentDraft) return;
  if (!layerWritable() && !['brush-select','eyedropper'].includes(state.tool)) {
    notify('Choose an unlocked paint, mask, or surface layer');
    return;
  }
  const central = event.target === art;
  if (transformDraft) {
    if (central) beginTransformDrag(event);
    return;
  }
  if (!central && (!grid || state.tool === 'brush-select' || !event.target.matches('.ink-grid-repeats canvas'))) return;
  const snap = state.tool !== 'eyedropper' && !(state.tool === 'brush-select' && pointSelection(selectionType()));
  const at = central ? view.pixelAt(event.clientX,event.clientY,{ snap }) : strokeAt(event);
  if (!at) return;
  stop();
  if (state.tool === 'brush-select') { beginSelection(event,at); return; }
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
  else state.points = [at];
  draw();
});
art.addEventListener('pointermove',event => {
  if (drawingPointer !== event.pointerId) return;
  if (transformDraft?.drag) { extendTransformDrag(event); return; }
  if (selectionDraft) {
    if (extendSelection(event)) drawSelection();
    return;
  }
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
  if (state.tool === 'shape') state.points[1] = at;
  else state.points.push(at);
  draw();
});
art.addEventListener('pointerup',event => {
  if (drawingPointer !== event.pointerId) return;
  if (pencilStroke) extendPencil(event);
  drawingPointer = undefined;
  if (transformDraft?.drag) {
    extendTransformDrag(event);
    delete transformDraft.drag;
  } else if (selectionDraft) {
    extendSelection(event);
    finishSelection();
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
  resetStroke();
  draw();
});
$('transform-begin').addEventListener('click',()=>startTransform(true));
$('transform-copy').addEventListener('click',copyActiveSelection);
$('transform-paste').addEventListener('click',()=>startTransform(false));
$('transform-fields').addEventListener('input',updateTransform);
$('transform-apply').addEventListener('click',finishTransform);
$('transform-cancel').addEventListener('click',cancelTransform);
const nudges = { ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1] };
art.closest('.ink-grid-viewport').addEventListener('keydown',event => {
  const key = event.key.toLowerCase();
  const clipboardKey = (event.ctrlKey || event.metaKey) && (key === 'c' || key === 'v');
  const nudge = nudges[event.key];
  if (!clipboardKey && !(transformDraft && (nudge || key === 'enter' || key === 'escape'))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (clipboardKey) {
    if (key === 'c') copyActiveSelection();
    else startTransform(false);
  } else if (key === 'enter') finishTransform();
  else if (key === 'escape') cancelTransform();
  else {
    const x = $('transform-x').valueAsNumber, y = $('transform-y').valueAsNumber;
    if (Number.isInteger(x) && Number.isInteger(y)) repositionTransform(x+nudge[0],y+nudge[1]);
  }
},{ capture:true });
$('selection-type').addEventListener('change',() => chooseTool('brush-select'));
$('selection-mode').addEventListener('change',() => {
  if (selectionDraft) { refreshSelection(); drawSelection(); }
});
$('selection-modifiers').addEventListener('click',event => {
  if (event.target.dataset.selectionModifier) modifySelection(event.target.dataset.selectionModifier);
});
$('selection-name').addEventListener('input',drawSelection);
$('selection-saved').addEventListener('change',drawSelection);
$('selection-save').addEventListener('click',saveSelection);
$('selection-recall').addEventListener('click',recallSelection);
$('selection-clear').addEventListener('click',clearSelection);
$('selection-close').addEventListener('click',finishSelection);
$('selection-cancel').addEventListener('click',() => { selectionDraft = undefined; draw(); });
art.addEventListener('dblclick',() => {
  if (state.tool === 'brush-select' && selectionDraft?.type === 'polygon') finishSelection();
});
art.closest('.ink-grid-viewport').addEventListener('keydown',event => {
  if (event.key === 'Enter' && selectionDraft?.type === 'polygon') finishSelection();
  else if (event.key === 'Escape' && selectionDraft) { selectionDraft = undefined; draw(); }
  else if (event.key === 'Escape' && activeSelection()) clearSelection();
});
$('finish-shape').addEventListener('click',() => finishShape(currentShape()));
$('cancel-shape').addEventListener('click',() => { resetStroke(); draw(); });
$('shape-controls').addEventListener('change',event => {
  if (['shape-type','shape-curve'].includes(event.target.id)) resetStroke();
  draw();
});
$('canvas-operation').addEventListener('change',showCanvasControls);
$('canvas-fit-selection').addEventListener('click',() => {
  const active = activeSelection(), { width,height } = state.doc;
  if (!active?.pixelCount) return;
  const bounds = canvasTransforms.extent(width,height);
  for (const [x,y] of selections.pixels(width,active.mask)) bounds.include(x,y);
  const [x,y,w,h] = bounds.rect();
  [$('canvas-x').value,$('canvas-y').value,$('canvas-width').value,$('canvas-height').value] = [x,y,w,h];
});
$('canvas-size').addEventListener('submit',event => {
  event.preventDefault();
  try {
    transformCanvas(canvasOperation(),$('canvas-binding-policy').value);
    notify(`Canvas ${state.doc.width} × ${state.doc.height} px`);
  } catch (error) { notify(error.message); }
});
function chooseTool(tool) {
  state.tool=tool;
  resetStroke();
  document.querySelectorAll('[data-tool]').forEach(button => button.setAttribute('aria-pressed',button.dataset.tool===tool));
  notify('');
  draw();
}
for (const id of ['tools','selection-tools','brush-tools']) $(id).addEventListener('click',event => {
  if (event.target.dataset.tool) chooseTool(event.target.dataset.tool);
});
$('play').addEventListener('click',() => {
  if (state.play !== undefined) { stop(); return; }
  resetStroke();
  const { entries, at } = stamp.prepare(state.doc), start=performance.now();
  const elapsed=entries.slice(0,state.frame).reduce((sum, entry)=>sum+entry.duration,0);
  const stopAt=entries.reduce((sum, entry)=>sum+entry.duration,0);
  $('play').textContent='Pause canvas';
  onionSkin.setPlaying(true);
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
$('scrub').addEventListener('input',()=>{
  const preview = adjustmentDraft?.scope === 'range' ? adjustmentDraft : undefined;
  stop();
  state.frame = Number($('scrub').value)-1;
  resetStroke();
  adjustmentDraft = preview;
  draw();
});
$('duration').addEventListener('change',()=>edit(()=>{
  state.doc.frames[state.frame].duration=limit(Number($('duration').value) || .01,.01,60);
}));
$('playback').addEventListener('change',()=>edit(()=>{state.doc.playback=$('playback').value;}));

function showTagFields() {
  const { frames,tags = [] } = state.doc, choice = tags.find(tag=>tag.id === $('tag-select').value);
  $('tag-id').value = choice?.id ?? '';
  $('tag-id').readOnly = !!choice;
  $('tag-label').value = choice?.label ?? '';
  $('tag-start').value = choice ? frames.findIndex(frame=>frame.id === choice.start) : state.frame;
  $('tag-end').value = choice ? frames.findIndex(frame=>frame.id === choice.end) : state.frame;
  $('tag-direction').value = choice?.direction ?? 'forward';
  $('tag-loop').checked = choice?.loop ?? true;
  $('tag-remove').disabled = !choice;
}

function updateTagForm() {
  const { frames,tags = [] } = state.doc;
  const key = JSON.stringify([frames.map(({ id,label })=>[id,label]),tags]);
  if (key === tagFormKey && tagFormDoc === state.doc) return;
  tagFormKey = key;
  tagFormDoc = state.doc;
  const menu = $('tag-select'), current = menu.value;
  menu.replaceChildren(new Option('New tag',''),...tags.map(tag=>new Option(tag.label ?? tag.id,tag.id)));
  if (tags.some(tag=>tag.id === current)) menu.value = current;
  for (const endpoint of ['tag-start','tag-end'])
    $(endpoint).replaceChildren(...frames.map(({ id,label },i)=>new Option((i+1)+' · '+(label ?? id ?? 'Frame'),i)));
  showTagFields();
}

$('tag-select').addEventListener('change',showTagFields);
$('tag-form').addEventListener('submit',event=>{
  event.preventDefault();
  const doc = state.doc, tags = new Map((doc.tags ?? []).map(tag=>[tag.id,tag]));
  const id = $('tag-id').value.trim(), label = $('tag-label').value.trim();
  if (!$('tag-select').value && tags.has(id)) { notify('Choose the existing tag before editing it'); return; }
  const frames = doc.frames.slice(), used = new Set(frameIds(doc));
  function endpoint(index) {
    const frame = frames[index];
    if (frame.id !== undefined) return frame.id;
    const id = colors.uniqueId(used,'frame-'+(index+1));
    used.add(id);
    frames[index] = { ...frame,id };
    return id;
  }
  try {
    tags.set(id,{ id,...(label && { label }),start:endpoint(Number($('tag-start').value)),end:endpoint(Number($('tag-end').value)),
      direction:$('tag-direction').value,loop:$('tag-loop').checked });
    const revised = [...tags.values()];
    ranges.resolve(frames,revised);
    edit(()=>{ doc.frames = frames; doc.tags = revised; });
    $('tag-select').value = id;
    showTagFields();
    notify('Saved playback tag '+id);
  } catch (error) { notify(error.message); }
});
$('tag-remove').addEventListener('click',()=>{
  const id = $('tag-select').value;
  if (!id) return;
  edit(()=>{ state.doc.tags = state.doc.tags.filter(tag=>tag.id !== id); });
  notify('Removed playback tag '+id);
});
$('duplicate').addEventListener('click',()=>edit(()=>{
  const copy=structuredClone(state.doc.frames[state.frame]);
  delete copy.id;
  if (state.doc.tilemap) copy.id = colors.uniqueId(new Set(frameIds(state.doc)),'tile-'+(state.doc.frames.length+1));
  if (state.stack) for (const cel of Object.values(copy.cels)) delete cel.id;
  state.doc.frames.splice(++state.frame,0,copy);
  if (selection?.frame >= state.frame) selection = { ...selection,frame:selection.frame+1 };
  resetStroke();
}));
$('remove').addEventListener('click',()=>edit(()=>{
  state.doc.frames.splice(state.frame,1);
  if (selection?.frame === state.frame) selection = undefined;
  else if (selection?.frame > state.frame) selection = { ...selection,frame:selection.frame-1 };
  resetStroke();
  state.frame=Math.min(state.frame,state.doc.frames.length-1);
}));
$('undo').addEventListener('click',()=>{
  stop();
  const snapshot=state.undo.pop();
  if (snapshot.data) state.doc=snapshot.data;
  state.frame=snapshot.frame;
  state.layer=snapshot.layer;
  state.swatch = Math.max(0,state.doc.swatchIds.indexOf(snapshot.swatch));
  selection = snapshot.selection;
  resetStroke();
  update();
  showPaletteRamp();
});
$('pencil-color-mode').addEventListener('change',()=>{
  $('pencil-rgb').value = state.doc.palette[state.swatch];
  draw();
});
function validateStackDeck(doc,stack = layerStack.prepare(doc.layers)) {
  workshopRules(doc);
  const { width,height,frames,sceneBindings = [],destinations = [] } = doc;
  const cells = frames.reduce((n,frame)=>n+Object.keys(frame.cels).length,0);
  if (width*height*Math.max(cells,doc.layers.length) > 4_000_000)
    throw new RangeError('Layer deck exceeds the native pixel budget');
  for (const binding of sceneBindings) if (binding.layer !== undefined && !stack.rows.has(binding.layer))
    throw new RangeError('Scene binding '+binding.id+' needs its layer');
  for (const row of stack.rows.values()) if (row.kind === 'surface') {
    const target = destinations.find(entry=>entry.id === row.destination && entry.kind === 'surface-channel');
    const binding = target && sceneBindings.find(entry=>entry.id === target.binding);
    if (!binding || binding.layer !== undefined && binding.layer !== row.id)
      throw new RangeError('Surface layer '+row.id+' needs a matching destination');
  }
  const frameIds = new Set(frames.flatMap(frame=>frame.id === undefined ? [] : [frame.id]));
  if (frameIds.size !== frames.filter(frame=>frame.id !== undefined).length)
    throw new RangeError('Layer deck frame IDs must be unique');
  Tilemap.prepare(doc.tilemap,frameIds,width,height);
  validateSavedMasks(width,height,doc.sharedSelections);
  const details = doc.protectedDetails ?? [];
  const ids = frames.map(frame=>frame.id);
  protection.validate(details,width,height,ids);
  for (let i = 0; i < frames.length; i++) {
    const raster = protectionRaster(doc,frames[i],stack);
    protection.paintLocks(protection.active(details,ids,i),width,raster);
  }
  return stack;
}

function protectionRaster(doc,frame,stack) {
  const { width,height,swatchIds } = doc;
  const raster = stack ? renderStack(doc,stack,frame) : { slots:rasterSlots(width,height,frame),
    opacity:frame.alpha,locks:new Uint8Array(width*height) };
  return { ...raster,swatches:swatchIds,colors:raster.packed ?? doc.palette.map(row=>Number.parseInt(row.slice(1),16)) };
}

function validateProtection(doc,stack) {
  const ids = frameIds(doc);
  protection.validate(doc.protectedDetails,doc.width,doc.height,ids);
  if (!doc.protectedDetails?.some(row=>row.kind === 'gap')) return;
  for (let i = 0; i < doc.frames.length; i++) {
    const gaps = protection.active(doc.protectedDetails,ids,i).filter(row=>row.kind === 'gap');
    if (gaps.length) protection.paintLocks(gaps,doc.width,protectionRaster(doc,doc.frames[i],stack));
  }
}

function assertProtectionUnchanged(doc,next,stack) {
  if (!doc.protectedDetails?.length) return;
  for (let i = 0; i < doc.frames.length; i++) {
    const active = frameProtection(doc,i);
    if (!active.length) continue;
    const change = protection.changed(active,doc.width,protectionRaster(doc,doc.frames[i],state.stack),
      protectionRaster(next,next.frames[i],stack));
    if (change) throw new RangeError('Edit would change protected detail '+change.id+' at '+change.at.join(', '));
  }
}

function updateLayers() {
  state.stack = state.doc.layers && layerStack.prepare(state.doc.layers);
  const rows = state.stack ? [...state.stack.rows.values()] : [];
  if (!state.stack?.rows.has(state.layer)) state.layer = rows.at(-1)?.id;
  const choices = rows.map(row=>new Option((row.parent ? row.parent+' / ' : '')+(row.label ?? row.id)+' · '+row.kind,row.id));
  const active = $('layer-active');
  active.replaceChildren(...(choices.length ? choices : [new Option('Paint','')]));
  active.value = state.layer ?? '';
  const targets = state.doc.destinations?.filter(row=>row.kind === 'surface-channel') ?? [];
  const destination = $('layer-destination'), selected = destination.value;
  destination.replaceChildren(...targets.map(row=>new Option(row.id,row.id)));
  if (targets.some(row=>row.id === selected)) destination.value = selected;
  showLayerProperties();
}

function showLayerProperties() {
  const row = state.stack?.rows.get(state.layer);
  $('layer-destination-label').hidden = $('layer-kind').value !== 'surface';
  $('layer-properties').hidden = !row;
  if (!row) return;
  $('layer-name').value = row.label ?? '';
  $('layer-visible').checked = row.visible !== false;
  $('layer-lock').checked = row.locked === true;
  $('layer-opacity').value = row.opacity ?? 1;
  $('layer-blend').value = row.blend ?? 'normal';
  const siblings = state.stack.children.get(row.parent), i = siblings.indexOf(row);
  const below = siblings.slice(0,i).filter(value=>value.kind !== 'reference' || row.kind === 'reference');
  const groups = [...state.stack.rows.values()].filter(value=>value.kind === 'group' && value.index < row.index);
  $('layer-parent').replaceChildren(new Option('Root',''),...groups.map(value=>new Option(value.label ?? value.id,value.id)));
  $('layer-parent').value = row.parent ?? '';
  $('layer-clip').replaceChildren(new Option('None',''),...below.map(value=>new Option(value.label ?? value.id,value.id)));
  $('layer-clip').value = row.clip ?? '';
  $('layer-lower').disabled = i === 0;
  $('layer-raise').disabled = i === siblings.length-1;
  $('layer-merge').textContent = row.kind === 'group' ? 'Flatten group' : 'Merge down';
  $('layer-merge').disabled = row.effectiveLock || !(row.kind === 'group' ?
    state.stack.children.get(row.id).length : row.kind === 'paint' && siblings[i-1]?.kind === 'paint');
  $('layer-remove').disabled = row.effectiveLock || state.stack.rows.size < 2;
  $('layer-reference-label').hidden = row.kind !== 'reference' || row.effectiveLock;
  $('layer-bound-path').hidden = row.kind !== 'surface';
  $('layer-bound-path').value = row.kind === 'surface' ? 'Surface destination layer:'+row.id : '';
}

function commitStack(doc,active = state.layer) {
  const stack = layerStack.prepare(doc.layers);
  assertProtectionUnchanged(state.doc,doc,stack);
  validateStackDeck(doc,stack);
  edit(()=>{
    state.doc = doc;
    state.layer = active;
    resetStroke();
  });
  notify('');
}

$('layer-kind').addEventListener('change',showLayerProperties);
$('layer-active').addEventListener('change',()=>{
  state.layer = $('layer-active').value;
  resetStroke();
  showLayerProperties();
  draw();
});
for (const id of ['layer-view','layer-references']) $(id).addEventListener('change',draw);
$('layer-add').addEventListener('click',()=>{
  const doc = state.doc, kind = $('layer-kind').value;
  const next = $('layer-id').value.trim() || colors.uniqueId(new Set(doc.layers?.map(row=>row.id) ?? ['paint']),kind);
  const existing = doc.layers ?? [{ id:'paint',kind:'paint' }];
  const destination = kind === 'surface' ? $('layer-destination').value : undefined;
  const frames = doc.layers ? doc.frames : doc.frames.map(({ slots,rows,strokes,alpha,knockouts,...frame })=>({
    ...frame,cels:{ paint:{ slots,rows,strokes,alpha,knockouts } }
  }));
  const layers = [...existing,{ id:next,kind,...(destination !== undefined && { destination }) }];
  try { commitStack({ ...doc,format:stackFormat,version:1,layers,frames },next); }
  catch (error) { notify(error.message); }
});
const layerProperties = {
  'layer-name': ['label',input=>input.value.trim() || undefined],
  'layer-parent':['parent',input=>input.value || undefined],
  'layer-clip':['clip',input=>input.value || undefined],
  'layer-visible':['visible',input=>input.checked],
  'layer-lock':['locked',input=>input.checked],
  'layer-opacity':['opacity',input=>input.valueAsNumber],
  'layer-blend':['blend',input=>input.value]
};
$('layer-properties').addEventListener('change',event=>{
  const setting = layerProperties[event.target.id];
  if (!setting) return;
  const [key,read] = setting, doc = state.doc;
  const layers = doc.layers.map(row=>{
    if (row.id !== state.layer) return row;
    const next = { ...row,[key]:read(event.target) };
    if (next[key] === undefined) delete next[key];
    if (key === 'parent') delete next.clip;
    return next;
  });
  try { commitStack({ ...doc,layers }); }
  catch (error) { showLayerProperties(); notify(error.message); }
});
for (const [id,step] of [['layer-lower',-1],['layer-raise',1]]) $(id).addEventListener('click',()=>{
  const doc = state.doc, stack = layerStack.prepare(doc.layers), row = stack.rows.get(state.layer);
  const siblings = stack.children.get(row.parent), i = siblings.indexOf(row), swap = i+step;
  [siblings[i],siblings[swap]] = [siblings[swap],siblings[i]];
  const defs = new Map(doc.layers.map(layer=>[layer.id,layer]));
  const order = parent=>stack.children.get(parent)?.flatMap(layer=>[defs.get(layer.id),...order(layer.id)]) ?? [];
  const layers = order(undefined);
  try { commitStack({ ...doc,layers }); }
  catch (error) { updateLayers(); notify(error.message); }
});
$('layer-remove').addEventListener('click',()=>{
  const doc = state.doc, removed = new Set(layerStack.descendants(state.stack,state.layer));
  try {
    for (const id of removed) if (state.stack.rows.get(id).effectiveLock) throw new RangeError('Layer '+id+' is locked');
    const frames = doc.frames.map(frame=>({ ...frame,cels:Object.fromEntries(Object.entries(frame.cels)
      .filter(([id])=>!removed.has(id))) }));
    commitStack({ ...doc,layers:doc.layers.filter(row=>!removed.has(row.id)),frames });
  } catch (error) { notify(error.message); }
});
$('layer-merge').addEventListener('click',()=>{
  const doc = state.doc, layer = state.layer, row = state.stack.rows.get(layer);
  try {
    const plan = layerStack.mergePlan(doc.layers,{ type:row.kind === 'group' ? 'flatten-group' : 'merge-down',layer });
    const editor = colors.paletteEditor(indexedPalette()), inputStack = layerStack.prepare(plan.inputs);
    const discard = new Set([...plan.removed,plan.target]);
    const frames = doc.frames.map(frame=>{
      const raster = renderStack(doc,inputStack,frame);
      const baked = layerStack.bake(raster,raster.packed,editor.resolve,plan.knockouts);
      const { id,label } = frame.cels[plan.target] ?? {};
      const cels = Object.fromEntries(Object.entries(frame.cels).filter(([id])=>!discard.has(id)));
      cels[plan.target] = { ...(id && { id }),...(label && { label }),...baked };
      return { ...frame,cels };
    });
    const next = { ...doc,layers:plan.layers,frames,palette:editor.palette.map(row=>row.color),
      swatchIds:editor.palette.map(row=>row.id) }, nextStack = layerStack.prepare(plan.layers);
    for (let i = 0; i < frames.length; i++) {
      const before = renderStack(doc,state.stack,doc.frames[i]), after = renderStack(next,nextStack,frames[i]);
      const rgba = layerStack.image(after,after.packed).rgba;
      if (!layerStack.image(before,before.packed).rgba.every((n,p)=>n === rgba[p]))
        throw new RangeError('Merge would change the rendered pixels in frame '+(i+1));
    }
    commitStack(next,plan.target);
  } catch (error) { notify(error.message); }
});
$('layer-reference').addEventListener('change',async event=>{
  const [file] = event.target.files, doc = state.doc, frame = state.frame, layer = state.layer;
  if (!file) return;
  try {
    const { width,height,palette,slots,alpha,knockouts } = await openPNG(file);
    if (doc !== state.doc || frame !== state.frame || layer !== state.layer)
      throw new Error('The layer selection changed while opening the PNG');
    if (width !== doc.width || height !== doc.height) throw new RangeError('Reference PNG must match the native canvas size');
    const row = state.stack.rows.get(layer);
    if (row.kind !== 'reference' || row.effectiveLock) throw new RangeError('Choose an unlocked reference layer');
    const editor = colors.paletteEditor(indexedPalette()), mapping = palette.map(rgb=>editor.resolve(rgb));
    const cels = { ...doc.frames[frame].cels,[layer]:{ ...doc.frames[frame].cels[layer],slots:slots.map(slot=>slot === null ? null : mapping[slot]),
      alpha,knockouts } };
    const frames = doc.frames.map((row,i)=>i === frame ? { ...row,cels } : row);
    commitStack({ ...doc,frames,palette:editor.palette.map(row=>row.color),swatchIds:editor.palette.map(row=>row.id) });
    notify('Loaded reference '+file.name);
  } catch (error) { notify(error.message); }
  finally { event.target.value = ''; }
});

function showAdjustmentControls() {
  const type = $('adjustment-type').value;
  for (const field of $('adjustment-settings').querySelectorAll('[data-adjustment]'))
    field.hidden = !field.dataset.adjustment.split(' ').includes(type);
  $('adjustment-range').hidden = $('adjustment-scope').value !== 'range';
  const labels = { gradient:['Start swatch','End swatch'],replace:['Source swatch','Target swatch'],
    dither:['Dark swatch','Light swatch'],outline:['Outline swatch',''] };
  const [first,second] = labels[type] ?? ['', ''];
  $('adjustment-first-label').textContent = first;
  $('adjustment-second-label').textContent = second;
}

function updateAdjustmentSwatches() {
  for (const [id,slot] of [['adjustment-first',0],['adjustment-second',1]]) {
    const select = $(id), previous = select.value;
    select.replaceChildren(...state.doc.swatchIds.map(key=>new Option(swatchTitle(key),key)));
    select.value = state.doc.swatchIds.includes(previous) ? previous : state.doc.swatchIds[slot] ?? state.doc.swatchIds[0];
  }
  showAdjustmentControls();
}

function showAdjustmentPreview() {
  $('adjustment-start').max = $('adjustment-end').max = state.doc.frames.length;
  $('adjustment-preview').disabled = !layerWritable() || drawingPointer !== undefined || !!transformDraft || !!selectionDraft;
  const draft = adjustmentDraft?.scope === 'cleanup' ? undefined : adjustmentDraft;
  $('adjustment-apply').disabled = !draft?.pixelCount;
  $('adjustment-cancel').disabled = !draft;
  const { pixelCount,frames } = draft ?? {};
  $('adjustment-info').value = draft
    ? `${pixelCount} ${pixelCount === 1 ? 'pixel' : 'pixels'} changed in ${frames.size} ${frames.size === 1 ? 'frame' : 'frames'}` : '';
}

function showCleanupPreview() {
  const kind = $('cleanup-kind').value;
  $('cleanup-mode-label').hidden = kind !== 'cluster';
  $('cleanup-swatch-label').hidden = kind !== 'fragment';
  const plan = adjustmentDraft?.cleanup;
  $('cleanup-apply').disabled = $('cleanup-cancel').disabled = !plan;
  $('cleanup-info').value = plan ? plan.changes.length+' of '+plan.maxChanges+' pixels' : '';
  const region = $('cleanup-diff');
  region.hidden = !plan;
  if (plan === shownCleanup) return;
  shownCleanup = plan;
  const label = pixel=>pixel.rgba ? pixel.swatch+' · #'+pixel.rgba.slice(0,3)
    .map(byte=>byte.toString(16).padStart(2,'0')).join('')+' · α '+pixel.rgba[3] : pixel.state;
  const rows = (plan?.changes ?? []).map(change=>{
    const row = document.createElement('tr');
    for (const value of [change.at.join(', '),label(change.before),label(change.after)])
      row.insertCell().textContent = value;
    return row;
  });
  region.querySelector('tbody').replaceChildren(...rows);
}

function previewCleanup() {
  const selected = activeSelection();
  if (!selected?.pixelCount || !layerWritable() || drawingPointer !== undefined || transformDraft || selectionDraft) return;
  stop();
  resetStroke();
  try {
    const doc = state.doc, current = activeCel(), { width,height } = doc;
    const { slots,opacity,colors,locks } = craftFrame(doc,state.frame,state.layer);
    const kind = $('cleanup-kind').value, swatch = $('cleanup-swatch').value;
    const plan = cleanup.plan({ width,height,slots,alpha:opacity,colors,locks,swatches:doc.swatchIds },selected.mask,{
      kind,maxChanges:$('cleanup-budget').valueAsNumber,
      ...(kind === 'cluster' && { mode:$('cleanup-mode').value }),
      ...(kind === 'fragment' && swatch && { swatch })
    });
    if (!plan.changes.length) notify('No pixels to change');
    else {
      const next = slots.map(slot=>slot < 0 ? null : slot);
      const alpha = current.alpha?.slice() ?? Array(next.length).fill(255);
      for (const [p,pixel] of plan.writes) {
        next[p] = pixel.slot < 0 ? null : pixel.slot;
        alpha[p] = pixel.alpha;
      }
      layerConflict(next,alpha,current.knockouts);
      adjustmentDraft = { scope:'cleanup',cleanup:plan,pixelCount:plan.changes.length,
        frames:new Map([[state.frame,{ slots:next,alpha,knockouts:current.knockouts }]]),
        palette:doc.palette,swatchIds:doc.swatchIds };
      notify('');
    }
  } catch (error) { notify(error.message); }
  draw();
}

$('cleanup-settings').addEventListener('change',()=>{
  if (adjustmentDraft?.cleanup) previewCleanup();
  else showCleanupPreview();
});
$('cleanup-preview').addEventListener('click',previewCleanup);
$('cleanup-apply').addEventListener('click',()=>{
  if (!adjustmentDraft?.cleanup) return;
  const { slots,alpha } = adjustmentDraft.frames.get(state.frame);
  if (savePixels(activeCel(),slots,state.doc.palette,alpha)) notify('Applied cleanup');
});
$('cleanup-cancel').addEventListener('click',()=>{
  if (!adjustmentDraft?.cleanup) return;
  adjustmentDraft = undefined;
  draw();
});

function readAdjustment() {
  const type = $('adjustment-type').value, match = $('adjustment-match').value;
  const value = id=>$('adjustment-'+id).value;
  const number = id=>$('adjustment-'+id).valueAsNumber;
  const first = value('first'), second = value('second');
  if (type === 'curves') {
    const curve = { stops:JSON.parse(value('curve')) }, channel = value('channel');
    return { type,match,...(channel === 'rgb' ? { curve } : { channels:{ [channel]:curve } }) };
  }
  if (type === 'hue-saturation') return { type,match,degrees:number('degrees'),saturation:number('saturation') };
  if (type === 'gradient') return { type,match,axis:value('axis'),stops:[[0,first],[1,second]] };
  if (type === 'replace') return { type,map:{ [first]:second } };
  if (type === 'dither') return { type,dark:first,light:second,pattern:value('pattern') };
  return { type,swatch:first,radius:number('radius'),side:value('side') };
}

function previewAdjustment() {
  stop();
  resetStroke();
  try {
    const scope = $('adjustment-scope').value, doc = state.doc, { width,height } = doc;
    const active = activeSelection();
    if (scope === 'selection' && !active?.pixelCount) throw new Error('Select pixels before previewing this adjustment');
    const first = scope === 'range' ? $('adjustment-start').valueAsNumber-1 : state.frame;
    const last = scope === 'range'
      ? ($('adjustment-end').value ? $('adjustment-end').valueAsNumber : doc.frames.length)-1 : first;
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || first > last || last >= doc.frames.length)
      throw new RangeError('Choose a frame range in order within the animation');
    const editor = colors.paletteEditor(indexedPalette()), prepared = adjustments.prepare(readAdjustment(),editor);
    const frames = new Map();
    let pixelCount = 0;
    for (let index = first; index <= last; index++) {
      const current = activeCel(index), { rows,strokes,alpha:beforeAlpha,...rest } = current;
      const source = { slots:rasterSlots(width,height,current),alpha:beforeAlpha };
      const writes = prepared.apply(width,height,source,scope === 'selection' ? active.mask : undefined);
      if (!writes.size) continue;
      const slots = source.slots.map(slot=>slot === -2 ? null : slot), alpha = beforeAlpha?.slice() ?? Array(slots.length).fill(255);
      for (const [p,pixel] of writes) {
        slots[p] = pixel.slot;
        alpha[p] = pixel.alpha;
      }
      layerConflict(slots,alpha,current.knockouts,index);
      frames.set(index,{ ...rest,slots,...(alpha.some((value,p)=>slots[p] !== null && value !== 255) && { alpha }) });
      pixelCount += writes.size;
    }
    adjustmentDraft = { scope,frames,pixelCount,palette:editor.palette.map(row=>row.color),
      swatchIds:editor.palette.map(row=>row.id) };
    notify('');
  } catch (error) { notify(error.message); }
  draw();
}

$('adjustment-settings').addEventListener('change',()=>{
  showAdjustmentControls();
  if (adjustmentDraft) previewAdjustment();
});
$('adjustment-preview').addEventListener('click',previewAdjustment);
$('adjustment-apply').addEventListener('click',()=>{
  const draft = adjustmentDraft;
  if (!draft?.pixelCount || draft.scope === 'cleanup') return;
  const doc = state.doc, frames = doc.frames.map((frame,i)=>{
    const cel = draft.frames.get(i);
    if (!cel) return frame;
    return state.stack ? { ...frame,cels:{ ...frame.cels,[state.layer]:cel } } : cel;
  });
  const next = { ...doc,frames,palette:draft.palette,swatchIds:draft.swatchIds };
  try {
    if (state.stack) validateStackDeck(next,state.stack);
    edit(()=>{ state.doc = next; resetStroke(); });
    notify('Applied adjustment');
  } catch (error) { notify(error.message); }
});
$('adjustment-cancel').addEventListener('click',()=>{
  adjustmentDraft = undefined;
  draw();
});
function swatchTitle(id) {
  const names = state.doc.swatchLabels;
  const label = names && Object.hasOwn(names,id) ? names[id] : undefined;
  return label ? label+' · '+id : id;
}

function updateRampChoices() {
  for (const [id,empty] of [['palette-ramp-select','New ramp'],['brush-ramp-id','Manual slots']]) {
    const select = $(id), previous = select.value, ramps = state.doc.ramps ?? [];
    select.replaceChildren(new Option(empty,''),...ramps.map(ramp=>new Option(ramp.label ?? ramp.id,ramp.id)));
    if (ramps.some(ramp=>ramp.id === previous)) select.value = previous;
  }
  brushShading();
}

function showPaletteRamp() {
  const ramp = state.doc.ramps?.find(row=>row.id === $('palette-ramp-select').value);
  $('palette-ramp-id').value = ramp?.id ?? '';
  $('palette-ramp-id').readOnly = !!ramp;
  $('palette-ramp-name').value = ramp?.label ?? '';
  $('palette-ramp-order').value = ramp?.swatches.join(', ') ?? '';
  $('palette-ramp-remove').disabled = !ramp;
}

function paletteEdit(operation,selected) {
  const doc = state.doc, active = doc.swatchIds[state.swatch];
  const { palette,replacements } = palettes.edit(palettes.fromStamp(doc),operation);
  const swatchIds = palette.swatches.map(row=>row.id), positions = new Map(swatchIds.map((id,i)=>[id,i]));
  const reindex = doc.swatchIds.map(id=>positions.get(replacements?.get(id) ?? id));
  const slots = values=>values.map(slot=>slot === null ? null : reindex[slot]);
  function updateIndices(cel,id) {
    const { rows,...rest } = cel, base = rows ? stamp.paint(doc.width,doc.height,{ rows }) : cel.slots;
    const row = state.stack?.rows.get(id);
    if (replacements && row && (row.effectiveLock || row.kind === 'reference')) {
      const changes = slot=>slot !== null && replacements.has(doc.swatchIds[slot]);
      if (base?.some(changes) || cel.strokes?.some(mark=>changes(mark.slot)))
        throw new RangeError('Layer '+id+' does not accept pixel edits');
    }
    return { ...rest,...(base && { slots:slots(base) }),
      ...(cel.strokes && { strokes:cel.strokes.map(mark=>({ ...mark,slot:mark.slot === null ? null : reindex[mark.slot] })) }) };
  }
  const frames = !replacements && reindex.every((slot,i)=>slot === i) ? doc.frames : doc.frames.map(frame=>
    state.stack ? { ...frame,cels:Object.fromEntries(Object.entries(frame.cels).map(([id,cel])=>[id,updateIndices(cel,id)])) } :
      updateIndices(frame));
  const { swatchLabels,lockedSwatches,ramps,...base } = doc;
  const roles = doc.swatchRoles && swatchIds.map(id=>doc.swatchRoles[doc.swatchIds.indexOf(id)] ?? null);
  const next = { ...base,frames,palette:palette.swatches.map(row=>row.color),swatchIds,
    ...palettes.stampMetadata(palette),...(roles && { swatchRoles:roles }) };
  directional.prepare(next.directional,new Set(next.frames.map(frame=>frame.id)),new Set(next.swatchIds));
  assertProtectionUnchanged(doc,next,state.stack);
  if (state.stack) validateStackDeck(next,state.stack);
  else workshopRules(next);
  edit(()=>{
    state.doc = next;
    state.swatch = positions.get(selected ?? active) ?? positions.get(replacements?.get(active)) ?? 0;
    resetStroke();
  });
}

function commitPalette(operation,selected) {
  try {
    paletteEdit(operation,selected);
    notify('');
    return true;
  } catch (error) {
    selectSwatch(state.swatch);
    notify(error.message);
    return false;
  }
}

function changeSwatch(change) {
  commitPalette({ type:'swatch',swatch:{ id:state.doc.swatchIds[state.swatch],...change } });
}
$('color').addEventListener('change',()=>changeSwatch({ color:$('color').value }));
$('swatch-name').addEventListener('change',()=>changeSwatch({ label:$('swatch-name').value.trim() || null }));
$('swatch-lock').addEventListener('change',()=>changeSwatch({ locked:$('swatch-lock').checked }));
$('add-color').addEventListener('click',()=>{
  const id = colors.uniqueId(new Set(state.doc.swatchIds),'slot-'+state.doc.palette.length);
  commitPalette({ type:'swatch',swatch:{ id,color:'#ffffff' } },id);
});
for (const [button,step] of [['swatch-earlier',-1],['swatch-later',1]]) $(button).addEventListener('click',()=>{
  const order = state.doc.swatchIds.slice(), p = state.swatch, q = p+step;
  [order[p],order[q]] = [order[q],order[p]];
  commitPalette({ type:'reorder',order });
});
$('swatch-replace').addEventListener('click',()=>{
  const active = activeSelection();
  const { width,height,swatchIds } = state.doc, current = activeCel();
  const to = swatchIds.indexOf($('swatch-replace-target').value);
  if (!active?.pixelCount || to < 0 || to === state.swatch) return;
  const slots = stamp.paint(width,height,current);
  let changed = 0;
  for (let p = 0; p < slots.length; p++) {
    if (!active.mask[p] || slots[p] !== state.swatch) continue;
    slots[p] = to;
    changed++;
  }
  if (changed && !savePixels(current,slots)) return;
  notify(changed ? `Replaced ${changed} selected pixels` : 'No selected pixels use the active swatch');
});
$('swatch-remap').addEventListener('click',()=>{
  const { swatchIds } = state.doc, from = swatchIds[state.swatch], to = $('swatch-remap-target').value;
  const operation = $('swatch-remap-remove').checked
    ? { type:'remap',map:{ [from]:to },removeSources:true }
    : { type:'remap-indices',map:{ [state.swatch]:swatchIds.indexOf(to) } };
  if (commitPalette(operation,to)) showPaletteRamp();
});
$('palette-ramp-select').addEventListener('change',showPaletteRamp);
const rampOrder = ()=>$('palette-ramp-order').value.split(',').map(id=>id.trim()).filter(Boolean);
$('palette-ramp-add').addEventListener('click',()=>{
  const next = [...new Set([...rampOrder(),state.doc.swatchIds[state.swatch]])];
  $('palette-ramp-order').value = next.join(', ');
});
$('palette-ramp-form').addEventListener('submit',event=>{
  event.preventDefault();
  const id = $('palette-ramp-id').value, label = $('palette-ramp-name').value.trim();
  if (!$('palette-ramp-select').value && state.doc.ramps?.some(ramp=>ramp.id === id)) {
    notify('Choose the existing ramp before editing it');
    return;
  }
  if (commitPalette({ type:'ramp',ramp:{ id,...(label && { label }),swatches:rampOrder() } })) {
    $('palette-ramp-select').value = id;
    showPaletteRamp();
  }
});
$('palette-ramp-remove').addEventListener('click',()=>{
  if (commitPalette({ type:'remove-ramp',id:$('palette-ramp-select').value })) showPaletteRamp();
});
function extractPalette(image) {
  const options = { size:$('palette-extract-size').valueAsNumber,alpha:$('palette-extract-alpha').value };
  paletteEdit({ type:'import',palette:palettes.fromExtraction(KIT.palette.extract(image,options)) });
  notify('Extracted palette');
}
$('palette-extract-frame').addEventListener('click',()=>{
  try {
    const { width,height,palette,frames } = state.doc;
    if (state.stack) {
      const raster = renderStack(state.doc,state.stack,frames[state.frame]);
      extractPalette(layerStack.image(raster,raster.packed));
    } else {
      const { rows,slots,strokes,alpha } = frames[state.frame];
      extractPalette(stamp.image({ width,height,palette,rows,slots,strokes,alpha },{ preserveHidden:true }));
    }
  } catch (error) { notify(error.message); }
});
for (const [input,extract] of [['palette-import',false],['palette-extract-png',true]]) $(input).addEventListener('change',async event=>{
  const [file] = event.target.files, doc = state.doc;
  if (!file) return;
  try {
    const source = extract ? await readPNG(file,true) : JSON.parse(await file.text());
    if (state.doc !== doc) throw new Error('The stamp changed while opening the palette');
    if (extract) extractPalette(source);
    else if (commitPalette({ type:'import',palette:source })) notify('Imported '+file.name);
  } catch (error) { notify(error.message); }
  finally { event.target.value = ''; }
});
$('palette-export').addEventListener('click',()=>saveJson('palette.json',palettes.fromStamp(state.doc)));

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
  try {
    load(/\.png$/i.test(file.name) || file.type === 'image/png' ? await openPNG(file) : JSON.parse(await file.text()));
    notify(`Opened ${file.name}`);
  }
  catch (error) { notify(error.message); }
  finally { event.target.value=''; }
});
function download(filename,blob) {
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download=filename;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify(`Saved ${link.download}`);
}
function saveJson(filename,data) {
  download(filename,new Blob([JSON.stringify(data,null,2)],{ type:'application/json' }));
}

function workshopTileArt(frame) {
  const doc = state.doc, layers = Object.entries(frame.cels).map(([id,cel])=>{
    const [x,y] = state.stack.rows.get(id).offset ?? [0,0], [dx,dy] = cel.offset ?? [0,0];
    return [id,{ slots:rasterSlots(doc.width,doc.height,cel),alpha:cel.alpha,offset:[x+dx,y+dy] }];
  });
  const details = frameProtection(doc,doc.frames.indexOf(frame));
  return { layers:new Map(layers),protection:Tilemap.protectionKey(details) };
}

function occupiedTile(doc,at) {
  const grid = Tilemap.prepare(doc.tilemap,new Set(frameIds(doc)),doc.width,doc.height);
  const id = Tilemap.pick(grid,at);
  if (!id) throw new RangeError('Pick an occupied tilemap cell');
  return doc.frames.find(frame=>frame.id === id);
}

const tilePanel = mountTilemap(document.querySelector('main'),{
  Tilemap,segment:paintTools.segment,stop,notify,
  read:()=>({ doc:state.doc,frame:state.doc.frames[state.frame].id,canUndo:state.undo.length > 0 }),
  readTile(id) {
    const frame = state.doc.frames.find(frame=>frame.id === id);
    const composed = renderStack(state.doc,state.stack,frame);
    return layerStack.image(composed,composed.packed);
  },
  readTileArt:workshopTileArt,
  create(width,height) {
    const doc = state.doc, used = new Set(frameIds(doc)), tilemap = { version:1,width,height,cells:[] };
    const frames = doc.frames.map((frame,i)=>{
      const { id,label,guides,selections,duration,...cel } = frame;
      const key = id ?? colors.uniqueId(used,'tile-'+(i+1));
      used.add(key);
      return { id:key,duration:duration ?? 1/(doc.fps ?? 12),
        ...(label !== undefined && { label }),...(guides !== undefined && { guides }),
        ...(selections !== undefined && { selections }),cels:state.stack ? frame.cels : { paint:cel } };
    });
    const revised = { ...doc,format:stackFormat,version:1,layers:doc.layers ?? [{ id:'paint' }],frames,tilemap };
    validateStackDeck(revised);
    edit(()=>{ state.doc = revised; resetStroke(); });
  },
  place(points,id) {
    const doc = state.doc;
    const { tilemap,changes } = Tilemap.place(doc.tilemap,new Set(frameIds(doc)),doc.width,doc.height,points,id);
    if (!changes.length) return;
    stop();
    saveUndo();
    state.doc = { ...doc,tilemap };
    $('undo').disabled = false;
    tilePanel.refresh();
    notify((id === null ? 'Erased ' : 'Placed ')+changes.length+(changes.length === 1 ? ' cell' : ' cells'));
  },
  edit(id) {
    const index = state.doc.frames.findIndex(frame=>frame.id === id);
    if (index < 0) return;
    stop();
    resetStroke();
    state.frame = index;
    draw();
    $('canvas-view').querySelector('.ink-grid-viewport').focus({ preventScroll:true });
  },
  add() {
    const doc = state.doc;
    if ($('duplicate').disabled) throw new RangeError('Tile artwork exceeds the workshop frame budget');
    const id = colors.uniqueId(new Set(frameIds(doc)),'tile-'+(doc.frames.length+1));
    const frame = { id,duration:1/(doc.fps ?? 12),cels:{} };
    edit(()=>{ state.doc = { ...doc,frames:[...doc.frames,frame] }; });
    return id;
  },
  variant(at) {
    const doc = state.doc, source = occupiedTile(doc,at);
    if ($('duplicate').disabled) throw new RangeError('Tile artwork exceeds the workshop frame budget');
    const ids = new Set(frameIds(doc)), reserved = new Set(ids);
    for (const frame of doc.frames) for (const cel of Object.values(frame.cels))
      if (cel.id?.includes('/')) reserved.add(cel.id.split('/')[0]);
    const id = colors.uniqueId(reserved,source.id.slice(0,48)+'-variant');
    const frame = structuredClone(source);
    frame.id = id;
    if (frame.label) frame.label += ' (variant)';
    for (const cel of Object.values(frame.cels)) delete cel.id;
    if (frame.guides?.length) frame.guides = Tilemap.cloneRecords(frame.guides,
      [...(doc.guides ?? []),...doc.frames.flatMap(row=>row.guides ?? [])]);
    if (frame.selections?.length) frame.selections = Tilemap.cloneRecords(frame.selections,
      [...(doc.sharedSelections ?? []),...doc.frames.flatMap(row=>row.selections ?? [])]);
    const locks = Tilemap.variantProtection(doc.protectedDetails,frameProtection(doc,doc.frames.indexOf(source)),id);
    ids.add(id);
    const { tilemap } = Tilemap.place(doc.tilemap,ids,doc.width,doc.height,[at],id);
    const revised = { ...doc,tilemap,frames:[...doc.frames,frame],...(locks && { protectedDetails:locks }) };
    validateStackDeck(revised,state.stack);
    edit(()=>{ state.doc = revised; });
    notify('Created '+id+' at '+at.join(', '));
    return id;
  },
  reuse(at,id) {
    const doc = state.doc, source = occupiedTile(doc,at), match = doc.frames.find(frame=>frame.id === id);
    if (!match || match === source || !Tilemap.sameArt(workshopTileArt(source),workshopTileArt(match)))
      throw new RangeError('Choose a different tile with exactly matching artwork and protection');
    const { tilemap } = Tilemap.place(doc.tilemap,new Set(frameIds(doc)),doc.width,doc.height,[at],id);
    edit(()=>{ state.doc = { ...doc,tilemap }; });
    notify('Reused '+id+' at '+at.join(', '));
  },
  undo:()=> $('undo').click()
});

$('export-png').addEventListener('click',async()=>{
  const { width,height,palette,swatchIds,swatchLabels,lockedSwatches,ramps,frames } = state.doc;
  const index = state.frame, current = frames[index], name = $('preset').value;
  try {
    if (tilePanel.active()) {
      download('tilemap.png',await saveRasterPNG(tilePanel.image()));
      return;
    }
    let paint = { palette,swatchIds,slots:stamp.paint(width,height,current),alpha:current.alpha,knockouts:current.knockouts };
    if (state.stack) {
      const raster = renderStack(state.doc,state.stack,current), editor = colors.paletteEditor(indexedPalette(),width*height+palette.length);
      paint = { ...layerStack.bake(raster,raster.packed,editor.resolve),
        palette:editor.palette.map(row=>row.color),swatchIds:editor.palette.map(row=>row.id) };
    }
    const png = await savePNG({ width,height,swatchLabels,lockedSwatches,ramps,...paint },$('png-color-mode').value);
    download(`${name}-frame-${index+1}.png`,png);
  } catch (error) { notify(error.message); }
});
$('export').addEventListener('click',()=>saveJson(`${$('preset').value}-stamp.json`,state.doc));
load(stonePaint());
