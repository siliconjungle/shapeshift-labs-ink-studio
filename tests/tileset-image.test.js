'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const {deflateSync} = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');
const PNGBytes = require('../src/png-bytes.js');

const K = ink.load().KIT;
const scene = {id:'tileset-fixture',style:'slate',solids:[]};
const rgba = Uint8Array.from([207,81,39,255,14,54,223,255,71,168,92,255,229,91,23,0]);

function quad(object, x, texture) {
  const positions = [[x,0,0],[x+1,0,0],[x+1,1,0],[x,1,0]];
  const uvs = [[0,1],[1,1],[1,0],[0,0]];
  const vertices = positions.map((position,index) => ({id:'vertex-'+index,position}));
  const corners = vertices.map(({id:vertex},index) => ({id:'corner-'+index,vertex,uv:uvs[index]}));
  return {document:{id:object,vertices,faces:[{id:'front',material:'paint',corners}]},
    materials:[{id:'paint',texture}]};
}

test('PNG import preserves indexed slots and palette transparency, including duplicate swatches',() => {
  const colors = Uint8Array.from([21,34,57,21,34,57,91,57,34]);
  const alpha = Uint8Array.from([255,144,0]);
  const rows = PNGBytes.scanlines(2,2,Uint8Array.from([0,1,1,2]),1);
  const encoded = Buffer.concat(PNGBytes.indexed(2,2,colors,alpha,deflateSync(rows)));
  assert.deepEqual(ink.readTilesetImage(encoded),
    {version:1,width:2,height:2,encoding:'indexed8',data:'AAEBAg==',palette:[0x152239,0x152239,0x5b3922],alpha:[255,144,0]});
  const oversize = PNG.encode(2049,1,new Uint8Array(2049*4),4);
  assert.throws(() => ink.readTilesetImage(oversize),/2048 texels/);
});

test('a blank tileset fills the declared rectangle with exact background bytes',() => {
  const width = 3, height = 2;
  for (const [background,rgba] of [
    [undefined,[0,0,0,0]],
    ['transparent',[0,0,0,0]],
    ['#317285',[49,114,133,255]],
    ['#31728580',[49,114,133,128]],
    ['#31728500',[49,114,133,0]]
  ]) {
    const image = ink.createBlankTileset({width,height,background});
    assert.deepEqual([image.version,image.width,image.height,image.encoding],[1,width,height,'rgba8']);
    const decoded = Buffer.from(image.data,'base64');
    assert.equal(decoded.length,width*height*4);
    for (let i=0;i<decoded.length;i+=4) assert.deepEqual([...decoded.subarray(i,i+4)],rgba);
  }
  for (const width of [0,2.5,2049])
    assert.throws(() => ink.createBlankTileset({width,height}),/2048 texels/);
  assert.throws(() => ink.createBlankTileset({width,height,background:'red'}),/#rrggbb or #rrggbbaa/);
});

test('scene editor registration is transactional and renders one source on separate meshes',() => {
  const editor = ink.createSceneEditor(scene);
  const image = ink.readTilesetImage(PNG.encode(2,2,rgba,4));
  editor.registerTileset('shared',image);
  editor.registerTileset('shared',image);
  assert.throws(() => editor.registerTileset('shared',ink.readTilesetImage(PNG.encode(1,1,rgba.subarray(0,4),4))),
    /already registered/);
  editor.undo();
  assert.equal(editor.snapshot().tilesets,undefined);
  editor.redo();
  assert.deepEqual(editor.snapshot().tilesets.shared,image);

  const texture = {tileset:'shared'};
  const topologyMeshes = {one:quad('one',0,texture),two:quad('two',2,texture)};
  const source = {...editor.snapshot(),topologyMeshes};
  const world = ink.createSceneEditor(JSON.parse(JSON.stringify(source))).build();
  for (const [mesh,x] of world.meshes.map((mesh,i) => [mesh,i*2])) {
    const ray = K.sceneMeshes.rayQuery(mesh,K);
    const hit = (u,v) => ray({origin:[x+u,v,1],direction:[0,0,-1],maxDistance:2});
    assert.equal(hit(.25,.75).pigment,0xcf5127);
    assert.equal(hit(.75,.75).pigment,0x0e36df);
    assert.equal(hit(.25,.25).pigment,0x47a85c);
    assert.equal(hit(.75,.25),null);
  }

  assert.throws(() => ink.createSceneEditor({...scene,topologyMeshes}),/Unknown tileset shared/);
  assert.throws(() => ink.createSceneEditor({...scene,tilesets:{invalid:{...image,data:'AAAA'}}}),/Invalid rgba8/);
});

test('the CLI scene embeds the registered image and renders like inline pigment after moving it',t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = name => path.join(dir,name);
  const cli = (...args) => execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),...args],
    {encoding:'utf8'});
  const bound = {...scene,topologyMeshes:{one:quad('one',0,{tileset:'shared'})}};
  const inline = {...scene,topologyMeshes:{one:quad('one',0,{width:2,height:2,pixels:Array.from(rgba)})}};
  fs.writeFileSync(file('draft.json'),JSON.stringify(bound));
  fs.writeFileSync(file('inline.json'),JSON.stringify(inline));
  fs.writeFileSync(file('paint.png'),PNG.encode(2,2,rgba,4));
  const result = JSON.parse(cli('tileset','import',file('paint.png'),'--scene',file('draft.json'),
    '--id','shared','--out',file('registered.json')));
  assert.deepEqual(result,{scene:file('registered.json'),id:'shared',width:2,height:2,encoding:'rgba8'});
  fs.unlinkSync(file('paint.png'));
  fs.mkdirSync(file('moved'));
  fs.renameSync(file('registered.json'),file('moved/registered.json'));

  const settings = ['--w','64','--h','48','--px','1','--raw','--target','0.5,0.5,0','--yaw','0','--pitch','0'];
  cli('render',file('moved/registered.json'),...settings,'--out',file('registered.png'));
  cli('render',file('inline.json'),...settings,'--out',file('inline.png'));
  assert.deepEqual(fs.readFileSync(file('registered.png')),fs.readFileSync(file('inline.png')));
});

test('the CLI creates and binds a blank tileset without an image file',t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-blank-tileset-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const original = path.join(directory,'scene.json'), output = path.join(directory,'painted.json');
  const texture = {tileset:'window'};
  fs.writeFileSync(original,JSON.stringify({...scene,topologyMeshes:{panel:quad('panel',0,texture)}}));
  const cli = (...args) => execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset','create','--scene',original,'--id','window','--out',output,...args],{encoding:'utf8',stdio:'pipe'});
  assert.throws(() => cli('--width','1.5','--height','3'),/--width/);
  assert.throws(() => cli('--width','2','--height','3','--background','red'),/#rrggbb/);
  assert(!fs.existsSync(output));

  const receipt = JSON.parse(cli('--width','2','--height','3','--background','#31728580'));
  assert.deepEqual(receipt,{scene:output,id:'window',width:2,height:3,encoding:'rgba8'});
  const editor = ink.createSceneEditor(fs.readFileSync(output,'utf8'));
  const [mesh] = editor.build().meshes;
  const hit = K.sceneMeshes.rayQuery(mesh,K)({origin:[.5,.5,1],direction:[0,0,-1],maxDistance:2});
  assert.equal(hit.pigment,0x317285);
});

const repackOptions = {tileSize:{width:2,height:2},margins:{left:1,top:2,right:2,bottom:1},gutters:{x:2,y:1}};
const contentRows = [[0,1,2,1],[1,0,0,2],[2,1,1,2],[0,2,2,0]];
const contentSlots = contentRows.flat();
const spacedSlots = new Uint8Array(9*8).fill(3);
for (const [row,values] of contentRows.entries()) {
  const y = [2,3,5,6][row];
  for (const [column,x] of [1,2,5,6].entries()) spacedSlots[y*9+x] = values[column];
}

test('repacking an imported PNG maps rectangle origins and retains all authored RGBA bytes',()=>{
  const source = Uint8Array.from({length:9*8*4},(_,i)=>i%249);
  const asset = ink.readTilesetImage(PNG.encode(9,8,source,4));
  const {tileset,report} = ink.repackTilesetImage(asset,repackOptions);
  assert.deepEqual(report.rectangleMap,{x:[{source:1,destination:0},{source:5,destination:2}],
    y:[{source:2,destination:0},{source:5,destination:2}]});
  assert.deepEqual([report.columns,report.rows,report.removedTexels],[2,2,56]);
  assert.deepEqual(report.source,{width:9,height:8,encoding:'rgba8'});
  assert.deepEqual(report.destination,{width:4,height:4,encoding:'rgba8'});
  const expected = [];
  for (const y of [2,3,5,6]) for (const x of [1,2,5,6]) expected.push(...source.slice((y*9+x)*4,(y*9+x)*4+4));
  assert.deepEqual([...Buffer.from(tileset.data,'base64')],expected);
  assert.equal(asset.width,9);
  const editor = ink.createSceneEditor(scene);
  editor.registerTileset('compact',tileset);
  const brush = ink.pickTilesetBlock(editor.snapshot(),'compact',{x:0,y:0,width:4,height:4});
  assert.deepEqual([...ink.rasterizeTilesetBrush(editor.snapshot(),brush).pixels],expected);

  for (const margins of [{left:1,top:2,right:1,bottom:1},{left:1,top:2,right:2,bottom:2}])
    assert.throws(()=>ink.repackTilesetImage(asset,{...repackOptions,margins}),/covered exactly/);
  assert.throws(()=>ink.repackTilesetImage(asset,{...repackOptions,gutters:{x:2}}),/explicit nonnegative/);
  const one = ink.repackTilesetImage(ink.createBlankTileset({width:4,height:4}),{
    tileSize:{width:2,height:2},margins:{left:1,top:0,right:1,bottom:2},gutters:{x:3,y:1}
  });
  assert.deepEqual([one.report.columns,one.report.rows,one.tileset.width,one.tileset.height],[1,1,2,2]);
});

test('the repack CLI preserves indexed slots, duplicate swatches and exact alpha entries',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-repack-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const input = path.join(dir,'spaced.png'), out = path.join(dir,'compact.png'), report = path.join(dir,'rectangles.json');
  const colors = Uint8Array.from([21,34,57,21,34,57,91,57,34,255,0,211]), alpha = Uint8Array.from([255,144,0]);
  const inputPNG = Buffer.concat(PNGBytes.indexed(9,8,colors,alpha,deflateSync(PNGBytes.scanlines(9,8,spacedSlots))));
  fs.writeFileSync(input,inputPNG);
  const flags = ['--tile-width','2','--tile-height','2','--margin-left','1','--margin-top','2',
    '--margin-right','2','--margin-bottom','1','--gutter-x','2','--gutter-y','1'];
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset','repack',input,...args],{cwd:dir,encoding:'utf8',stdio:'pipe'});
  assert.throws(()=>cli(...flags.slice(0,-2),'--out',out),/explicit integer/);
  assert.throws(()=>cli(...flags,'--out',input),/separate paths/);
  assert.throws(()=>cli(...flags,'--margin-right','1','--out',out,'--report',report),/covered exactly/);
  assert.equal(fs.existsSync(report),false);
  assert.equal(fs.existsSync(out),false);
  const result = JSON.parse(cli(...flags,'--out',out,'--report',report));
  assert.deepEqual(result,JSON.parse(fs.readFileSync(report,'utf8')));
  const {tileset,report:expected} = ink.repackTilesetImage(inputPNG,repackOptions);
  assert.deepEqual(result,expected);
  assert.deepEqual(fs.readFileSync(input),inputPNG);
  assert.deepEqual(tileset.palette,[0x152239,0x152239,0x5b3922,0xff00d3]);
  assert.deepEqual(tileset.alpha,[255,144,0]);
  assert.deepEqual([...Buffer.from(tileset.data,'base64')],contentSlots);
  assert.deepEqual({...ink.readTilesetImage(out),tileSize:{width:2,height:2}},tileset);
});

test('extracting an indexed crop keeps slot identity and registers an independent single-tile grid',()=>{
  const colors = Uint8Array.from([21,34,57,21,34,57,91,57,34]), alpha = Uint8Array.from([255,144,0]);
  const slots = Uint8Array.from([2,0,1,0,1,2]);
  const png = Buffer.concat(PNGBytes.indexed(3,2,colors,alpha,deflateSync(PNGBytes.scanlines(3,2,slots))));
  const source = {...ink.readTilesetImage(png),tileSize:{width:1,height:1,paddingX:1}};
  const editor = ink.createSceneEditor({...scene,tilesetDefaults:{tileSize:{width:3,height:2}},tilesets:{atlas:source}});
  const before = editor.snapshot(), crop = {x:1,y:0,width:2,height:2};
  const asset = editor.extractTileset('atlas','sample',crop);
  assert.deepEqual(asset,{version:1,width:2,height:2,encoding:'indexed8',data:'AAEBAg==',tileSize:{width:2,height:2},
    palette:[0x152239,0x152239,0x5b3922],alpha:[255,144,0]});
  assert.deepEqual(editor.snapshot().tilesets.atlas,source);
  assert.deepEqual(editor.tilesetGrid('sample'),{tileSize:{width:2,height:2},source:'override'});
  const brush = ink.pickTilesetBlock(editor.snapshot(),'sample',{x:0,y:0,width:2,height:2});
  assert.deepEqual([brush.columns,brush.rows],[1,1]);
  assert.deepEqual(editor.extractTileset('atlas','sample',crop),asset);
  assert.throws(()=>editor.extractTileset('atlas','atlas',crop),/different tileset ID/);
  assert.throws(()=>editor.extractTileset('atlas','sample',{...crop,x:0}),/different image/);
  assert.throws(()=>editor.extractTileset('atlas','missing',{...crop,x:2}),/inside the tileset/);
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot().tilesets.sample,asset);
});

test('the CLI extracts exact RGBA texels from coordinates or a saved pick and binds both sources',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-extract-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name+'.json');
  const pixels = Uint8Array.from({length:4*3*4},(_,i)=>i%4===3 ? 255 : i);
  const atlas = ink.readTilesetImage(PNG.encode(4,3,pixels,4));
  const source = {...scene,tilesets:{atlas},
    topologyMeshes:{original:quad('original',0,{tileset:'atlas'}),cut:quad('cut',2,{tileset:'patch'})}};
  fs.writeFileSync(file('source'),JSON.stringify(source));
  const cli = (...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),
    'tileset',...args],{encoding:'utf8',cwd:dir,stdio:'pipe'});
  const rect = ['--id','atlas','--x','2','--y','1','--width','2','--height','2'];
  const input = ['--scene',file('source')];
  cli('pick',...input,...rect,'--out',file('saved'));
  const command = ['extract',...input,'--new-id','patch'];
  const report = JSON.parse(cli(...command,'--selection',file('saved'),'--out',file('cut')));
  assert.deepEqual(report.source,{tileset:'atlas',x:2,y:1,width:2,height:2});
  cli(...command,...rect,'--out',file('numeric'));
  assert.deepEqual(fs.readFileSync(file('cut')),fs.readFileSync(file('numeric')));
  assert.throws(()=>cli(...command,...rect,'--selection',file('saved'),'--out',file('invalid')),/selection.*or --id/);
  assert.throws(()=>cli(...command,'--selection',file('saved'),'--out',file('saved')),/new scene JSON/);

  const revised = JSON.parse(fs.readFileSync(file('cut'),'utf8'));
  assert.deepEqual(revised.tilesets.atlas,atlas);
  assert.deepEqual(revised.topologyMeshes,source.topologyMeshes);
  assert.deepEqual(Buffer.from(revised.tilesets.patch.data,'base64'),Buffer.from([
    ...pixels.subarray(24,32),...pixels.subarray(40,48)
  ]));
  const world = ink.createSceneEditor(revised).build();
  const ray = K.sceneMeshes.rayQuery(world.meshes.find(mesh=>mesh.objectId==='cut'),K);
  assert.equal(ray({origin:[2.25,.75,1],direction:[0,0,-1],maxDistance:2}).pigment,0x18191a);
});
