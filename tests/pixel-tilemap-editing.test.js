'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout:pause } = require('node:timers/promises');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { createPixelEditor } = require('..');
const { documentFromDeck } = require('../cli/pixel-art.js');
const { withChrome } = require('../cli/canvas-grid-chrome.js');
const PNG = require('../cli/png.js');
const { build } = require('../scripts/build.js');

const root = path.resolve(__dirname,'..');
const source = {
  format:'ink-studio/pixel-art',version:2,width:3,height:2,pixelAspect:[1,1],
  palette:{ stone:'#3c6672',gold:'#ffc55c' },layers:[{ id:'art' }],
  frames:[
    { id:'wall',durationMs:100,cels:{ art:{ marks:[
      { swatch:'stone',at:[1,1] },{ swatch:'gold',at:[2,0] },{ alpha:1,runs:[[0,2,1]] }
    ] } } },
    { id:'lamp',durationMs:100,cels:{ art:{ marks:[{ swatch:'gold',at:[1,1] }] } } }
  ],
  tilemap:{ version:1,width:4,height:2,cells:[
    { at:[0,0],tile:'wall' },{ at:[2,0],tile:'wall' },{ at:[3,1],tile:'lamp' }
  ] }
};
const wall = [60,102,114,255], gold = [255,197,92,255], empty = [0,0,0,0];
const pixel = ({w,rgba},x,y)=>Array.from(rgba.subarray((y*w+x)*4,(y*w+x)*4+4));
const patch = (editor,operation)=>({
  id:'tilemap-stroke',destination:'timeline',revision:editor.tilemap().revision,operation
});
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tilemap-'));
  t.after(()=>fs.rmSync(dir,{ force:true,recursive:true }));
  return dir;
}

test('placement strokes and tile pixels share undo, replay, preview and the saved document',()=>{
  const editor = createPixelEditor(source), before = editor.tilemapRaster();
  assert.deepEqual([before.w,before.h],[12,4]);
  assert.deepEqual(pixel(before,1,1),wall);
  assert.deepEqual(pixel(before,7,1),wall);
  assert.deepEqual(pixel(before,4,1),empty);
  assert.deepEqual(editor.tilemap([2,0]).picked,{ at:[2,0],tile:'wall' });
  assert.throws(()=>editor.tilemap([4,0]),/inside the tilemap/);

  const stroke = patch(editor,{ type:'place-tiles',points:[[1,0],[2,0]],tile:'lamp' });
  const preview = editor.previewEdit(stroke);
  assert.equal(preview.valid,true);
  assert.deepEqual(preview.targets[0].changes,[
    { at:[1,0],before:null,after:'lamp' },{ at:[2,0],before:'wall',after:'lamp' }
  ]);
  assert.deepEqual(editor.tilemapRaster(),before);
  editor.apply(stroke);
  assert.equal(editor.previewEdit(stroke).conflicts[0].code,'stale-document');
  assert.deepEqual(editor.tilemap().tiles.map(tile=>tile.placements),[1,3]);
  const placed = editor.tilemapRaster();
  assert.deepEqual(pixel(placed,4,1),gold);
  assert.deepEqual(pixel(placed,7,1),gold);

  const paint = { id:'relight-lamp',frame:'lamp',revision:editor.tilemap().revision,
    operation:{ tool:'pencil',layer:'art',points:[[1,1]],swatch:'stone' } };
  editor.apply(paint);
  const after = editor.tilemapRaster();
  for (const xy of [[4,1],[7,1],[10,3]]) assert.deepEqual(pixel(after,...xy),wall);
  assert.deepEqual(editor.snapshot().tilemap.cells.map(row=>row.tile),['wall','lamp','lamp','lamp']);
  const replay = createPixelEditor(source);
  for (const receipt of editor.receipts()) replay.replay(receipt);
  assert.deepEqual(replay.tilemapRaster(),after);
  assert.deepEqual(createPixelEditor(documentFromDeck(editor.layerDeck())).tilemapRaster(),after);
  editor.undo();
  assert.deepEqual(editor.tilemapRaster(),placed);
  editor.undo();
  assert.deepEqual(editor.tilemapRaster(),before);
  editor.redo();
  assert.deepEqual(editor.tilemapRaster(),placed);
});

test('tilemaps reject broken references, duplicate locations and out-of-bounds strokes',()=>{
  const editor = createPixelEditor(source);
  const invalid = type=>editor.previewEdit(patch(editor,{ type:'place-tiles',...type })).conflicts[0].message;
  assert.match(invalid({ points:[[4,0]],tile:'wall' }),/inside the map/);
  assert.match(invalid({ points:[[0,0]],tile:'unknown' }),/known tile frame/);
  assert.match(invalid({ points:[[0,0],[0,-1]],tile:null }),/inside the map/);
  assert.deepEqual(editor.snapshot(),source);
  const duplicate = { ...source.tilemap,cells:[...source.tilemap.cells,{ at:[0,0],tile:'lamp' }] };
  assert.throws(()=>createPixelEditor({ ...source,tilemap:duplicate }),/repeats cell/);
  const huge = { ...source.tilemap,width:256,height:256,cells:[] };
  assert.throws(()=>createPixelEditor({ ...source,width:32,height:32,tilemap:huge }),/raster budget/);
  const { tilemap,...art } = source, doc = createPixelEditor(art);
  doc.apply({ id:'new-map',destination:'timeline',revision:doc.timeline().revision,operation:{ type:'set-tilemap',tilemap } });
  doc.apply(patch(doc,{ type:'place-tiles',points:[[2,0]],tile:null }));
  assert.deepEqual(doc.tilemap([2,0]).picked,{ at:[2,0],tile:null });
  assert.deepEqual(pixel(doc.tilemapRaster(),7,1),empty);
});

test('CLI inspects map cells and writes an exact transparent PNG',t=>{
  const dir = workspace(t), doc = path.join(dir,'map.json'), image = path.join(dir,'map.png');
  fs.writeFileSync(doc,JSON.stringify(source));
  const run = (...args)=>execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'pixel-art','tilemap',...args],{ encoding:'utf8' });
  const report = JSON.parse(run('inspect',doc,'--at','3,1'));
  assert.equal(report.picked.tile,'lamp');
  assert.deepEqual(report.tileSize,[3,2]);
  run('draw',doc,'--out',image);
  const actual = PNG.raster(image), expected = createPixelEditor(source).tilemapRaster();
  assert.deepEqual([actual.w,actual.h],[expected.w,expected.h]);
  assert.deepEqual(Uint8Array.from(actual.data),expected.rgba);
});

test('the workshop paints a placement stroke, picks its tile and edits every instance',{skip:!process.env.INK_TEST_CHROME},async t=>{
  const dir = workspace(t), [{ file:bundle }] = build('development',dir);
  const examples = path.join(root,'examples'), file = path.join(dir,'workshop.html');
  const url = relative=>pathToFileURL(path.resolve(examples,relative)).href;
  fs.writeFileSync(file,fs.readFileSync(path.join(examples,'pixel-stamp-editor.html'),'utf8')
    .replace('../dist/ink-studio.browser.js',pathToFileURL(bundle).href)
    .replace('../src/pixel-grid-canvas.css',url('../src/pixel-grid-canvas.css'))
    .replace('src="pixel-stamp-studies.js"','src="'+url('pixel-stamp-studies.js')+'"')
    .replace('src="pixel-stamp-editor.mjs"','src="'+url('pixel-stamp-editor.mjs')+'"'));
  const deck = createPixelEditor(source).layerDeck();
  await withChrome(dir,{hardware:true},async browser=>{
    const run = expression=>browser.evaluate(expression);
    const click = id=>run('document.getElementById('+JSON.stringify(id)+').click()');
    await browser.send('Emulation.setDeviceMetricsOverride',{ width:1200,height:1200,deviceScaleFactor:1,mobile:false });
    await browser.send('Page.navigate',{ url:pathToFileURL(file).href });
    for (let i=0;i<100 && !await run('document.querySelector(".ink-grid-dimensions")?.value');i++) await pause(25);
    assert(await run('document.querySelector(".ink-grid-dimensions").value'));
    await click('tilemap-new');
    assert.equal(await run('document.getElementById("tilemap-create").hidden'),false);
    await run('document.getElementById("tilemap-create").requestSubmit()');
    assert.equal(await run('document.getElementById("tilemap-workspace").hidden'),false);
    await run(`const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(JSON.stringify(deck))}],"map.json",{type:"application/json"}));
      const input = document.getElementById("import"); input.files = dt.files; input.dispatchEvent(new Event("change"));`);
    for (let i=0;i<100 && !await run('document.getElementById("status").textContent.includes("Opened map.json")');i++) await pause(25);
    assert.equal(await run('document.getElementById("pixel-workspace").hidden'),true);
    const read = (x,y)=>run(`Array.from(document.getElementById("tilemap-canvas").getContext("2d").getImageData(${x},${y},1,1).data)`);
    assert.deepEqual(await read(1,1),wall);
    assert.deepEqual(await read(4,1),empty);
    const where = (selector,x,y)=>run(`
      (()=>{ const c=document.querySelector(${JSON.stringify(selector)}), r=c.getBoundingClientRect();
        return {x:r.left+(${x}+.5)*r.width/c.width,y:r.top+(${y}+.5)*r.height/c.height}; })()`);
    const send = (type,pos,other={})=>browser.send('Input.dispatchMouseEvent',{ type,...pos,...other });
    const press = pos=>send('mousePressed',pos,{button:'left',buttons:1,clickCount:1});
    const release = pos=>send('mouseReleased',pos,{button:'left',clickCount:1});
    await run('document.getElementById("tilemap-choice").value = "lamp"');
    const a = await where('#tilemap-canvas',1,1), b = await where('#tilemap-canvas',7,1);
    await press(a);
    await send('mouseMoved',b,{button:'left',buttons:1});
    await release(b);
    assert.deepEqual(await read(4,1),gold);
    await click('tilemap-undo');
    assert.deepEqual(await read(1,1),wall);
    assert.deepEqual(await read(4,1),empty);

    await run('document.getElementById("tilemap-tool").value = "pick"');
    await press(a);
    await release(a);
    assert.equal(await run('document.getElementById("tilemap-choice").value'),'wall');
    await click('tilemap-edit-tile');
    assert.equal(await run('document.getElementById("tilemap-workspace").hidden'),true);
    assert.equal(await run('document.getElementById("remove").disabled'),true);
    await run('document.querySelectorAll(".swatch")[1].click()');
    const at = await where('#canvas-view .ink-grid-main',1,1);
    await press(at);
    await release(at);
    await click('tilemap-place');
    assert.deepEqual(await read(1,1),gold);
    assert.deepEqual(await read(7,1),gold);
    assert.deepEqual(await read(4,1),empty);

    await run('document.getElementById("tilemap-tool").value = "erase"');
    await press(a);
    await release(a);
    assert.deepEqual(await read(1,1),empty);
    assert.deepEqual(await read(7,1),gold);
    await click('tilemap-undo');

    const png = await run(`(async()=>{ const url = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
      try {
        const saved = new Promise(resolve=>{ URL.createObjectURL = blob=>(resolve(blob),"blob:tilemap"); });
        HTMLAnchorElement.prototype.click = ()=>{};
        document.getElementById("export-png").click();
        return Array.from(new Uint8Array(await (await saved).arrayBuffer()));
      } finally { URL.createObjectURL = url; HTMLAnchorElement.prototype.click = click; } })()`);
    assert.deepEqual(Array.from(PNG.raster(Uint8Array.from(png)).data.slice(8,12)),[255,197,92,1]);

    const saved = await run(`(async()=>{ let artifact; const url = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = blob=>(artifact = blob,"blob:tilemap"); HTMLAnchorElement.prototype.click = ()=>{};
      try { document.getElementById("export").click(); return JSON.parse(await artifact.text()); }
      finally { URL.createObjectURL = url; HTMLAnchorElement.prototype.click = click; } })()`);
    const reopened = createPixelEditor(documentFromDeck(saved));
    assert.deepEqual(reopened.snapshot().tilemap,source.tilemap);
    assert.deepEqual(pixel(reopened.tilemapRaster(),7,1),gold);
    await click('tilemap-add-tile');
    assert.equal(await run('document.getElementById("tilemap-editing").value'),'tile-3');
    await click('tilemap-place');
    assert.equal(await run('document.getElementById("tilemap-choice").value'),'tile-3');
  });
});
