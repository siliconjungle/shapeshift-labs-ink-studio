'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology;

function fixture() {
  const vertices = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0],[3,0,0],[3,1,0]]
    .map((position,i)=>({id:'v'+i,position}));
  const layout = [[.125,.375],[1,1],[1,0],[.125,.125]];
  const faces = [[0,1,2,3],[1,4,5,2],[4,6,7,5]].map((ring,i)=>({
    id:'f'+i,material:['tiles','print','blank'][i],corners:ring.map((vertex,j)=>({
      id:'c'+i+'-'+j,vertex:'v'+vertex,uv:[j%2,0],attributes:{'uv/1':[0.5,0.25],'uv/2':layout[j]}
    }))
  }));
  const doc = T.create({id:'panel',vertices,faces,uvBindings:{pigment:2,emission:1}});
  const bytes = (width,height)=>new Array(width*height*4).fill(255);
  const print = (width,height)=>({width,height,pixels:bytes(width,height)});
  const scene = {id:'lamps',style:'slate',solids:[],tilesets:{metal:ink.createBlankTileset({
    width:17,height:11,background:'#a1957b'})},topologyMeshes:{panel:{
    document:doc,materials:[{id:'tiles',texture:{tileset:'metal'}},{id:'print',texture:print(5,7)}],
    bakes:[{id:'printed-bake',material:'print',maps:{texture:print(9,1),emission:bytes(9,1)}}]
  }}};
  return {doc,scene};
}

test('scene inspection pairs exact authored UVs with texels on each material and seam side',()=>{
  const {doc,scene} = fixture(), editor = ink.createSceneEditor(scene), before = editor.snapshot();
  const report = editor.inspectMeshUV('panel',{uvSet:'pigment'});
  assert.equal(report.uvSet,2);
  assert.equal(report.revision,T.revision(doc));
  assert.deepEqual(report.texelCoordinates,{origin:'top-left',units:'texel-centers'});
  assert.deepEqual(report.faces.map(face=>face.atlas),[
    {kind:'tileset',channel:'pigment',size:[17,11],tileset:'metal'},
    {kind:'material-bake',channel:'pigment',size:[9,1],bake:'printed-bake'},undefined
  ]);
  const [left,right,blank] = ['c0-0','c1-0','c2-0'].map(id=>report.corners.find(corner=>corner.id===id));
  assert.deepEqual(left.uv,[.125,.375]);
  assert.deepEqual(left.texel,[2,3.75]);
  assert.deepEqual(right.uv,left.uv);
  assert.deepEqual(right.texel,[1,0]);
  assert.equal(blank.texel,undefined);
  const edge = report.edges.find(row=>row.vertices.join() === 'v1,v2');
  assert.equal(edge.kind,'material-boundary');
  assert.deepEqual(edge.sides.map(side=>side.texels),[[[16,10],[16,0]],[[1,0],[1,0]]]);
  assert.deepEqual(editor.inspectMeshUV('panel',{uvSet:2}),report);
  assert.equal(editor.inspectMeshUV('panel').texelCoordinates,undefined);
  const light = editor.inspectMeshUV('panel',{uvSet:'emission'});
  assert.equal(light.uvSet,1);
  assert.deepEqual(light.corners.find(row=>row.id==='c1-0').texel,[4,0]);
  assert.equal(light.corners.find(row=>row.id==='c0-0').texel,undefined);
  const discarded = JSON.parse(JSON.stringify(scene));
  discarded.topologyMeshes.panel.bakes[0].invalidated = {faces:['f1']};
  const previous = ink.createSceneEditor(discarded).inspectMeshUV('panel',{uvSet:'pigment'});
  assert.deepEqual(previous.corners.find(row=>row.id==='c1-0').texel,[.5,2.25]);
  assert.deepEqual(editor.snapshot(),before);
});

test('a standalone layout uses only supplied dimensions and handles single-texel axes',()=>{
  const {doc} = fixture(), flat = T.uv.inspect(doc,2);
  assert.equal(flat.texelCoordinates,undefined);
  const paired = T.uv.inspect(doc,2,{atlas:[1,33]});
  assert.deepEqual(paired.faces[0].atlas,{kind:'explicit',size:[1,33]});
  assert.deepEqual(paired.corners[0].texel,[0,12]);
  assert.deepEqual(paired.corners[1].texel,[0,32]);
  assert.throws(()=>T.uv.inspect(doc,2,{atlas:[1.5,12]}),/positive integer/);
});

test('eyedrop retains exact fractional crop coordinates and CLI layout matches the SDK',t=>{
  const {scene,doc} = fixture(), editor = ink.createSceneEditor(scene);
  const crop = ink.pickTilesetRectangle(scene,'metal',{x:2,y:1,width:9,height:7});
  editor.placeTilesetFace({object:'sample',face:'paint',selection:crop,origin:[0,1,0],paint:{rotation:90},
    uvInset:{left:.5,top:1.25}});
  const recovered = editor.eyedropTilesetFace({object:'sample',face:'paint'});
  assert(recovered.canStamp);
  assert.deepEqual(recovered.atlas.size,[17,11]);
  assert.deepEqual(recovered.uv.map(row=>row.texel),[[10,7],[10,2.25],[2.5,2.25],[2.5,7]]);
  assert.deepEqual(recovered.selection,crop);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-source-uv-'));
  t.after(()=>fs.rmSync(cwd,{force:true,recursive:true}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const write = (name,value)=>fs.writeFileSync(path.join(cwd,name),JSON.stringify(value));
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,[cli,'mesh-uv','layout',...args],{cwd,encoding:'utf8'}));
  write('scene.json',editor.snapshot());
  write('mesh.json',doc);
  assert.deepEqual(run('scene.json','--object','panel','--channel','pigment'),editor.inspectMeshUV('panel',{uvSet:'pigment'}));
  assert.deepEqual(run('mesh.json','--uv-set','2','--atlas','1,33'),T.uv.inspect(doc,2,{atlas:[1,33]}));
  const rejected = spawnSync(process.execPath,[cli,'mesh-uv','layout','mesh.json','--atlas','0,4'],{cwd,encoding:'utf8'});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/positive integer/);
});
