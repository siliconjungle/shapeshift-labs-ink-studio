'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const width=17, height=9;
const a = {x:2,y:1,width:4,height:3}, b = {x:10,y:5,width:4,height:3};
const operation = {type:'swap',a,b};
const slots = new Uint8Array(width*height);
for (const [i,{x,y}] of [a,b].entries()) {
  for (let j=0;j<a.height;j++) for (let k=0;k<a.width;k++)
    slots[(y+j)*width+x+k] = (i*2+j+k)%4;
}
const tileset = {version:1,width,height,encoding:'indexed8',palette:[0x9e6273,0x9e6273,0x396f82,0xce9261],
  alpha:[255,140,0,255],data:Buffer.from(slots).toString('base64'),tileSize:{width:4,height:3}};
const makeUv = ({x,y,width:w,height:h})=>[[x,y+h-1],[x+w-1,y+h-1],[x+w-1,y],[x,y]].map(([u,v])=>[u/(width-1),v/(height-1)]);

function scene() {
  const vertices = [], faces = [];
  for (const [index,region] of [a,b,{x:7,y:1,width:3,height:3}].entries()) {
    const id = 'panel-'+index;
    const positions = [[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>[x+index*1.1,y,0]);
    const uv = makeUv(region);
    if (index === 1) uv.reverse();
    faces.push({id,material:index === 1 ? 'alternate-paint' : 'paint',corners:positions.map((position,i)=>{
      const vertex=id+'-v'+i;
      vertices.push({id:vertex,position});
      return {id:id+'-c'+i,vertex,uv:[i/8,.5],attributes:{'uv/1':uv[i],weight:.75}};
    })});
  }
  return {id:'atlas-swap',style:'slate',solids:[],tilesets:{atlas:tileset},
    topologyMeshes:{wall:{document:{id:'wall',vertices,faces,uvBindings:{pigment:1}},
      materials:[{id:'paint',texture:{tileset:'atlas'}},{id:'alternate-paint'}],
      bakes:[{id:'baked',material:'alternate-paint',maps:{texture:{tileset:'atlas'}}}]}}};
}

test('swap preserves indexed bytes, stable mesh records, alternate UVs, attachments and one-step undo',()=>{
  const source = scene(), row = source.topologyMeshes.wall;
  const revision = ink.load().KIT.meshTopology.revision(row.document);
  row.attachments = {format:'ink-studio/mesh-attachments',version:1,mesh:'wall',revision,attachments:[]};
  row.shapeKeys = {format:'ink-studio/mesh-shape-keys',version:1,mesh:'wall',restRevision:revision,keys:[]};
  const editor = ink.createSceneEditor(source), before = editor.snapshot();
  const preview = editor.planTilesetCanvas('atlas',operation);
  assert.equal(preview.canCommit,true);
  assert.equal(preview.texelsExchanged,24);
  assert.deepEqual(preview.references.map(ref=>[ref.face,ref.from,ref.to,ref.uvSet]),[
    ['panel-0','a','b',1],['panel-1','b','a',1]]);
  assert.deepEqual(editor.snapshot(),before);
  assert.deepEqual(editor.transformTilesetCanvas('atlas',operation),preview);

  const after = editor.snapshot(), swapped = after.tilesets.atlas;
  const expected = slots.slice();
  for (let y=0;y<a.height;y++) for (let x=0;x<a.width;x++) {
    const i=(a.y+y)*width+a.x+x, j=(b.y+y)*width+b.x+x;
    expected[i]=slots[j];
    expected[j]=slots[i];
  }
  assert.deepEqual(swapped,{...tileset,data:Buffer.from(expected).toString('base64')});
  const baked = after.topologyMeshes.wall;
  assert.deepEqual(baked.bakes,row.bakes);
  assert.deepEqual(baked.document.vertices,row.document.vertices);
  assert.deepEqual(baked.document.faces[2],row.document.faces[2]);
  const corners = baked.document.faces[0].corners;
  assert.deepEqual(corners.map(corner=>corner.uv),row.document.faces[0].corners.map(corner=>corner.uv));
  assert.deepEqual(corners.map(corner=>corner.attributes['uv/1']),makeUv(b));
  assert(corners.every(corner=>corner.attributes.weight === .75));
  const revised = ink.load().KIT.meshTopology.revision(baked.document);
  assert.notEqual(revised,revision);
  assert.deepEqual(baked.attachments,{...row.attachments,revision:revised});
  assert.deepEqual(baked.shapeKeys,{...row.shapeKeys,restRevision:revised});
  editor.undo();
  assert.deepEqual(editor.snapshot(),before);
  editor.redo();
  assert.deepEqual(editor.snapshot(),after);
});

test('preview rejects overlapping picks, cross-region footprints and pins before mutation',()=>{
  const source = scene();
  const [first,,outer] = source.topologyMeshes.wall.document.faces;
  outer.corners[0].attributes['uv/1'] = [.25,.25];
  first.corners[0].uvPins = {1:true};
  const editor = ink.createSceneEditor(source);
  const report = editor.planTilesetCanvas('atlas',operation);
  assert.equal(report.canCommit,false);
  assert.deepEqual(report.references.filter(ref=>ref.conflicts.length).map(ref=>[ref.face,...ref.conflicts]),[
    ['panel-0',{reason:'pinned-uv',corner:'panel-0-c0'}],
    ['panel-2',{reason:'crossing-region'}]]);
  assert.throws(()=>editor.transformTilesetCanvas('atlas',operation),error=>{
    assert.deepEqual(error.report,report);
    return true;
  });
  assert.deepEqual(editor.snapshot(),source);
  assert.throws(()=>editor.planTilesetCanvas('atlas',{...operation,b:{...a,x:3}}),/no overlap/);
  assert.throws(()=>editor.planTilesetCanvas('atlas',{...operation,b:{...b,height:4}}),/equal dimensions/);
  assert.throws(()=>editor.planTilesetCanvas('atlas',{...operation,b:{...b,x:16}}),/inside the tileset/);
});

test('preview identifies texture dependencies a UV translation would disturb',()=>{
  const source = scene(), row = source.topologyMeshes.wall;
  row.materials[0].mipmaps = true;
  row.materials[1].texture = {width:1,height:1,pixels:[40,60,80,255]};
  const report = ink.createSceneEditor(source).planTilesetCanvas('atlas',operation);
  assert.equal(report.canCommit,false);
  assert.equal(report.references.find(ref=>ref.face === 'panel-0').conflicts[0].reason,'atlas-wide-filter');
  assert.equal(report.references.find(ref=>ref.face === 'panel-1').conflicts[0].reason,'shared-uv-textures');
  assert.equal(report.references.find(ref=>ref.face === 'panel-2').conflicts[0].reason,'atlas-wide-filter');
});

test('an active modifier stack blocks an affected mesh and leaves unrelated UVs eligible',()=>{
  const source = scene(), row = source.topologyMeshes.wall;
  row.modifiers = [{id:'copies',kind:'array',count:2,step:[0,2,0]}];
  const editor = ink.createSceneEditor(source);
  const blocked = editor.planTilesetCanvas('atlas',operation);
  assert.equal(blocked.canCommit,false);
  assert.deepEqual(blocked.blockers,[{reason:'active-mesh-modifiers',object:'wall',face:'panel-0',modifiers:['copies']}]);
  const noHits = editor.planTilesetCanvas('atlas',{type:'swap',
    a:{x:0,y:0,width:1,height:1},b:{x:16,y:0,width:1,height:1}});
  assert.equal(noHits.canCommit,true);
  assert.deepEqual(noHits.references,[]);
});

test('CLI swap previews and writes a new scene whose native-resolution render matches',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-atlas-swap-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  const source = scene(), original = JSON.stringify(source);
  fs.writeFileSync(file('wall.json'),original);
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const invoke = (...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const swap = (...args)=>invoke('tileset','swap','--scene','wall.json','--id','atlas','--a','2,1,4,3','--b','10,5,4,3',...args);
  const preview = swap();
  assert.equal(preview.status,0,preview.stderr);
  assert.equal(fs.readdirSync(dir).length,1);
  const result = swap('--out','swapped.json');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),JSON.parse(preview.stdout));
  const revised = JSON.parse(fs.readFileSync(file('swapped.json'),'utf8'));
  assert.notEqual(revised.tilesets.atlas.data,source.tilesets.atlas.data);
  const render = name=>{
    const frame = invoke('render',name+'.json','--w','118','--h','64','--px','1','--out',name+'.png',
      '--ortho','--yaw','.23','--pitch','.09','--target','1.6,.5,0','--zoom','2.5','--raw');
    assert.equal(frame.status,0,frame.stderr);
    return fs.readFileSync(file(name+'.png'));
  };
  const before = render('wall'), after = render('swapped');
  const {data} = PNG.raster(before);
  let visible = 0;
  for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) visible++;
  assert(visible>100);
  assert.deepEqual(before,after);
  assert.equal(fs.readFileSync(file('wall.json'),'utf8'),original);
  source.topologyMeshes.wall.document.faces[0].corners[0].uvPins={1:true};
  fs.writeFileSync(file('wall.json'),JSON.stringify(source));
  const blocked = swap('--out','blocked.json');
  assert.equal(blocked.status,1,blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).canCommit,false);
  assert.equal(fs.existsSync(file('blocked.json')),false);
});

test('swapping a linked sheet protects the new layout from on-load refresh',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-linked-atlas-swap-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source = scene(), raster = ink.load().KIT.authoring.tilesets.prepare(source.tilesets).resolve({tileset:'atlas'});
  const image = PNG.encode(width,height,raster.pixels,4);
  source.tilesets.atlas = {...ink.readTilesetImage(image),tileSize:tileset.tileSize};
  fs.writeFileSync(path.join(dir,'atlas.png'),image);
  fs.writeFileSync(path.join(dir,'original.json'),JSON.stringify(source));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const edit = (...args)=>{
    const result = spawnSync(process.execPath,[cli,'tileset',...args,'--id','atlas'],{cwd:dir,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const linked = edit('link','atlas.png','--scene','original.json','--refresh','on-load','--out','linked.json');
  const swapped = edit('swap','--scene','linked.json','--a','2,1,4,3','--b','10,5,4,3','--out','swapped.json');
  assert.deepEqual(swapped.source,{file:'atlas.png',refresh:'on-load',sha256:linked.incoming.sha256});
  const reload = edit('reload','--scene','swapped.json');
  assert.equal(reload.localPaint,true);
  assert.equal(reload.sourceChanged,false);
  assert.equal(reload.blockers[0].reason,'local-paint');
  const render = spawnSync(process.execPath,[cli,'render','swapped.json','--w','72','--h','40','--px','1',
    '--target','1.6,.5,0','--zoom','2','--yaw','0','--pitch','0','--ortho','--raw','--out','held.png'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(render.status,0,render.stderr);
  assert.match(render.stderr,/used embedded image \(local-paint\)/);
});
