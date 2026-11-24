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
const neighbors = {
  ...source,
  frames:[
    { id:'road',durationMs:100,cels:{ art:{ marks:[{swatch:'stone',at:[1,1]}] } } },
    { id:'road-copy',durationMs:100,cels:{ art:{ marks:[{swatch:'stone',at:[1,1]}] } } },
    { id:'bank',durationMs:100,cels:{ art:{ marks:[
      {swatch:'gold',at:[0,0]}, {swatch:'gold',at:[0,1]}, {alpha:1,runs:[[1,0,1]]}
    ] } } },
    { id:'junction',durationMs:100,cels:{} },
    { id:'glow-a',durationMs:80,cels:{ art:{ marks:[{swatch:'stone',at:[2,0]}] } } },
    { id:'glow-b',durationMs:120,cels:{ art:{ marks:[{swatch:'gold',runs:[[0,2,1],[1,2,1]]}] } } }
  ],
  tilemap:{
    version:1,width:4,height:3,cells:[
      {at:[0,1],tile:'road'}, {at:[1,1],tile:'road'}, {at:[2,1],tile:'bank'}, {at:[2,0],tile:'bank'}
    ],
    variants:{
      road:{ connects:['road','bank'],neighbors:{ E:'junction',EW:'junction' } },
      junction:{ animation:{ frames:['glow-a','glow-b'] } }
    }
  }
};
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tilemap-'));
  t.after(()=>fs.rmSync(dir,{ force:true,recursive:true }));
  return dir;
}

async function withWorkshop(t,use) {
  const dir = workspace(t), [{ file:bundle }] = build('development',dir);
  const examples = path.join(root,'examples'), file = path.join(dir,'workshop.html');
  const url = relative=>pathToFileURL(path.resolve(examples,relative)).href;
  fs.writeFileSync(file,fs.readFileSync(path.join(examples,'pixel-stamp-editor.html'),'utf8')
    .replace('../dist/ink-studio.browser.js',pathToFileURL(bundle).href)
    .replace('../src/pixel-grid-canvas.css',url('../src/pixel-grid-canvas.css'))
    .replace('src="pixel-stamp-studies.js"','src="'+url('pixel-stamp-studies.js')+'"')
    .replace('src="pixel-stamp-editor.mjs"','src="'+url('pixel-stamp-editor.mjs')+'"'));
  await withChrome(dir,{hardware:true},async browser=>{
    await browser.send('Emulation.setDeviceMetricsOverride',{ width:1200,height:1200,deviceScaleFactor:1,mobile:false });
    await browser.send('Page.navigate',{ url:pathToFileURL(file).href });
    for (let i=0;i<100 && !await browser.evaluate('document.querySelector(".ink-grid-dimensions")?.value');i++) await pause(25);
    assert(await browser.evaluate('document.querySelector(".ink-grid-dimensions").value'));
    await use(browser);
  });
}

async function openWorkshopDeck(browser,design) {
  const deck = createPixelEditor(design).layerDeck();
  await browser.evaluate(`{ const dt = new DataTransfer();
    dt.items.add(new File([${JSON.stringify(JSON.stringify(deck))}],"map.json",{type:"application/json"}));
    const input = document.getElementById("import"); input.files = dt.files; input.dispatchEvent(new Event("change")); }`);
  for (let i=0;i<100 && !await browser.evaluate('document.getElementById("status").textContent.includes("Opened map.json")');i++) await pause(25);
  assert.match(await browser.evaluate('document.getElementById("status").textContent'),/Opened map.json/);
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

test('a local variant copies editable art and locks, detaches held cels and rebinds one placement',()=>{
  const doc = structuredClone(source);
  doc.frames.push({ id:'held-wall',durationMs:150,cels:{ art:{ hold:'wall/art',offset:[1,0] } } });
  doc.tilemap.cells.slice(0,2).forEach(cell=>{ cell.tile = 'held-wall'; });
  doc.guides = [{ id:'edge',kind:'axis',axis:'x',at:2,frame:'held-wall' }];
  doc.selections = [{ id:'top',frame:'held-wall',pixels:[[0,0],[1,0]] }];
  doc.protectedDetails = [{ id:'gap',kind:'gap',frames:['held-wall','held-wall'],pixels:[[0,0]] }];
  const editor = createPixelEditor(doc), initial = editor.tilemapRaster();
  const fork = patch(editor,{ type:'make-local-variant',at:[0,0],tile:'cracked' });
  assert.deepEqual(editor.previewEdit(fork).targets[0].changes,[{ at:[0,0],before:'held-wall',after:'cracked' }]);
  assert.equal(editor.tilemap([0,0]).picked.tile,'held-wall');
  editor.apply(fork);
  const made = editor.snapshot(), art = made.frames.at(-1).cels.art;
  assert.equal(art.hold,undefined);
  assert.equal(art.id,'cracked/art');
  assert.deepEqual(art.offset,[1,0]);
  assert.deepEqual(art.marks,doc.frames[0].cels.art.marks);
  assert.deepEqual(made.guides.at(-1),{ ...doc.guides[0],id:'edge-variant',frame:'cracked' });
  assert.deepEqual(made.selections.at(-1),{ ...doc.selections[0],id:'top-variant',frame:'cracked' });
  assert.deepEqual(made.protectedDetails.at(-1),{ id:'gap-variant',kind:'gap',frame:'cracked',pixels:[[0,0]] });
  assert.deepEqual(editor.tilemapRaster(),initial);
  assert.deepEqual(editor.tilemap([0,0]).exactMatches,['held-wall']);
  assert.equal(editor.previewEdit(fork).conflicts[0].code,'stale-document');

  const change = {
    id:'paint-crack',frame:'cracked',revision:editor.tilemap().revision,
    operation:{ tool:'pencil',layer:'art',points:[[2,1]],swatch:'gold' }
  };
  editor.apply(change);
  assert.deepEqual(pixel(editor.tilemapRaster(),2,1),gold);
  assert.deepEqual(pixel(editor.tilemapRaster(),8,1),wall);
  assert.deepEqual(editor.tilemap([0,0]).exactMatches,[]);
  assert.match(editor.previewEdit(patch(editor,{ type:'reuse-exact-tile',at:[0,0],tile:'held-wall' })).conflicts[0].message,/match exactly/);
  editor.undo();
  editor.undo();
  assert.deepEqual(editor.snapshot(),doc);
  editor.redo();
  const reuse = patch(editor,{ type:'reuse-exact-tile',at:[0,0],tile:'held-wall' });
  editor.apply(reuse);
  assert.deepEqual(editor.tilemap([0,0]).picked,{ at:[0,0],tile:'held-wall' });
  assert.equal(editor.tilemap([2,0]).picked.tile,'held-wall');
  assert.deepEqual(editor.tilemapRaster(),initial);
  assert(editor.snapshot().frames.some(frame=>frame.id === 'cracked'));
  const replay = createPixelEditor(doc);
  for (const receipt of editor.receipts()) replay.replay(receipt);
  assert.deepEqual(replay.snapshot(),editor.snapshot());
});

test('exact reuse checks indexed and hidden layer pixels, alpha, knockouts, offsets and locks',()=>{
  const doc = structuredClone(source), [tile] = doc.frames;
  doc.layers.push({ id:'hidden',visible:false });
  doc.palette.copy = doc.palette.stone;
  const clone = (id,extra = {})=>({ ...structuredClone(tile),id,...extra });
  const swapped = clone('same-rgb');
  swapped.cels.art.marks[0].swatch = 'copy';
  const alpha = clone('different-alpha');
  alpha.cels.art.marks[2].alpha = 2;
  const shift = clone('shifted');
  shift.cels.art.offset = [0,1];
  const hidden = clone('hidden-paint');
  hidden.cels.hidden = { marks:[{ swatch:'gold',at:[0,1] }] };
  const erased = clone('hidden-knockout');
  erased.cels.hidden = { marks:[{ swatch:null,at:[0,1] }] };
  doc.protectedDetails = [{ id:'hold',kind:'accent',frame:'locked-pixel',pixels:[[1,1]] }];
  doc.frames.push(clone('first-match'),swapped,alpha,shift,hidden,erased,clone('locked-pixel'),clone('second-match',{
    label:'Same drawing',durationMs:175
  }));
  const editor = createPixelEditor(doc);
  assert.deepEqual(editor.tilemap([0,0]).exactMatches,['first-match','second-match']);
  assert.deepEqual(editor.tilemap([1,0]).exactMatches,[]);
  const operation = { type:'reuse-exact-tile',at:[0,0],tile:'second-match' };
  for (const tile of ['same-rgb','different-alpha','shifted','hidden-paint','hidden-knockout','locked-pixel']) {
    const preview = editor.previewEdit(patch(editor,{ ...operation,tile }));
    assert.equal(preview.valid,false);
    assert.match(preview.conflicts[0].message,/match exactly/);
  }
  assert.equal(editor.previewEdit(patch(editor,{ ...operation,at:[1,0] })).valid,false);
  editor.apply(patch(editor,operation));
  editor.apply({ id:'shared-paint',frame:'second-match',revision:editor.tilemap().revision,
    operation:{ tool:'pencil',layer:'art',points:[[1,1]],swatch:'gold' } });
  assert.deepEqual(pixel(editor.tilemapRaster(),1,1),gold);
  assert.deepEqual(pixel(editor.tilemapRaster(),7,1),wall);
});

test('CLI inspects map cells and writes an exact transparent PNG',t=>{
  const dir = workspace(t), doc = path.join(dir,'map.json'), image = path.join(dir,'map.png');
  fs.writeFileSync(doc,JSON.stringify(source));
  const cli = (...args)=>execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'pixel-art',...args],{ encoding:'utf8' });
  const run = (...args)=>cli('tilemap',...args);
  const report = JSON.parse(run('inspect',doc,'--at','3,1'));
  assert.equal(report.picked.tile,'lamp');
  assert.deepEqual(report.exactMatches,[]);
  assert.deepEqual(report.tileSize,[3,2]);
  run('draw',doc,'--out',image);
  const actual = PNG.raster(image), expected = createPixelEditor(source).tilemapRaster();
  assert.deepEqual([actual.w,actual.h],[expected.w,expected.h]);
  assert.deepEqual(Uint8Array.from(actual.data),expected.rgba);
  const command = path.join(dir,'fork.json'), revised = path.join(dir,'revised.json');
  fs.writeFileSync(command,JSON.stringify({
    id:'fork-lamp',destination:'timeline',revision:report.revision,
    operation:{ type:'make-local-variant',at:[3,1],tile:'new-lamp' }
  }));
  cli('edit',doc,command,'--out',revised);
  const picked = JSON.parse(run('inspect',revised,'--at','3,1'));
  assert.equal(picked.picked.tile,'new-lamp');
  assert.deepEqual(picked.exactMatches,['lamp']);
});

test('the workshop paints a placement stroke, picks its tile and edits every instance',{skip:!process.env.INK_TEST_CHROME},async t=>{
  await withWorkshop(t,async browser=>{
    const run = expression=>browser.evaluate(expression);
    const click = id=>run('document.getElementById('+JSON.stringify(id)+').click()');
    await click('tilemap-new');
    assert.equal(await run('document.getElementById("tilemap-create").hidden'),false);
    await run('document.getElementById("tilemap-create").requestSubmit()');
    assert.equal(await run('document.getElementById("tilemap-workspace").hidden'),false);
    await openWorkshopDeck(browser,source);
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
    assert.equal(await run('document.getElementById("tilemap-instance-count").value'),'2 placements');
    assert.equal(await run('document.getElementById("tilemap-edit-tile").textContent'),'Edit every instance');
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

    await run('document.getElementById("tilemap-tool").value = "pick"');
    const picked = await where('#tilemap-canvas',7,1);
    await press(picked);
    await release(picked);
    assert.equal(await run('document.getElementById("tilemap-picked").hidden'),false);
    await click('tilemap-variant');
    assert.equal(await run('document.getElementById("tilemap-editing").value'),'wall-variant · 1 placement');
    await run('document.querySelectorAll(".swatch")[0].click()');
    const local = await where('#canvas-view .ink-grid-main',1,1);
    await press(local);
    await release(local);
    await click('tilemap-place');
    assert.deepEqual(await read(1,1),gold);
    assert.deepEqual(await read(7,1),wall);
    assert.equal(await run('document.getElementById("tilemap-reuse").disabled'),true);
    await click('tilemap-pixels');
    await run('document.querySelectorAll(".swatch")[1].click()');
    const restored = await where('#canvas-view .ink-grid-main',1,1);
    await press(restored);
    await release(restored);
    await click('tilemap-place');
    assert.equal(await run('document.getElementById("tilemap-exact").value'),'wall');
    await click('tilemap-reuse');
    assert.equal(await run('document.getElementById("tilemap-pick-label").value'),'2, 0 · wall');
    assert.deepEqual(await read(7,1),gold);
    await click('tilemap-undo');
    assert.equal(await run('document.getElementById("tilemap-pick-label").value'),'2, 0 · wall-variant');
  });
});

test('neighbors resolve a bounded native window and report asymmetric alpha and RGB seams',()=>{
  const editor = createPixelEditor(neighbors), a = editor.tilemapNeighborhood([1,1]), b = editor.tilemapNeighborhood([1,1],{time:.08});
  assert.deepEqual([a.raster.w,a.raster.h],[9,6]);
  assert.deepEqual(a.cells[4],{at:[1,1],offset:[0,0],tile:'road',variant:'junction',frame:'glow-a',mask:'EW',step:0});
  assert.equal(a.cells[2].tile,'bank');
  assert.equal(a.cells[7].tile,null);
  assert.equal(b.cells[4].frame,'glow-b');
  assert.equal(b.cells[3].mask,'E');
  assert.equal(b.cells[3].frame,'glow-b');
  assert.deepEqual(a.seams[1],{ side:'E',at:[2,1],length:2,coverage:1,color:1 });
  assert.deepEqual(b.seams[1],{ side:'E',at:[2,1],length:2,coverage:1,color:0 });
  assert.deepEqual(editor.tilemapNeighborhood([1,1],{ time:.2 }).cells,a.cells);
  assert.equal(editor.tilemapNeighborhood([0,0]).cells[0].outside,true);
  assert.throws(()=>editor.tilemapNeighborhood([4,0]),/inside the tilemap/);
  assert.throws(()=>editor.tilemapRaster({time:-1}),/nonnegative seconds/);
  const map = editor.tilemapRaster({time:.08});
  for (let y=0;y<b.raster.h;y++) for (let x=0;x<b.raster.w;x++) assert.deepEqual(pixel(b.raster,x,y),pixel(map,x,y));
  const imported = createPixelEditor(documentFromDeck(editor.layerDeck())).tilemapNeighborhood([1,1],{time:.08});
  assert.deepEqual(imported.cells,b.cells);
  assert.deepEqual(imported.seams,b.seams);
  assert.deepEqual(imported.raster,b.raster);
});

test('tile rules validate references and protect exact reuse from changing connectivity',()=>{
  const doc = structuredClone(neighbors), editor = createPixelEditor(doc);
  assert.deepEqual(editor.tilemap([1,1]).exactMatches,[]);
  const conflicting = patch(editor,{ type:'reuse-exact-tile',at:[1,1],tile:'road-copy' });
  assert.match(editor.previewEdit(conflicting).conflicts[0].message,/animation and neighbor rules/);
  doc.tilemap.variants.road.connects = ['road','road-copy','bank'];
  doc.tilemap.variants['road-copy'] = { ...doc.tilemap.variants.road,connects:['road','road-copy'] };
  assert.deepEqual(createPixelEditor(doc).tilemap([1,1]).exactMatches,[]);
  doc.tilemap.variants.road.neighbors.WE = 'bank';
  assert.throws(()=>createPixelEditor(doc),/canonical NESW/);
  delete doc.tilemap.variants.road.neighbors.WE;
  doc.tilemap.variants.junction.animation.frames.push('unknown');
  assert.throws(()=>createPixelEditor(doc),/known frames/);
});

test('CLI exports native neighbor PNG and report at the same time',t=>{
  const dir = workspace(t), file = path.join(dir,'map.json'), png = path.join(dir,'context.png');
  fs.writeFileSync(file,JSON.stringify(neighbors));
  const cli = (...args)=>execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'pixel-art','tilemap',...args],{encoding:'utf8'});
  const result = JSON.parse(cli('neighbors',file,'--at','1,1','--t','.08','--image',png));
  assert.equal(result.cells[4].frame,'glow-b');
  assert.equal(result.seams[1].coverage,1);
  const actual = PNG.raster(png), { raster } = createPixelEditor(neighbors).tilemapNeighborhood([1,1],{time:.08});
  assert.deepEqual([actual.w,actual.h],[raster.w,raster.h]);
  assert.deepEqual(Uint8Array.from(actual.data),raster.rgba);
});

test('the workshop seeks tile variants and paints the resolved frame with live neighbors',{skip:!process.env.INK_TEST_CHROME},async t=>{
  await withWorkshop(t,async browser=>{
    await openWorkshopDeck(browser,neighbors);
    const run = expression=>browser.evaluate(expression);
    const click = id=>run('document.getElementById('+JSON.stringify(id)+').click()');
    const where = (selector,x,y)=>run(`(()=>{ const c=document.querySelector(${JSON.stringify(selector)}), r=c.getBoundingClientRect();
      return { x:r.left+(${x}+.5)*r.width/c.width,y:r.top+(${y}+.5)*r.height/c.height }; })()`);
    const mouse = (type,point)=>browser.send('Input.dispatchMouseEvent',{ type,...point,button:'left',
      buttons:type === 'mousePressed' ? 1 : 0,clickCount:1 });
    const read = (selector,x,y)=>run(`Array.from(document.querySelector(${JSON.stringify(selector)}).getContext('2d').getImageData(${x},${y},1,1).data)`);
    await run('document.getElementById("tilemap-tool").value="pick"');
    const focus = await where('#tilemap-canvas',4,3);
    await mouse('mousePressed',focus);
    await mouse('mouseReleased',focus);
    await click('tilemap-edit-tile');
    assert.equal(await run('document.getElementById("tile-neighbor-controls").hidden'),false);
    assert.match(await run('document.getElementById("tile-neighbor-summary").value'),/EW → junction · Cel 1 glow-a/);
    assert.deepEqual(await read('#tile-neighbor-resolved',2,0),wall);
    assert.deepEqual(await read('.ink-grid-neighbors canvas:nth-child(5)',0,0),gold);
    await run(`{ const input=document.getElementById("tile-neighbor-time");
      input.value=".08"; input.dispatchEvent(new Event("input")); }`);
    assert.match(await run('document.getElementById("tile-neighbor-summary").value'),/Cel 2 glow-b/);
    assert.deepEqual(await read('.ink-grid-neighbors canvas:nth-child(4)',2,0),gold);
    await click('tile-neighbor-edit');
    assert.equal(await run('document.getElementById("tilemap-editing").value'),'glow-b');
    assert.match(await run('document.getElementById("tile-neighbor-edges").value'),/E 1\/2 alpha, 0 RGB/);
    await run('document.querySelectorAll(".swatch")[0].click()');
    const center = await where('#canvas-view .ink-grid-main',2,0);
    await mouse('mousePressed',center);
    assert.deepEqual(await read('.ink-grid-neighbors canvas:nth-child(4)',2,0),wall);
    assert.match(await run('document.getElementById("tile-neighbor-edges").value'),/E 1\/2 alpha, 1 RGB/);
    await mouse('mouseReleased',center);
    assert.equal(await run('document.getElementById("remove").disabled'),true);
    await click('tile-neighbor-play');
    for (let i=0;i<20 && !await run('document.getElementById("tile-neighbor-time").valueAsNumber > .08');i++) await pause(25);
    assert(await run('document.getElementById("tile-neighbor-time").valueAsNumber > .08'));
    await click('tile-neighbor-play');
    await run(`{ const input=document.getElementById("tile-neighbor-time");
      input.value=".08"; input.dispatchEvent(new Event("input")); }`);
    await click('tile-neighbor-show');
    assert.equal(await run('document.querySelector(".ink-grid-neighbors").hidden'),true);
    await click('tile-neighbor-show');
    await click('tilemap-place');
    assert.deepEqual(await read('#tilemap-canvas',5,2),wall);
  });
});
