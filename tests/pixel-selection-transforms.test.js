const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const transforms = require('../src/pixel-selection-transforms.js');
const { fromPixels,pixels } = require('../src/pixel-selections.js');

const palette = [{ id:'rust',color:'#cc381a' },{ id:'cool',color:'#204968' },{ id:'alias',color:'#cc381a' }];
const width = 7, height = 5, index = (x,y)=>y*width+x;
const empty = () => ({ slots:Array(width*height).fill(null),palette });
const placements = result => [...result.writes].map(([p,{ slot,alpha }])=>[p%width,Math.floor(p/width),slot,alpha]);

test('moving a masked selection buffers overlap, opacity and indexed alias identity', () => {
  const source = { ...empty(),alpha:Array(width*height).fill(255) };
  source.slots[index(1,1)] = 0;
  source.alpha[index(1,1)] = 128;
  source.slots[index(3,1)] = 1;
  source.alpha[index(3,1)] = 0;
  source.slots[index(2,1)] = source.slots[index(4,1)] = source.slots[index(2,2)] = 2;
  const selected = fromPixels(width,height,[[1,1],[3,1],[1,2]]);
  const clip = transforms.capture(width,height,source,selected);
  assert.deepEqual(clip.slots,[0,null,1,-1,null,null]);
  assert.deepEqual(clip.alpha,[128,255,0,255,255,255]);
  const moved = transforms.stage(width,height,source,JSON.parse(JSON.stringify(clip)),{ offset:[1,0] },{ move:true });
  assert.deepEqual(pixels(width,moved.mask),[[2,1],[4,1],[2,2]]);
  assert.deepEqual(placements(moved),[[1,1,-1,255],[3,1,-1,255],[2,1,0,128],[4,1,1,0]]);
  assert.equal(moved.writes.has(index(2,2)),false);
  assert.equal(source.slots[index(1,1)],0);

  const aliased = transforms.capture(width,height,source,fromPixels(width,height,[[2,1]]));
  assert.deepEqual(placements(transforms.stage(width,height,source,aliased,{ at:[1,0] })),[[1,0,2,255]]);
  const clipped = transforms.stage(width,height,source,clip,{ at:[-1,0] },{ move:true });
  assert.equal(clipped.clippedPixels,2);
  assert.deepEqual(pixels(width,clipped.mask),[[1,0]]);
});

test('flip, scale and rotation keep whole pixels and the pixel-aware sampler keeps diagonal clusters', () => {
  const clip = { format:transforms.format,version:1,width:2,height:3,origin:[0,0],palette,
    slots:[0,1,2,0,1,2] };
  const apply = options => transforms.stage(width,height,empty(),clip,options);
  const rows = options => placements(apply(options)).map(row=>row[2]);
  assert.deepEqual(rows({ angle:90 }),[1,2,0,2,0,1]);
  assert.deepEqual(rows({ angle:90,rotation:'pixel-aware' }),rows({ angle:90 }));
  assert.deepEqual(rows({ flipX:true,flipY:true }),[2,1,0,2,1,0]);
  assert.deepEqual(rows({ size:[4,1] }),[2,2,0,0]);
  assert.throws(()=>apply({ at:[1.5,1] }),/integer/);
  assert.throws(()=>apply({ size:[2,0] }),/integer/);

  const art = { ...clip,width:3,height:3,slots:[0,1,0,1,1,1,0,1,0] };
  const nearest = transforms.stage(width,height,empty(),art,{ angle:30 });
  const aware = transforms.stage(width,height,empty(),art,{ angle:30,rotation:'pixel-aware' });
  assert.equal(nearest.writes.get(index(0,1)).slot,0);
  assert.equal(aware.writes.get(index(0,1)).slot,1);
  assert.deepEqual(new Set([...aware.writes.values()].map(pixel=>pixel.slot)),new Set([1]));
  const point = transforms.stage(width,height,empty(),{ ...clip,width:1,height:1,slots:[0] },
    { angle:45,rotation:'pixel-aware' });
  assert.deepEqual(point.bounds,[0,0,1,1]);
  assert.deepEqual(placements(point),[[0,0,0,255]]);
});

const document = {
  format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],
  palette:{ rust:'#cc381a',cool:'#204968',alias:'#cc381a' },
  layers:[{ id:'ink' }],frames:[{ id:'front',durationMs:100,cels:{ ink:{ id:'drawing',marks:[
    { swatch:'rust',at:[1,1] },{ swatch:'alias',at:[2,1] },{ swatch:null,at:[1,2] },
    { alpha:128,runs:[[1,1,1]] }
  ] } } },{ id:'back',durationMs:100,cels:{} }],
  selections:[{ id:'badge',frame:'front',pixels:[[1,1],[2,1],[1,2],[2,2]] }]
};
const patch = (editor,id,operation,extra = {})=>({
  id,frame:'front',revision:editor.describe().revision,operation,...extra
});

test('document transform previews its footprints and commits raster, mask and alpha as one undo', () => {
  const editor = ink.createPixelEditor(document);
  const transform = { tool:'transform',selection:'badge',transform:{ offset:[1,0] },resultSelection:'new-badge' };
  const move = patch(editor,'nudge-badge',transform,{ cel:'drawing' });
  const preview = editor.previewEdit(move);
  assert.deepEqual(preview.targets[0].bounds,[2,1,2,2]);
  assert.equal(preview.targets[0].pixelCount,5);
  assert.deepEqual(preview.targets[0].selectionRuns,[[1,2,2],[2,2,2]]);
  assert.equal(editor.sample([1,1]).swatch,'rust');
  const result = editor.apply(move), [receipt] = editor.receipts();
  assert.equal(editor.sample([1,1]).swatch,null);
  assert.deepEqual([editor.sample([2,1]).swatch,editor.sample([2,1]).alpha],['rust',128]);
  assert.equal(editor.sample([3,1]).swatch,'alias');
  assert.equal(editor.sample([2,2],{ mode:'layer',layer:'ink' }).knockout,true);
  assert.deepEqual(editor.select({ type:'recall',id:'new-badge' }).pixels,[[2,1],[3,1],[2,2],[3,2]]);
  assert.deepEqual(ink.createPixelEditor(document).replay(receipt),result);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),document);

  const guards = { ...document,protectedDetails:[{ id:'hold',pixels:[[3,1]] }] };
  const locked = ink.createPixelEditor(guards), blocked = patch(locked,'blocked',transform,{ cel:'drawing' });
  assert.equal(locked.previewEdit(blocked).conflicts[0].code,'protected-pixel');
  assert.throws(()=>locked.apply(blocked),error=>error.receipt.conflicts[0].code === 'protected-pixel');
  assert.deepEqual(locked.snapshot(),guards);
  const clipped = structuredClone(document);
  clipped.layers.unshift({ id:'mask' });
  clipped.layers[1].clip = 'mask';
  clipped.frames[0].cels.mask = { marks:[{ swatch:'cool',shape:{ type:'rect',rect:[1,1,2,2] } }] };
  const intoClip = ink.createPixelEditor(clipped);
  assert.equal(intoClip.previewEdit(patch(intoClip,'blocked-clip',transform,{ cel:'drawing' })).conflicts[0].code,'clipped-pixel');
  const copied = editor.apply(patch(editor,'clone',{ ...transform,mode:'copy',transform:{ at:[4,2] } },{ cel:'drawing' }));
  assert.equal(ink.createPixelEditor(copied).sample([1,1]).swatch,'rust');
  assert.equal(editor.sample([4,2]).alpha,128);
});

test('CLI and working sessions copy portable pixels and replay paste into another palette', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-transform-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json');
  const write = (name,data)=>fs.writeFileSync(file(name),JSON.stringify(data));
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  write('source',document);
  const clipboard = cli('copy',file('source'),'--selection','badge','--cel','drawing');
  assert.deepEqual(clipboard,ink.createPixelEditor(document).copySelection({ selection:'badge',layer:'ink' }));
  assert.deepEqual(clipboard.slots,[0,1,-2,-1]);
  const session = path.join(dir,'session');
  cli('session','init',session,file('source'));
  assert.deepEqual(cli('session','copy',session,'--selection','badge','--layer','ink'),clipboard);
  const target = { ...document,palette:{ rust:'#8899aa' },selections:[],
    frames:[{ id:'front',durationMs:100,cels:{} }] };
  write('target',target);
  const operation = { tool:'paste',layer:'ink',clipboard,transform:{ at:[3,2],angle:90 },resultSelection:'pasted' };
  write('paste',patch(ink.createPixelEditor(target),'paste-badge',operation));
  const preview = cli('preview',file('target'),file('paste'));
  assert.deepEqual(preview.targets[0].addedSwatches,['brush-cc381a']);
  write('receipt',cli('edit',file('target'),file('paste'),'--out',file('edited')));
  cli('replay',file('target'),file('receipt'),'--out',file('replayed'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('replayed'),'utf8'));
  const editor = ink.createPixelEditor(JSON.parse(fs.readFileSync(file('edited'),'utf8')));
  assert.deepEqual([editor.sample([4,2]).color,editor.sample([4,2]).alpha],['#cc381a',128]);
  assert.equal(editor.sample([3,2],{ mode:'layer',layer:'ink' }).knockout,true);
});
