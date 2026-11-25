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
