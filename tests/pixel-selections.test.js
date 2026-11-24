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
