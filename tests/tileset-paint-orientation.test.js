'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync,spawnSync} = require('node:child_process');
const {test} = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const width = 8, height = 5, pixels = new Uint8Array(width*height*4);
for (let y=0;y<height;y++) for (let x=0;x<width;x++)
  pixels.set([33+x*23,40+y*40,(x+y)*15,255],(y*width+x)*4);
const scene = {id:'tile-paint-orientation',style:'slate',solids:[],tilesetDefaults:{texelsPerUnit:2},
  tilesets:{paint:ink.readTilesetImage(PNG.encode(width,height,pixels,4))}};
const selection = ink.pickTilesetRectangle(scene,'paint',{x:0,y:1,width:4,height:2});
const brush = ink.pickTilesetBlock(scene,'paint',{x:0,y:0,width:8,height:5},{width:2,height:2,paddingX:1,paddingY:1});

test('paint quarter turns and reflections permute pigment on an independently tilted rectangular face',()=>{
  const editor = ink.createSceneEditor(scene);
  const request = {object:'wall',face:'tile',selection,origin:[3,4,5],right:[0,0,-1],up:[0,1,0]};
  const base = editor.planTilesetFace(request);
  const order = claim=>claim.corners.map(corner=>corner.uv);
  const paint = {rotation:90,flipX:true};
  const turn = editor.planTilesetFace({...request,paint:{rotation:90}});
  const mirror = editor.planTilesetFace({...request,paint:{flipY:true}});
  const both = editor.placeTilesetFace({...request,paint});
  const [bl,br,tr,tl] = order(base);
  assert.deepEqual(order(turn),[br,tr,tl,bl]);
  assert.deepEqual(order(mirror),[tl,tr,br,bl]);
  assert.deepEqual(order(both),[bl,tl,tr,br]);
  for (const result of [turn,mirror,both]) {
    assert.deepEqual(result.size,[2,1]);
    assert.deepEqual(result.vertices,base.vertices);
    assert.deepEqual(result.corners.map(({id,vertex})=>[id,vertex]),base.corners.map(({id,vertex})=>[id,vertex]));
  }
  const row = editor.meshTopology('wall');
  assert.deepEqual(row.bindings[0].data.paint,{rotation:90,flipX:true,flipY:false});
  assert.deepEqual(row.bindings[0].data.selection,selection);
  editor.undo();
  assert.deepEqual(editor.snapshot(),scene);
  assert.throws(()=>editor.planTilesetFace({...request,paint:{rotation:45}}),/Paint rotation/);
  assert.throws(()=>editor.planTilesetFace({...request,paint:{flipX:'yes'}}),/reflections must be boolean/);
});

test('draws and fills with oriented pigment only, keeping separate material UV layouts and atlas migrations',()=>{
  const editor = ink.createSceneEditor(scene);
  editor.placeTilesetFace({object:'wall',face:'starter',selection,origin:[10,0,0]});
  const source = JSON.parse(JSON.stringify(editor.snapshot())), mesh = source.topologyMeshes.wall.document;
  mesh.uvBindings = {pigment:2,normal:3};
  for (const corner of mesh.faces[0].corners) corner.attributes = {'uv/2':corner.uv,'uv/3':[0,0]};
  const reopened = ink.createSceneEditor(source);
  const paint = {rotation:270,flipY:true};
  const stamp = reopened.planTilesetFace({object:'wall',face:'sample',selection,paint});
  const base = reopened.planTilesetFace({object:'wall',face:'sample',selection});
  assert.deepEqual(stamp.corners.map(c=>c.uv),base.corners.map(c=>c.uv));
  assert.deepEqual(stamp.corners.map(c=>c.attributes['uv/3']),base.corners.map(c=>c.attributes['uv/3']));
  assert.notDeepEqual(stamp.corners.map(c=>c.attributes['uv/2']),base.corners.map(c=>c.attributes['uv/2']));
  reopened.applyTilesetStroke({mode:'draw',id:'course',object:'wall',selection,paint,path:[[0,0],[2,0]],interval:2});
  const rect = reopened.applyTilesetRectangle({mode:'fill',id:'patch',object:'wall',selection,paint,from:[0,2],to:[0,2]});
  assert.deepEqual(rect.brush.source.paint,{rotation:270,flipX:false,flipY:true});
  const fresh = reopened.meshTopology('wall').document.faces.filter(face=>face.id!=='starter');
  for (const face of fresh)
    assert.deepEqual(face.corners.map(c=>c.attributes['uv/2']),stamp.corners.map(c=>c.attributes['uv/2']));
  const move = reopened.transformTilesetCanvas('paint',{type:'swap',
    a:{x:0,y:1,width:4,height:2},b:{x:4,y:1,width:4,height:2}});
  assert.equal(move.canCommit,true);
  const row = reopened.meshTopology('wall');
  for (const bound of row.bindings.filter(binding=>binding.element !== 'starter')) {
    assert.deepEqual(bound.data.paint,{rotation:270,flipX:false,flipY:true});
    assert.equal(bound.data.selection.x,4);
  }
  const moved = row.document.faces.find(face=>face.id === 'course/0');
  assert.deepEqual(moved.corners.map(c=>c.attributes['uv/2']),
    stamp.corners.map(c=>[c.attributes['uv/2'][0]+4/7,c.attributes['uv/2'][1]]));
});

test('rotates a complete padded block and its artwork anchor while fitting the original world footprint',()=>{
  const editor = ink.createSceneEditor(scene);
  const request = {id:'ornament',object:'wall',at:[0,0],brush:{...brush,paint:{rotation:90}}};
  const plan = editor.applyTilesetBrushRun(request);
  assert.deepEqual(plan.paintGrid,[2,3]);
  assert.deepEqual(plan.tileSize,[1.5,2/3]);
  assert.deepEqual(plan.pitch,[3,0]);
  assert.deepEqual(plan.faces.map(row=>row.cell),[[1,2],[1,1],[1,0],[0,2],[0,1],[0,0]]);
  assert.deepEqual(plan.faces.map(row=>[row.selection.x,row.selection.y]),
    [[0,0],[3,0],[6,0],[0,3],[3,3],[6,3]]);
  const row = editor.meshTopology('wall');
  assert.deepEqual(row.bindings[0].data.paint,{rotation:90,flipX:false,flipY:false});
  assert.deepEqual(row.document.vertices.reduce(([low,high],point)=>[
    low.map((x,i)=>Math.min(x,point.position[i])),high.map((x,i)=>Math.max(x,point.position[i]))
  ],[[Infinity,Infinity,Infinity],[-Infinity,-Infinity,-Infinity]]),[[0,0,0],[3,2,0]]);
  const anchored = editor.planTilesetBrushRun({...request,id:'anchored',at:[5,2],align:'anchor',anchor:[2,1],
    count:2,spacing:'overlap'});
  assert.deepEqual(anchored.anchor,[2,1]);
  assert.deepEqual(anchored.paintAnchor,[3,2]);
  assert.deepEqual(anchored.pitch,[1.5,0]);
  assert.equal(anchored.stamps[1].replaced.length,3);
  assert.equal(anchored.stamps[0].origin[0],2.75);
  assert(Math.abs(anchored.stamps[0].origin[1]-2/3)<1e-12);
  const reset = editor.planTilesetBrushRun({...request,id:'reset',paint:{rotation:0}});
  assert.deepEqual(reset.paintGrid,[3,2]);
  assert.deepEqual(reset.faces.map(row=>row.cell),[[0,1],[1,1],[2,1],[0,0],[1,0],[2,0]]);
});

test('CLI saves and previews oriented brush pixels and stamps a proof with the requested paint orientation',t=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-tile-paint-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file = name=>path.join(dir,name);
  fs.writeFileSync(file('scene.json'),JSON.stringify(scene));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args)=>execFileSync(process.execPath,[cli,'tileset',...args],{cwd:dir,encoding:'utf8'});
  run('pick','--scene','scene.json','--id','paint','--brush','--x','0','--y','0','--width','8','--height','5',
    '--tile-width','2','--tile-height','2','--padding-x','1','--padding-y','1','--paint-rotate','90','--paint-flip-x','--out','brush.json');
  const saved = JSON.parse(fs.readFileSync(file('brush.json')));
  assert.deepEqual(saved.paint,{rotation:90,flipX:true,flipY:false});
  run('brush-preview','brush.json','--scene','scene.json','--out','brush.png');
  const rotated = PNG.raster(file('brush.png')), original = ink.rasterizeTilesetBrush(scene,brush);
  assert.deepEqual([rotated.w,rotated.h],[4,6]);
  for (let y=0;y<original.height;y++) for (let x=0;x<original.width;x++) {
    const from = (y*original.width+x)*4, to = ((original.width-1-x)*rotated.w+original.height-1-y)*4;
    assert.deepEqual(Array.from(rotated.data.subarray(to,to+4)),Array.from(original.pixels.subarray(from,from+4)));
  }
  const place = ['stamp','--scene','scene.json','--object','wall','--face','tile','--id','paint',
    '--x','0','--y','1','--width','4','--height','2','--paint-rotate','180','--paint-flip-x'];
  const preview = JSON.parse(run(...place));
  assert.equal(fs.existsSync(file('placed.json')),false);
  assert.deepEqual(JSON.parse(run(...place,'--out','placed.json')),preview);
  const landed = JSON.parse(fs.readFileSync(file('placed.json')));
  assert.deepEqual(landed.topologyMeshes.wall.bindings[0].data.paint,{rotation:180,flipX:true,flipY:false});
  const invalid = spawnSync(process.execPath,[cli,'tileset',...place.map(arg=>arg==='180' ? '45' : arg)],{cwd:dir,encoding:'utf8'});
  assert.equal(invalid.status,1);
  assert.match(invalid.stderr,/Paint rotation/);
});
