const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const selectionTools = require('../src/pixel-selections.js');

const { mask,pixels } = selectionTools;
const design = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
  palette:{ rust:'#b53129',alias:'#b53129',near:'#bb3129',blue:'#243b6a' },
  layers:[{ id:'ink' },{ id:'top' }],
  frames:[{ id:'front',durationMs:100,cels:{
    ink:{ id:'drawing',marks:[
      { swatch:'rust',at:[1,1] },{ swatch:'alias',at:[2,1] },{ swatch:'rust',at:[5,1] },
      { swatch:'near',at:[6,1] },{ swatch:'rust',at:[3,2] },{ swatch:'rust',at:[1,2] },
      { swatch:'rust',at:[2,2] },{ alpha:0,runs:[[2,1,1]] },{ alpha:128,runs:[[2,2,1]] }
    ] },
    top:{ marks:[{ swatch:'blue',at:[2,1] }] }
  } },{ id:'back',durationMs:100,cels:{} }]
};
const patch = (editor,id,operation,extra = {}) => ({
  id,frame:'front',revision:editor.describe().revision,operation,...extra
});

test('marquees and lassos resolve exact pixel masks in native row order', () => {
  const read = q => pixels(8,mask(8,6,q));
  assert.deepEqual(read({ type:'rectangle',rect:[1,2,3,2] }),[[1,2],[2,2],[3,2],[1,3],[2,3],[3,3]]);
  const rounded = read({ type:'ellipse',rect:[1,1,4,4] });
  assert.equal(rounded.length,12);
  assert.ok(rounded.some(([x,y])=>x === 2 && y === 1));
  assert.ok(!rounded.some(([x,y])=>x === 1 && y === 1));
  const concave = [[1,1],[6,1],[6,2],[3,2],[3,4],[1,4]];
  const polygon = read({ type:'polygon',points:concave });
  assert.deepEqual(read({ type:'lasso',points:concave }),polygon);
  assert.ok(polygon.some(([x,y])=>x === 2 && y === 3));
  assert.ok(!polygon.some(([x,y])=>x === 4 && y === 3));
  assert.deepEqual(read({ type:'lasso',points:[[1,1],[3,3]] }),[[1,1],[2,2],[3,3]]);
  const crossing = read({ type:'lasso',points:[[1,1],[5,5],[1,5],[5,1]] });
  assert.ok(crossing.some(([x,y])=>x === 3 && y === 3));
  assert.ok(!crossing.some(([x,y])=>x === 1 && y === 3));
  assert.throws(()=>read({ type:'polygon',points:[[1,1],[3,3]] }),/3–128/);
  assert.throws(()=>read({ type:'ellipse',rect:[7,1,2,2] }),/in-bounds/);
});

test('wand compares visible RGBA, supports raw layer color and can select matching islands', () => {
  const editor = ink.createPixelEditor(design);
  const query = { type:'wand',at:[1,1] };
  assert.deepEqual(editor.select(query).pixels,[[1,1]]);
  assert.deepEqual(editor.select(query,{ cel:'drawing' }).pixels,[[1,1],[2,1]]);
  assert.deepEqual(editor.select({ ...query,connected:false,tolerance:6 },{ layer:'ink' }).pixels,
    [[1,1],[2,1],[5,1],[6,1],[3,2]]);
  assert.deepEqual(editor.select({ type:'wand',at:[1,2],tolerance:255 },{ layer:'ink' }).pixels.some(
    ([x,y])=>x === 2 && y === 2),false);
  assert.throws(()=>editor.select(query,{ layer:'ink',cel:'drawing' }),/composite, a layer or a cel/);
  assert.throws(()=>editor.select({ ...query,tolerance:256 }),/tolerance/);
});

test('named selections preview and replay transactionally, clip raster tools, and capture a masked brush', () => {
  const editor = ink.createPixelEditor(design);
  const query = { type:'wand',at:[1,1],connected:false };
  const save = patch(editor,'pick-rust',{ id:'rust-islands',layer:'ink',query },{ destination:'selections' });
  const preview = editor.previewEdit(save);
  assert.equal(preview.pixelCount,0);
  assert.deepEqual(preview.targets[0].runs,[[1,1,2],[1,5,1],[2,3,1]]);
  editor.begin('Select paint');
  const selected = editor.apply(save), [receipt] = editor.receipts();
  assert.deepEqual(editor.previewChanges().targets,preview.targets);
  editor.commit();
  assert.deepEqual(ink.createPixelEditor(design).replay(receipt),selected);
  assert.equal(editor.undo(),true);
  assert.equal(editor.snapshot().selections,undefined);
  assert.equal(editor.redo(),true);
  const brush = editor.captureBrush({ selection:'rust-islands',layer:'ink' });
  assert.deepEqual([brush.width,brush.height],[5,2]);
  assert.deepEqual(brush.slots.map(slot=>slot === null ? 0 : 1),[1,1,0,0,1,0,0,1,0,0]);

  const paint = patch(editor,'paint-rust',{ tool:'shape',shape:{ type:'rect',rect:[0,0,8,6] },
    swatch:'blue',layer:'ink',selection:'rust-islands' });
  assert.equal(editor.previewEdit(paint).targets[0].pixelCount,4);
  editor.apply(paint);
  assert.equal(editor.sample([5,1],{ layer:'ink',mode:'layer' }).swatch,'blue');
  assert.equal(editor.sample([6,1],{ layer:'ink',mode:'layer' }).swatch,'near');
  assert.equal(editor.previewEdit({ ...patch(editor,'wrong-frame',paint.operation),frame:'back' }).valid,false);

  const guarded = ink.createPixelEditor({ ...selected,protectedDetails:[{ id:'outside',pixels:[[6,1]] }] });
  const fill = patch(guarded,'fill-only-seeded-island',{ tool:'fill',at:[5,1],swatch:'blue',
    layer:'ink',selection:'rust-islands' });
  guarded.apply(fill);
  assert.equal(guarded.receipts().at(-1).affectedTargets[0].pixelCount,1);
  assert.equal(guarded.sample([1,1],{ layer:'ink',mode:'layer' }).swatch,'rust');
});

test('CLI queries, captures and replay preserve the same disconnected mask', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-selection-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name => path.join(dir,name+'.json');
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  const query = { type:'wand',at:[1,1],connected:false };
  write('design',design);
  write('query',query);
  const result = cli('select',file('design'),file('query'),'--layer','ink','--frame','front');
  assert.deepEqual(result,ink.createPixelEditor(design).select(query,{ layer:'ink',frame:'front' }));
  const session = path.join(dir,'session');
  cli('session','init',session,file('design'));
  assert.deepEqual(cli('session','select',session,file('query'),'--layer','ink','--frame','front'),result);
  write('patch',{ id:'store-selection',destination:'selections',frame:'front',revision:result.revision,
    operation:{ id:'rust-islands',query,layer:'ink' } });
  write('receipt',cli('edit',file('design'),file('patch'),'--out',file('selected')));
  cli('replay',file('design'),file('receipt'),'--out',file('replayed'));
  assert.equal(fs.readFileSync(file('replayed'),'utf8'),fs.readFileSync(file('selected'),'utf8'));
  cli('brush',file('selected'),'--selection','rust-islands','--layer','ink','--out',file('brush'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('brush'),'utf8')).slots.filter(slot=>slot !== null).length,4);
});

test('selection algebra and outlines match four-neighbor distances at holes and canvas edges', () => {
  const { fromPixels,combine,modify } = selectionTools;
  const width = 5, height = 4;
  const left = fromPixels(width,height,[[0,0],[1,0],[2,0]]), right = fromPixels(width,height,[[1,0],[1,1]]);
  assert.deepEqual(pixels(width,combine('combine',left,right)),[[0,0],[1,0],[2,0],[1,1]]);
  assert.deepEqual(pixels(width,combine('subtract',left,right)),[[0,0],[2,0]]);
  assert.deepEqual(pixels(width,combine('intersect',left,right)),[[1,0]]);
  assert.equal(pixels(width,modify(width,height,left,{ type:'invert' })).length,17);
  assert.deepEqual(pixels(width,left),[[0,0],[1,0],[2,0]]);
  assert.throws(()=>fromPixels(width,height,[[1,1],[1,1]]),/repeats a pixel/);

  const carved = mask(width,height,{ type:'rectangle',rect:[0,0,width,height] });
  carved[2*width+2] = 0;
  const on = pixels(width,carved), off = pixels(width,modify(width,height,carved,{ type:'invert' }));
  for (const amount of [1,2,512]) {
    const distance = (x,y,sites) => Math.min(...sites.map(([a,b])=>Math.abs(x-a)+Math.abs(y-b)));
    const inner = (x,y) => Math.min(distance(x,y,off),x+1,y+1,width-x,height-y);
    const outer = (x,y) => distance(x,y,on);
    const check = (operation,expected) =>
      assert.deepEqual(Array.from(modify(width,height,carved,{ amount,...operation })),expected);
    check({ type:'grow' },Array.from(carved,(_,p)=>Number(outer(p%width,Math.floor(p/width)) <= amount)));
    check({ type:'shrink' },Array.from(carved,(_,p)=>Number(inner(p%width,Math.floor(p/width)) > amount)));
    for (const side of ['inside','outside','both']) {
      check({ type:'outline',side },Array.from(carved,(on,p)=>Number(on ?
        side !== 'outside' && inner(p%width,Math.floor(p/width)) <= amount :
        side !== 'inside' && outer(p%width,Math.floor(p/width)) <= amount)));
    }
  }
  const empty = new Uint8Array(width*height);
  assert.deepEqual(modify(width,height,empty,{ type:'grow',amount:512 }),empty);
  assert.deepEqual(modify(width,height,empty,{ type:'outline',side:'both' }),empty);
  assert.throws(()=>modify(width,height,left,{ type:'outline',side:'around' }),/outline side/);
  assert.throws(()=>modify(width,height,left,{ type:'grow',amount:0 }),/radius/);
});

test('selection expressions compose recalled and fresh masks with frame scope and bounded evaluation', () => {
  const editor = ink.createPixelEditor({ ...design,selections:[
    { id:'start',frame:'front',pixels:[[0,0],[1,0]] },
    { id:'rear',frame:'back',pixels:[[3,3]] },
    { id:'shared',pixels:[[2,0]] }
  ] });
  const start = { type:'recall',id:'start' };
  const query = { type:'subtract',
    base:{ type:'grow',source:{ type:'combine',base:start,with:{ type:'recall',id:'shared' } } },
    with:{ type:'rectangle',rect:[0,1,2,1] } };
  const keep = [[0,0],[1,0],[2,0],[3,0],[2,1]];
  assert.deepEqual(editor.select(query).pixels,keep);
  assert.equal(editor.select({ type:'recall',id:'rear' }).frame,'back');
  assert.throws(()=>editor.select(start,{ frame:'back' }),/belongs to frame front/);
  assert.throws(()=>editor.select({ type:'recall',id:'missing' }),/Unknown pixel selection/);
  assert.throws(()=>editor.select({ type:'pixels',pixels:[[8,0]] }),/outside the native grid/);
  const cyclic = { type:'invert' };
  cyclic.source = cyclic;
  assert.throws(()=>editor.select(cyclic),/at most 32 operations/);

  const transaction = patch(editor,'edit-mask',{ id:'retained',query },{ destination:'selections' });
  const before = editor.snapshot();
  assert.deepEqual(editor.previewEdit(transaction).targets[0].runs,[[0,0,4],[1,2,1]]);
  const updated = editor.apply(transaction);
  assert.deepEqual(editor.select({ type:'recall',id:'retained' }).pixels,keep);
  assert.deepEqual(editor.stamp().selections.map(row=>row.id),['start','shared','retained']);
  assert.deepEqual(editor.stamp({ frame:'back' }).selections.map(row=>row.id),['rear','shared']);
  assert.deepEqual(ink.createPixelEditor(before).replay(editor.receipts()[0]),updated);
  assert.equal(editor.undo(),true);
  assert.throws(()=>editor.select({ type:'recall',id:'retained' }),/Unknown pixel selection/);
});

test('the CLI saves and recalls edited masks and retains them in stamp exports', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-edited-masks-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json');
  const designWithMask = { ...design,selections:[{ id:'source',frame:'front',pixels:[[1,1]] }] };
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  const source = { type:'recall',id:'source' };
  write('design',designWithMask);
  write('outline',{ type:'outline',side:'outside',source });
  const selected = JSON.parse(cli('select',file('design'),file('outline')));
  const expected = [[1,0],[0,1],[2,1],[1,2]];
  assert.deepEqual(selected.pixels,expected);
  write('patch',{ id:'outline-pass',destination:'selections',frame:'front',revision:selected.revision,
    operation:{ id:'ring',query:{ type:'outline',side:'outside',source } } });
  cli('edit',file('design'),file('patch'),'--out',file('edited'));
  write('recall',{ type:'recall',id:'ring' });
  assert.deepEqual(JSON.parse(cli('select',file('edited'),file('recall'))).pixels,expected);
  const output = path.join(dir,'render');
  cli('draw',file('edited'),'--out',output);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'stamp.json'),'utf8')).selections[1],
    { id:'ring',pixels:expected });
});

test('swatches retain indexed identity and a cluster can follow edges or corners within any mask', () => {
  const editor = ink.createPixelEditor(design), source = { type:'swatch',id:'rust' };
  const all = [[1,1],[5,1],[2,2],[3,2]];
  assert.deepEqual(editor.select(source,{ layer:'ink' }).pixels,all);
  assert.deepEqual(editor.select({ type:'swatch',at:[2,1] }).pixels,[[2,1]]);
  assert.deepEqual(editor.select({ type:'swatch',at:[1,2] },{ layer:'ink' }).pixels,[]);
  assert.deepEqual(editor.select({ type:'cluster',at:[1,1] },{ cel:'drawing' }).pixels,[[1,1]]);
  assert.deepEqual(editor.select({ type:'cluster',at:[1,1],connectivity:8,source }).pixels,[[1,1],[2,2],[3,2]]);
  const selected = { type:'cluster',at:[0,0],source };
  assert.deepEqual(editor.select(selected).pixels,[]);
});

test('owner, depth and diagnostic selections share the native grid and fingerprint the render', () => {
  const editor = ink.createPixelEditor(design), { width:w,height:h } = design, n = w*h;
  const objectId = new Uint32Array(n), partId = new Uint32Array(n), materialId = new Uint32Array(n);
  const depth = new Float32Array(n).fill(Infinity), coverage = new Float32Array(n);
  const surfaceUV = new Float32Array(n*2), surfaceUVValid = new Uint8Array(n);
  objectId.set([1,2,2,1]); partId.set([1,2,2,0]); materialId.set([2,1,2,1]);
  depth.set([2,1,1.5,3]); coverage.set([.2,.75,1,.4]);
  surfaceUV.set([0,.5,0,.5]); surfaceUVValid.set([0,255]);
  const renderFrame = { w,h,passes:{ w,h,objectId,partId,materialId,depth,coverage,surfaceUV,surfaceUVValid,
    objects:[null,'dock','crane'],materials:[null,'metal','wood'],
    parts:[null,{ part:'arm',entity:'dock' },{ part:'arm',entity:'crane' }] } };
  const pick = query=>editor.select(query,{ renderFrame }).pixels;
  assert.deepEqual(pick({ type:'object',id:'dock' }),[[0,0],[3,0]]);
  assert.deepEqual(pick({ type:'object',at:[4,0] }),[]);
  assert.deepEqual(pick({ type:'part',id:'arm',object:'crane' }),[[1,0],[2,0]]);
  assert.deepEqual(pick({ type:'part',id:'arm',entity:'dock' }),[[0,0]]);
  assert.deepEqual(pick({ type:'part',at:[1,0] }),[[1,0],[2,0]]);
  assert.deepEqual(pick({ type:'material',id:'metal' }),[[1,0],[3,0]]);
  assert.deepEqual(pick({ type:'depth',range:[1.5,3] }),[[0,0],[2,0],[3,0]]);
  assert.deepEqual(pick({ type:'channel',channel:'coverage',range:[.7,1] }),[[1,0],[2,0]]);
  assert.deepEqual(pick({ type:'channel',channel:'surfaceUV',component:1,range:[.5,.5] }),[[1,0]]);
  assert.throws(()=>pick({ type:'channel',channel:'surfaceUV',range:[0,1] }),/Choose a component/);
  assert.throws(()=>pick({ type:'channel',channel:'invented',range:[0,1] }),/Unknown render channel/);
  assert.throws(()=>editor.select({ type:'depth',range:[0,2] }),/SDK renderFrame/);
  assert.throws(()=>editor.select({ type:'depth',range:[0,2] },{ renderFrame:{ ...renderFrame,w:3 } }),/match the document/);

  const query = { type:'intersect',base:{ type:'part',id:'arm',object:'crane' },
    with:{ type:'depth',range:[1.5,3] } };
  const { sources } = editor.select(query,{ renderFrame });
  const selection = patch(editor,'inspect-crane',{ id:'near-arm',query,sources },{ destination:'selections' });
  assert.deepEqual(editor.previewEdit(selection,{ renderFrame }).targets[0].runs,[[0,2,1]]);
  assert.deepEqual(editor.previewEdit(selection,{ renderFrame }).targets[0].sources[0].passes,
    ['depth','objectId','partId']);
  const after = editor.apply(selection,{ renderFrame }), [receipt] = editor.receipts();
  assert.deepEqual(ink.createPixelEditor(design).replay(receipt,{ renderFrame }),after);
  depth[0] = 2.5; // The saved mask is identical, but the inspected pass has changed.
  assert.equal(ink.createPixelEditor(design).previewEdit(selection,{ renderFrame }).conflicts[0].code,'stale-source');
  assert.throws(()=>ink.createPixelEditor(design).replay(receipt,{ renderFrame }),
    error=>error.receipt?.conflicts[0].code === 'stale-source');
});

test('a bound material channel selects rest-chart values and pigment coverage', () => {
  const scene = { id:'test-panel',style:'slate',solids:[{
    id:'panel',kind:'box',at:[0,0,0],half:[1,1,.25],res:.2,mat:'stone',
    surfaceState:{ charts:{ front:{ origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0],stamps:[
      { channel:'wear',brush:{ kind:'rect',min:[0,0],max:[.5,1] },value:.625 },
      { channel:'paint',brush:{ kind:'rect',min:[.5,0],max:[1,1] },value:'#ffaa44',strength:.5 }
    ] } } }
  }] };
  const doc = { ...design,sceneBindings:[{ id:'panel',scene:'test-panel',object:'panel',frame:'front' }],
    destinations:[
      { id:'wear',kind:'surface-channel',binding:'panel',chart:'front',channel:'wear' },
      { id:'pigment',kind:'surface-channel',binding:'panel',chart:'front',channel:'paint' }
    ] };
  const editor = ink.createPixelEditor(doc,{ sceneEditor:ink.createSceneEditor(scene) });
  const wear = { type:'channel',destination:'wear',range:[.6,.7] };
  const selected = editor.select(wear);
  assert.equal(selected.pixelCount,design.width*design.height/2);
  assert.ok(selected.pixels.every(([x])=>x < design.width/2));
  assert.equal(selected.sources[0].kind,'surface-channel');
  assert.ok(editor.select({ type:'channel',destination:'pigment',range:[.49,.51] }).pixels.every(([x])=>x >= design.width/2));
  assert.throws(()=>editor.select(wear,{ frame:'back' }),/bound to frame front/);
});

test('CLI renders named parts at document size and replays their retained mask', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-semantic-selection-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json');
  const scene = 'examples/part-motion.js';
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  write('design',{ ...design,width:80,height:56 });
  const query = { type:'part',id:'tide-needle',object:'tide-needle' };
  write('query',query);
  const report = cli('select',file('design'),file('query'),'--scene',scene,'--t','.25');
  assert.deepEqual(report.grid,[80,56]);
  assert.ok(report.pixelCount > 5);
  assert.deepEqual(report.sources[0].passes,['objectId','partId']);
  write('patch',{ id:'save-needle',revision:report.revision,frame:'front',destination:'selections',
    operation:{ id:'needle',query } });
  write('receipt',cli('edit',file('design'),file('patch'),'--scene',scene,'--t','.25','--out',file('edited')));
  cli('replay',file('design'),file('receipt'),'--scene',scene,'--t','.25','--out',file('replayed'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('replayed'),'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('edited'),'utf8')).selections[0].pixels,report.pixels);
});

test('CLI material and SDF masks follow the visible owners at mesh cutouts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-cutout-selection-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const source = path.join(dir,'document.json'), query = path.join(dir,'query.json');
  fs.writeFileSync(source,JSON.stringify({ ...design,width:100,height:72 }));
  function select(value) {
    fs.writeFileSync(query,JSON.stringify(value));
    return JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','select',source,query,
      '--scene','examples/opaque-surface-gate.js','--t','.4'],{ cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  }
  const copper = { type:'material',id:'brushed-copper' };
  const screen = select(copper);
  assert.ok(screen.pixelCount > 10);
  const sdf = { type:'channel',channel:'surfaceKind',range:[2,2] };
  assert.ok(select(sdf).pixelCount > 50);
  assert.equal(select({ type:'intersect',base:sdf,with:copper }).pixelCount,0);
});

function scopeStudy({makeBuilder,SpriteSurface}) {
  return { id:'scope-study', name:'Scope study', build() {
    const B = makeBuilder(17,[0x162331,0xec9244,0x4cc6bb,0x777d87]);
    B.disc(0,0,0,[0,0,1],.52,.025,B.P[1],3);
    B.describeSplats(0,1,{ object:'assembly',target:{part:'handle'} });
    B.disc(.8,.94,0,[0,0,1],.24,.025,B.P[2],3);
    B.describeSplats(1,2,{ object:'assembly',target:{part:'hinge'} });
    B.disc(.35,0,.5,[0,0,1],.25,.025,B.P[2],.35,{nd:true});
    B.describeSplats(2,3,{ object:'mist' });
    const cover = SpriteSurface.make();
    cover.face([-.22,-.5,1],[.44,0,0],[0,1,0],12,22,()=>0x777d87,{objectId:'cover'});
    return B.finish({id:'scope-study',spriteSurfaces:cover.finish(),radius:4,
      cam:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,ortho:true},dither:0});
  } };
}

function scopedDesign(scene) {
  return { ...design,width:64,height:48,sceneBindings:[
    { id:'work',scene,object:'assembly',part:'handle',frame:'front',layer:'ink' },
    { id:'whole',scene,object:'assembly' }
  ] };
}

test('binding scope defaults to visible target hits, preserves soft overlap, and names deliberate hidden selection',()=>{
  const editor = ink.createPixelEditor(scopedDesign('scope-study'));
  const world = scopeStudy(ink.load()).build(), calls = [];
  const captureSelection = settings=>{
    calls.push(settings.pixelSelection.isolated);
    return ink.render(world,{ ...settings,px:1,raw:true });
  };
  const pick = (scope,options={})=>editor.select({ type:'binding',id:'work',...(scope && {scope}) },
    { captureSelection,...options });
  const visible = pick(), isolated = pick('isolated-part'), through = pick('through-layers');
  const frameOptions = { w:64,h:48,px:1,raw:true };
  const visibleFrame = ink.render(world,{ ...frameOptions,pixelSelection:{ object:'assembly',part:'handle' } });
  assert.deepEqual(visibleFrame.rgb,ink.render(world,frameOptions).rgb);
  assert.deepEqual(editor.select({type:'binding',id:'work'},{renderFrame:visibleFrame}),visible);
  assert.deepEqual(visible,pick('visible'));
  assert.ok(visible.pixelCount > 10);
  assert.ok(through.pixelCount > visible.pixelCount);
  assert.deepEqual(through.pixels,isolated.pixels);
  const includes = (mask,x,y)=>mask.pixels.some(([u,v])=>u === x && v === y);
  assert.equal(includes(visible,32,24),false);
  assert.equal(includes(through,32,24),true);
  assert.equal(includes(isolated,32,24),true);
  const projectedOrigin = ink.render(world,{ w:64,h:48,px:1,raw:true,
    pixelSelection:{ object:'mist' } }).pixelSelection.coverage;
  assert.ok(visible.pixels.some(([x,y])=>projectedOrigin[y*64+x] > .1));
  const whole = editor.select({ type:'binding',id:'whole',scope:'through-layers' },{ captureSelection });
  assert.ok(whole.pixelCount > through.pixelCount);
  assert.equal(through.sources[0].occludedPixels,through.pixelCount-visible.pixelCount);
  assert.equal(through.sources[0].scope,'through-layers');
  assert.notEqual(through.sources[0].revision,isolated.sources[0].revision);
  assert.equal(visible.sources[0].scope,'visible');
  assert.deepEqual(calls.slice(0,4),[false,true,true,false]);
  assert.throws(()=>pick('visible',{ frame:'back' }),/scoped to frame front/);
  assert.throws(()=>pick('visible',{ layer:'top' }),/scoped to layer ink/);
  assert.throws(()=>pick('anything'),/selection scope/);
  assert.throws(()=>editor.select({ type:'binding',id:'whole',scope:'isolated-part' },{ captureSelection }),/named part/);
  assert.throws(()=>pick('visible',{ captureSelection:()=>({ w:64,h:48,scene:'other' }) }),/not the scene/);
});

test('CLI saves and replays a guarded scope and maps the document to the registered native grid',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-selection-scope-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json'), scene = path.join(dir,'scene.js');
  fs.writeFileSync(scene,'module.exports = '+scopeStudy.toString());
  const doc = scopedDesign(scene);
  doc.width = doc.height = 8;
  doc.sceneBindings[0].canvas = { size:[64,48],offset:[28,20],scale:[1,1] };
  const select = { type:'binding',id:'work',scope:'through-layers' };
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  write('design',doc);
  write('query',select);
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  const report = cli('select',file('design'),file('query'),'--scene',scene);
  assert.deepEqual(report.grid,[8,8]);
  assert.deepEqual(report.sources[0].grid,[64,48]);
  assert.ok(report.sources[0].occludedPixels > 0);
  write('patch',{ id:'save-work',frame:'front',revision:report.revision,destination:'selections',
    operation:{ id:'work-mask',query:select,sources:report.sources } });
  const receipt = cli('edit',file('design'),file('patch'),'--scene',scene,'--out',file('edited'));
  assert.equal(receipt.inputs.selectionSources[0].scope,'through-layers');
  write('receipt',receipt);
  cli('replay',file('design'),file('receipt'),'--scene',scene,'--out',file('again'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file('again'),'utf8')).selections[0].pixels,report.pixels);
  write('patch',{ id:'save-work',frame:'front',revision:report.revision,destination:'selections',
    operation:{ id:'work-mask',query:{ ...select,scope:'visible' },sources:report.sources } });
  assert.throws(()=>cli('edit',file('design'),file('patch'),'--scene',scene,'--out',file('stale')),error=>
    JSON.parse(error.stdout).conflicts[0].code === 'stale-source');
});

test('through-layer selection reaches a retained SDF behind opaque geometry',()=>{
  const source = { id:'field-scope',style:'slate',
    camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    finish:{ look:{ sdfAssist:true } },
    solids:[
      { id:'rear',kind:'box',at:[0,0,0],half:[.65,.65,.12],res:.13,mat:'stone' },
      { id:'cover',kind:'box',at:[0,0,.7],half:[.24,.8,.12],res:.13,mat:'stone' }
    ] };
  const world = ink.createSceneEditor(source).build();
  const document = { ...scopedDesign(source.id),sceneBindings:[{ id:'target',scene:source.id,object:'rear' }] };
  const editor = ink.createPixelEditor(document);
  const captureSelection = settings=>ink.render(world,{ ...settings,px:1,raw:true,passes:['opaque-surface'] });
  const read = scope=>editor.select({ type:'binding',id:'target',scope },{ captureSelection });
  const visible = read('visible'), through = read('through-layers');
  assert.ok(visible.pixelCount > 10);
  assert.ok(through.sources[0].occludedPixels > 10);
  assert.ok(through.pixels.some(([x,y])=>x === 32 && y === 24));
  assert.ok(!visible.pixels.some(([x,y])=>x === 32 && y === 24));
  const isolated = captureSelection({ w:64,h:48,pixelSelection:{object:'rear',isolated:true} });
  assert.equal(ink.pickSurface(isolated.passes,32,24).kind,'sdf');
});
