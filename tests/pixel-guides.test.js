const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const stamps = require('../src/pixel-stamps.js');
const { validate } = require('../cli/pixel-art.js');

const design = {
  format:'ink-studio/pixel-art',version:2,width:16,height:16,pixelAspect:[1,1],palette:{ ink:'#15263a' },
  layers:[{ id:'base' }],frames:[
    { id:'front',durationMs:100,cels:{ base:{ marks:[{ at:[4,4],swatch:'ink' }] } } },
    { id:'side',durationMs:100,cels:{} }
  ],
  guides:[
    { id:'tile',kind:'grid',at:[1,2],step:[4,4] },
    { id:'vertical',kind:'axis',axis:'x',at:5 },
    { id:'front-pin',kind:'registration',at:[6.5,7],frame:'front' },
    { id:'side-pivot',kind:'pivot',at:[11,11],frame:'side' }
  ]
};

test('guide snapping resolves independent axes, lattice origins, and frame-local point anchors', () => {
  const editor = ink.createPixelEditor(design);
  assert.deepEqual(editor.snap([5.4,6.2],{ frame:'front' }).hits,{ x:'vertical',y:'tile' });
  const registration = editor.snap([7.1,7.2],{ frame:'front' });
  assert.deepEqual(registration.position,[6.5,7]);
  assert.deepEqual(registration.at,[7,7]);
  assert.deepEqual(registration.hits,{ point:'front-pin' });
  assert.deepEqual(editor.snap([7.1,7.2],{ frame:'side' }).hits,{});
  assert.deepEqual(editor.snap([10.7,10.5],{ frame:'side' }).hits,{ point:'side-pivot' });
  assert.deepEqual(editor.snap([7.1,7.2],{ radius:.25 }).hits,{});
  assert.throws(()=>editor.snap([1,2],{ radius:-1 }),/radius/);

  const guides = require('../src/pixel-guides.js');
  const same = [{ id:'b',kind:'axis',axis:'x',at:5 },{ id:'a',kind:'axis',axis:'x',at:5 }];
  assert.deepEqual(guides.snap(same,[5,3],{ width:16,height:16 }).hits,{ x:'a' });
  const cyclic = [{ id:'repeat',kind:'grid',at:[-3,-2],step:[4,4] }];
  assert.deepEqual(guides.snap(cyclic,[3,4],{ width:16,height:16,radius:2 }).at,[1,2]);
  assert.throws(()=>validate({ ...design,guides:[...design.guides,design.guides[0]] }),/unique IDs/);
  assert.throws(()=>validate({ ...design,guides:[{ ...design.guides[2],frame:'ghost' }] }),/known frame/);
  assert.throws(()=>validate({ ...design,guides:[{ ...design.guides[0],step:[0,4] }] }),/positive integer steps/);
  assert.throws(()=>validate({ ...design,guides:[{ ...design.guides[2],at:[1.25,5] }] }),/native coordinates/);
});

test('guide edits share preview, revision guards, receipts and persisted undo', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-guides-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const editor = ink.createPixelEditor(design,{ sessionDirectory:directory });
  const before = editor.stamp();
  const patch = { id:'move-guides',revision:editor.describe().revision,destination:'guides',
    operation:{ upsert:[{ ...design.guides[2],at:[7,8] }],remove:['vertical'] } };
  const proposed = editor.previewEdit(patch);
  assert.equal(proposed.pixelCount,0);
  assert.deepEqual(proposed.guides.map(({ id,change }) => [id,change]),[['vertical','removed'],['front-pin','modified']]);
  editor.begin('Align the front pose');
  editor.apply(patch);
  assert.equal(editor.closeSession(),true);
  const resumed = ink.openPixelEditorSession(directory);
  assert.equal(resumed.sessionStatus().pending,true);
  assert.deepEqual(resumed.previewChanges(),proposed);
  assert.equal(resumed.commit(),true);
  assert.deepEqual(resumed.stamp().slots,before.slots);
  assert.notEqual(resumed.describe().revision,patch.revision);
  const [receipt] = resumed.receipts();
  assert.equal(receipt.outputs.kind,'guides');
  assert.deepEqual(receipt.affectedTargets[0].guides,[{ id:'vertical',change:'removed' },{ id:'front-pin',change:'modified' }]);
  assert.throws(()=>resumed.apply(patch),/observed revision/);
  assert.throws(()=>resumed.apply({ ...patch,revision:resumed.describe().revision }),/Unknown pixel guide/);
  assert.equal(resumed.undo(),true);
  assert.deepEqual(resumed.stamp(),before);
  assert.equal(resumed.redo(),true);
  assert.deepEqual(ink.createPixelEditor(design).replay(receipt),resumed.snapshot());
  assert.deepEqual(resumed.stamp({ frame:'side' }).guides.map(guide=>guide.id),['tile','side-pivot']);
  assert.equal(resumed.stamp({ frame:'side' }).guides[1].frame,undefined);

  const cwd = path.resolve(__dirname,'..');
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],{ cwd,encoding:'utf8' }));
  const input = path.join(directory,'original.json');
  fs.writeFileSync(input,JSON.stringify(design));
  assert.deepEqual(cli('snap',input,'--at','7.1,7.2','--frame','front'),ink.createPixelEditor(design).snap([7.1,7.2]));
  assert.deepEqual(cli('session','snap',directory,'--at','7,8','--frame','front'),resumed.snap([7,8]));
  const patchFile = path.join(directory,'patch.json'), output = path.join(directory,'guided.json');
  fs.writeFileSync(patchFile,JSON.stringify(patch));
  assert.equal(cli('edit',input,patchFile,'--out',output).outputs.documentRevision,resumed.describe().revision);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),resumed.snapshot());
});

test('a stamp can explicitly carry each frame’s native pivot into its atlas', () => {
  const stamp = { width:8,height:6,palette:['#ab8627'],frames:[
    { rows:Array(6).fill('0.......'),guides:[{ id:'foot',kind:'pivot',at:[1,3.5] }] },
    { rows:Array(6).fill('0.......'),guides:[{ id:'foot',kind:'pivot',at:[2.5,3] }] }
  ] };
  const pivots = atlas => [0,1].map(frame=>atlas.select(frame,'card').pivot);
  assert.deepEqual(pivots(stamps.atlas(stamp,{ pivotGuide:'foot' })),[{ x:1.5,y:4 },{ x:3,y:3.5 }]);
  assert.deepEqual(pivots(stamps.atlas(stamp)),[{ x:4,y:3 },{ x:4,y:3 }]);
  assert.throws(()=>stamps.atlas(stamp,{ pivotGuide:'missing' }),/matching pivot guide/);
});
