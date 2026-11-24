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
    sceneBindings:[{ id:'panel',scene:scenePath,object:'face',frame:'front' }],
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
    const at = place(await screen(browser,main),1,2);
    const sample = async (mode,expected) => {
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
