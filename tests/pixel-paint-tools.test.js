const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const { freehand } = require('../src/pixel-paint-tools.js');

const design = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
  palette:{ base:'#13272f',mint:'#a7ceaa',gold:'#ffd55e',other:'#a7ceaa' },
  layers:[{ id:'floor' },{ id:'ink' },{ id:'light' }],
  frames:[{ id:'front',durationMs:100,cels:{
    floor:{ marks:[{ swatch:'base',shape:{ type:'rect',rect:[0,0,8,6] } }] },
    ink:{ id:'active-ink', marks:[
      { swatch:'mint',shape:{ type:'rect',rect:[1,1,2,2] } },
      { swatch:'other',at:[3,1] },{ swatch:'mint',at:[3,3] },
      { swatch:null,at:[7,4] }
    ] },
    light:{ marks:[{ swatch:'gold',at:[1,1] }] }
  } },{ id:'side',durationMs:100,cels:{} }]
};
const makePatch = (editor,id,operation,extra = {}) => ({
  id,revision:editor.describe().revision,frame:'front',operation,...extra
});

test('pixel-perfect freehand keeps diagonals, taps and endpoints while trimming corner doubles', () => {
  function trace(points,pixelPerfect = true) {
    const kept = [], stroke = freehand((x,y)=>{ kept.push([x,y]); },{ pixelPerfect });
    for (const point of points) stroke.add(point);
    return [...kept,stroke.tip()];
  }
  const stairs = [[0,0],[1,0],[1,1],[2,1],[2,2]];
  assert.deepEqual(trace(stairs),[[0,0],[1,1],[2,2]]);
  assert.deepEqual(trace(stairs,false),stairs);
  assert.deepEqual(trace([[7,7],[4,4]]),[[7,7],[6,6],[5,5],[4,4]]);
  assert.deepEqual(trace([[3,2],[3,2]]),[[3,2]]);
  assert.deepEqual(trace([[1,0],[1,1],[1,0]]),[[1,0],[1,1],[1,0]]);
  assert.deepEqual(trace([[0,0],[1,0],[1,1],[1,0]]),[[0,0],[1,1],[1,0]]);
  assert.deepEqual(trace([[4,2],[4,3],[3,3],[3,4],[2,4]]),[[4,2],[3,3],[2,4]]);
});

test('the pixel-perfect pencil preserves stored pixels and replays the resolved path', t => {
  const doc = structuredClone(design);
  doc.protectedDetails = [{ id:'highlight',pixels:[[3,1]] }];
  const editor = ink.createPixelEditor(doc);
  const points = [[2,1],[3,1],[3,2],[4,3],[5,4]];
  const operation = { tool:'pencil',layer:'ink',swatch:'gold',points };
  const patch = makePatch(editor,'clean-stroke',{ ...operation,pixelPerfect:true });
  assert.equal(editor.previewEdit(patch).targets[0].pixelCount,4);
  const output = editor.apply(patch), [receipt] = editor.receipts();
  assert.equal(receipt.affectedTargets[0].pixelPerfect,true);
  assert.deepEqual(receipt.affectedTargets[0].runs,[[1,2,1],[2,3,1],[3,4,1],[4,5,1]]);
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,'other');
  assert.equal(editor.sample([4,3]).swatch,'gold');
  assert.deepEqual(ink.createPixelEditor(doc).replay(receipt),output);
  assert.equal(editor.undo(),true);
  assert.equal(editor.sample([4,3],{ mode:'layer',layer:'ink' }).swatch,null);
  assert.throws(()=>editor.apply(makePatch(editor,'raw-stroke',operation)),
    error => error.receipt.conflicts[0].code === 'protected-pixel');
  const plain = ink.createPixelEditor(design);
  plain.apply(makePatch(plain,'raw-stroke',operation));
  assert.equal(plain.sample([3,1]).swatch,'gold');
  assert.throws(()=>plain.apply(makePatch(plain,'bad-option',{ ...operation,pixelPerfect:'yes' })),/boolean pencil option/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-perfect-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const input = path.join(directory,'drawing.json'), request = path.join(directory,'patch.json');
  const edited = path.join(directory,'edited.json'), saved = path.join(directory,'receipt.json');
  fs.writeFileSync(input,JSON.stringify(doc));
  fs.writeFileSync(request,JSON.stringify(patch));
  const cli = (...args) => execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  fs.writeFileSync(saved,cli('edit',input,request,'--out',edited));
  const replayed = path.join(directory,'replayed.json');
  assert.equal(cli('replay',input,saved,'--out',replayed),fs.readFileSync(saved,'utf8'));
  assert.equal(fs.readFileSync(replayed,'utf8'),fs.readFileSync(edited,'utf8'));
});

test('eyedropper reads exact swatch identity and the chosen cel below the visible composite', () => {
  const editor = ink.createPixelEditor(design);
  const composite = editor.sample([1,1]);
  const active = editor.sample([1,1],{ mode:'layer',cel:'active-ink' });
  assert.deepEqual([composite.layer,composite.swatch,composite.color],['light','gold','#ffd55e']);
  assert.deepEqual([active.layer,active.cel,active.swatch,active.color],['ink','active-ink','mint','#a7ceaa']);
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,'other');
  assert.equal(editor.sample([7,4],{ mode:'layer',layer:'ink' }).knockout,true);
  assert.equal(editor.sample([7,5],{ mode:'layer',layer:'ink' }).knockout,false);
  assert.throws(()=>editor.sample([0,0],{ mode:'layer' }),/layer or cel/);
});

test('pencil, eraser and fill edit the source cel, with coherent retained marks and replay', () => {
  const editor = ink.createPixelEditor(design);
  const fill = makePatch(editor,'bucket',{ tool:'fill',at:[1,1],swatch:'base' },{ cel:'active-ink' });
  const preview = editor.previewEdit(fill);
  assert.equal(preview.targets[0].pixelCount,4);
  assert.equal(preview.pixelCount,3);
  editor.begin('Paint the texture');
  editor.apply(fill);
  const [receipt] = editor.receipts();
  assert.deepEqual(receipt.affectedTargets[0].runs,[[1,1,2],[2,1,2]]);
  assert.deepEqual(editor.previewChanges(),preview);
  editor.commit();
  assert.equal(editor.sample([1,1]).swatch,'gold');
  assert.equal(editor.sample([1,1],{ mode:'layer',layer:'ink' }).swatch,'base');
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,'other');
  assert.equal(editor.sample([3,3],{ mode:'layer',layer:'ink' }).swatch,'mint');
  assert.equal(editor.undo(),true);
  assert.equal(editor.sample([2,2]).swatch,'mint');
  assert.equal(editor.redo(),true);
  assert.deepEqual(ink.createPixelEditor(design).replay(receipt),editor.snapshot());

  editor.apply(makePatch(editor,'erase',{ tool:'eraser',layer:'ink',points:[[3,1],[3,3]] }));
  assert.equal(editor.sample([3,1]).swatch,'base');
  assert.equal(editor.sample([3,1],{ mode:'layer',layer:'ink' }).swatch,null);
  editor.apply(makePatch(editor,'remove-cut',{ tool:'eraser',layer:'ink',points:[[7,4]] }));
  assert.equal(editor.sample([7,4]).swatch,'base');
  assert.equal(editor.sample([7,4],{ mode:'layer',layer:'ink' }).knockout,false);
  editor.apply(makePatch(editor,'line',{ tool:'pencil',layer:'ink',points:[[4,1],[4,4]],swatch:'gold' }));
  assert.equal(editor.sample([4,3]).swatch,'gold');
  assert.deepEqual(editor.snapshot().frames[0].cels.ink.marks.slice(0,4),design.frames[0].cels.ink.marks);
});

test('fill covers a large grid and respects clipping and protected boundaries', () => {
  const blank = { ...design,width:100,height:80,frames:[{ id:'front',durationMs:100,cels:{} }] };
  const editor = ink.createPixelEditor(blank);
  editor.apply(makePatch(editor,'fill-blank',{ layer:'ink',tool:'fill',at:[0,0],swatch:'gold' }));
  const target = editor.receipts()[0].affectedTargets[0];
  assert.equal(target.pixelCount,8000);
  assert.equal(target.runs.length,80);
  assert.equal(editor.sample([99,79]).swatch,'gold');

  const clipped = structuredClone(design);
  clipped.layers[1].clip = 'floor';
  clipped.frames[0].cels.floor.marks[0].shape.rect = [0,0,4,6];
  clipped.protectedDetails = [{ id:'border',pixels:[[2,1],[2,2]] }];
  const guarded = ink.createPixelEditor(clipped);
  guarded.apply(makePatch(guarded,'safe-fill',{ layer:'ink',tool:'fill',at:[1,1],swatch:'base' }));
  assert.equal(guarded.receipts()[0].affectedTargets[0].pixelCount,2);
  assert.equal(guarded.sample([2,1],{ mode:'layer',layer:'ink' }).swatch,'mint');
  assert.equal(guarded.sample([7,4],{ mode:'layer',layer:'ink' }).clipped,true);
  const revision = guarded.describe().revision;
  assert.throws(()=>guarded.apply(makePatch(guarded,'bad-line',
    { layer:'ink',tool:'pencil',points:[[1,1],[3,1]],swatch:'gold' })),
    error => error.receipt.conflicts[0].code === 'protected-pixel');
  assert.equal(guarded.describe().revision,revision);
});

test('material eyedropper reads retained color, coverage and scalar values in rest UV', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-sample-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const rect = { kind:'rect',min:[0,.5],max:[1,1] };
  const scene = { id:'wall',style:'slate',solids:[{ id:'brick',kind:'box',at:[0,0,0],half:[1,1,.25],res:.1,mat:'stone',
    surfaceState:{ charts:{ face:{ origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0],stamps:[
      { channel:'paint',brush:rect,value:'#a7ceaa',strength:.5 },
      { channel:'heat',brush:rect,value:45 }
    ] } } } }] };
  const scenePath = path.join(directory,'wall.json'), input = path.join(directory,'art.json');
  const spec = { ...design,sceneBindings:[{ id:'wall-projection',scene:scenePath,object:'brick',frame:'front' }],
    destinations:[{ id:'pigment',kind:'surface-channel',binding:'wall-projection',chart:'face',channel:'paint' },
      { id:'temperature',kind:'surface-channel',binding:'wall-projection',chart:'face',channel:'heat' }] };
  const editor = ink.createPixelEditor(spec,{ sceneRef:scenePath,sceneEditor:ink.createSceneEditor(scene) });
  const paint = editor.sample([0,0],{ mode:'source',destination:'pigment' });
  assert.deepEqual(paint.uv,[.0625,1-.5/6]);
  assert.deepEqual(paint.value,{ color:[167/255,206/255,170/255],coverage:.5 });
  assert.match(paint.sourceRevision,/^[a-f0-9]{64}$/);
  assert.equal(editor.sample([0,5],{ mode:'source',destination:'pigment' }).value,null);
  assert.throws(()=>editor.sample([0,0],{ mode:'source',frame:'side',destination:'pigment' }),/bound to frame/);
  const scalar = editor.sample(undefined,{ mode:'source',destination:'temperature',uv:[.25,.75] });
  assert.deepEqual([scalar.value,scalar.type,scalar.units,scalar.object,scalar.chart],[45,'number','degC','brick','face']);
  fs.writeFileSync(scenePath,JSON.stringify(scene));
  fs.writeFileSync(input,JSON.stringify(spec));
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  assert.deepEqual(cli('sample',input,'--mode','source','--destination','temperature','--scene',scenePath,'--uv','.25,.75'),scalar);
  const patch = path.join(directory,'patch.json'), out = path.join(directory,'filled.json');
  fs.writeFileSync(patch,JSON.stringify(makePatch(editor,'region',{ layer:'ink',tool:'fill',at:[1,1],swatch:'base' })));
  assert.equal(cli('edit',input,patch,'--out',out).affectedTargets[0].pixelCount,4);
  assert.equal(cli('sample',out,'--mode','layer','--layer','ink','--at','1,1').swatch,'base');
});

test('symmetry and wrap apply after a pencil stroke is rasterized, with atomic protection and replay', t => {
  const blank = { ...design,frames:[{ id:'front',durationMs:100,cels:{} }] };
  const editor = ink.createPixelEditor(blank);
  const drawing = { mirrorX:3.5,mirrorY:2,wrapX:true,wrapY:true };
  const operation = { tool:'pencil',layer:'ink',swatch:'gold',points:[[7,5],[8,6],[9,6]],drawing };
  const patch = makePatch(editor,'seam',operation);
  const expected = [[0,0,2],[0,6,2],[4,0,2],[4,6,2],[5,0,1],[5,7,1]];
  assert.deepEqual(editor.previewEdit(patch).targets[0].runs,expected);
  const painted = editor.apply(patch), [receipt] = editor.receipts();
  assert.deepEqual(receipt.affectedTargets[0].drawing,drawing);
  assert.deepEqual(receipt.affectedTargets[0].runs,expected);
  assert.deepEqual(ink.createPixelEditor(blank).replay(receipt),painted);
  assert.equal(editor.sample([4,5]).swatch,null);
  assert.equal(editor.undo(),true);
  assert.equal(editor.sample([7,4]).swatch,null);
  assert.equal(editor.redo(),true);
  assert.equal(editor.sample([7,4]).swatch,'gold');

  const protectedDoc = { ...blank,protectedDetails:[{ id:'hold',pixels:[[7,4]] }] };
  const guarded = ink.createPixelEditor(protectedDoc);
  assert.throws(()=>guarded.apply(makePatch(guarded,'blocked',operation)),
    error=>error.receipt.conflicts[0].code === 'protected-pixel');
  assert.deepEqual(guarded.snapshot(),protectedDoc);
  assert.equal(editor.previewEdit(makePatch(editor,'outside',{ ...operation,points:[[16,1]] })).valid,false);
  assert.equal(editor.previewEdit(makePatch(editor,'fractional',{ ...operation,drawing:{ mirrorX:3.25 } })).valid,false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-wrapped-edit-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name => path.join(dir,name+'.json');
  fs.writeFileSync(file('design'),JSON.stringify(blank));
  fs.writeFileSync(file('patch'),JSON.stringify(patch));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  fs.writeFileSync(file('receipt'),cli('edit',file('design'),file('patch'),'--out',file('edited')));
  cli('replay',file('design'),file('receipt'),'--out',file('replayed'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('replayed'),'utf8'));
});

test('wrapped fill crosses enabled edges and each mirrored seed uses its own starting swatch', () => {
  const marks = [[0,0],[0,1],[7,1],[0,5]].map(at=>({ swatch:'mint',at }));
  marks.push({ swatch:'other',at:[4,1] });
  const spec = { ...design,frames:[{ id:'front',durationMs:100,cels:{ ink:{ marks } } }] };
  const editor = ink.createPixelEditor(spec);
  editor.apply(makePatch(editor,'fill-wrap',{ tool:'fill',layer:'ink',at:[0,1],swatch:'gold',
    drawing:{ mirrorX:2,wrapX:true } }));
  assert.deepEqual(editor.receipts()[0].affectedTargets[0].runs,[[0,0,1],[1,0,1],[1,4,1],[1,7,1]]);
  assert.equal(editor.sample([0,5]).swatch,'mint');
  editor.apply(makePatch(editor,'wrap-erase',{ tool:'eraser',layer:'ink',points:[[7,1],[8,1]],drawing:{ wrapX:true } }));
  assert.equal(editor.sample([7,1]).swatch,null);
  assert.equal(editor.sample([0,1]).swatch,null);
  assert.equal(editor.sample([4,1]).swatch,'gold');
});
