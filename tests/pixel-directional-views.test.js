'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync,spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { setTimeout:pause } = require('node:timers/promises');
const { createPixelEditor,readSpriteAtlas,writeSpriteAtlas } = require('..');
const { documentFromDeck } = require('../cli/pixel-art.js');
const { withChrome } = require('../cli/canvas-grid-chrome.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const json = file=>JSON.parse(fs.readFileSync(file,'utf8'));
const save = (file,value)=>fs.writeFileSync(file,JSON.stringify(value));
const command = (...args)=>execFileSync(process.execPath,[cli,'pixel-art','directions',...args],{ encoding:'utf8' });
const workspace = t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-directions-'));
  t.after(()=>fs.rmSync(dir,{ recursive:true,force:true }));
  return name=>path.join(dir,name);
};

const directional = {
  version:1,approvedSwatches:['rust','gold'],
  partAnchors:[{ id:'pin',part:'latch',point:[0,0,0] }],
  views:[
    { frame:'front',pose:0,yaw:0,pitch:0,pivot:[2,2],unitsPerPixel:.1 },
    { frame:'rim',pose:0,yaw:.65,pitch:0,pivot:[2,2],unitsPerPixel:.1,anchors:{ pin:[3,2] },handoff:'exact' },
    { frame:'high',pose:0,yaw:.65,pitch:.4,pivot:[2,2],unitsPerPixel:.1 }
  ]
};
const document = {
  format:'ink-studio/pixel-art',version:2,width:5,height:4,pixelAspect:[1,1],
  palette:{ rust:'#b04a2f',gold:'#f4cf72',slate:'#33474f' },layers:[{ id:'art' }],
  frames:[
    { id:'front',durationMs:100,cels:{ art:{ marks:[{ swatch:'rust',at:[1,1] },{ swatch:'rust',at:[2,2] }] } } },
    { id:'rim',durationMs:100,cels:{ art:{ marks:[{ swatch:'rust',at:[2,1] },{ swatch:'gold',at:[3,2] },{ swatch:'gold',at:[4,2] }] } } },
    { id:'high',durationMs:100,cels:{ art:{ marks:[{ swatch:'slate',at:[3,2] }] } } }
  ]
};

test('directional registration supports revisions, undo, layer decks and grid transforms',()=>{
  const editor = createPixelEditor(document), start = editor.timeline().revision;
  const edit = {
    id:'register-angles',destination:'timeline',revision:start,operation:{ type:'set-directional',directional }
  };
  assert.equal(editor.previewEdit(edit).valid,true);
  editor.apply(edit);
  assert.deepEqual(editor.timeline().directional,directional);
  assert.equal(editor.previewEdit(edit).conflicts[0].code,'stale-document');
  assert.deepEqual(documentFromDeck(editor.layerDeck()).directional,directional);
  editor.undo();
  assert.equal(editor.snapshot().directional,undefined);
  editor.redo();
  const pad = { id:'pad-angles',destination:'canvas',revision:editor.timeline().revision,
    operation:{ type:'pad',margins:[1,2,0,0] } };
  editor.apply(pad);
  const padded = editor.snapshot().directional;
  assert.deepEqual(padded.views[1].pivot,[3,4]);
  assert.deepEqual(padded.views[1].anchors,{ pin:[4,4] });
  assert.deepEqual(padded.partAnchors,directional.partAnchors);
  const duplicate = structuredClone(directional);
  duplicate.views[1].yaw = Math.PI*2;
  assert.throws(()=>createPixelEditor({ ...document,directional:duplicate }),/repeat a heading/);
});

test('CLI compares adjacent authored pixels by a shared anchor and checks the set palette',t=>{
  const file = workspace(t), source = file('drawing.json'), report = file('report.json'), review = file('review.html');
  save(source,{ ...document,directional });
  command('review',source,'--anchor','pin','--out',report,'--review',review);
  const result = json(report);
  const pair = result.pairs.find(row=>row.from === 'front' && row.to === 'rim');
  assert.deepEqual(pair.shift,[-1,0]);
  assert.deepEqual(pair.exact,['rim']);
  assert.deepEqual(pair.counts,{ leftOnly:0,rightOnly:1,color:1,alpha:0 });
  assert.deepEqual(pair.difference,[[2,2,2]]);
  assert(result.pairs.some(row=>row.axis === 'pitch' && row.to === 'high'));
  assert.deepEqual(result.views[2].unapproved,[{ color:'#33474f',pixels:1 }]);
  assert.deepEqual(result.approved.map(row=>row.id),['rust','gold']);
  assert.match(fs.readFileSync(review,'utf8'),/image-rendering:pixelated/);
  assert.deepEqual(json(source).frames,document.frames);
  const blocked = spawnSync(process.execPath,[cli,'pixel-art','directions','export',source,'--out',file('atlas.json')],{ encoding:'utf8' });
  assert.equal(blocked.status,1);
  assert.match(blocked.stderr,/unapproved colors/);
  assert.equal(fs.existsSync(file('atlas.json')),false);
  const approved = structuredClone(directional);
  approved.approvedSwatches.push('slate');
  save(source,{ ...document,directional:approved });
  command('export',source,'--out',file('atlas.json'));
  const { metadata,images } = readSpriteAtlas(file('atlas.json')).snapshot();
  assert.equal(metadata.viewBlend,'nearest');
  assert.equal(metadata.frames[1].handoff,'exact');
  assert.deepEqual(metadata.partAnchors,directional.partAnchors);
  assert.deepEqual(Object.keys(images),['color']);
});

test('CLI roundtrips actual art and re-registers depth and paint without synthesizing missing geometry',t=>{
  const file = workspace(t), base = file('base.json'), source = file('drawing.json'), edited = file('edited.json'), result = file('out.json');
  const width=6,height=3,rect={ x:0,y:0,width:3,height };
  const maps = { color:[176,74,47,128],depth:[71,22,4,255],normal:[20,175,200,255],emission:[55,80,20,255] };
  const images = Object.fromEntries(Object.entries(maps).map(([channel,pixel])=>{
    const rgba = new Uint8Array(width*height*4);
    rgba.set(pixel,4*(width+1));
    return [channel,rgba];
  }));
  writeSpriteAtlas({ metadata:{ width,height,depthRange:[0,2],viewBlend:'depth-reprojected',
    outputPalette:[0xb04a2f,0xf4cf72],partAnchors:directional.partAnchors,
    frames:[{ yaw:0,rect },{ yaw:.65,rect,anchors:{ pin:[2,1] } }] },images },{ out:base });
  command('open',base,'--out',source);
  const design = json(source), editor = createPixelEditor(design);
  assert.deepEqual(design.directional.approvedSwatches,['ink-b04a2f','ink-f4cf72']);
  assert.equal(editor.sample([1,1],{ frame:'view-1' }).alpha,128);
  editor.apply({ id:'draw-rim',frame:'view-2',revision:editor.timeline().revision,
    operation:{ tool:'pencil',layer:'art',points:[[2,1]],swatch:'ink-f4cf72' } });
  save(edited,editor.snapshot());
  command('export',edited,'--base',base,'--out',result);
  const asset = readSpriteAtlas(result), out = asset.snapshot(), [first,second] = out.metadata.frames;
  const rgba = (name,frame,x,y)=>{
    const index = ((frame.rect.y+y)*out.metadata.width+frame.rect.x+x)*4;
    return Array.from(out.images[name].subarray(index,index+4));
  };
  assert.equal(out.metadata.viewBlend,'depth-reprojected');
  assert.deepEqual(out.metadata.outputPalette,[0xb04a2f,0xf4cf72]);
  assert.equal(first.duration,1/12);
  assert.notDeepEqual(first.rect,second.rect);
  assert.equal(first.handoff,undefined);
  assert.equal(second.handoff,'exact');
  for (const [name,pixel] of Object.entries(maps)) {
    assert.deepEqual(rgba(name,first,1,1),pixel);
    assert.deepEqual(rgba(name,second,1,1),pixel);
  }
  assert.deepEqual(rgba('color',first,2,1),[0,0,0,0]);
  assert.deepEqual(rgba('color',second,2,1),[244,207,114,255]);
  assert.deepEqual(rgba('depth',second,2,1),[0,0,0,0]);
  command('open',result,'--out',file('reopened.json'));
  assert.equal(json(file('reopened.json')).directional.views[0].anchors,undefined);
  assert.deepEqual(json(file('reopened.json')).directional.views[1].anchors,{ pin:[2,1] });
});

test('browser review switches pairs and previews aligned artwork at native size',{ skip:!process.env.INK_TEST_CHROME },async t=>{
  const file = workspace(t), source = file('drawing.json'), review = file('review.html');
  const single = { ...directional.views[0],frame:'single',pose:1 };
  save(source,{ ...document,frames:[...document.frames,{ ...document.frames[0],id:'single' }],
    directional:{ ...directional,views:[...directional.views,single] } });
  command('review',source,'--anchor','pin','--out',file('report.json'),'--review',review);
  await withChrome(path.dirname(review),{},async browser=>{
    await browser.send('Page.navigate',{ url:pathToFileURL(review).href });
    for (let i=0;i<100 && !await browser.evaluate('document.querySelector("#left")?.naturalWidth');i++) await pause(25);
    assert.equal(await browser.evaluate('document.querySelector("#left").naturalWidth'),5);
    assert.match(await browser.evaluate('document.querySelector("#summary").textContent'),/Exact handoff for rim/);
    const old = await browser.evaluate('document.querySelector("#right").src');
    await browser.evaluate('document.querySelector("#aligned").click()');
    assert.notEqual(await browser.evaluate('document.querySelector("#right").src'),old);
    await browser.evaluate('const zoom = document.querySelector("#zoom"); zoom.value = "1"; zoom.dispatchEvent(new Event("change"));');
    assert.equal(await browser.evaluate('document.querySelector("#left").width'),5);
    await browser.evaluate('const pairs = document.querySelector("#pairs"); pairs.selectedIndex = 1; pairs.dispatchEvent(new Event("change"));');
    assert.match(await browser.evaluate('document.querySelector("#right-name").textContent'),/^high/);
    await browser.evaluate('pairs.value = "v3"; pairs.dispatchEvent(new Event("change"));');
    assert.equal(await browser.evaluate('document.querySelector("#right-panel").hidden'),true);
    assert.match(await browser.evaluate('document.querySelector("#left-name").textContent'),/^single/);
  });
});
