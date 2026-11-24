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
  });
});
