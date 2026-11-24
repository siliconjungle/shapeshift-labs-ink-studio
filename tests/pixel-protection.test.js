const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ink = require('..');
const PixelArt = require('../cli/pixel-art.js');

function document() {
  const width = 6, height = 3;
  const slots = Array(width*height).fill(null);
  slots[0] = 'red';
  slots[1] = slots[6] = slots[7] = 'blue';
  slots[16] = 'yellow';
  return { format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],
    palette:{ red:'#cf424a',blue:'#244976',yellow:'#fcdc78' },layers:[{ id:'ink' }],
    frames:['start','hold','end','after'].map(id=>({ id,durationMs:100,cels:{ ink:{ slots:[...slots],marks:[] } } })),
    selections:[{ id:'seam',pixels:[[0,1],[1,1]] },{ id:'patch',frame:'hold',pixels:[[4,2],[5,2]] }] };
}

const change = (editor,destination,operation,frame) => ({ id:'test-edit',revision:editor.describe().revision,
  destination,operation,...(frame && { frame }) });
const protection = (editor,operation) => change(editor,'document:protection',operation);
const transform = (editor,position,settings = {})=>change(editor,'raster',{ tool:'transform',layer:'ink',selection:'patch',
  transform:{ at:position,...settings },carryProtection:true },'hold');

test('named locks cover ranges, preserve legacy rows, and block indirect edits and cleanup', () => {
  const source = document();
  source.protectedDetails = [{ id:'old',frame:'start',pixels:[[0,0]] }];
  const editor = ink.createPixelEditor(source);
  const lock = protection(editor,{ type:'set',id:'crack',kind:'gap',frames:['hold','end'],pixels:[[5,2]] });
  const preview = editor.previewEdit(lock);
  assert.equal(preview.valid,true);
  assert.deepEqual(preview.pixels.map(pixel=>pixel.frame),['hold','end']);
  assert.equal(preview.targets[0].after.kind,'gap');

  editor.apply(lock);
  const [receipt] = editor.receipts();
  assert.deepEqual(ink.createPixelEditor(source).replay(receipt),editor.snapshot());
  editor.apply(protection(editor,{ type:'set',id:'seam',kind:'contour',selection:'seam' }));
  editor.apply(protection(editor,{ type:'set',id:'glint',kind:'accent',frame:'hold',pixels:[[4,2]] }));
  assert.deepEqual(editor.inspect([5,2],{ frame:'hold' }).protection,[{
    id:'crack',kind:'gap',frames:['hold','end']
  }]);
  assert.equal(editor.inspect([5,2],{ frame:'end' }).protected,true);
  assert.equal(editor.inspect([5,2],{ frame:'after' }).protected,false);
  assert.deepEqual(editor.inspect([1,1],{ frame:'after' }).protection,[{ id:'seam',kind:'contour' }]);
  assert.equal(editor.inspect([0,0],{ frame:'start' }).protection[0].id,'old');
  assert.throws(()=>editor.apply(protection(editor,{ type:'set',id:'filled',kind:'gap',pixels:[[4,2]] })),
    /must be transparent/);
  assert.throws(()=>editor.apply(protection(editor,{ type:'set',id:'reverse',kind:'pixel',frames:['end','hold'],pixels:[[4,2]] })),
    /document order/);
  const layer = change(editor,'document:layers',{ type:'update',layer:'ink',changes:{ visible:false } });
  assert.equal(editor.previewEdit(layer).conflicts[0].code,'protected-pixel');
  const global = change(editor,'document:palette',{ type:'swatch',swatch:{ id:'yellow',color:'#ffffff' } });
  assert.equal(editor.previewEdit(global).conflicts[0].detail,'glint');
  const erase = change(editor,'raster',{ tool:'eraser',layer:'ink',points:[[4,2]] },'hold');
  assert.equal(editor.previewEdit(erase).conflicts[0].code,'protected-pixel');
  const cleanup = change(editor,'document:adjustments',{ scope:{ frames:['hold','end'],layer:'ink' },
    adjustment:{ type:'outline',swatch:'blue',radius:1,side:'outside' } });
  assert.equal(editor.previewEdit(cleanup).conflicts[0].code,'protected-pixel');
  const summary = PixelArt.review(PixelArt.compile(editor.snapshot(),'hold')).report;
  assert.ok(summary.protectedDetails.some(row=>row.id === 'crack' && row.pixelCount === 1));
  const deck = editor.layerDeck();
  assert.deepEqual(PixelArt.documentFromDeck(deck).protectedDetails,editor.snapshot().protectedDetails);

  editor.apply(protection(editor,{ type:'remove',id:'crack' }));
  assert.equal(editor.inspect([5,2],{ frame:'hold' }).protected,false);
  assert.equal(editor.undo(),true);
  assert.equal(editor.inspect([5,2],{ frame:'hold' }).protected,true);
  assert.equal(editor.redo(),true);
  assert.equal(editor.inspect([5,2],{ frame:'hold' }).protected,false);
});

test('canvas resampling retains unsampled transparent gaps and exact accents with per-frame scope', () => {
  const source = document();
  source.protectedDetails = [
    { id:'glint',kind:'accent',frame:'hold',pixels:[[0,0]] },
    { id:'slot',kind:'gap',frames:['hold','end'],pixels:[[2,1]] }
  ];
  const editor = ink.createPixelEditor(source);
  const canvas = operation=>change(editor,'document:canvas',operation);
  const before = editor.snapshot();
  const crop = editor.previewEdit(canvas({ type:'crop',rect:[1,0,5,3] }));
  assert.match(crop.conflicts[0].message,/discard protected detail glint/);
  assert.deepEqual(editor.snapshot(),before);
  const output = editor.apply(canvas({ type:'resample',size:[3,1],filter:'area' }));
  assert.deepEqual(output.protectedDetails.map(row=>row.pixels),[[[0,0]],[[1,0]]]);
  assert.equal(editor.inspect([0,0],{ frame:'hold' }).composite.color,'#cf424a');
  assert.equal(editor.inspect([0,0],{ frame:'after' }).composite.color,'#244976');
  assert.equal(editor.inspect([1,0],{ frame:'end' }).composite.alpha,0);
  assert.equal(editor.inspect([1,0],{ frame:'after' }).protected,false);
  const padded = editor.apply(canvas({ type:'pad',margins:[1,2,0,0] }));
  assert.deepEqual(padded.protectedDetails.map(row=>row.pixels),[[[1,2]],[[2,2]]]);
  assert.equal(editor.inspect([1,2],{ frame:'hold' }).composite.color,'#cf424a');

  source.protectedDetails.push({ id:'colliding-ink',kind:'contour',frame:'hold',pixels:[[1,1]] });
  const conflict = ink.createPixelEditor(source);
  const resize = change(conflict,'canvas',{ type:'resample',size:[3,1],filter:'nearest' });
  assert.match(conflict.previewEdit(resize).conflicts[0].message,/combine different protected pixels/);
});

test('moving a fully selected frame lock carries its exact pigment or gap with undo and replay', () => {
  const source = document();
  source.protectedDetails = [
    { id:'glint',kind:'accent',frame:'hold',pixels:[[4,2]] },
    { id:'space',kind:'gap',frame:'hold',pixels:[[5,2]] }
  ];
  const editor = ink.createPixelEditor(source);
  assert.equal(editor.previewEdit(transform(editor,[0,0])).conflicts[0].detail,'space');
  const patch = transform(editor,[3,0],{ flipX:true });
  assert.equal(editor.previewEdit({ ...patch,operation:{ ...patch.operation,carryProtection:false } }).conflicts[0].code,'protected-pixel');
  const preview = editor.previewEdit(patch);
  assert.equal(preview.valid,true);
  assert.deepEqual(preview.targets[0].carriedProtection.map(row=>row.pixels),[[[4,0]],[[3,0]]]);
  const updated = editor.apply(patch);
  assert.equal(editor.inspect([4,0],{ frame:'hold' }).swatch,'yellow');
  assert.equal(editor.inspect([4,2],{ frame:'hold' }).protected,false);
  assert.equal(editor.inspect([3,0],{ frame:'hold' }).protection[0].id,'space');
  assert.deepEqual(ink.createPixelEditor(source).replay(editor.receipts()[0]),updated);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),source);

  const shared = ink.createPixelEditor({ ...source,protectedDetails:[{ id:'all',kind:'accent',pixels:[[4,2]] }] });
  assert.match(shared.previewEdit(transform(shared,[3,0])).conflicts[0].message,/locked to this frame/);
});


test('CLI authoring and references preserve locks on the native authored composite', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-authored-protection-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const file = name=>path.join(directory,name+'.json');
  const put = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  const source = document();
  source.layers.push({ id:'guide',kind:'reference' });
  source.frames[1].cels.guide = { marks:[{ at:[5,2],swatch:'blue' }] };
  const editor = ink.createPixelEditor(source);
  put('source',source);
  put('edit',protection(editor,{ type:'set',id:'cut',kind:'gap',frames:['hold','end'],pixels:[[5,2]] }));
  assert.equal(run('preview',file('source'),file('edit')).valid,true);
  const receipt = run('edit',file('source'),file('edit'),'--out',file('locked'));
  assert.equal(receipt.affectedTargets[0].id,'cut');
  put('receipt',receipt);
  run('replay',file('source'),file('receipt'),'--out',file('replayed'));
  assert.deepEqual(fs.readFileSync(file('locked')),fs.readFileSync(file('replayed')));
  const inspect = (...opts)=>run('inspect',file('locked'),'--frame','hold','--at','5,2',...opts);
  assert.equal(inspect().composite.alpha,0);
  const guide = inspect('--references');
  assert.equal(guide.composite.layer,'guide');
  assert.deepEqual(guide.protection,[{ id:'cut',kind:'gap',frames:['hold','end'] }]);
});
