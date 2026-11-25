'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const {setTimeout:pause} = require('node:timers/promises');
const {pathToFileURL} = require('node:url');
const {withChrome} = require('../cli/canvas-grid-chrome.js');
const ink = require('..');
const PNG = require('../cli/png.js');

const rectangle = {x:2,y:1,width:3,height:2};
const selection = {format:'ink-studio/tileset-selection',version:1,tileset:'masonry',...rectangle};
const scene = {id:'test',style:'slate',solids:[],tilesets:{
  masonry:ink.readTilesetImage(PNG.encode(8,6,Uint8Array.from({length:192},(_,i)=>i%4===3 ? 255 : i),4)),
  wide:ink.createBlankTileset({width:600,height:1})
}};

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-pick-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const filename = path.join(dir,'scene.json');
  fs.writeFileSync(filename,JSON.stringify(scene));
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset','pick','--scene',filename,'--id','masonry',...args],{encoding:'utf8',stdio:'pipe'});
  return {dir,filename,cli};
}

test('SDK picks exact rectangular texels, handles the last pixel, and rejects invalid bounds',()=>{
  assert.deepEqual(ink.pickTilesetRectangle(scene,'masonry',rectangle),selection);
  assert.equal(ink.pickTilesetRectangle(scene,'wide',{x:599,y:0,width:1,height:1}).x,599);
  for (const bounds of [{x:-1},{x:1.5},{width:0},{width:7},{y:5},{height:Infinity}])
    assert.throws(()=>ink.pickTilesetRectangle(scene,'masonry',{...rectangle,...bounds}),/whole texels inside/);
  assert.throws(()=>ink.pickTilesetRectangle(scene,'missing',rectangle),/Unknown tileset missing/);
});

test('CLI emits the same selection and rejects partial input',t=>{
  const {dir,filename,cli} = setup(t), output = path.join(dir,'pick.json');
  const coords = ['--x','2','--y','1','--width','3','--height','2'];
  assert.deepEqual(JSON.parse(cli(...coords)),selection);
  cli(...coords,'--out',output);
  assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),selection);
  assert.throws(()=>cli('--x','2','--width','3'),/all four rectangle values/);
  assert.throws(()=>cli(...coords,'--out',filename),/separately from the source scene/);
});

test('offline grid picking and numeric editing download identical JSON',
  {skip:!process.env.INK_TEST_CHROME},async t=>{
    const {dir,cli} = setup(t), page = path.join(dir,'picker.html');
    cli('--out',page);
    await withChrome(dir,{},async browser=>{
      await browser.send('Emulation.setDeviceMetricsOverride',{width:900,height:760,deviceScaleFactor:1,mobile:false});
      await browser.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
      await browser.send('Page.navigate',{url:pathToFileURL(page).href});
      for (let i=0;i<100 && !await browser.evaluate("document.querySelector('.ink-grid-main')?.width === 8");i++)
        await pause(30);
      const box = await browser.evaluate("document.querySelector('.ink-grid-main').getBoundingClientRect().toJSON()");
      const at = (x,y)=>({x:box.left+(x+.5)*box.width/8,y:box.top+(y+.5)*box.height/6});
      const mouse = (type, point, buttons)=>browser.send('Input.dispatchMouseEvent',
        {type,...point,button:'left',buttons,clickCount:1});
      await mouse('mousePressed',at(4,2),1);
      await mouse('mouseMoved',at(2,1),1);
      await mouse('mouseReleased',at(2,1),0);
      const values = "Array.from(document.querySelectorAll('form input'),input=>input.valueAsNumber)";
      assert.deepEqual(await browser.evaluate(values),[2,1,3,2]);
      await browser.evaluate(`document.querySelector('#save').click(); true`);
      const downloaded = path.join(dir,'masonry-selection.json');
      for (let i=0;i<100 && !fs.existsSync(downloaded);i++) await pause(30);
      assert.deepEqual(JSON.parse(fs.readFileSync(downloaded,'utf8')),selection);
      const edit = (name,value)=>browser.evaluate(`(() => {
        const node = document.querySelector('input[name="${name}"]');
        node.value = ${JSON.stringify(value)};
        node.dispatchEvent(new Event('input'));
        return document.querySelector('#save').disabled;
      })()`);
      assert.equal(await edit('width',8),true);
      assert.equal(await edit('width',3),false);
      assert.deepEqual(await browser.evaluate(values),[2,1,3,2]);
      assert.deepEqual(await browser.evaluate(`Array.from(['x','y','width','height'],key=>
        Number(document.querySelector('.ink-grid-selection').style.getPropertyValue('--ink-selection-'+key)))`),[2,1,3,2]);
    });
  });

const tile = {width:2,height:2};
const brushBounds = {x:2,y:2,width:4,height:4};
const brush = {format:'ink-studio/tileset-brush',version:1,tileset:'masonry',...brushBounds,
  tileWidth:2,tileHeight:2,columns:2,rows:2};

test('an ordered tile brush preserves the atlas block and excludes partial tiles',t=>{
  const {cli} = setup(t);
  const size = ['--tile-width','2','--tile-height','2'];
  const coords = ['--x','2','--y','2','--width','4','--height','4'];
  assert.deepEqual(ink.pickTilesetBlock(scene,'masonry',brushBounds,tile),brush);
  assert.deepEqual(JSON.parse(cli(...coords,...size)),brush);
  assert.throws(()=>cli(...coords,'--tile-width','3'),/both --tile-width and --tile-height/);
  assert.throws(()=>ink.pickTilesetBlock(scene,'masonry',{...brushBounds,x:1},tile),/whole tile boundaries/);
  assert.throws(()=>ink.pickTilesetBlock(scene,'masonry',{...brushBounds,x:0,width:8},{width:3,height:2}),/inside the tileset/);
  assert.throws(()=>ink.pickTilesetBlock(scene,'masonry',brushBounds,{width:9,height:2}),/fit the tileset/);
});

test('the CLI reopens a brush and previews the original texels in brush order',t=>{
  const {dir,filename} = setup(t);
  const file = path.join(dir,'brush.json'), out = path.join(dir,'preview.png');
  fs.writeFileSync(file,JSON.stringify(brush));
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset','brush-preview',file,'--scene',filename,'--out',out]);
  const {w,h,data} = PNG.raster(out);
  assert.deepEqual([w,h],[4,4]);
  const source = Buffer.from(scene.tilesets.masonry.data,'base64'), expected = [];
  for (let row=2;row<6;row++) expected.push(...source.subarray((row*8+2)*4,(row*8+6)*4));
  assert.deepEqual([...data],expected);
  assert.deepEqual([...ink.rasterizeTilesetBrush(scene,brush).pixels],expected);
  assert.throws(()=>ink.rasterizeTilesetBrush(scene,{...brush,columns:1}),/counts do not match/);
});
