'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const request = (settings,uvSet)=>({uvSet,operations:[{op:'snap',scope:'independent',...settings}]});
const evidence = result=>result.report.operations[0].evidence;
const changed = (result,id)=>result.report.corners.find(row=>row.id===id)?.after;
const close = (a,b)=>assert(a?.every((n,i)=>Math.abs(n-b[i])<1e-10),JSON.stringify({a,b}));
const valid = result=>assert(result.report.canCommit,JSON.stringify(result.report.operations));

function fixture() {
  const vertices = [
    ['a',0,0],['b',1,0],['c',1,1],['d',0,1],['e',2,0],['f',2,1],
    ['g',0,1.5],['h',1,1.5],['i',1,2.5],['j',0,2.5]
  ].map(([id,x,y])=>({id,position:[x,y,0]}));
  const face = (id,verts,uvs)=>({id,material:'paint',corners:verts.map((vertex,i)=>({
    id:id+'/'+vertex,vertex,uv:[[0,1],[1,1],[1,0],[0,0]][i],attributes:{'uv/1':uvs[i]}
  }))});
  const faces = [
    face('left',['a','b','c','d'],[[.17,.75],[.39,.73],[.41,.25],[.16,.25]]),
    face('right',['b','e','f','c'],[[.47,.73],[.77,.73],[.77,.25],[.47,.25]]),
    face('chart',['g','h','i','j'],[[.04,.80],[.39,.73],[.43,.10],[.04,.10]])
  ];
  const mesh = T.create({id:'sample-plates',vertices,faces,uvBindings:{pigment:1},uvPivots:{1:[.5,.5]}});
  const edge = (a,b)=>UV.inspect(mesh,1).edges.find(row=>row.vertices[0]===a && row.vertices[1]===b).id;
  const seam = edge('b','c');
  const document = UV.plan(mesh,{uvSet:1,operations:[{op:'cut',ids:[seam]}]}).document;
  const side = (u,face)=>UV.select(document,{domain:'edges',uvSet:1,atlas:{at:[u,.5],face}});
  return {document,seam,edge,side};
}

test('snap an edge to the counterpart on an authored seam without stitching or changing its target side',()=>{
  const {document,seam,side} = fixture(), selection = side(.47,'right'), targetSide = side(.4,'left');
  const options = {selection,target:{kind:'seam',selection:targetSide}};
  const result = UV.plan(document,request(options,1));
  valid(result);
  assert.deepEqual(selection.edgeSides.map(row=>row.face),['right']);
  assert.deepEqual(changed(result,'right/b'),[.39,.73]);
  assert.deepEqual(changed(result,'right/c'),[.41,.25]);
  assert.equal(changed(result,'left/b'),undefined);
  assert.equal(evidence(result).target.edge,seam);
  assert.deepEqual(result.report.seams,[]);
  assert.equal(UV.inspect(result.document,1).edges.find(row=>row.id===seam).kind,'seam');
  assert.deepEqual(result.document.vertices,document.vertices);
  assert.deepEqual(result.document.uvPivots,document.uvPivots);
  assert.deepEqual(result.document.faces.map(face=>face.corners.map(corner=>corner.uv)),
    document.faces.map(face=>face.corners.map(corner=>corner.uv)));
  assert.throws(()=>UV.plan(document,request({...options,selection:UV.select(document,{uvSet:1,domain:'edges',ids:[seam]})},1)),
    /source edge side/);
  assert.throws(()=>UV.plan(document,request({...options,target:{kind:'seam',edge:seam}},1)),/reference edge side/);
  assert.throws(()=>UV.plan(result.document,request(options,1)),/selection from this mesh revision/);
});

test('snap to another chart’s point or edge and keep the reference fixed',()=>{
  const {document,edge,side} = fixture();
  const exact = UV.plan(document,request({ids:['right/b'],target:{kind:'chart',corner:'chart/h'}},1));
  valid(exact);
  assert.deepEqual(changed(exact,'right/b'),[.39,.73]);
  assert.equal(changed(exact,'chart/h'),undefined);
  const target = {kind:'chart',edge:edge('h','i')};
  const projected = UV.plan(document,request({ids:['right/c'],target},1));
  valid(projected);
  const [a,b] = evidence(projected).target.points, [u,v] = changed(projected,'right/c');
  assert(Math.abs((u-a[0])*(b[1]-a[1])-(v-a[1])*(b[0]-a[0]))<1e-12);
  assert(v>b[1] && v<a[1]);
  const aligned = UV.plan(document,request({selection:side(.47,'right'),target},1));
  valid(aligned);
  assert.deepEqual(changed(aligned,'right/b'),a);
  assert.deepEqual(changed(aligned,'right/c'),b);
  const wrong = UV.plan(document,request({ids:['chart/i'],target},1));
  assert.equal(wrong.report.operations[0].conflicts[0].code,'snap-same-chart');
  const locked = UV.plan(document,request({scope:'together',ids:['left/b'],target:{kind:'chart',edge:edge('h','i')}},1));
  valid(locked);
  assert.deepEqual(locked.document,document);
  assert(evidence(locked).moving.some(row=>row.id==='chart/h'));
});

test('snap an edge to one tile line from its midpoint and corners to fractional source texels',()=>{
  const {document,side} = fixture(), selection = side(.4,'left');
  const scene = {id:'grid',style:'slate',solids:[],tilesets:{
    sheet:{...ink.createBlankTileset({width:33,height:17,background:'#517f87'}),
      tileSize:{width:8,height:4,paddingX:1,offsetX:3}}
  },topologyMeshes:{plates:{document,materials:[{id:'paint',texture:{tileset:'sheet'}}]}}};
  const editor = ink.createSceneEditor(scene);
  const tileRequest = request({selection,target:{kind:'grid',axis:'u',units:'tile'}},'pigment');
  const tiled = editor.planMeshUV('plates',tileRequest);
  valid(tiled);
  assert.deepEqual(changed(tiled,'left/b'),[12/32,.73]);
  assert.deepEqual(changed(tiled,'left/c'),[12/32,.25]);
  assert.equal(evidence(tiled).target.materials[0].gridSource,'override');
  assert.deepEqual(evidence(tiled).guides,[{material:'paint',points:[[12/32,0],[12/32,1]]}]);
  assert.deepEqual(editor.editMeshUV('plates',tileRequest).uv,tiled.report);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('plates').document,tiled.document);

  const fraction = editor.planMeshUV('plates',request({ids:['right/b'],target:{kind:'grid',axis:'v',step:.25}},'pigment'));
  valid(fraction);
  assert.deepEqual(changed(fraction,'right/b'),[.47,11.75/16]);
  const explicit = UV.plan(document,request({ids:['left/a'],target:{kind:'grid',axis:'u',atlas:[33,17],step:.25,origin:6}},1));
  valid(explicit);
  close(changed(explicit,'left/a'),[5.5/32,.75]);
  const margin = UV.plan(document,{uvSet:1,operations:[{op:'move-corners',ids:['right/e'],scope:'independent',translate:[.2,0]}]});
  valid(margin);
  const lastTile = UV.plan(margin.document,request({ids:['right/e'],target:{kind:'grid',axis:'u',units:'tile',
    atlas:[33,17],tileSize:{width:8,height:4,paddingX:1,offsetX:3}}},1));
  valid(lastTile);
  assert.deepEqual(changed(lastTile,'right/e'),[21/32,.73]);
});

test('grid snapping reports competing lines, pin conflicts and collapsed triangles before committing',()=>{
  const {document,edge,side} = fixture();
  const grid = {kind:'grid',axis:'u',units:'uv',step:.25};
  const synthetic = UV.select(document,{domain:'edges',uvSet:1,ids:[edge('c','d'),edge('b','c')]});
  const selected = UV.select(document,{domain:'edges',uvSet:1,from:{...synthetic,
    edgeSides:synthetic.edgeSides.filter(row=>row.face==='left')}});
  const collision = UV.plan(document,request({selection:selected,target:grid},1));
  assert(collision.report.operations[0].conflicts.some(row=>row.code==='snap-competing-targets' && row.corner==='left/c'));
  assert.deepEqual(collision.patch,{});
  const pin = UV.plan(document,{uvSet:1,operations:[{op:'pin',ids:['left/b'],pinned:true}]}).document;
  const pinned = UV.plan(pin,request({ids:['left/b'],target:grid},1));
  assert(pinned.report.operations[0].conflicts.some(row=>row.code==='pinned-corner'));
  assert.deepEqual(pinned.document,pin);
  const collapsed = UV.plan(document,request({ids:['left/a','left/b','left/c','left/d'],target:{...grid,step:1}},1));
  assert(collapsed.report.operations[0].conflicts.some(row=>row.code==='collapsed-uv-triangle'));
  const flipped = UV.plan(document,request({ids:['left/a'],target:{kind:'chart',corner:'right/e'}},1));
  assert(flipped.report.operations[0].conflicts.some(row=>row.code==='flipped-uv-triangle'));
  const same = UV.plan(document,request({selection:side(.47,'right'),target:{kind:'seam',edge:edge('b','c'),face:'right'}},1));
  valid(same);
  assert.deepEqual(same.patch,{});
});
