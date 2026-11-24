const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const canvas = require('../src/pixel-canvas-transforms.js');
const { compile } = require('../cli/pixel-art.js');

const document = {
  format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,2],
  palette:{ rust:'#cc381a',blue:'#204968' },
  layers:[{ id:'base' },{ id:'ink',clip:'base' }],
  frames:[
    { id:'front',durationMs:120,cels:{
      base:{ marks:[{ swatch:'blue',shape:{ type:'rect',rect:[2,1,3,2] } }] },
      ink:{ id:'glaze',marks:[{ swatch:'rust',at:[2,1] },{ alpha:128,runs:[[1,2,1]] },
        { swatch:null,at:[3,1] },{ swatch:'rust',at:[5,1] }] }
    } },
    { id:'rear',durationMs:240,cels:{ base:{ marks:[{ swatch:'blue',at:[7,5] }] } } }
  ],
  guides:[{ id:'pivot',kind:'pivot',at:[2.5,1],frame:'front' },
    { id:'grid',kind:'grid',at:[0,0],step:[4,2] }],
  selections:[{ id:'line',frame:'front',pixels:[[0,0],[2,1],[3,1]] }],
  protectedDetails:[{ id:'hold',pixels:[[7,0],[2,1]] }]
};
const request = (editor,operation,id = operation.type) => ({
  id,destination:'canvas',revision:editor.describe().revision,operation
});

test('canvas grid plans keep pixels whole and area filtering preserves the indexed palette', () => {
  const raster = (operation,slots,alpha)=>canvas.raster(canvas.plan(2,2,operation),slots,alpha);
  const art = [0,null,1,-2], alpha = [255,255,128,255];
  assert.deepEqual(raster({ type:'resize',size:[3,3],anchor:'bottom-right' },art,alpha).slots,
    [null,null,null,null,0,null,null,1,-2]);
  assert.deepEqual(raster({ type:'resize',size:[1,1],anchor:'bottom-right' },art).slots,[-2]);
  assert.deepEqual(raster({ type:'resample',size:[1,1] },art),{ slots:[-2] });
  assert.deepEqual(raster({ type:'resample',size:[1,1],filter:'area' },art,alpha),{ slots:[0],alpha:[96] });
  assert.deepEqual(raster({ type:'resample',size:[1,1],filter:'area' },[1,0,null,null]),
    { slots:[0],alpha:[128] });
  assert.throws(()=>canvas.plan(2,2,{ type:'crop',rect:[1,0,2,1] }),/in-bounds/);
  assert.throws(()=>canvas.plan(512,2,{ type:'pad',margins:[1,0,0,0] }),/dimensions/);
});

test('crop previews all frames and carries individual cels, masks and guides through undo and replay', () => {
  const editor = ink.createPixelEditor(document);
  const crop = request(editor,{ type:'crop',rect:[2,1,4,3] });
  const preview = editor.previewEdit(crop);
  assert.deepEqual(preview.conflicts,[]);
  const [target] = preview.targets;
  assert.deepEqual(target.beforeGrid,[8,6]);
  assert.deepEqual(target.grid,[4,3]);
  assert.deepEqual(target.droppedProtected,[{ id:'hold',pixels:1 }]);
  assert.equal(preview.pixels.find(pixel=>pixel.frame === 'rear' && pixel.at[0] === 7).after,null);
  assert.deepEqual(editor.snapshot(),document);

  const cropped = editor.apply(crop), [receipt] = editor.receipts();
  assert.equal(receipt.command.frame,null);
  assert.deepEqual(receipt.affectedTargets[0],target);
  assert.deepEqual(cropped.pixelAspect,[1,2]);
  assert.deepEqual(cropped.layers,document.layers);
  assert.deepEqual(cropped.frames.map(frame=>[frame.id,frame.durationMs]),[['front',120],['rear',240]]);
  const sample = point=>editor.sample(point,{ mode:'layer',cel:'glaze' });
  assert.deepEqual([sample([0,0]).swatch,sample([0,0]).alpha],['rust',128]);
  assert.equal(sample([1,0]).knockout,true);
  assert.deepEqual([sample([3,0]).swatch,sample([3,0]).clipped],['rust',true]);
  assert.deepEqual(cropped.guides.map(guide=>guide.at),[[.5,0],[-2,-1]]);
  assert.deepEqual(cropped.selections[0].pixels,[[0,0],[1,0]]);
  assert.deepEqual(cropped.protectedDetails[0].pixels,[[0,0]]);
  assert.deepEqual(ink.createPixelEditor(document).replay(receipt),cropped);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),document);
  assert.equal(editor.redo(),true);
  assert.deepEqual(editor.snapshot(),cropped);
});

test('trim includes visible pixels on all frames and protected blank pixels', () => {
  const original = structuredClone(document);
  original.protectedDetails[0].pixels = [[1,4]];
  const editor = ink.createPixelEditor(original);
  const transformed = editor.apply(request(editor,{ type:'trim' }));
  assert.deepEqual([transformed.width,transformed.height],[7,5]);
  assert.deepEqual(transformed.protectedDetails[0].pixels,[[0,3]]);
  assert.equal(editor.sample([6,4],{ frame:'rear' }).swatch,'blue');
  const empty = { ...document,frames:[{ id:'empty',durationMs:100,cels:{} }],guides:[],
    selections:[],protectedDetails:[] };
  const blank = ink.createPixelEditor(empty);
  assert.deepEqual(blank.apply(request(blank,{ type:'trim' })),empty);
});

test('preserve composes chart coordinates and reframe maps the entire new grid', () => {
  const scene = { id:'panel',style:'slate',solids:[
    { id:'wall',kind:'box',at:[0,0,0],half:[1,1,.25],res:.12,mat:'stone',
      surfaceState:{ charts:{ front:{ origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0],stamps:[
        { channel:'wear',brush:{ kind:'rect',min:[0,0],max:[.5,1] },value:.625 }
      ] } } } }
  ] };
  const bound = { ...document,sceneBindings:[{ id:'source',scene:'panel',object:'wall',frame:'front' }],
    destinations:[{ id:'wear',kind:'surface-channel',binding:'source',chart:'front',channel:'wear' }] };
  const editor = ink.createPixelEditor(bound,{ sceneEditor:ink.createSceneEditor(scene) });
  const fromChart = { mode:'source',destination:'wear' };
  const original = editor.sample([2,1],fromChart);
  assert.equal(original.value,.625);
  const crop = { type:'crop',rect:[2,1,4,3] };
  assert.match(editor.previewEdit(request(editor,crop)).conflicts[0].message,/bindingPolicy/);
  const preserved = editor.apply(request(editor,{ ...crop,bindingPolicy:'preserve' }));
  assert.deepEqual(preserved.sceneBindings[0].canvas,{ size:[8,6],offset:[2,1],scale:[1,1] });
  assert.deepEqual(editor.sample([0,0],fromChart).uv,original.uv);
  const padded = editor.apply(request(editor,{ type:'pad',margins:[1,0,0,0],bindingPolicy:'preserve' }));
  assert.deepEqual(padded.sceneBindings[0].canvas,{ size:[8,6],offset:[1,1],scale:[1,1] });
  assert.deepEqual(editor.sample([1,0],fromChart).uv,original.uv);
  const reframed = editor.apply(request(editor,{ type:'resize',size:[5,3],bindingPolicy:'reframe' }));
  assert.deepEqual(reframed.sceneBindings,bound.sceneBindings);
  assert.deepEqual(editor.sample([1,0],fromChart).uv,[.3,1-.5/3]);
  assert.equal(editor.sample(undefined,{ ...fromChart,uv:[.25,.75] }).value,.625);

  const paddedBeyondSource = ink.createPixelEditor(bound,{ sceneEditor:ink.createSceneEditor(scene) });
  paddedBeyondSource.apply(request(paddedBeyondSource,{ type:'pad',margins:[1,0,0,0],bindingPolicy:'preserve' }));
  assert.deepEqual(paddedBeyondSource.stamp().sceneBindings[0].canvas,{ size:[8,6],offset:[-1,0],scale:[1,1] });
  assert.equal(paddedBeyondSource.sample([0,0],fromChart).uv,null);
  assert.equal(paddedBeyondSource.sample([0,0],fromChart).value,null);
  const selection = paddedBeyondSource.select({ type:'channel',destination:'wear',range:[0,1] });
  assert.equal(selection.pixels.length,48);
  assert.ok(selection.pixels.every(([x])=>x > 0));
});

test('legacy revisions and user-defined destinations named canvas remain usable', () => {
  const legacy = { format:'ink-studio/pixel-art',version:1,width:2,height:2,
    palette:{ rust:'#cc381a' },layers:[{ id:'ink',marks:[{ at:[1,1],swatch:'rust' }] }] };
  const original = ink.createPixelEditor(legacy);
  original.apply({ ...request(original,{ type:'crop',rect:[1,1,1,1] }),revision:compile(legacy).revision });
  assert.equal(original.sample([0,0]).swatch,'rust');

  const custom = ink.createPixelEditor({ ...document,destinations:[{ id:'canvas',kind:'raster' }] });
  const pad = request(custom,{ type:'pad',margins:[1,0,0,0] });
  const padded = custom.apply({ ...pad,destination:'document:canvas' });
  assert.equal(padded.width,9);
  assert.deepEqual(padded.destinations,[{ id:'canvas',kind:'raster' }]);
});

test('CLI and persistent sessions preview, apply and replay a whole-canvas edit', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-canvas-transforms-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  const file = name=>path.join(dir,name+'.json');
  const write = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const cli = (...args)=>JSON.parse(execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' }));
  write('document',document);
  write('patch',request(ink.createPixelEditor(document),{ type:'pad',margins:[1,1,0,0] }));
  assert.deepEqual(cli('preview',file('document'),file('patch')).targets[0].grid,[9,7]);
  write('receipt',cli('edit',file('document'),file('patch'),'--out',file('edited')));
  cli('replay',file('document'),file('receipt'),'--out',file('replayed'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('replayed'),'utf8'));

  const session = path.join(dir,'session');
  cli('session','init',session,file('document'));
  cli('session','begin',session);
  cli('session','apply',session,file('patch'));
  assert.deepEqual(cli('session','preview',session).targets[0].grid,[9,7]);
  cli('session','commit',session);
  cli('session','undo',session);
  cli('session','redo',session);
  cli('session','export',session,'--out',file('session-edited'));
  assert.equal(fs.readFileSync(file('edited'),'utf8'),fs.readFileSync(file('session-edited'),'utf8'));
});
