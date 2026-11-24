const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: pause } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { build } = require('../scripts/build.js');
const { withChrome } = require('../cli/canvas-grid-chrome.js');
const PNG = require('../cli/png.js');

const root = path.resolve(__dirname,'..');
const skip = !process.env.INK_TEST_CHROME;
const main = 'canvas.ink-grid-main', preview = '.ink-grid-reference canvas';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-canvas-'));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true }));
  return directory;
}

async function until(browser,expression) {
  for (let i = 0; i < 120; i++) {
    if (await browser.evaluate(expression)) return;
    await pause(25);
  }
  assert.fail('Browser did not satisfy ' + expression);
}

async function load(browser,file,width = 1160,height = 1000) {
  const url = pathToFileURL(file).href;
  await browser.send('Emulation.setDeviceMetricsOverride',{ width,height,deviceScaleFactor:2,mobile:false });
  await browser.send('Page.navigate',{ url });
  await until(browser,`location.href === ${JSON.stringify(url)} && document.querySelector('.ink-grid-dimensions')?.value`);
}

const evaluate = (browser,fn,...args) => browser.evaluate('(' + fn + ')(...' + JSON.stringify(args) + ')');
const click = (browser,selector) => evaluate(browser,selector => document.querySelector(selector).click(),selector);
const raster = (browser,selector,x,y) => evaluate(browser,(selector,x,y) =>
  [...document.querySelector(selector).getContext('2d').getImageData(x,y,1,1).data],selector,x,y);
const screen = (browser,selector) => evaluate(browser,selector => {
  const canvas = document.querySelector(selector), box = canvas.getBoundingClientRect();
  return { x:box.x, y:box.y, w:box.width, h:box.height, width:canvas.width, height:canvas.height };
},selector);
const place = (box,x,y) => ({ x:box.x + (x+.5)*box.w/box.width, y:box.y + (y+.5)*box.h/box.height });

test('the workshop draws and keys slice bounds, pivots and nine-slice guides', { skip },async t=>{
  const directory = workspace(t), [{ file:bundle }] = build('development',directory);
  const base = path.join(root,'examples'), file = path.join(directory,'workshop.html');
  const url = relative=>pathToFileURL(path.resolve(base,relative)).href;
  fs.writeFileSync(file,fs.readFileSync(path.join(base,'pixel-stamp-editor.html'),'utf8')
    .replace('../dist/ink-studio.browser.js',pathToFileURL(bundle).href)
    .replace('../src/pixel-grid-canvas.css',url('../src/pixel-grid-canvas.css'))
    .replace('src="pixel-stamp-studies.js"','src="'+url('pixel-stamp-studies.js')+'"')
    .replace('src="pixel-stamp-editor.mjs"','src="'+url('pixel-stamp-editor.mjs')+'"'));
  await withChrome(directory,{hardware:true},async browser=>{
    await load(browser,file);
    const set = (selector,value,event='input')=>evaluate(browser,(selector,value,event)=>{
      const element = document.querySelector(selector);
      element.value = value;
      element.dispatchEvent(new Event(event,{bubbles:true}));
    },selector,value,event);
    const get = selector=>evaluate(browser,selector=>document.querySelector(selector).value,selector);
    const submit = ()=>browser.evaluate('document.getElementById("slice-form").requestSubmit()');
    await set('#preset','blank','change');
    await click(browser,'#duplicate');
    await set('#scrub',1);
    await browser.evaluate('document.getElementById("slice-panel").open = true');
    await set('#slice-id','ui-panel');
    await set('#slice-label','UI panel');
    async function drawSlice(button,from,to = from) {
      await click(browser,button);
      const box = await screen(browser,main), start = place(box,...from), end = place(box,...to);
      const mouse = (type,point,buttons)=>browser.send('Input.dispatchMouseEvent',{type,...point,button:'left',buttons,clickCount:1});
      await mouse('mousePressed',start,1);
      if (from !== to) await mouse('mouseMoved',end,1);
      await mouse('mouseReleased',end,0);
    }
    await drawSlice('#slice-draw',[2,3],[6,7]);
    await drawSlice('#slice-pick-pivot',[5,5]);
    await drawSlice('#slice-draw-stretch',[3,4],[5,6]);
    assert.equal(await get('#slice-key-status'),'Unsaved frame key');
    assert.deepEqual(await raster(browser,main,2,3),[0,0,0,0]);
    await submit();
    assert.equal(await get('#slice-key-status'),'Key on frame-1');
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-slice=ui-panel] [class^=ink-grid-slice-line]").length'),4);
    assert(await browser.evaluate('!!document.querySelector("[data-slice=ui-panel] .ink-grid-slice-pivot")'));
    await set('#scrub',2);
    assert.equal(await get('#slice-key-status'),'Inherited from frame-1');
    await set('#slice-x',3);
    await submit();
    assert.equal(await get('#slice-key-status'),'Key on frame-2');
    const deck = await browser.evaluate(`(async()=>{ let result; const capture=URL.createObjectURL, click=HTMLAnchorElement.prototype.click;
      try {
        URL.createObjectURL=blob=>(result=blob,"blob:ink-slices"); HTMLAnchorElement.prototype.click=()=>{};
        document.getElementById("export").click();
        return JSON.parse(await result.text());
      } finally { URL.createObjectURL=capture; HTMLAnchorElement.prototype.click=click; } })()`);
    assert.deepEqual(deck.slices,[{id:'ui-panel',label:'UI panel',keys:[
      {frame:'frame-1',bounds:[2,3,5,5],pivot:[3,2],nineSlice:[1,1,1,1]},
      {frame:'frame-2',bounds:[3,3,5,5],pivot:[3,2],nineSlice:[1,1,1,1]}
    ]}]);
    await click(browser,'#slice-remove-key');
    assert.equal(await get('#slice-key-status'),'Inherited from frame-1');
    await click(browser,'#undo');
    assert.equal(await get('#slice-key-status'),'Key on frame-2');
    await click(browser,'[data-view="slices"]');
    assert.equal(await browser.evaluate('document.querySelector(".ink-grid-slices").hidden'),true);
    const doc = path.join(directory,'sliced.json'), review = path.join(directory,'review.html');
    const { documentFromDeck } = require('../cli/pixel-art.js');
    fs.writeFileSync(doc,JSON.stringify(documentFromDeck(deck)));
    execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'pixel-art','canvas',doc,'--frame','frame-2','--out',review]);
    await load(browser,review);
    await until(browser,'!!document.querySelector("[data-slice=ui-panel] .ink-grid-slice-pivot")');
    assert.equal(await browser.evaluate('document.querySelector("[data-slice=ui-panel]").style.getPropertyValue("--slice-x")'),'3');
  });
});

test('the workshop pans without editing, keeps the 1× view live, and resizes without resampling', { skip },async t => {
  const directory = workspace(t);
  const [{ file:bundle }] = build('development',directory);
  const base = path.join(root,'examples'), file = path.join(directory,'workshop.html');
  const url = relative => pathToFileURL(path.resolve(base,relative)).href;
  fs.writeFileSync(file,fs.readFileSync(path.join(base,'pixel-stamp-editor.html'),'utf8')
    .replace('../dist/ink-studio.browser.js',pathToFileURL(bundle).href)
    .replace('../src/pixel-grid-canvas.css',url('../src/pixel-grid-canvas.css'))
    .replace('src="pixel-stamp-studies.js"','src="'+url('pixel-stamp-studies.js')+'"')
    .replace('src="pixel-stamp-editor.mjs"','src="'+url('pixel-stamp-editor.mjs')+'"'));
  await withChrome(directory,{ hardware:true },async browser => {
    await load(browser,file);
    await browser.evaluate(`document.querySelector('#preset').value = 'blank';
      document.querySelector('#preset').dispatchEvent(new Event('change'));
      document.querySelector('#duplicate').click();
      document.querySelector('#duration').value = '.375';
      document.querySelector('#duration').dispatchEvent(new Event('change'));`);
    const initial = await screen(browser,main), normal = await screen(browser,preview);
    assert.equal(initial.w / initial.width,Math.floor(initial.w / initial.width));
    assert.equal(normal.w,normal.width);
    assert.equal(normal.h,normal.height);
    const hit = place(initial,24,26);
    const mouse = (type,position,extra = {}) => browser.send('Input.dispatchMouseEvent',{ type,...position,...extra });
    await mouse('mouseMoved',hit);
    await until(browser,"document.querySelector('.ink-grid-coordinates').value === 'X 24 · Y 26'");
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-lines').hidden"),false);
    await click(browser,'.ink-grid-toggle input');
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-lines').hidden"),true);
    await click(browser,'.ink-grid-toggle input');
    await click(browser,'[data-view="in"]');
    const zoomed = await screen(browser,main);
    assert.equal(zoomed.w,initial.w+initial.width);
    assert.equal((await screen(browser,preview)).w,normal.w);

    await click(browser,'[data-view="pan"]');
    const start = place(zoomed,24,24), end = { x:start.x+45, y:start.y+30 };
    await mouse('mousePressed',start,{ button:'left',buttons:1,clickCount:1 });
    await mouse('mouseMoved',end,{ button:'left',buttons:1 });
    await mouse('mouseReleased',end,{ button:'left',clickCount:1 });
    const panned = await screen(browser,main);
    assert.equal(panned.x,zoomed.x+45);
    assert.equal(panned.y,zoomed.y+30);
    assert.deepEqual(await raster(browser,preview,24,24),[0,0,0,0]);
    await click(browser,'[data-view="pan"]');
    const drawAt = place(panned,24,24);
    await mouse('mousePressed',drawAt,{ button:'left',buttons:1,clickCount:1 });
    assert.deepEqual(await raster(browser,main,24,24),[39,58,71,255]);
    assert.deepEqual(await raster(browser,preview,24,24),[39,58,71,255]);
    await mouse('mouseReleased',drawAt,{ button:'left',clickCount:1 });

    await browser.evaluate(`document.querySelector('#canvas-width').value='72';
      document.querySelector('#canvas-height').value='62';
      document.querySelector('#canvas-size button').click();`);
    const resized = await screen(browser,preview);
    assert.deepEqual([resized.width,resized.height,resized.w,resized.h],[72,62,72,62]);
    assert.deepEqual(await raster(browser,preview,24,24),[39,58,71,255]);
    assert.deepEqual(await raster(browser,preview,71,61),[0,0,0,0]);
    assert.equal(await browser.evaluate("document.querySelector('#duration').value"),'0.375');
    const firstFrame = () => evaluate(browser,() => {
      const scrub = document.querySelector('#scrub');
      scrub.value = 1;
      scrub.dispatchEvent(new Event('input'));
    });
    await firstFrame();
    assert.deepEqual(await raster(browser,preview,24,24),[0,0,0,0]);
    await click(browser,'#undo');
    assert.deepEqual([(await screen(browser,main)).width,(await screen(browser,preview)).width],[48,48]);
    assert.deepEqual(await raster(browser,preview,24,24),[39,58,71,255]);

    await browser.evaluate(`const type = document.querySelector('#guide-type');
      type.value='pivot'; type.dispatchEvent(new Event('change'));
      document.querySelector('#guide-scope').value='frame';
      document.querySelector('#guide-x').value='24';
      document.querySelector('#guide-y').value='25';
      document.querySelector('#guide-form button[type="submit"]').click();`);
    assert.equal(await browser.evaluate("document.querySelector('.ink-guide-pivot')?.dataset.guide"),'pivot-1');
    await click(browser,'[data-view="snap"]');
    const placed = place(await screen(browser,main),23.35,25);
    await mouse('mouseMoved',placed);
    await until(browser,"document.querySelector('.ink-grid-coordinates').value === 'X 24 · Y 25 · pivot-1'");
    await mouse('mousePressed',placed,{ button:'left',buttons:1,clickCount:1 });
    await mouse('mouseReleased',placed,{ button:'left',clickCount:1 });
    assert.deepEqual(await raster(browser,preview,23,25),[0,0,0,0]);
    assert.deepEqual(await raster(browser,preview,24,25),[39,58,71,255]);
    await click(browser,'[data-view="in"]');
    const center = place(await screen(browser,main),24,25);
    const mark = await browser.evaluate(`(() => {
      const box = document.querySelector('.ink-guide-pivot').getBoundingClientRect();
      return { x:box.x+box.width/2, y:box.y+box.height/2 };
    })()`);
    assert.deepEqual(mark,center);
    await firstFrame();
    assert.equal(await browser.evaluate("document.querySelector('.ink-guide-toggles').hidden"),true);

    const canvasBounds = await screen(browser,main);
    const cornerPath = [[15,12],[16,12],[16,13]].map(([x,y])=>place(canvasBounds,x,y));
    const [from,corner,to] = cornerPath;
    const color = [39,58,71,255], clear = [0,0,0,0];
    assert.equal(await browser.evaluate("document.querySelector('#pixel-perfect').checked"),true);
    await mouse('mousePressed',from,{ button:'left',buttons:1,clickCount:1 });
    await mouse('mouseMoved',corner,{ button:'left',buttons:1 });
    assert.deepEqual(await raster(browser,preview,16,12),color);
    await mouse('mouseMoved',to,{ button:'left',buttons:1 });
    assert.deepEqual(await raster(browser,main,16,12),clear);
    assert.deepEqual(await raster(browser,preview,16,12),clear);
    await mouse('mouseReleased',to,{ button:'left',clickCount:1 });
    assert.deepEqual(await raster(browser,preview,15,12),color);
    assert.deepEqual(await raster(browser,preview,16,13),color);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,15,12),clear);
    assert.deepEqual(await raster(browser,preview,16,13),clear);
    await click(browser,'#pixel-perfect');
    await mouse('mousePressed',from,{ button:'left',buttons:1,clickCount:1 });
    await mouse('mouseMoved',corner,{ button:'left',buttons:1 });
    await mouse('mouseReleased',to,{ button:'left',clickCount:1 });
    assert.deepEqual(await raster(browser,preview,16,12),color);
    assert.deepEqual(await raster(browser,preview,16,13),color);
    await click(browser,'#undo');

    await click(browser,'[data-tool="shape"]');
    const chooseShape = (type,settings = {}) => evaluate(browser,(type,settings) => {
      for (const [id,value] of Object.entries(settings)) document.getElementById(id).value = value;
      const control = document.querySelector('#shape-type');
      control.value = type;
      control.dispatchEvent(new Event('change',{ bubbles:true }));
    },type,settings);
    const anchor = (x,y) => place(canvasBounds,x,y);
    const press = at => mouse('mousePressed',at,{ button:'left',buttons:1,clickCount:1 });
    const release = at => mouse('mouseReleased',at,{ button:'left',clickCount:1 });
    const tap = async (x,y) => { await press(anchor(x,y)); await release(anchor(x,y)); };
    await chooseShape('rect',{ 'shape-fill':'outline' });
    await press(anchor(10,10));
    await mouse('mouseMoved',anchor(18,16),{ button:'left',buttons:1 });
    assert.deepEqual(await raster(browser,preview,18,16),color);
    await release(anchor(18,16));
    assert.deepEqual(await raster(browser,preview,14,13),clear);
    await click(browser,'#undo');

    await chooseShape('ellipse',{ 'shape-fill':'filled' });
    await press(anchor(10,10));
    await release(anchor(18,16));
    assert.deepEqual(await raster(browser,preview,14,13),color);
    assert.deepEqual(await raster(browser,preview,10,10),clear);
    await click(browser,'#undo');

    await chooseShape('curve',{ 'shape-curve':3 });
    await tap(10,20);
    await tap(16,8);
    assert.equal(await browser.evaluate("document.querySelector('#finish-shape').disabled"),true);
    await tap(22,20);
    assert.equal(await browser.evaluate("document.querySelector('#finish-shape').disabled"),false);
    assert.deepEqual(await raster(browser,preview,16,14),color);
    await click(browser,'#cancel-shape');
    assert.deepEqual(await raster(browser,preview,16,14),clear);

    await chooseShape('staircase',{ 'shape-lengths':'3, 2', 'shape-dir-x':-1 });
    await tap(18,20);
    assert.deepEqual(await raster(browser,preview,16,20),color);
    assert.deepEqual(await raster(browser,preview,15,21),color);
    assert.deepEqual(await raster(browser,preview,16,21),clear);
    await click(browser,'#undo');

    const tick = place(await screen(browser,main),18,18);
    const dab = async () => {
      await mouse('mousePressed',tick,{ button:'left',buttons:1,clickCount:1 });
      await mouse('mouseReleased',tick,{ button:'left',clickCount:1 });
    };
    await click(browser,'.swatch:nth-child(3)');
    await click(browser,'[data-tool="fill"]');
    await dab();
    assert.deepEqual(await raster(browser,preview,47,47),[230,219,182,255]);
    await click(browser,'.swatch:nth-child(1)');
    await click(browser,'[data-tool="eyedropper"]');
    await dab();
    assert.equal(await browser.evaluate("document.querySelector('.swatch:nth-child(3)').getAttribute('aria-pressed')"),'true');
    await click(browser,'[data-tool="erase"]');
    await dab();
    assert.deepEqual(await raster(browser,preview,18,18),[0,0,0,0]);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,18,18),[230,219,182,255]);

    await evaluate(browser,() => {
      const preset = document.querySelector('#preset');
      preset.value = 'blank';
      preset.dispatchEvent(new Event('change'));
    });
    await click(browser,'[data-tool="pencil"]');
    await tap(8,8);
    await click(browser,'.swatch:nth-child(3)');
    await tap(9,9);
    await click(browser,'[data-tool="brush-select"]');
    await press(anchor(8,8));
    await mouse('mouseMoved',anchor(9,9),{ button:'left',buttons:1 });
    await release(anchor(9,9));
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-selection').hidden"),false);
    await click(browser,'#capture-brush');
    assert.equal(await browser.evaluate("document.querySelector('[data-tool=brush-stamp]').getAttribute('aria-pressed')"),'true');
    await evaluate(browser,() => {
      document.querySelector('#brush-x').value = 1;
      document.querySelector('#brush-y').value = 1;
      const angle = document.querySelector('#brush-angle');
      angle.value = 90;
      angle.dispatchEvent(new Event('change',{ bubbles:true }));
    });
    const download = (selector,json = true) => evaluate(browser,async (selector,json) => {
      const createURL = URL.createObjectURL, clickLink = HTMLAnchorElement.prototype.click;
      const writing = new Promise(resolve=>{
        URL.createObjectURL = blob => {
          resolve(json ? blob.text() : blob.arrayBuffer());
          return createURL.call(URL,blob);
        };
      });
      try {
        HTMLAnchorElement.prototype.click = function () {};
        document.querySelector(selector).click();
        const data = await writing;
        return json ? JSON.parse(data) : Array.from(new Uint8Array(data));
      } finally {
        URL.createObjectURL = createURL;
        HTMLAnchorElement.prototype.click = clickLink;
      }
    },selector,json);
    const saveBrush = () => download('#save-brush');
    const savedBrush = await saveBrush();
    assert.deepEqual(savedBrush.anchor,[1,1]);
    assert.deepEqual(savedBrush.settings,{ angle:90,size:[2,2],swatch:{ mode:'original' } });
    assert.deepEqual(savedBrush.slots,[0,null,null,1]);
    await press(anchor(20,20));
    assert.deepEqual(await raster(browser,preview,20,20),[230,219,182,255]);
    assert.deepEqual(await raster(browser,preview,21,19),color);
    await release(anchor(20,20));
    assert.deepEqual(await raster(browser,preview,21,20),clear);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,20,20),clear);
    assert.deepEqual(await raster(browser,preview,9,9),[230,219,182,255]);

    const brushFile = path.join(directory,'loaded-brush.json');
    fs.writeFileSync(brushFile,JSON.stringify({ format:'ink-studio/pixel-brush',version:1,
      width:1,height:1,anchor:[0,0],palette:[{ color:'#ffffff' }],slots:[0],
      settings:{ angle:90,size:[1,1],swatch:{ mode:'tint',color:'#514a6e',id:'lavender' } } }));
    const { root } = await browser.send('DOM.getDocument',{ depth:0 });
    const { nodeId } = await browser.send('DOM.querySelector',{ nodeId:root.nodeId,selector:'#open-brush' });
    await browser.send('DOM.setFileInputFiles',{ nodeId,files:[brushFile] });
    await until(browser,"document.querySelector('#brush-tint').value === '#514a6e'");
    await tap(21,22);
    assert.deepEqual(await raster(browser,preview,21,22),[81,74,110,255]);
    assert.equal(await browser.evaluate("document.querySelectorAll('.swatch').length"),4);
    await click(browser,'#undo');
    assert.equal(await browser.evaluate("document.querySelectorAll('.swatch').length"),3);

    await click(browser,'#brush-dynamics');
    await evaluate(browser,() => {
      for (const [id,value] of Object.entries({ width:5,height:5,stabilization:0,light:.2,fast:1 }))
        document.getElementById('brush-'+id).value = value;
      document.getElementById('brush-fast').dispatchEvent(new Event('change',{ bubbles:true }));
    });
    assert.deepEqual((await saveBrush()).settings.dynamics,
      { stabilization:0,pressure:[.2,1],velocity:{ speed:120,size:[1,1] } });
    const pen = (type,x,y,force) => mouse(type,anchor(x,y),
      { pointerType:'pen',force,button:'left',buttons:type === 'mouseReleased' ? 0 : 1,clickCount:1 });
    await pen('mousePressed',10.25,25,.05);
    assert.deepEqual(await raster(browser,preview,10,25),[81,74,110,255]);
    assert.deepEqual(await raster(browser,preview,10,24),clear);
    await pen('mouseMoved',25.75,25,1);
    assert.deepEqual(await raster(browser,preview,26,23),[81,74,110,255]);
    await pen('mouseReleased',25.75,25,0);
    assert.deepEqual(await raster(browser,main,26,23),[81,74,110,255]);
    assert.deepEqual(await raster(browser,preview,18,25),[81,74,110,255]);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,10,25),clear);
    assert.deepEqual(await raster(browser,preview,26,23),clear);
    await tap(30,25);
    assert.deepEqual(await raster(browser,preview,30,23),[81,74,110,255]);

    await click(browser,'#brush-dynamics');
    const settings = (mode, values = {}) => evaluate(browser,(mode,values) => {
      for (const [id,value] of Object.entries(values)) document.getElementById('brush-'+id).value = value;
      const select = document.getElementById('brush-mode');
      select.value = mode;
      if (values.width !== undefined)
        document.getElementById('brush-width').dispatchEvent(new Event('change',{ bubbles:true }));
      select.dispatchEvent(new Event('change',{ bubbles:true }));
    },mode,values);
    await settings('alpha',{ width:9,height:9,alpha:128 });
    await press(anchor(30,25));
    assert.equal((await raster(browser,preview,30,25))[3],128);
    assert.deepEqual(await raster(browser,preview,26,25),clear);
    await release(anchor(30,25));

    await settings('recolor');
    await click(browser,'.swatch:nth-child(1)');
    await tap(30,25);
    assert.equal((await raster(browser,main,30,25))[3],128);
    assert.deepEqual(await raster(browser,preview,26,25),clear);
    await settings('ramp',{ ramp:'1,3','ramp-step':1 });
    await tap(30,25);
    const lit = await raster(browser,preview,30,25);
    assert.ok(Math.abs(lit[0]-230) <= 1);
    assert.equal(lit[3],128);

    await settings('alpha',{ alpha:0 });
    await tap(30,25);
    assert.deepEqual(await raster(browser,preview,30,25),clear);
    await settings('alpha',{ alpha:255 });
    await tap(30,25);
    assert.deepEqual(await raster(browser,preview,30,25),[230,219,182,255]);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,30,25),clear);

    await click(browser,'[data-tool="pencil"]');
    await click(browser,'#mirror-x');
    await evaluate(browser,() => {
      const input = document.querySelector('#mirror-x-at');
      input.value = 12.5;
      input.dispatchEvent(new Event('change',{ bubbles:true }));
    });
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-mirror-x').hidden"),false);
    await press(anchor(11,5));
    assert.deepEqual(await raster(browser,preview,14,5),color);
    await release(anchor(11,5));
    assert.deepEqual(await raster(browser,main,11,5),color);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,14,5),clear);
    assert.deepEqual(await raster(browser,preview,11,5),clear);
    await click(browser,'#mirror-x');

    await click(browser,'#wrap-x');
    await click(browser,'[data-view="out"]');
    const tile = await screen(browser,main), leftRepeat = '.ink-grid-repeats canvas:first-child';
    assert.equal(await browser.evaluate("document.querySelectorAll('.ink-grid-repeats canvas').length"),2);
    const right = place(tile,47,34), over = place(tile,48.25,34);
    await press(right);
    await mouse('mouseMoved',over,{ button:'left',buttons:1 });
    assert.deepEqual(await raster(browser,preview,0,34),color);
    assert.deepEqual(await raster(browser,leftRepeat,0,34),color);
    assert.deepEqual(await raster(browser,preview,24,34),clear);
    await release(over);
    assert.deepEqual(await raster(browser,main,47,34),color);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,preview,0,34),clear);
    assert.deepEqual(await raster(browser,preview,47,34),clear);

    await click(browser,'[data-tool="brush"]');
    const repeatTap = place(tile,48.25,36);
    await press(repeatTap);
    await release(repeatTap);
    assert.deepEqual(await raster(browser,main,0,36),color);
    await click(browser,'[data-tool="erase"]');
    await press(repeatTap);
    await release(repeatTap);
    assert.deepEqual(await raster(browser,preview,0,36),clear);
    await click(browser,'#wrap-y');
    assert.equal(await browser.evaluate("document.querySelectorAll('.ink-grid-repeats canvas').length"),8);
    const savedTile = await download('#export');
    assert.deepEqual([savedTile.width,savedTile.height],[48,48]);
    assert.deepEqual(savedTile.drawing,{ wrapX:true,wrapY:true });

    await evaluate(browser,() => {
      const preset = document.querySelector('#preset');
      preset.value = 'blank';
      preset.dispatchEvent(new Event('change'));
    });
    const canvas = await screen(browser,main), cursor = (x,y)=>place(canvas,x,y);
    const clickPixel = async (x,y) => { await press(cursor(x,y)); await release(cursor(x,y)); };
    const move = (x,y) => mouse('mouseMoved',cursor(x,y),{ button:'left',buttons:1 });
    const chooseSelection = type => evaluate(browser,type => {
      const field = document.querySelector('#selection-type');
      field.value = type;
      field.dispatchEvent(new Event('change',{ bubbles:true }));
    },type);
    const overlay = '.ink-grid-selection canvas';
    const selected = async (x,y) => (await raster(browser,overlay,x,y))[3] > 0;

    await chooseSelection('ellipse');
    await press(cursor(4,4));
    await move(8,8);
    assert.equal(await selected(4,4),false);
    assert.equal(await selected(6,6),true);
    await release(cursor(8,8));
    await click(browser,'[data-tool="pencil"]');
    await press(cursor(3,6));
    await move(10,6);
    await release(cursor(10,6));
    assert.deepEqual(await raster(browser,preview,3,6),clear);
    assert.deepEqual(await raster(browser,preview,4,6),color);
    assert.deepEqual(await raster(browser,preview,8,6),color);
    assert.deepEqual(await raster(browser,preview,9,6),clear);

    await chooseSelection('lasso');
    await press(cursor(12,4));
    await move(16,4);
    await move(12,8);
    await release(cursor(12,4));
    assert.equal(await selected(13,5),true);
    assert.equal(await selected(16,8),false);

    await chooseSelection('polygon');
    await clickPixel(18,4);
    await clickPixel(22,4);
    assert.equal(await browser.evaluate("document.querySelector('#selection-close').disabled"),true);
    await clickPixel(22,8);
    await click(browser,'#selection-close');
    assert.equal(await selected(21,5),true);
    assert.equal(await selected(18,8),false);
    await click(browser,'#selection-clear');

    await click(browser,'[data-tool="pencil"]');
    await click(browser,'.swatch:nth-child(3)');
    for (const x of [5,6,13]) await clickPixel(x,32);
    await chooseSelection('swatch');
    await clickPixel(5,32);
    assert.equal(await selected(13,32),true);
    assert.equal(await selected(10,32),false);
    await chooseSelection('cluster');
    await clickPixel(5,32);
    assert.equal(await selected(6,32),true);
    assert.equal(await selected(13,32),false);
    await chooseSelection('wand');
    await clickPixel(5,32);
    assert.equal(await selected(6,32),true);
    assert.equal(await selected(13,32),false);
    await chooseSelection('range');
    await clickPixel(5,32);
    assert.equal(await selected(13,32),true);
    assert.equal(await selected(10,32),false);
    await click(browser,'#capture-brush');
    const islands = await saveBrush();
    assert.deepEqual(islands.slots,[0,0,null,null,null,null,null,null,0]);

    const change = (id,value,type = 'change') => evaluate(browser,(id,value,type) => {
      const field = document.getElementById(id);
      field.value = value;
      field.dispatchEvent(new Event(type,{ bubbles:true }));
    },id,value,type);
    const rectangle = async (x,y,u,v) => { await press(cursor(x,y)); await move(u,v); await release(cursor(u,v)); };
    const modify = type => click(browser,'[data-selection-modifier="'+type+'"]');
    await evaluate(browser,() => {
      for (const details of document.querySelectorAll('#selection-tools details')) details.open = true;
    });

    await chooseSelection('rectangle');
    await rectangle(25,15,27,17);
    await change('selection-mode','combine');
    await rectangle(27,15,29,15);
    assert.equal(await selected(29,15),true);
    assert.equal(await selected(25,17),true);
    await change('selection-mode','subtract');
    await clickPixel(26,16);
    assert.equal(await selected(26,16),false);
    await modify('grow');
    assert.equal(await selected(26,16),true);
    assert.equal(await selected(24,15),true);
    assert.equal(await selected(24,14),false);
    await change('selection-mode','intersect');
    await rectangle(26,16,28,17);
    assert.equal(await selected(26,16),true);
    assert.equal(await selected(25,17),false);
    await click(browser,'#undo');
    assert.equal(await selected(25,17),true);

    await change('selection-mode','replace');
    await rectangle(25,15,27,17);
    await modify('shrink');
    assert.equal(await selected(26,16),true);
    assert.equal(await selected(25,15),false);
    await click(browser,'#undo');
    await modify('outline');
    assert.equal(await selected(26,16),false);
    assert.equal(await selected(25,15),true);
    await change('selection-name','rim','input');
    await click(browser,'#selection-save');
    await modify('invert');
    assert.equal(await selected(26,16),true);
    assert.equal(await selected(25,15),false);
    await click(browser,'#selection-recall');
    assert.equal(await selected(26,16),false);
    assert.equal(await selected(25,15),true);

    const savedMasks = await download('#export');
    assert.equal(savedMasks.frames[0].selections[0].id,'rim');
    assert.equal(savedMasks.frames[0].selections[0].pixels.length,8);
    const maskFile = path.join(directory,'saved-masks.json');
    fs.writeFileSync(maskFile,JSON.stringify(savedMasks));
    const doc = await browser.send('DOM.getDocument',{ depth:1 });
    const imported = await browser.send('DOM.querySelector',{ nodeId:doc.root.nodeId,selector:'#import' });
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[maskFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened saved-masks.json'");
    assert.equal(await browser.evaluate("document.querySelector('#selection-saved option[value=rim]').value"),'rim');
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-selection').hidden"),true);
    await change('selection-saved','rim');
    await click(browser,'#selection-recall');
    assert.equal(await selected(26,16),false);
    assert.equal(await selected(25,15),true);

    await click(browser,'#selection-clear');
    await chooseSelection('rectangle');
    await rectangle(5,32,6,32);
    const gold = [230,219,182,255];
    await evaluate(browser,()=>document.querySelector('#transform-begin').closest('details').open = true);
    const key = async name => {
      await browser.send('Input.dispatchKeyEvent',{ type:'keyDown',key:name,code:name });
      await browser.send('Input.dispatchKeyEvent',{ type:'keyUp',key:name,code:name });
    };
    await click(browser,'#transform-begin');
    await key('ArrowRight');
    assert.deepEqual(await raster(browser,preview,5,32),clear);
    assert.deepEqual(await raster(browser,preview,7,32),gold);
    const beforeCommit = await download('#export');
    assert.notEqual(beforeCommit.frames[0].slots[32*48+5],null);
    assert.equal(beforeCommit.frames[0].slots[32*48+7],null);
    await press(cursor(6,32));
    await move(9,31);
    await release(cursor(9,31));
    assert.deepEqual(await raster(browser,preview,10,31),gold);
    assert.equal(await selected(10,31),true);
    await key('Enter');
    assert.equal(await browser.evaluate("document.querySelector('#transform-fields').hidden"),true);
    assert.deepEqual(await raster(browser,main,10,31),gold);
    await click(browser,'#undo');
    assert.deepEqual(await raster(browser,main,10,31),clear);
    assert.equal(await selected(5,32),true);

    await click(browser,'#transform-begin');
    await change('transform-angle',90,'input');
    await change('transform-width',3,'input');
    await change('transform-rotation','pixel-aware','input');
    assert.deepEqual(await raster(browser,preview,5,34),gold);
    assert.deepEqual(await raster(browser,preview,6,32),clear);
    await key('Escape');
    assert.deepEqual(await raster(browser,preview,5,34),clear);
    assert.deepEqual(await raster(browser,preview,6,32),gold);

    await click(browser,'#transform-copy');
    await click(browser,'#transform-paste');
    await change('transform-x',19,'input');
    await change('transform-y',25,'input');
    assert.deepEqual(await raster(browser,preview,5,32),gold);
    assert.deepEqual(await raster(browser,preview,20,25),gold);
    await click(browser,'#transform-apply');
    assert.deepEqual(await raster(browser,main,20,25),gold);
    assert.equal(await selected(20,25),true);

    await change('canvas-operation','crop');
    await click(browser,'#canvas-fit-selection');
    await click(browser,'#canvas-apply');
    const cropped = await download('#export');
    assert.deepEqual([cropped.width,cropped.height],[2,1]);
    assert.deepEqual(await raster(browser,preview,1,0),gold);

    const boundFile = path.join(directory,'bound-canvas.json');
    fs.writeFileSync(boundFile,JSON.stringify({ width:4,height:3,palette:['#e6dbb6'],
      slots:[null,null,null,null,null,0,null,null,null,null,null,null],
      guides:[{ id:'toe',kind:'pivot',at:[1,1] }],
      sceneBindings:[{ id:'prop',scene:'panel',object:'wall' }] }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[boundFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened bound-canvas.json'");
    await change('canvas-operation','pad');
    await change('canvas-left',1);
    await change('canvas-top',1);
    assert.equal(await browser.evaluate("document.querySelector('#canvas-size').checkValidity()"),false);
    await change('canvas-binding-policy','preserve');
    await click(browser,'#canvas-apply');
    const padded = await download('#export');
    assert.deepEqual([padded.width,padded.height],[5,4]);
    assert.deepEqual(padded.guides[0].at,[2,2]);
    assert.deepEqual(padded.sceneBindings[0].canvas,{ size:[4,3],offset:[-1,-1],scale:[1,1] });
    assert.deepEqual(await raster(browser,preview,2,2),gold);

    await change('canvas-operation','resample');
    await change('canvas-width',10);
    await change('canvas-height',8);
    await click(browser,'#canvas-apply');
    const scaled = await download('#export');
    assert.deepEqual([scaled.width,scaled.height],[10,8]);
    assert.deepEqual(scaled.guides[0].at,[4.5,4.5]);
    assert.deepEqual(await raster(browser,preview,5,5),gold);
    await click(browser,'#undo');
    assert.deepEqual(await download('#export'),padded);

    const aliasPNG = path.join(directory,'aliases.png');
    const paint = { width:3,height:2,palette:['#cb4519','#cb4519'],swatchIds:['brass','accent'],
      slots:[0,1,0,null,null,1],alpha:[255,255,3,255,255,0],knockouts:[4] };
    fs.writeFileSync(aliasPNG,PNG.encodePaint(paint,'rgba'));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[aliasPNG] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened aliases.png'");
    await click(browser,'[data-tool="pencil"]');
    await change('pencil-color-mode','rgba');
    await change('pencil-alpha',7);
    const adjusted = place(await screen(browser,main),1,0);
    await press(adjusted);
    await release(adjusted);
    await change('pencil-rgb','#112233');
    await change('pencil-alpha',1);
    const precise = place(await screen(browser,main),0,1);
    await press(precise);
    await release(precise);
    await change('png-color-mode','indexed');
    const exported = Buffer.from(await download('#export-png',false));
    assert.equal(exported[25],3);
    const reopened = PNG.paintRaster(exported);
    assert.deepEqual(reopened.swatchIds,['brass','accent','rgb-112233']);
    assert.deepEqual(reopened.slots,[0,1,0,2,null,1]);
    assert.deepEqual(reopened.alpha,[255,7,3,1,255,0]);
    assert.deepEqual(reopened.knockouts,[4]);
    assert.deepEqual([...PNG.raster(exported).data.slice(12,16)],[17,34,51,1]);
    const editedPNG = path.join(directory,'edited-aliases.png');
    fs.writeFileSync(editedPNG,exported);
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[editedPNG] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened edited-aliases.png'");
    const editable = await download('#export');
    assert.deepEqual(editable.swatchIds,reopened.swatchIds);
    assert.deepEqual(editable.frames[0].slots,reopened.slots);
    assert.deepEqual(editable.frames[0].alpha,reopened.alpha);

    await click(browser,'#palette button:nth-child(1)');
    await change('swatch-name','Brass base');
    await click(browser,'#swatch-lock');
    await change('color','#000000');
    assert.equal(await browser.evaluate("document.querySelector('#status').textContent"),'Swatch brass is locked');
    assert.equal(await browser.evaluate("document.querySelector('#color').value"),'#cb4519');
    await evaluate(browser,()=>{
      for (const id of ['palette-ramp-form','swatch-remap','palette-export'])
        document.getElementById(id).closest('details').open = true;
    });
    await change('palette-ramp-id','metal');
    await change('palette-ramp-name','Warm metal');
    await change('palette-ramp-order','rgb-112233, accent, brass');
    await click(browser,'#palette-ramp-form button[type=submit]');
    await change('brush-mode','ramp');
    await change('brush-ramp-id','metal');
    assert.equal(await browser.evaluate("document.querySelector('#brush-ramp').disabled"),true);
    await click(browser,'#swatch-later');
    const ordered = await download('#export');
    assert.deepEqual(ordered.swatchIds,['accent','brass','rgb-112233']);
    assert.deepEqual(ordered.frames[0].slots,[1,0,1,2,null,0]);
    assert.deepEqual(ordered.ramps[0].swatches,['rgb-112233','accent','brass']);
    assert.deepEqual(ordered.frames[0].alpha,editable.frames[0].alpha);
    assert.equal(await browser.evaluate("document.querySelector('#swatch-replace').disabled"),true);
    await evaluate(browser,()=>document.querySelector('#swatch-replace').closest('details').open = true);
    await chooseSelection('rectangle');
    const paletteCanvas = await screen(browser,main);
    await press(place(paletteCanvas,0,0));
    await mouse('mouseMoved',place(paletteCanvas,1,0),{ button:'left',buttons:1 });
    await release(place(paletteCanvas,1,0));
    await change('swatch-replace-target','rgb-112233');
    await click(browser,'#swatch-replace');
    const localColor = await download('#export');
    assert.deepEqual(localColor.palette,ordered.palette);
    assert.deepEqual(localColor.frames[0].slots,[2,0,1,2,null,0]);
    assert.deepEqual(localColor.frames[0].alpha,ordered.frames[0].alpha);
    await click(browser,'#undo');

    await click(browser,'#palette button:nth-child(1)');
    await change('swatch-remap-target','rgb-112233');
    await click(browser,'#swatch-remap');
    const indexRemap = await download('#export');
    assert.deepEqual(indexRemap.palette,ordered.palette);
    assert.deepEqual(indexRemap.frames[0].slots,[1,2,1,2,null,2]);
    await click(browser,'#undo');

    await click(browser,'#palette button:nth-child(1)');
    await change('swatch-remap-target','rgb-112233');
    await click(browser,'#swatch-remap-remove');
    await click(browser,'#swatch-remap');
    const remapped = await download('#export');
    assert.deepEqual(remapped.swatchIds,['brass','rgb-112233']);
    assert.deepEqual(remapped.ramps[0].swatches,['rgb-112233','brass']);
    assert.deepEqual(remapped.frames[0].slots,[0,1,0,1,null,1]);

    const exportedPalette = await download('#palette-export');
    const paletteFile = path.join(directory,'saved-palette.json');
    fs.writeFileSync(paletteFile,JSON.stringify(exportedPalette));
    await change('preset','blank');
    const paletteInput = await browser.send('DOM.querySelector',{ nodeId:doc.root.nodeId,selector:'#palette-import' });
    await browser.send('DOM.setFileInputFiles',{ nodeId:paletteInput.nodeId,files:[paletteFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Imported saved-palette.json'");
    const importedPalette = await download('#palette-export');
    assert.deepEqual(importedPalette.swatches.slice(-2),exportedPalette.swatches);
    assert.deepEqual(importedPalette.ramps,exportedPalette.ramps);
    const extractInput = await browser.send('DOM.querySelector',{ nodeId:doc.root.nodeId,selector:'#palette-extract-png' });
    await browser.send('DOM.setFileInputFiles',{ nodeId:extractInput.nodeId,files:[editedPNG] });
    await until(browser,"document.querySelector('#status').textContent === 'Extracted palette'");
    assert.ok((await download('#palette-export')).swatches.some(row=>row.id === 'extracted-cb4519-slot-1'));

    const adjustmentFile = path.join(directory,'adjustment-frames.json');
    const frame = (...blue) => Array.from({ length:12 },(_,i)=>blue.includes(i) ? 0 : null);
    fs.writeFileSync(adjustmentFile,JSON.stringify({ width:4,height:3,palette:['#0000cc','#ffffff'],
      frames:[{ duration:.125,slots:frame(5,6) },{ duration:.25,slots:frame(6) }] }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[adjustmentFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened adjustment-frames.json'");
    const originalFrames = await download('#export');
    await evaluate(browser,()=>document.querySelector('#adjustment-preview').closest('details').open = true);
    await chooseSelection('rectangle');
    await change('selection-mode','replace');
    const maskPoint = place(await screen(browser,main),1,1);
    await press(maskPoint);
    await release(maskPoint);
    await change('adjustment-type','hue-saturation');
    await change('adjustment-degrees',120);
    await change('adjustment-scope','selection');
    await click(browser,'#adjustment-preview');
    assert.deepEqual(await raster(browser,preview,1,1),[204,0,0,255]);
    assert.deepEqual(await raster(browser,preview,2,1),[0,0,204,255]);
    assert.deepEqual(await download('#export'),originalFrames);
    await click(browser,'#adjustment-cancel');
    assert.deepEqual(await raster(browser,preview,1,1),[0,0,204,255]);
    await click(browser,'#adjustment-preview');
    await click(browser,'#adjustment-apply');
    const localAdjustment = await download('#export');
    assert.deepEqual(localAdjustment.swatchIds,['slot-0','slot-1','rgb-cc0000']);
    assert.equal(localAdjustment.frames[0].slots[5],2);
    assert.equal(localAdjustment.frames[0].slots[6],0);
    assert.deepEqual(localAdjustment.frames[1],originalFrames.frames[1]);
    await click(browser,'#undo');
    assert.deepEqual(await download('#export'),originalFrames);

    await change('adjustment-scope','range');
    await change('adjustment-start',1);
    await change('adjustment-end',2);
    await click(browser,'#adjustment-preview');
    assert.equal(await browser.evaluate("document.querySelector('#adjustment-info').value"),'3 pixels changed in 2 frames');
    await change('scrub',2,'input');
    assert.deepEqual(await raster(browser,preview,2,1),[204,0,0,255]);
    assert.deepEqual(await download('#export'),originalFrames);
    await click(browser,'#adjustment-apply');
    const ranged = await download('#export');
    assert.equal(ranged.frames[0].slots[5],2);
    assert.equal(ranged.frames[0].slots[6],2);
    assert.equal(ranged.frames[1].slots[6],2);
    assert.equal(ranged.frames[1].duration,.25);
    await click(browser,'#undo');
    assert.deepEqual(await download('#export'),originalFrames);

    const layeredFile = path.join(directory,'workshop-layers.json');
    const slots = (...pixels)=>Array.from({ length:12 },(_,i)=>pixels.find(([p])=>p === i)?.[1] ?? null);
    const layers = [{ id:'back' },{ id:'group',kind:'group',opacity:.5 },
      { id:'mask',kind:'mask',parent:'group' },{ id:'detail',parent:'group',clip:'mask' },
      { id:'ref',kind:'reference' }];
    fs.writeFileSync(layeredFile,JSON.stringify({
      format:'ink-studio/pixel-layer-deck',version:1,width:4,height:3,swatchIds:['blue','red','green'],
      palette:['#0000ff','#ff0000','#00ff00'],layers,frames:[{ id:'wide',duration:.25,cels:{
        back:{ slots:slots([5,0],[6,0],[7,0]) }, mask:{ slots:slots([5,1]) },
        detail:{ slots:slots([5,1],[6,1]) }, ref:{ slots:slots([7,2]) }
      } }]
    }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[layeredFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened workshop-layers.json'");
    await evaluate(browser,()=>document.querySelector('#layer-active').closest('details').open = true);
    assert.deepEqual(await raster(browser,preview,1,1),[128,0,127,255]);
    assert.deepEqual(await raster(browser,preview,2,1),[0,0,255,255]);
    assert.deepEqual(await raster(browser,preview,3,1),[0,255,0,255]);
    await click(browser,'#layer-references');
    assert.deepEqual(await raster(browser,preview,3,1),[0,0,255,255]);
    await change('layer-active','mask');
    await change('layer-view','active');
    assert.deepEqual(await raster(browser,preview,1,1),[255,0,0,255]);
    await change('layer-view','composite');
    await change('layer-active','group');
    await click(browser,'#layer-lock');
    await change('layer-active','detail');
    await click(browser,'[data-tool="pencil"]');
    await change('pencil-color-mode','indexed');
    await click(browser,'#palette button:nth-child(3)');
    const layerCanvas = await screen(browser,main), lockedPaint = place(layerCanvas,1,1);
    await press(lockedPaint);
    await release(lockedPaint);
    assert.equal(await browser.evaluate("document.querySelector('#status').textContent"),'Choose an unlocked paint, mask, or surface layer');
    await change('layer-active','group');
    await click(browser,'#layer-lock');
    await change('layer-active','detail');
    const outsideMask = place(layerCanvas,2,1);
    await press(outsideMask);
    await release(outsideMask);
    assert.equal(await browser.evaluate("document.querySelector('#status').textContent"),'Clipped pixel at 2, 1');
    await press(lockedPaint);
    await release(lockedPaint);
    const beforeMerge = await download('#export');
    assert.deepEqual(beforeMerge.frames[0].cels.detail.slots,slots([5,2],[6,1]));
    assert.deepEqual(await raster(browser,preview,1,1),[0,128,127,255]);
    await evaluate(browser,()=>document.querySelector('#pixel-inspection details').open = true);
    await mouse('mouseMoved',outsideMask);
    await mouse('mouseMoved',lockedPaint);
    await until(browser,"document.querySelector('[data-inspection-result]').value.includes('#00807f')");
    const inspected = await browser.evaluate("document.querySelector('#pixel-inspection').textContent");
    assert.match(inspected,/detail.*clip mask 255/);
    assert.match(inspected,/layer blend/);

    await change('layer-active','group');
    await click(browser,'#layer-merge');
    const mergedDeck = await download('#export');
    assert.deepEqual(mergedDeck.layers.map(row=>row.id),['back','group','ref']);
    assert.equal(mergedDeck.layers[1].kind,'paint');
    assert.deepEqual(await raster(browser,preview,1,1),[0,128,127,255]);
    await change('png-color-mode','rgba');
    const layerPNG = Buffer.from(await download('#export-png',false));
    assert.deepEqual([...PNG.raster(layerPNG).data.slice(7*4,8*4)],[0,0,255,255]);
    await click(browser,'#undo');
    assert.deepEqual(await download('#export'),beforeMerge);

    await change('layer-kind','paint');
    await change('layer-id','extra');
    await click(browser,'#layer-add');
    assert.equal((await download('#export')).layers.at(-1).id,'extra');
    await click(browser,'#layer-remove');
    assert.deepEqual((await download('#export')).layers,beforeMerge.layers);

    const detailFile = path.join(directory,'workshop-detail.json');
    fs.writeFileSync(detailFile,JSON.stringify({ width:4,height:3,swatchIds:['ink'],
      palette:['#ff0000'],frames:[{ slots:slots([0,0],[11,0]),duration:.25 },{ slots:slots(),duration:.25 }] }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[detailFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened workshop-detail.json'");
    await evaluate(browser,()=>document.querySelector('#protection-tools').open = true);
    await chooseSelection('rectangle');
    const detailCanvas = await screen(browser,main);
    await press(place(detailCanvas,0,0));
    await release(place(detailCanvas,0,0));
    await evaluate(browser,()=>{
      const field = document.querySelector('#protection-id');
      field.value = 'eye';
      field.dispatchEvent(new Event('input'));
    });
    await change('protection-kind','accent');
    await click(browser,'#protection-lock');
    const locked = await download('#export');
    assert.deepEqual(locked.protectedDetails,[{ id:'eye',kind:'accent',pixels:[[0,0]],frame:'frame-1' }]);
    await change('color','#00ff00');
    assert.match(await browser.evaluate("document.querySelector('#status').textContent"),/would change protected detail eye/);
    await click(browser,'#transform-begin');
    await evaluate(browser,()=>{
      const carry = document.querySelector('#transform-protection');
      carry.checked = true;
      document.querySelector('#transform-x').value = 2;
      carry.dispatchEvent(new Event('input',{ bubbles:true }));
    });
    await click(browser,'#transform-apply');
    assert.deepEqual((await download('#export')).protectedDetails[0].pixels,[[2,0]]);
    assert.deepEqual(await raster(browser,preview,2,0),[255,0,0,255]);
    await click(browser,'#protection-unlock');
    assert.deepEqual((await download('#export')).protectedDetails,[]);
    await click(browser,'#undo');
    assert.equal((await download('#export')).protectedDetails[0].id,'eye');

    await evaluate(browser,()=>document.querySelector('#craft-diagnostics details').open = true);
    const diagnostic = "document.querySelector('[data-diagnostic-result]')";
    await until(browser,`${diagnostic}.dataset.finding === 'orphan-3-2'`);
    await click(browser,'[data-diagnostic-jump]');
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-diagnostic').hidden"),false);
    await until(browser,"document.querySelector('[data-inspection-result]').value.startsWith('3, 2')");
    await click(browser,'[data-diagnostic-select]');
    assert.equal(await browser.evaluate("document.querySelector('#selection-count').value"),'1 pixels selected');
    assert.deepEqual(await raster(browser,preview,3,2),[255,0,0,255]);
    await click(browser,'[data-diagnostic-protected]');
    await click(browser,'[data-diagnostic-previous]');
    await until(browser,`${diagnostic}.dataset.finding === 'orphan-2-0'`);
    assert.equal(await browser.evaluate("document.querySelector('[data-diagnostic-select]').disabled"),true);
    assert.match(await browser.evaluate("document.querySelector('#pixel-inspection').textContent"),/eye · accent/);
    await click(browser,'[data-diagnostic-next]');
    await until(browser,`${diagnostic}.dataset.finding === 'orphan-3-2'`);
    const spare = await screen(browser,main);
    await click(browser,'[data-tool="erase"]');
    await press(place(spare,3,2));
    await release(place(spare,3,2));
    await until(browser,`${diagnostic}.dataset.finding === 'orphan-2-0'`);
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-diagnostic').hidden"),true);

    const cleanupFile = path.join(directory,'workshop-cleanup.json');
    fs.writeFileSync(cleanupFile,JSON.stringify({ width:4,height:3,swatchIds:['ink','rust'],palette:['#142839','#c65126'],
      frames:[{ slots:slots([4,0],[5,0],[6,1],[8,0],[9,0]),duration:.25 }] }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[cleanupFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened workshop-cleanup.json'");
    await until(browser,`${diagnostic}.dataset.finding === 'orphan-2-1'`);
    const cleanupOriginal = await download('#export');
    await click(browser,'[data-diagnostic-select]');
    await evaluate(browser,()=>document.querySelector('#cleanup-tools').open = true);
    await change('cleanup-kind','fragment');
    await click(browser,'#cleanup-preview');
    await until(browser,"document.querySelector('#cleanup-info').value === '1 of 64 pixels'");
    assert.match(await browser.evaluate("document.querySelector('#cleanup-diff tbody').textContent"),
      /2, 1.*rust · #c65126 · α 255.*ink · #142839 · α 255/);
    assert.deepEqual(await raster(browser,preview,2,1),[20,40,57,255]);
    assert.deepEqual(await download('#export'),cleanupOriginal);
    await click(browser,'#cleanup-cancel');
    assert.deepEqual(await raster(browser,preview,2,1),[198,81,38,255]);
    await click(browser,'#cleanup-preview');
    await click(browser,'#cleanup-apply');
    assert.equal((await download('#export')).frames[0].slots[6],0);
    await until(browser,`${diagnostic}.dataset.finding === ''`);
    await click(browser,'#undo');
    assert.deepEqual(await download('#export'),cleanupOriginal);

    const rulesFile = path.join(directory,'workshop-art-rules.json');
    const artRules = {
      version:1,
      profiles:[{ id:'actor',ramps:['metal'] },{ id:'close-up',
        exceptions:[{ id:'visor',check:'ramp',reason:'Hold the visor spot.',selection:'visor' }] }],
      bindings:[{ profile:'actor',layer:'paint' },{ profile:'close-up',layer:'paint',shot:'close' }]
    };
    fs.writeFileSync(rulesFile,JSON.stringify({ width:4,height:3,swatchIds:['ink','rust','blue'],palette:['#142839','#c65126','#628ace'],
      ramps:[{ id:'metal',swatches:['ink','blue'] }],frames:[{ id:'front',slots:slots([4,0],[5,0],[6,1]),duration:.25 }],
      sharedSelections:[{ id:'visor',pixels:[[2,1]] }],artRules }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[rulesFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened workshop-art-rules.json'");
    await evaluate(browser,()=>{
      const menu = document.querySelector('[data-diagnostic-kind]');
      menu.value = 'ramp';
      menu.dispatchEvent(new Event('change'));
    });
    await until(browser,`${diagnostic}.dataset.finding === 'ramp-2-1'`);
    assert.equal(await browser.evaluate("document.querySelector('#art-shot-control').hidden"),false);
    await change('art-shot','close');
    await until(browser,`${diagnostic}.dataset.finding === ''`);
    await click(browser,'[data-diagnostic-accepted]');
    await until(browser,`${diagnostic}.value.includes('Accepted · visor')`);
    assert.match(await browser.evaluate("document.querySelector('#craft-diagnostics p').textContent"),/Hold the visor spot/);
    assert.equal(await browser.evaluate("document.querySelector('[data-diagnostic-select]').disabled"),true);
    assert.deepEqual((await download('#export')).artRules,artRules);

    const motionFile = path.join(directory,'workshop-motion.json');
    const row = (id,anchor,glint)=>({ id,duration:.125,slots:slots([anchor+4,0],[anchor+5,glint]),
      guides:[{ id:'pivot',kind:'registration',at:[anchor,1] }] });
    fs.writeFileSync(motionFile,JSON.stringify({ width:4,height:3,swatchIds:['ink','light'],palette:['#142839','#eff9a4'],
      frames:[row('base',0,0),row('flash',1,1),row('hold',0,0)] }));
    await browser.send('DOM.setFileInputFiles',{ nodeId:imported.nodeId,files:[motionFile] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened workshop-motion.json'");
    await evaluate(browser,()=>{
      document.querySelector('#motion-checks details').open = true;
    });
    await until(browser,"document.querySelector('[data-motion-result]').dataset.finding === 'flash/flicker-2-1'");
    await click(browser,'[data-motion-jump]');
    assert.equal(await browser.evaluate("document.querySelector('#scrub').value"),'2');
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-motion').hidden"),false);
    assert.deepEqual(await raster(browser,preview,2,1),[239,249,164,255]);
    await evaluate(browser,()=>{
      const picker = document.querySelector('[data-motion-sample]');
      picker.selectedIndex = 0;
      picker.dispatchEvent(new Event('change'));
    });
    assert.equal(await browser.evaluate("document.querySelector('#scrub').value"),'1');
    await until(browser,"document.querySelector('[data-inspection-result]').value.startsWith('1, 1')");
    assert.deepEqual(await raster(browser,preview,1,1),[20,40,57,255]);










  });
});

test('the CLI exports an offline native canvas with both views on the selected versioned frame', { skip },async t => {
  const directory = workspace(t), input = path.join(directory,'design.json'), file = path.join(directory,'review.html');
  const scenePath = path.join(directory,'scene.json');
  const versioned = { format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
    palette:{ warm:'#ac421d',cool:'#216286' },layers:[{ id:'paint' },{ id:'glaze' }],frames:[
      { id:'front',label:'Front',durationMs:100,cels:{ paint:{ marks:[{ at:[1,2],swatch:'cool' }] },
        glaze:{ marks:[{ at:[1,2],swatch:'warm' }] } } },
      { id:'side',label:'Side',durationMs:200,cels:{ paint:{ marks:[{ at:[1,2],swatch:'cool' }] } } }
    ],guides:[{ id:'tile',kind:'grid',at:[0,1],step:[4,3] },
      { id:'front-pin',kind:'registration',at:[3,4],frame:'front' }],
    protectedDetails:[{ id:'paint-tip',kind:'accent',frame:'front',pixels:[[1,2]] }],
    sceneBindings:[{ id:'panel',scene:scenePath,object:'face',frame:'front',
      canvas:{ size:[7,6],offset:[-1,0],scale:[1,1] } }],
    destinations:[{ id:'scratches',kind:'surface-channel',binding:'panel',chart:'front',channel:'wear' }] };
  fs.writeFileSync(scenePath,JSON.stringify({ id:'panel',style:'slate',solids:[
    { id:'face',kind:'box',at:[0,0,0],half:[1,1,.25],res:.1,mat:'stone',surfaceState:{ charts:{ front:{
      origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0],
      stamps:[{ channel:'wear',value:.625,brush:{ kind:'rect',min:[0,0],max:[1,1] } }]
    } } } }
  ] }));
  fs.writeFileSync(input,JSON.stringify(versioned));
  const args = ['cli/ink-studio.js','pixel-art','canvas',input,'--out',file];
  execFileSync(process.execPath,[...args,'--scene',scenePath,'--destination','scratches'],{ cwd:root });
  await withChrome(directory,{ hardware:true },async browser => {
    await load(browser,file,380,850);
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth'),380);
    assert.deepEqual(await raster(browser,main,1,2),[172,66,29,255]);
    assert.deepEqual(await raster(browser,preview,1,2),[172,66,29,255]);
    assert.deepEqual(await raster(browser,preview,0,0),[0,0,0,0]);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-guide=front-pin]'))"),true);
    await click(browser,'#eyedropper');
    const sample = async (mode,expected,x = 1,y = 2) => {
      const at = place(await screen(browser,main),x,y);
      await evaluate(browser,mode => {
        const input = document.querySelector('#sample-mode');
        input.value = mode;
        input.dispatchEvent(new Event('change'));
      },mode);
      await browser.send('Input.dispatchMouseEvent',{ type:'mousePressed',...at,button:'left',buttons:1,clickCount:1 });
      await browser.send('Input.dispatchMouseEvent',{ type:'mouseReleased',...at,button:'left',clickCount:1 });
      assert.equal(await browser.evaluate("document.querySelector('#sample-value').value"),expected);
    };
    await sample('composite','1, 2 · warm · #ac421d');
    await sample('layer','1, 2 · paint · cool · #216286');
    await sample('source','1, 2 · face/front/wear · 0.625');
    await sample('source','0, 0 · face/front/wear · Outside source',0,0);
    await evaluate(browser,()=>document.querySelector('#pixel-inspection details').open = true);
    const moveTo = async (x,y) => browser.send('Input.dispatchMouseEvent',{
      type:'mouseMoved',...place(await screen(browser,main),x,y)
    });
    await moveTo(1,2);
    const inspectorOutput = "document.querySelector('[data-inspection-result]').value";
    await until(browser,`${inspectorOutput} === '1, 2 · glaze · #ac421d · alpha 255'`);
    const inspected = await browser.evaluate("document.querySelector('#pixel-inspection').textContent");
    assert.match(inspected,/paint.*covered/);
    assert.match(inspected,/authored index/);
    assert.match(inspected,/paint-tip · accent · front/);
    assert.match(inspected,/face\/front\/wear.*0\.625/);
    assert.match(inspected,/Source view.*panel.*8×6/);
    assert.match(inspected,/Scene bindings.*panel · grid mismatch/);
    assert.match(inspected,/Scene hits/);
    await click(browser,'#pixel-inspection button');
    await moveTo(0,0);
    assert.equal(await browser.evaluate(inspectorOutput),'1, 2 · glaze · #ac421d · alpha 255');
    await click(browser,'#pixel-inspection button');
    await moveTo(1,2);
    await moveTo(0,0);
    await until(browser,`${inspectorOutput} === '0, 0 · Transparent · alpha 0'`);
    assert.match(await browser.evaluate("document.querySelector('#pixel-inspection').textContent"),/Outside source/);
    await evaluate(browser,()=>document.querySelector('#craft-diagnostics details').open = true);
    await until(browser,"document.querySelector('[data-diagnostic-result]').value === 'No findings in this view'");
    await click(browser,'[data-diagnostic-protected]');
    await until(browser,"document.querySelector('[data-diagnostic-result]').dataset.finding === 'orphan-1-2'");
    await click(browser,'[data-diagnostic-jump]');
    await until(browser,`${inspectorOutput} === '1, 2 · glaze · #ac421d · alpha 255'`);
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-diagnostic').hidden"),false);
    await browser.evaluate(`document.querySelector('#frames').selectedIndex = 1;
      document.querySelector('#frames').dispatchEvent(new Event('change'));`);
    await until(browser,"document.querySelector('.ink-grid-main').getContext('2d').getImageData(1,2,1,1).data[0] === 33");
    assert.deepEqual(await raster(browser,preview,1,2),[33,98,134,255]);
    assert.equal((await screen(browser,preview)).w,8);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-guide=front-pin]'))"),false);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-guide=tile]'))"),true);
    assert.equal(await browser.evaluate("document.querySelector('#sample-mode').options[2].disabled"),true);
    execFileSync(process.execPath,[...args,'--frame','side'],{ cwd:root });
    await browser.send('Page.navigate',{ url:'about:blank' });
    await load(browser,file);
    assert.equal(await browser.evaluate("document.querySelector('#frame-control').hidden"),true);
    assert.deepEqual(await raster(browser,preview,1,2),[33,98,134,255]);

    versioned.palette.gold = '#f9bd66';
    versioned.ramps = [{ id:'warm-ramp',swatches:['warm','gold'] }];
    versioned.artRules = { version:1,
      profiles:[{ id:'underpainting',ramps:['warm-ramp'],exceptions:[{ id:'glaze-study',check:'ramp',reason:'Test cool spill.' }] }],
      bindings:[{ profile:'underpainting',layer:'paint',shot:'study' }] };
    fs.writeFileSync(input,JSON.stringify(versioned));
    execFileSync(process.execPath,[...args,'--frame','side','--art-shot','study'],{ cwd:root });
    await browser.send('Page.navigate',{ url:'about:blank' });
    await load(browser,file);
    await evaluate(browser,()=>document.querySelector('#craft-diagnostics details').open = true);
    await until(browser,"!document.querySelector('[data-diagnostic-accepted]').closest('label').hidden");
    await click(browser,'[data-diagnostic-accepted]');
    await evaluate(browser,()=>{
      const menu = document.querySelector('[data-diagnostic-kind]');
      menu.value = 'ramp';
      menu.dispatchEvent(new Event('change'));
    });
    await until(browser,"document.querySelector('[data-diagnostic-result]').value.includes('Accepted · glaze-study')");

    const sourceView = path.join(directory,'native-view.json');
    execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','capture',scenePath,
      '--w','8','--h','6','--t','.25','--view-id','paint-guide','--out',sourceView],{ cwd:root });
    execFileSync(process.execPath,[...args,'--source-view',sourceView,'--at','4,3'],{ cwd:root });
    await browser.send('Page.navigate',{ url:'about:blank' });
    await load(browser,file);
    await evaluate(browser,()=>document.querySelector('#pixel-inspection details').open = true);
    await moveTo(4,3);
    await until(browser,"document.querySelector('#pixel-inspection').textContent.includes('paint-guide')");
    const sourceText = await browser.evaluate("document.querySelector('#pixel-inspection').textContent");
    assert.match(sourceText,/time 0\.25 s/);
    assert.match(sourceText,/Rest position/);
    assert.match(sourceText,/Geometric normal/);
    assert.match(sourceText,/Splat contributors.*Frontmost.*visible coverage/);

    const motionFile = path.join(directory,'motion.html');
    const sceneArt = { format:'ink-studio/pixel-art',version:2,width:8,height:6,pixelAspect:[1,1],
      palette:versioned.palette,layers:[{ id:'paint' }],frames:['quiet','flash','hold'].map(id=>({
        id,durationMs:125,cels:{ paint:{ marks:[{ at:[1,2],swatch:id === 'flash' ? 'gold' : 'cool' }] } }
      })) };
    fs.writeFileSync(input,JSON.stringify(sceneArt));
    execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','motion',input,'--review',motionFile],{ cwd:root });
    await browser.send('Page.navigate',{ url:'about:blank' });
    await load(browser,motionFile);
    await until(browser,"document.querySelector('[data-motion-result]').dataset.finding === 'flash/flicker-1-2'");
    await click(browser,'[data-motion-jump]');
    await until(browser,"document.querySelector('#samples').selectedIndex === 1");
    assert.deepEqual(await raster(browser,preview,1,2),[249,189,102,255]);
    await evaluate(browser,()=>{
      const picker = document.querySelector('[data-motion-sample]');
      picker.selectedIndex = 2;
      picker.dispatchEvent(new Event('change'));
    });
    await until(browser,"document.querySelector('#samples').selectedIndex === 2");
    assert.deepEqual(await raster(browser,preview,1,2),[33,98,134,255]);

    const blockerScene = path.join(directory,'blocking-scene.json');
    fs.writeFileSync(blockerScene,JSON.stringify({ id:'blocking-scene',style:'slate',
      camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
      finish:{ look:{ sdfAssist:true } },
      solids:[
        { id:'rear',kind:'box',at:[0,0,0],half:[.8,.8,.12],res:.12,mat:'stone' },
        { id:'cover',kind:'box',at:[0,0,.7],half:[.35,1.1,.12],res:.12,mat:'stone' }
      ] }));
    fs.writeFileSync(input,JSON.stringify({ ...sceneArt,sceneBindings:[{
      id:'rear-study',scene:blockerScene,object:'rear',frame:'quiet',
      canvas:{size:[16,12],offset:[4,3],scale:[1,1]}
    }] }));
    execFileSync(process.execPath,[...args,'--scene',blockerScene,'--binding','rear-study'],{ cwd:root });
    await browser.send('Page.navigate',{ url:'about:blank' });
    await load(browser,file);
    await evaluate(browser,()=>{
      const picker = document.querySelector('#scene-hit-mode');
      picker.value = 'blocker';
      picker.dispatchEvent(new Event('change'));
      document.querySelector('#pixel-inspection details').open = true;
    });
    await until(browser,"!document.querySelector('.ink-grid-source-hits').hidden");
    assert.ok((await raster(browser,'.ink-grid-source-hits',4,3))[3] > 0);
    assert.equal((await raster(browser,preview,4,3))[3],0);
    await moveTo(4,3);
    await until(browser,"document.querySelector('#pixel-inspection').textContent.includes('Occluded · rear-study · cover')");
    await evaluate(browser,()=>{
      const picker = document.querySelector('#frames');
      picker.selectedIndex = 1;
      picker.dispatchEvent(new Event('change'));
    });
    await until(browser,"document.querySelector('.ink-grid-source-hits').hidden");

    const plan = path.join(directory,'views.json');
    fs.writeFileSync(plan,JSON.stringify({ version:1,samples:[
      { id:'head-on',time:0,camera:{ yaw:0 } },{ id:'orbit',time:.5,camera:{ yaw:.35 } }
    ] }));
    execFileSync(process.execPath,['cli/ink-studio.js','pixel-art','motion',scenePath,'--views',plan,
      '--w','16','--h','12','--review',motionFile],{ cwd:root });
    await browser.send('Page.navigate',{ url:'about:blank' });
    await load(browser,motionFile);
    await evaluate(browser,()=>document.querySelector('#pixel-inspection details').open = true);
    await moveTo(8,6);
    await until(browser,"document.querySelector('#pixel-inspection').textContent.includes('head-on')");
    await click(browser,'#pixel-inspection button');
    await evaluate(browser,()=>{
      const picker = document.querySelector('#samples');
      picker.selectedIndex = 1;
      picker.dispatchEvent(new Event('change'));
    });
    await until(browser,"document.querySelector('#pixel-inspection').textContent.includes('time 0.5 s')");
    assert.match(await browser.evaluate("document.querySelector('#pixel-inspection').textContent"),/yaw 0\.35/);
  });
});

test('offline cel timeline navigates linked exposures and shows timing and offsets',{ skip },async t=>{
  const directory = workspace(t), source = path.join(directory,'day.json'), file = path.join(directory,'day.html');
  fs.writeFileSync(source,JSON.stringify({
    format:'ink-studio/pixel-art',version:2,width:3,height:2,pixelAspect:[1,1],
    palette:{ red:'#bd2020',gold:'#e2b648' },layers:[{ id:'lines' },{ id:'ink',label:'Ink',offset:[1,0] }],
    tags:[{ id:'reverse',start:'rise',end:'rest',direction:'reverse',loop:false }],
    frames:[
      { id:'rise',durationMs:120,cels:{ ink:{ marks:[{ swatch:'red',at:[0,1] }] } } },
      { id:'rest',durationMs:240,cels:{ ink:{ hold:'rise/ink',offset:[0,-1] } } }
    ]
  }));
  execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'pixel-art','canvas',source,'--out',file]);
  await withChrome(directory,{ hardware:true },async browser=>{
    await load(browser,file);
    assert.match(await browser.evaluate("document.querySelector('#timeline thead tr').textContent"),/rest240 ms · 120 ms start/);
    assert.deepEqual(await raster(browser,preview,1,1),[189,32,32,255]);
    const hold = '#timeline tbody tr:last-child td:last-child button';
    await click(browser,hold);
    await until(browser,"document.querySelector('#timeline output').value.includes('holds rise/ink')");
    assert.equal(await browser.evaluate("document.querySelector('#sample-layer').value"),'ink');
    assert.equal(await browser.evaluate("document.querySelector('#frames').selectedIndex"),1);
    assert.equal(await browser.evaluate("document.querySelector('#timeline output').value.endsWith('offset 1, -1')"),true);
    assert.deepEqual(await raster(browser,preview,1,0),[189,32,32,255]);
    await click(browser,'#onion-skin summary');
    await click(browser,'[data-onion-enabled]');
    await until(browser,"!document.querySelector('.ink-grid-onion').hidden");
    assert.equal((await raster(browser,'.ink-grid-onion',1,1))[3],89);
    assert.deepEqual(await raster(browser,preview,1,1),[0,0,0,0]);
    assert.equal(await browser.evaluate("document.querySelectorAll('#timeline [data-linked]').length"),2);
    assert.match(await browser.evaluate("document.querySelector('#timeline-links').textContent"),/2 cels across 2 frames/);
    const unlink = await browser.evaluate("JSON.parse(decodeURIComponent(document.querySelector('#timeline-unlink').href.split(',')[1]))");
    assert.deepEqual(unlink.operation,{ type:'unlink',frame:'rest',layer:'ink' });
    const previewEdit = JSON.parse(execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),
      'pixel-art','timeline',source],{ encoding:'utf8' }));
    assert.equal(unlink.revision,previewEdit.revision);
    await click(browser,'#timeline-source');
    await until(browser,"document.querySelector('#timeline-source').hidden && document.querySelector('#frames').selectedIndex === 0");
    assert.deepEqual(await raster(browser,preview,1,1),[189,32,32,255]);
    await evaluate(browser,()=>{
      const range = document.querySelector('[data-native-range]');
      range.value = 'reverse';
      range.dispatchEvent(new Event('change'));
    });
    await click(browser,'[data-native-play]');
    await until(browser,"document.querySelector('[data-native-frame]').value === 'rest'");
    assert.deepEqual(await raster(browser,preview,1,0),[189,32,32,255]);
    assert.deepEqual(await raster(browser,main,1,1),[189,32,32,255]);
    assert.equal(await browser.evaluate("document.querySelector('#frames').selectedIndex"),0);
    await click(browser,'[data-native-follow]');
    assert.deepEqual(await raster(browser,preview,1,1),[189,32,32,255]);

    await click(browser,'#timeline-batch summary');
    await click(browser,'[data-batch-cel="rise/ink"]');
    await click(browser,'[data-batch-cel="rest/ink"]');
    const batch = await browser.evaluate("JSON.parse(decodeURIComponent(document.querySelector('#batch-download').href.split(',')[1]))");
    assert.equal(batch.destination,'timeline');
    assert.deepEqual(batch.operation,{ type:'edit-cels',scope:{ cels:['rise/ink','rest/ink'] },
      edit:{ type:'palette-swap',map:{ red:'gold' } } });
    const editFile = path.join(directory,'batch.json'), revised = path.join(directory,'revised.json');
    fs.writeFileSync(editFile,JSON.stringify(batch));
    const runBatch = (...args)=>JSON.parse(execFileSync(process.execPath,[path.join(root,'cli/ink-studio.js'),
      'pixel-art',...args],{ encoding:'utf8' }));
    const report = runBatch('preview',source,editFile);
    assert.equal(report.valid,true);
    assert.deepEqual(report.targets[0].frames.map(row=>[row.frame,row.pixelCount]),[['rise',1],['rest',1]]);
    const receipt = runBatch('edit',source,editFile,'--out',revised);
    assert.deepEqual(receipt.affectedTargets,report.targets);
    assert.equal(runBatch('sample',revised,'--frame','rest','--at','1,0').swatch,'gold');
  });
});

test('workshop onion skin follows the native grid, live strokes, layer view and playback',{ skip },async t=>{
  const directory = workspace(t), [{ file:bundle }] = build('development',directory);
  const base = path.join(root,'examples'), file = path.join(directory,'workshop.html');
  const source = path.join(directory,'onion-frames.json');
  const url = relative=>pathToFileURL(path.resolve(base,relative)).href;
  const slots = (...pixels)=>Array.from({ length:15 },(_,i)=>pixels.includes(i) ? 0 : null);
  fs.writeFileSync(source,JSON.stringify({
    format:'ink-studio/pixel-layer-deck',version:1,width:5,height:3,palette:['#0000ff'],
    layers:[{ id:'paper' },{ id:'ink' }],frames:[
      { id:'distant',duration:.5,cels:{ ink:{ slots:slots(1,4) } } },
      { id:'previous',duration:.5,cels:{ ink:{ slots:slots(0,1) } } },
      { id:'current',duration:.5,cels:{ ink:{ slots:slots(1,2) } } },
      { id:'next',duration:.5,cels:{ paper:{ slots:slots(9) },ink:{ slots:slots(1,3) } } }
    ]
  }));
  fs.writeFileSync(file,fs.readFileSync(path.join(base,'pixel-stamp-editor.html'),'utf8')
    .replace('../dist/ink-studio.browser.js',pathToFileURL(bundle).href)
    .replace('../src/pixel-grid-canvas.css',url('../src/pixel-grid-canvas.css'))
    .replace('src="pixel-stamp-studies.js"','src="'+url('pixel-stamp-studies.js')+'"')
    .replace('src="pixel-stamp-editor.mjs"','src="'+url('pixel-stamp-editor.mjs')+'"'));
  const overlay = '.ink-grid-onion';
  await withChrome(directory,{ hardware:true },async browser=>{
    await load(browser,file);
    const doc = await browser.send('DOM.getDocument');
    const input = await browser.send('DOM.querySelector',{ nodeId:doc.root.nodeId,selector:'#import' });
    await browser.send('DOM.setFileInputFiles',{ nodeId:input.nodeId,files:[source] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened onion-frames.json'");
    const change = (selector,value,event = 'input')=>evaluate(browser,(selector,value,event)=>{
      const input = document.querySelector(selector);
      input.value = value;
      input.dispatchEvent(new Event(event,{ bubbles:true }));
    },selector,value,event);
    const waitAlpha = (x,y,alpha)=>until(browser,
      `document.querySelector(${JSON.stringify(overlay)}).getContext('2d').getImageData(${x},${y},1,1).data[3] === ${alpha}`);
    await change('#scrub',3);
    await click(browser,'#onion-skin summary');
    await change('[data-onion-side="previous"] [data-onion-tint]','#ff0000');
    await change('[data-onion-side="previous"] [data-onion-opacity]',60);
    await change('[data-onion-side="next"] [data-onion-tint]','#00ff00');
    await change('[data-onion-side="next"] [data-onion-opacity]',40);
    await click(browser,'[data-onion-enabled]');
    await waitAlpha(0,0,153);
    assert.deepEqual(await raster(browser,overlay,0,0),[255,0,0,153]);
    assert.deepEqual(await raster(browser,overlay,3,0),[0,255,0,102]);
    assert.deepEqual(await raster(browser,overlay,4,0),[0,0,0,0]);
    assert.deepEqual(await raster(browser,overlay,4,1),[0,255,0,102]);
    assert.deepEqual(await raster(browser,preview,0,0),[0,0,0,0]);

    await change('[data-onion-side="previous"] [data-onion-count]',2);
    await waitAlpha(4,0,77);
    await change('#layer-view','active','change');
    await waitAlpha(4,1,0);
    await click(browser,'[data-onion-changes]');
    await waitAlpha(1,0,0);
    assert.equal((await raster(browser,overlay,2,0))[3],153);
    assert.deepEqual(await raster(browser,preview,2,0),[0,0,255,255]);

    await change('[data-onion-side="next"] [data-onion-count]',0);
    await waitAlpha(3,0,0);
    await change('[data-onion-side="previous"] [data-onion-count]',1);
    await waitAlpha(4,0,0);
    const target = place(await screen(browser,main),0,0);
    await browser.send('Input.dispatchMouseEvent',{ type:'mousePressed',...target,button:'left',buttons:1,clickCount:1 });
    await waitAlpha(0,0,0);
    assert.deepEqual(await raster(browser,preview,0,0),[0,0,255,255]);
    await browser.send('Input.dispatchMouseEvent',{ type:'mouseReleased',...target,button:'left',clickCount:1 });
    await click(browser,'#undo');
    await waitAlpha(0,0,153);

    await click(browser,'#play');
    assert.equal(await browser.evaluate("document.querySelector('.ink-grid-onion').hidden"),true);
    await click(browser,'#play');
    await until(browser,"!document.querySelector('.ink-grid-onion').hidden");
    await change('#scrub',1);
    await until(browser,"document.querySelector('.ink-grid-onion').hidden");
  });
});

test('workshop authors named playback and plays native cels beside a live editing frame',{ skip },async t=>{
  const directory = workspace(t), [{ file:bundle }] = build('development',directory);
  const base = path.join(root,'examples'), file = path.join(directory,'workshop.html');
  const source = path.join(directory,'tagged-frames.json');
  const url = relative=>pathToFileURL(path.resolve(base,relative)).href;
  const frames = [
    { id:'outside',duration:.02,slots:[0,null,null,null] },
    { id:'ready',duration:.1,slots:[1,null,null,null] },
    { id:'reach',duration:.2,slots:[2,null,null,null] },
    { id:'return',duration:.3,slots:[3,null,null,null] }
  ];
  fs.writeFileSync(source,JSON.stringify({ width:4,height:1,palette:['#ffffff','#ff0000','#00ff00','#0000ff'],frames,
    tags:[{ id:'rewind',label:'Rewind',start:'ready',end:'return',direction:'reverse',loop:false }] }));
  fs.writeFileSync(file,fs.readFileSync(path.join(base,'pixel-stamp-editor.html'),'utf8')
    .replace('../dist/ink-studio.browser.js',pathToFileURL(bundle).href)
    .replace('../src/pixel-grid-canvas.css',url('../src/pixel-grid-canvas.css'))
    .replace('src="pixel-stamp-studies.js"','src="'+url('pixel-stamp-studies.js')+'"')
    .replace('src="pixel-stamp-editor.mjs"','src="'+url('pixel-stamp-editor.mjs')+'"'));
  const frameOutput = '[data-native-frame]';
  await withChrome(directory,{ hardware:true },async browser=>{
    await load(browser,file);
    const doc = await browser.send('DOM.getDocument');
    const input = await browser.send('DOM.querySelector',{ nodeId:doc.root.nodeId,selector:'#import' });
    await browser.send('DOM.setFileInputFiles',{ nodeId:input.nodeId,files:[source] });
    await until(browser,"document.querySelector('#status').textContent === 'Opened tagged-frames.json'");
    await browser.evaluate(`
      let time = 1000, pending;
      performance.now = () => time;
      window.requestAnimationFrame = callback => { pending = callback; return 1; };
      window.cancelAnimationFrame = () => { pending = undefined; };
      window.advancePlayback = delta => { time += delta; const callback = pending; pending = undefined; callback?.(time); };
    `);
    const change = (selector,value,event = 'change')=>evaluate(browser,(selector,value,event)=>{
      const control = document.querySelector(selector);
      control.value = value;
      control.dispatchEvent(new Event(event,{ bubbles:true }));
    },selector,value,event);
    const statusIs = value=>until(browser,`document.querySelector('${frameOutput}').value === ${JSON.stringify(value)}`);
    const advance = delta=>evaluate(browser,delta=>window.advancePlayback(delta),delta);
    const play = '[data-native-play]', range = '[data-native-range]';
    await change(range,'rewind');
    await click(browser,play);
    await statusIs('return');
    const box = await screen(browser,preview);
    assert.deepEqual([box.w,box.h],[4,1]);
    assert.deepEqual(await raster(browser,preview,0,0),[0,0,255,255]);
    assert.deepEqual(await raster(browser,main,0,0),[255,255,255,255]);
    await advance(310);
    await statusIs('reach');
    assert.deepEqual(await raster(browser,preview,0,0),[0,255,0,255]);
    assert.equal(await browser.evaluate("document.querySelector('#scrub').value"),'1');

    const point = place(await screen(browser,main),2,0);
    await browser.send('Input.dispatchMouseEvent',{ type:'mousePressed',...point,button:'left',buttons:1,clickCount:1 });
    await browser.send('Input.dispatchMouseEvent',{ type:'mouseReleased',...point,button:'left',clickCount:1 });
    assert.deepEqual(await raster(browser,main,2,0),[255,255,255,255]);
    assert.deepEqual(await raster(browser,preview,2,0),[0,0,0,0]);
    await advance(320);
    await statusIs('ready');
    assert.equal(await browser.evaluate("document.querySelector('[data-native-play]').textContent"),'Play at 1×');
    await click(browser,'[data-native-follow]');
    assert.deepEqual(await raster(browser,preview,2,0),[255,255,255,255]);

    await evaluate(browser,()=>{ document.querySelector('#tag-form').closest('details').open = true; });
    await change('#tag-id','swing');
    await change('#tag-label','Swing');
    await change('#tag-start',1);
    await change('#tag-end',3);
    await change('#tag-direction','ping-pong');
    await click(browser,'#tag-save');
    await until(browser,"document.querySelector('#status').textContent === 'Saved playback tag swing'");
    await change(range,'swing');
    await click(browser,play);
    await statusIs('ready');
    await advance(110);
    await statusIs('reach');
    await advance(200);
    await statusIs('return');
    await advance(300);
    await statusIs('reach');
    await advance(200);
    await statusIs('ready');
    await change('#scrub',2,'input');
    assert.equal(await browser.evaluate("document.querySelector('#remove').disabled"),true);
    await click(browser,'#tag-remove');
    await until(browser,"!document.querySelector('[data-native-range] option[value=swing]')");
    await click(browser,'#undo');
    await until(browser,"!!document.querySelector('[data-native-range] option[value=swing]')");
  });
});
