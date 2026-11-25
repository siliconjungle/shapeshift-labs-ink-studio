'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const width=17,height=9;
const a={x:2,y:1,width:4,height:3}, b={x:10,y:5,width:4,height:3};
const pixels = new Uint8Array(width*height*4);
for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
  const inA=x>=a.x && x<a.x+a.width && y>=a.y && y<a.y+a.height;
  const inB=x>=b.x && x<b.x+b.width && y>=b.y && y<b.y+b.height;
  pixels.set(inA ? [175,105,47,255] : inB ? [53,148,158,255] : [231,0,96,255],(y*width+x)*4);
}
const scene={id:'placed-atlas',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:4},
  tilesets:{atlas:ink.readTilesetImage(PNG.encode(width,height,pixels,4))}};
const selection=ink.pickTilesetRectangle(scene,'atlas',a);
const request={object:'gate',face:'brick',selection,origin:[1,2,3]};

test('places a new editable quad with stable corners, texel-center UVs and a retained source',()=>{
  const editor=ink.createSceneEditor(scene), preview=editor.planTilesetFace(request);
  assert.equal(preview.canCommit,true);
  assert.deepEqual(preview.size,[1,.75]);
  assert.deepEqual(preview.vertices.map(v=>v.position),[[1,2,3],[2,2,3],[2,2.75,3],[1,2.75,3]]);
  assert.deepEqual(preview.corners.map(c=>c.uv),[[2/16,3/8],[5/16,3/8],[5/16,1/8],[2/16,1/8]]);
  assert.deepEqual(editor.snapshot(),scene);
  assert.deepEqual(editor.placeTilesetFace(request),preview);
  const landed=editor.snapshot(), row=landed.topologyMeshes.gate;
  assert.deepEqual(row.document.faces,[{id:'brick',material:'tileset/atlas',corners:preview.corners}]);
  assert.deepEqual(row.materials,[{id:'tileset/atlas',texture:{tileset:'atlas'}}]);
  assert.deepEqual(row.bindings,[{id:'tileset/brick',domain:'faces',element:'brick',
    data:{format:'ink-studio/tileset-face-source',version:1,selection,atlasSize:[width,height]}}]);
  const duplicate=editor.planTilesetFace(request);
  assert.equal(duplicate.canCommit,false);
  assert(duplicate.conflicts.some(conflict=>conflict.reason === 'face-id-in-use'));
  assert.throws(()=>editor.placeTilesetFace(request),/needs review/);
  assert.deepEqual(editor.snapshot(),landed);
  editor.undo();
  assert.deepEqual(editor.snapshot(),scene);
  editor.redo();
  assert.deepEqual(editor.snapshot(),landed);
});

test('appends to a reopened mesh, fills bound UV layouts and accepts a one-texel crop',()=>{
  const original=ink.createSceneEditor(scene);
  original.placeTilesetFace(request);
  const source=JSON.parse(JSON.stringify(original.snapshot())), mesh=source.topologyMeshes.gate;
  mesh.document.uvBindings={pigment:2,normal:3};
  for (const corner of mesh.document.faces[0].corners) corner.attributes={'uv/2':corner.uv,'uv/3':[0,0]};
  const reopened=ink.createSceneEditor(source);
  const pick=ink.pickTilesetRectangle(scene,'atlas',{x:10,y:5,width:1,height:3});
  const report=reopened.placeTilesetFace({...request,face:'trim',selection:pick,origin:[0,0,0],
    up:[0,0,3],texelsPerUnit:2,brushScale:2});
  assert.deepEqual(report.size,[1,3]);
  assert.deepEqual(report.vertices[2].position,[1,0,3]);
  assert.deepEqual(report.corners.map(c=>c.attributes['uv/2']),[[10/16,7/8],[10/16,7/8],[10/16,5/8],[10/16,5/8]]);
  assert.deepEqual(report.corners[2].attributes['uv/3'],[1,0]);
  const row=reopened.snapshot().topologyMeshes.gate;
  assert.deepEqual(row.document.faces[0],mesh.document.faces[0]);
  assert.equal(row.materials.length,1);
  assert.deepEqual(row.bindings[1].data.selection,pick);
  assert.throws(()=>reopened.placeTilesetFace({...request,face:'bad-frame',up:[1,0,0]}),/perpendicular/);
  reopened.editMeshTopology('gate',{vertices:[{id:'trim/v2',position:[1,0,3.5]}]});
  assert.equal(reopened.snapshot().topologyMeshes.gate.document.faces[1].id,'trim');
  assert.deepEqual(reopened.snapshot().topologyMeshes.gate.bindings[1].data.selection,pick);
});

test('swap, resize, and deduplication keep the face source aligned in their own transactions',()=>{
  const editor=ink.createSceneEditor(scene);
  editor.placeTilesetFace(request);
  const source=()=>editor.snapshot().topologyMeshes.gate.bindings[0].data;
  const swap=editor.transformTilesetCanvas('atlas',{type:'swap',a,b});
  assert.deepEqual(swap.sourceBindings[0].after.selection,{...selection,...b});
  assert.deepEqual(source().selection,{...selection,...b});
  editor.undo();
  assert.deepEqual(source().selection,selection);
  const resize=editor.transformTilesetCanvas('atlas',{type:'resize',size:[21,13],anchor:'center'});
  assert.deepEqual(resize.sourceBindings[0].after,source());
  assert.deepEqual(source().selection,{...selection,x:4,y:3});
  assert.deepEqual(source().atlasSize,[21,13]);
  editor.editTilesetRevision({type:'clone',id:'atlas',newId:'retained'});
  editor.editTilesetRevision({type:'deduplicate',id:'atlas',keepId:'retained'});
  assert.equal(source().selection.tileset,'retained');
  assert.equal(editor.snapshot().topologyMeshes.gate.materials[0].texture.tileset,'retained');
});

test('CLI previews, accepts a saved pick, and renders the placed texels at 1×',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-tileset-place-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name);
  fs.writeFileSync(file('scene.json'),JSON.stringify(scene));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  run('tileset','pick','--scene','scene.json','--id','atlas','--x','2','--y','1','--width','4','--height','3','--out','pick.json');
  const place=['tileset','place','--scene','scene.json','--selection','pick.json','--object','gate','--face','panel'];
  const preview=JSON.parse(run(...place));
  assert.equal(fs.existsSync(file('placed.json')),false);
  assert.deepEqual(JSON.parse(run(...place,'--out','placed.json')),preview);
  const saved=JSON.parse(fs.readFileSync(file('placed.json'),'utf8'));
  assert.deepEqual(saved.topologyMeshes.gate.bindings[0].data.selection,selection);
  const repeated=spawnSync(process.execPath,[cli,...place.map(a=>a==='scene.json'?'placed.json':a),'--out','blocked.json'],
    {cwd:dir,encoding:'utf8'});
  assert.equal(repeated.status,1,repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).canCommit,false);
  assert.equal(fs.existsSync(file('blocked.json')),false);

  const placed = ink.createSceneEditor(saved).build().topologyMeshes.gate.mesh;
  const kit = ink.load().KIT;
  for (const triangle of [0,1]) assert.equal(kit.sceneMeshes.trianglePigment(placed,triangle).color,0xaf692f);
  const render = (input,name)=>run('render',input,'--w','62','--h','46','--px','1','--target','.5,.375,0',
    '--yaw','0','--pitch','0','--zoom','6','--ortho','--raw','--out',name);
  render('placed.json','placed.png');
  const {data}=PNG.raster(file('placed.png'));
  let visible=0;
  for (let i=0;i<data.length;i+=4) if (data[i] !== data[0] || data[i+1] !== data[1] || data[i+2] !== data[2]) visible++;
  assert(visible>100,'visible texels: '+visible);

  const expected = saved.topologyMeshes.gate;
  expected.materials[0].texture = {width:1,height:1,pixels:[175,105,47,255]};
  fs.writeFileSync(file('inline.json'),JSON.stringify(saved));
  render('inline.json','inline.png');
  assert.deepEqual(fs.readFileSync(file('placed.png')),fs.readFileSync(file('inline.png')));
});

test('stamp and vertex move have separate dry runs and preserve each other’s authored data',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-stamp-and-move-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=name=>path.join(dir,name), read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const original=JSON.stringify(scene);
  fs.writeFileSync(file('draft.json'),original);
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
  const json=(...args)=>{
    const result=run(...args);
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const stamp=['tileset','stamp','--scene','draft.json','--object','gate','--part','wall',
    '--face','brick','--id','atlas','--x','2','--y','1','--width','4','--height','3'];
  const placement=json(...stamp);
  assert.equal(placement.format,'ink-studio/tileset-face-placement');
  assert.deepEqual(placement.source.selection,selection);
  assert.deepEqual(placement.corners.map(corner=>corner.id),['brick/c0','brick/c1','brick/c2','brick/c3']);
  assert.deepEqual(fs.readdirSync(dir),['draft.json']);
  assert.deepEqual(json(...stamp,'--out','stamped.json'),placement);
  assert.equal(fs.readFileSync(file('draft.json'),'utf8'),original);
  const stampSnapshot=fs.readFileSync(file('stamped.json'),'utf8');
  const stamped=read('stamped.json'), row=stamped.topologyMeshes.gate;
  const move=['mesh-topology','move','stamped.json','--object','gate','--part','wall','--vertex','brick/v2','--by','.25,.125,0'];
  const preview=json(...move);
  assert.equal(preview.format,'ink-studio/mesh-component-transform');
  assert.deepEqual(preview.operation,{kind:'move',offset:[.25,.125,0]});
  assert.deepEqual(preview.vertices,[{id:'brick/v2',before:[1,.75,0],after:[1.25,.875,0],weight:1,selected:true}]);
  assert.equal(fs.readFileSync(file('stamped.json'),'utf8'),stampSnapshot);
  assert(!fs.existsSync(file('moved.json')));
  assert.deepEqual(json(...move,'--expect',preview.beforeRevision,'--out','moved.json'),preview);
  const moved=read('moved.json'), after=moved.topologyMeshes.gate;
  const positionUpdate={id:'brick/v2',position:[1.25,.875,0]};
  assert.deepEqual(after.document.vertices,row.document.vertices.map(vertex=>vertex.id === positionUpdate.id ? positionUpdate : vertex));
  assert.deepEqual(after.document.faces,row.document.faces);
  assert.deepEqual(after.document.edges,row.document.edges);
  assert.deepEqual(after.materials,row.materials);
  assert.deepEqual(after.bindings,row.bindings);
  assert.deepEqual(moved.tilesets,stamped.tilesets);

  const stale=run(...move.map(arg=>arg === 'stamped.json' ? 'moved.json' : arg),
    '--expect',preview.beforeRevision,'--out','stale.json');
  assert.equal(stale.status,1);
  assert.match(stale.stderr,/expected topology revision/);
  assert(!fs.existsSync(file('stale.json')));
  const collapse=run(...move.map(arg=>arg === '.25,.125,0' ? '0,-.75,0' : arg),'--out','collapsed.json');
  assert.equal(collapse.status,1);
  assert.match(collapse.stderr,/simple polygon/);
  assert(!fs.existsSync(file('collapsed.json')));
  assert.equal(run(...stamp,'--vertex','brick/v2').status,1);
  assert.equal(run(...move,'--selection','pick.json').status,1);

  fs.writeFileSync(file('mesh.json'),JSON.stringify(row.document));
  const standalone=json('mesh-topology','move','mesh.json','--vertex','brick/v2','--by','.25,.125,0','--out','edited-mesh.json');
  assert.deepEqual(standalone.vertices,preview.vertices);
  assert.deepEqual(read('edited-mesh.json'),after.document);
});
