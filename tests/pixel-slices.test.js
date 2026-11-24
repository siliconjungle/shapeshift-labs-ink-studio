'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { createPixelEditor } = require('..');
const { documentFromDeck } = require('../cli/pixel-art.js');
const PNG = require('../cli/png.js');

const source = {
  format:'ink-studio/pixel-art',version:2,width:8,height:7,pixelAspect:[1,1],
  palette:{ rust:'#ad5437',ivory:'#fff6d3' },layers:[{ id:'ink' }],
  frames:[
    { id:'idle',durationMs:100,cels:{ ink:{ marks:[
      {swatch:'rust',at:[2,2]}, {swatch:'ivory',at:[3,3]}, {alpha:17,runs:[[3,3,1]]}
    ] } } },
    { id:'held',durationMs:100,cels:{ ink:{ hold:'idle/ink' } } },
    { id:'speak',durationMs:150,cels:{} },
    { id:'tail',durationMs:100,cels:{} }
  ],
  slices:[
    { id:'panel',label:'Speech panel',keys:[
      { frame:'speak',bounds:[2,2,5,4],pivot:[2,.5],nineSlice:[1,1,1,1] },
      { frame:'idle',bounds:[1,1,6,5],pivot:[2.5,3],nineSlice:[1,1,1,1] }
    ] },
    { id:'badge',keys:[{ frame:'speak',bounds:[4,3,1,1] }] }
  ]
};
const patch = (editor,destination,operation)=>({ id:'slice-edit',destination,revision:editor.slices().revision,operation });
const active = (editor,frame)=>editor.slices({ frame }).active;
const at = ({w,rgba},x,y)=>[...rgba.subarray((y*w+x)*4,(y*w+x)*4+4)];

test('slice keys follow frame order and support guarded edits, undo and replay',()=>{
  const editor = createPixelEditor(source);
  assert.deepEqual(active(editor,'held'),[{ id:'panel',label:'Speech panel',keyFrame:'idle',
    bounds:[1,1,6,5],pivot:[2.5,3],registration:[3.5,4],nineSlice:[1,1,1,1],stretch:[1,1,4,3] }]);
  assert.deepEqual(active(editor,'tail').map(row=>[row.id,row.keyFrame]),[['panel','speak'],['badge','speak']]);
  assert.throws(()=>editor.slice('badge',{frame:'idle'}),/no active key/);
  const operation = { type:'set-slice-key',id:'panel',label:'Dialogue',key:{
    frame:'held',bounds:[3,1,4,5],pivot:[-1,3.5],nineSlice:[1,2,1,1]
  } };
  const request = patch(editor,'timeline',operation);
  const preview = editor.previewEdit(request);
  assert.equal(preview.valid,true);
  assert.equal(preview.pixelCount,0);
  assert.equal(preview.targets[0].before.keys.length,2);
  assert.deepEqual(preview.targets[0].after.keys.at(-1),operation.key);
  assert.equal(active(editor,'held')[0].keyFrame,'idle');
  editor.apply(request);
  assert.equal(editor.previewEdit(request).conflicts[0].code,'stale-document');
  assert.equal(active(editor,'held')[0].keyFrame,'held');
  assert.deepEqual(active(editor,'held')[0].registration,[2,4.5]);
  assert.deepEqual(active(editor,'held')[0].stretch,[1,2,2,2]);
  assert.deepEqual(active(editor,'speak')[0].bounds,[2,2,5,4]);
  assert.deepEqual(documentFromDeck(editor.layerDeck()).slices,editor.snapshot().slices);
  editor.undo();
  assert.deepEqual(editor.snapshot(),source);
  editor.redo();
  editor.apply(patch(editor,'timeline',{ type:'remove-slice-key',id:'panel',frame:'held' }));
  assert.equal(active(editor,'held')[0].keyFrame,'idle');
  editor.apply(patch(editor,'timeline',{ type:'remove-slice',id:'badge' }));
  assert.equal(active(editor,'speak').length,1);
  const replay = createPixelEditor(source);
  for (const receipt of editor.receipts()) replay.replay(receipt);
  assert.deepEqual(replay.snapshot(),editor.snapshot());
});

test('invalid keys and crops reject atomically and transforms retain registration',()=>{
  const editor = createPixelEditor(source);
  const check = (key,error)=>assert.match(editor.previewEdit(patch(editor,'timeline',{
    type:'set-slice-key',id:'panel',key:{ frame:'held',bounds:[0,0,3,3],...key }
  })).conflicts[0].message,error);
  check({ frame:'missing' },/known frames/);
  check({ bounds:[-1,0,3,3] },/integer/);
  check({ bounds:[0,0,9,3] },/inside/);
  check({ pivot:[1,.25] },/half-pixel/);
  check({ nineSlice:[1,0,2,0] },/nonempty stretch/);
  const lost = editor.previewEdit(patch(editor,'canvas',{type:'crop',rect:[2,2,1,2]}));
  assert.match(lost.conflicts[0].message,/remove the stretch area/);
  assert.deepEqual(editor.snapshot(),source);
  const crop = patch(editor,'canvas',{type:'crop',rect:[2,0,6,7]});
  assert.deepEqual(editor.previewEdit(crop).targets[0].slices.after[0].keys[1].nineSlice,[0,1,1,1]);
  editor.apply(crop);
  assert.deepEqual(active(editor,'held')[0].bounds,[0,1,5,5]);
  assert.deepEqual(active(editor,'held')[0].registration,[1.5,4]);
  editor.undo();
  editor.apply(patch(editor,'canvas',{type:'resample',size:[16,14]}));
  assert.deepEqual(active(editor,'idle')[0].bounds,[2,2,12,10]);
  assert.deepEqual(active(editor,'idle')[0].pivot,[5.5,6.5]);
  assert.deepEqual(active(editor,'idle')[0].nineSlice,[2,2,2,2]);
  editor.undo();
  editor.apply(patch(editor,'canvas',{type:'pad',margins:[2,1,0,0]}));
  assert.deepEqual(active(editor,'idle')[0].bounds,[3,2,6,5]);
  assert.deepEqual(active(editor,'idle')[0].pivot,[2.5,3]);
  editor.undo();
  editor.apply(patch(editor,'canvas',{type:'trim'}));
  assert.deepEqual(editor.describe().grid,[6,5]);
  assert.deepEqual(active(editor,'idle')[0].bounds,[0,0,6,5]);
});

test('CLI exports a native slice and matching pivot and stretch metadata',t=>{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-slices-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const file = path.join(directory,'document.json'), out = path.join(directory,'panel.png'), metadata = path.join(directory,'panel.json');
  fs.writeFileSync(file,JSON.stringify(source));
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'pixel-art',...args],{ encoding:'utf8' });
  const inspection = JSON.parse(cli('slices','inspect',file,'--frame','held'));
  assert.equal(inspection.active[0].keyFrame,'idle');
  cli('slices','export',file,'--slice','panel','--frame','held','--out',out,'--metadata',metadata);
  const { raster,...report } = createPixelEditor(source).slice('panel',{ frame:'held' }), png = PNG.raster(out);
  assert.deepEqual(JSON.parse(fs.readFileSync(metadata,'utf8')),report);
  assert.deepEqual([png.w,png.h],[6,5]);
  assert.deepEqual(at(raster,1,1),[173,84,55,255]);
  assert.deepEqual(at(raster,2,2),[255,246,211,17]);
  assert.deepEqual(at(raster,0,0),[0,0,0,0]);
  assert.deepEqual(Uint8Array.from(png.data),raster.rgba);
});
