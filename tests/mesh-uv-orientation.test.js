'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const atlas = [25,17];
const cornersOf = (doc,id,uvSet='pigment')=>UV.inspect(doc,uvSet).corners.find(row=>row.id===id).uv;
const texelUV = (x,y)=>[x/24,y/16];
const plan = (doc,...operations)=>UV.plan(doc,{uvSet:'pigment',operations});
const orient = fields=>({op:'orient',domain:'faces',ids:['left','right'],space:'texel',atlas,...fields});
const evidence = result=>result.report.operations[0].evidence;
const ready = result=>assert(result.report.canCommit,JSON.stringify(result.report.operations));

function fixture() {
  const vertices = [
    ['a',0,0],['b',1,0],['c',1,1],['d',0,1],['e',2,0],['f',2,1]
  ].map(([id,x,y])=>({id,position:[x,y,0]}));
  const face = (id,ids,x)=>({id,material:'paint',corners:ids.map((vertex,i)=>({
    id:id+'/'+vertex,vertex,uv:[[0,1],[1,1],[1,0],[0,0]][i],
    attributes:{'uv/1':texelUV(...[[x,8],[x+4,8],[x+4,4],[x,4]][i])}
  }))});
  const doc = T.create({id:'two-plates',vertices,faces:[face('left',['a','b','c','d'],4),face('right',['b','e','f','c'],8)],
    uvBindings:{pigment:1}});
  const shared = UV.inspect(doc,'pigment').edges.find(row=>row.kind==='continuous').id;
  return {doc,shared};
}

test('apply exact clockwise quarter turns to a welded group or around each face center',()=>{
  const {doc,shared} = fixture();
  const selection = UV.select(doc,{uvSet:'pigment',domain:'faces',ids:['left','right']});
  const grouped = plan(doc,orient({ids:undefined,domain:undefined,selection,degrees:450}));
  ready(grouped);
  assert.deepEqual(evidence(grouped).angle,{requested:450,applied:450,wrapped:90,exact:true});
  assert.deepEqual(evidence(grouped).pivots,[{uv:texelUV(8,6),atlas}]);
  assert.deepEqual(cornersOf(grouped.document,'left/a'),texelUV(6,2));
  assert.deepEqual(cornersOf(grouped.document,'left/b'),cornersOf(grouped.document,'right/b'));
  assert.equal(UV.inspect(grouped.document,'pigment').edges.find(row=>row.id===shared).kind,'continuous');
  const perFace = plan(doc,orient({mode:'per-face',degrees:90}));
  ready(perFace);
  assert.deepEqual(evidence(perFace).pivots,[
    {face:'left',uv:texelUV(6,6),atlas},{face:'right',uv:texelUV(10,6),atlas}
  ]);
  assert.deepEqual(cornersOf(perFace.document,'left/a'),texelUV(4,4));
  assert.deepEqual(cornersOf(perFace.document,'right/b'),texelUV(8,4));
  assert.deepEqual(evidence(perFace).edgeChanges,[{edge:shared,before:'continuous',after:'seam'}]);
  assert.deepEqual(perFace.report.seams,[]);
  assert.deepEqual(perFace.document.vertices,doc.vertices);
  assert.deepEqual(UV.inspect(perFace.document).corners,UV.inspect(doc).corners);
  assert.deepEqual(plan(doc,...Array.from({length:4},()=>orient({degrees:90}))).document,doc);
  const normalized = UV.plan(doc,{operations:[{op:'orient',mode:'per-face',ids:['left'],degrees:-90}]});
  ready(normalized);
  assert.deepEqual(cornersOf(normalized.document,'left/a',0),[1,1]);
  assert.deepEqual(evidence(normalized).pivots,[{face:'left',uv:[.5,.5]}]);

  const cut = plan(doc,{op:'cut',ids:[shared]}).document;
  const savedSide = UV.select(cut,{domain:'edges',uvSet:'pigment',atlas:{at:texelUV(8,6),face:'left'}});
  const movedSide = plan(cut,orient({ids:undefined,domain:undefined,selection:savedSide,degrees:15}));
  ready(movedSide);
  assert.deepEqual(movedSide.report.corners.map(row=>row.id),['left/b','left/c']);
});

test('reflect on either source axis, compose both flips, and quantize authored angle steps',()=>{
  const {doc} = fixture();
  const x = plan(doc,orient({flipX:true})), y = plan(doc,orient({flipY:true}));
  const both = plan(doc,orient({flipX:true,flipY:true})), half = plan(doc,orient({degrees:180}));
  for (const result of [x,y,both,half]) ready(result);
  assert.deepEqual(cornersOf(x.document,'left/a'),texelUV(12,8));
  assert.deepEqual(cornersOf(y.document,'left/a'),texelUV(4,4));
  assert.equal(evidence(x).mirrored,true);
  assert.equal(evidence(both).mirrored,false);
  assert.deepEqual(both.document,half.document);

  const snapped = plan(doc,orient({degrees:87,increment:15}));
  ready(snapped);
  assert.deepEqual(evidence(snapped).angle,{requested:87,applied:90,wrapped:90,increment:15,exact:true});
  assert.deepEqual(snapped.document,plan(doc,orient({degrees:90})).document);
  const oblique = plan(doc,orient({mode:'per-face',degrees:-37,increment:15}));
  ready(oblique);
  assert.deepEqual(evidence(oblique).angle,{requested:-37,applied:-30,wrapped:330,increment:15,exact:false});
  assert.deepEqual(oblique.document,plan(doc,orient({mode:'per-face',degrees:-30})).document);
  assert.equal(evidence(plan(doc,orient({degrees:-7.5,increment:15}))).angle.applied,-15);
});

test('resolve atlas dimensions and dedicated pivots through the scene editor and undo orientation',()=>{
  const {doc} = fixture();
  const document = plan(doc,{op:'set-pivot',target:{kind:'point',uv:texelUV(7,6)}}).document;
  const scene = {id:'painted-plates',style:'slate',solids:[],
    tilesets:{signs:ink.createBlankTileset({width:25,height:17,background:'#476c70'})},
    topologyMeshes:{plates:{document,materials:[{id:'paint',texture:{tileset:'signs'}}],
      bakes:[{id:'rough-bake',material:'paint',maps:{roughness:.6}}]}}};
  const editor = ink.createSceneEditor(scene);
  const request = {uvSet:'pigment',revision:T.revision(document),operations:[orient({atlas:undefined,degrees:90})]};
  const preview = editor.planMeshUV('plates',request);
  ready(preview);
  assert.equal(evidence(preview).pivotSource,'dedicated');
  assert.deepEqual(evidence(preview).pivots,[{uv:texelUV(7,6),atlas}]);
  assert.deepEqual(cornersOf(preview.document,'left/a'),texelUV(5,3));
  const committed = editor.editMeshUV('plates',request);
  assert.deepEqual(committed.uv,preview.report);
  assert.equal(editor.snapshot().topologyMeshes.plates.bakes[0].invalidated.faces.length,2);
  assert.deepEqual(editor.meshTopology('plates').document.uvPivots,document.uvPivots);
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('plates').document,preview.document);
  assert.throws(()=>editor.planMeshUV('plates',request),/different topology revision/);
  assert.throws(()=>plan(doc,orient({atlas:undefined,degrees:90})),/atlas dimensions/);
  const dimensions = material=>({size:material==='paint' ? atlas : [49,33]});
  const mixed = T.edit(doc,{faces:[{...doc.faces[1],material:'other'}]});
  assert.throws(()=>UV.plan(mixed,{uvSet:'pigment',operations:[orient({atlas:undefined,degrees:90})]},
    {atlasFor:dimensions}),/matching atlas dimensions/);
  ready(UV.plan(mixed,{uvSet:'pigment',operations:[orient({atlas:undefined,mode:'per-face',degrees:90})]},
    {atlasFor:dimensions}));
});

test('allow intentional whole-face mirroring and block moved pins, out-of-sheet and inverted partial edits',()=>{
  const {doc} = fixture();
  const pin = plan(doc,{op:'pin',ids:['left/a'],pinned:true}).document;
  const blocked = plan(pin,orient({flipX:true}));
  assert.deepEqual(blocked.patch,{});
  assert(blocked.report.operations[0].conflicts.some(row=>row.code==='pinned-corner'));
  const atPin = plan(pin,orient({degrees:90,pivot:texelUV(4,8)}));
  ready(atPin);
  assert.deepEqual(cornersOf(atPin.document,'left/a'),texelUV(4,8));
  const outside = plan(doc,orient({flipX:true,pivot:[0,0]}));
  assert(outside.report.operations[0].conflicts.some(row=>row.code==='outside-atlas'));
  const partial = plan(doc,orient({domain:'corners',ids:['left/a'],flipX:true,pivot:texelUV(8,8)}));
  assert(partial.report.operations[0].conflicts.some(row=>row.code==='flipped-uv-triangle'));
  const together = plan(doc,orient({domain:'corners',ids:['left/b'],scope:'together',flipY:true,pivot:texelUV(8,7)}));
  ready(together);
  assert.deepEqual(together.report.corners.map(row=>row.id),['left/b','right/b']);
  assert.deepEqual(together.report.corners.map(row=>row.after),[texelUV(8,6),texelUV(8,6)]);
  assert.throws(()=>plan(doc,orient({increment:0,degrees:20})),/positive angle increment/);
  assert.throws(()=>plan(doc,orient({mode:'per-face',pivot:[.5,.5]})),/own centers/);
});
