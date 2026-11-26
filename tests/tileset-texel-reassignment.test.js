'use strict';

const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology;
const cli = path.join(__dirname,'../cli/ink-studio.js');
const request = (tileset,options={})=>({object:'sign',mode:'sheet',mapping:'preserve-texels',
  ids:['left','right'],tileset,...options});
const close = (a,b)=>assert(Math.abs(a-b)<1e-10,JSON.stringify({a,b}));

function fixture() {
  const vertices = Array.from({length:8},(_,i)=>({id:'v'+i,position:[Math.floor(i/2),i%2,0]}));
  const panel = (id,x,uv)=>({id,material:'enamel',corners:uv.map(([u,v],i)=>({
    id:id+'/'+i,vertex:'v'+(2*x+[0,2,3,1][i]),uv:[[0,1],[1,1],[1,0],[0,0]][i],
    attributes:{'uv/1':[u/63,v/63]}
  }))});
  const rect = (l,t,r,b)=>[[l,b],[r,b],[r,t],[l,t]];
  const doc = T.create({id:'sign',vertices,uvBindings:{pigment:1},faces:[
    panel('left',0,rect(8,12,28,32)),panel('right',1,rect(28,12,48,32)),panel('spare',2,rect(48,12,58,32))
  ]});
  const image = (width,height,color)=>ink.createBlankTileset({width,height,background:color});
  const scene = {id:'sign-reassignment',style:'slate',solids:[],
    camera:{target:[1.5,.5,0],dist:6,projection:'orthographic'},
    tilesets:{original:image(64,64,'#50787d'),large:image(96,80,'#809e76'),
      small:image(42,30,'#b97e64'),tiny:image(24,9,'#9a665c')},
    topologyMeshes:{sign:{document:doc,materials:[{id:'enamel',texture:{tileset:'original'}}],
      bakes:[{id:'surface-bake',material:'enamel',maps:{roughness:.4}}]}}};
  return {doc,scene};
}

test('reassign a 64×64 atlas without changing texel coordinates, per-face density or continuity',()=>{
  const {doc,scene} = fixture(), editor = ink.createSceneEditor(scene);
  const selection = editor.selectMeshUV('sign',{domain:'faces',uvSet:'pigment',ids:['left','right']});
  const req = request('large',{ids:undefined,selection,revision:T.revision(doc)});
  const preview = editor.planTilesetAssignment(req);
  assert(preview.canCommit);
  assert.equal(preview.uvSet,1);
  assert.equal(preview.clamp,false);
  for (const face of preview.faces) {
    assert.equal(face.basis,'source-texels');
    assert.deepEqual(face.before.atlasSize,[64,64]);
    assert.deepEqual(face.after.atlasSize,[96,80]);
    face.before.texelBounds.forEach((n,i)=>close(n,face.after.bounds[i]));
    close(face.before.metrics.density,face.after.metrics.density);
    assert(Math.abs(face.before.metrics.maxStretch-face.after.metrics.maxStretch)<1e-7);
    for (const {texels,after} of face.corners) {
      assert.deepEqual(texels.before,texels.after);
      assert.deepEqual(texels.clampedAxes,[]);
      assert.deepEqual(after,[texels.after[0]/95,texels.after[1]/79]);
    }
  }
  const [left,right] = preview.faces;
  assert.deepEqual(left.corners[1].after,right.corners[0].after);
  assert.deepEqual(left.corners[2].after,right.corners[3].after);
  const applied = editor.applyTilesetAssignment(req);
  assert.deepEqual(applied,preview);
  const result = editor.meshTopology('sign');
  assert.deepEqual(result.document.vertices,doc.vertices);
  assert.deepEqual(result.document.faces.find(row=>row.id==='spare'),doc.faces.find(row=>row.id==='spare'));
  assert.deepEqual(result.bakes,scene.topologyMeshes.sign.bakes);
  assert.deepEqual(result.document.faces.map(face=>face.corners.map(c=>c.uv)),doc.faces.map(face=>face.corners.map(c=>c.uv)));
  const source = editor.eyedropTilesetFace({object:'sign',face:'left'});
  assert(source.canStamp);
  assert.equal(source.sourceStatus,'retained');
  assert.deepEqual(source.selection,ink.pickTilesetRectangle(scene,'large',{x:8,y:12,width:21,height:21}));
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),scene);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('sign'),result);
});

test('report strict overflow, preview an explicit clamp, and reject destructive clamps or pinned UVs',()=>{
  const {doc,scene} = fixture(), editor = ink.createSceneEditor(scene);
  const strict = editor.planTilesetAssignment(request('small'));
  assert.equal(strict.canCommit,false);
  assert.deepEqual(editor.snapshot(),scene);
  assert.equal(strict.conflicts.length,5);
  assert(strict.conflicts.every(row=>row.reason==='texel-outside-tileset'));
  assert.deepEqual(strict.faces[1].after.clampedCorners,['right/0','right/1','right/2']);
  const clipped = strict.faces[1].corners[1];
  assert.deepEqual(clipped.texels,{before:[48,32],after:[41,29],clampedAxes:['u','v']});
  assert.throws(()=>editor.applyTilesetAssignment(request('small')),error=>error.report?.canCommit===false);
  const allowed = editor.planTilesetAssignment(request('small',{clamp:true}));
  assert(allowed.canCommit);
  assert.deepEqual(allowed.faces,strict.faces);
  const expected = [[8,12,28,29],[28,12,41,29]];
  allowed.faces.forEach((row,i)=>row.after.bounds.forEach((n,j)=>close(n,expected[i][j])));
  const collapsed = editor.planTilesetAssignment(request('tiny',{clamp:true}));
  assert.equal(collapsed.canCommit,false);
  assert(collapsed.conflicts.some(row=>row.reason==='clamp-collapsed-uv'));
  const pinned = T.uv.plan(doc,{uvSet:'pigment',operations:[{op:'pin',ids:['right/1'],pinned:true}]}).document;
  const pinScene = {...scene,topologyMeshes:{sign:{...scene.topologyMeshes.sign,document:pinned}}};
  assert.deepEqual(ink.createSceneEditor(pinScene).planTilesetAssignment(request('large')).conflicts,[
    {reason:'pinned-uv',face:'right',corner:'right/1'}
  ]);
  assert.throws(()=>editor.planTilesetAssignment(request('large',{mapping:'group',clamp:true})),/preserve-texels/);
  assert.deepEqual(editor.applyTilesetAssignment(request('small',{clamp:true})),allowed);
});

test('reject a clamped texture winding reversal and explain a missing source atlas',()=>{
  const {scene} = fixture();
  const vertices = [[0,0,0],[1,0,0],[0,1,0]].map((position,i)=>({id:'v'+i,position}));
  const corners = [[0,0],[3,3],[10,8]].map(([u,v],i)=>({id:'c'+i,vertex:'v'+i,uv:[u/63,v/63]}));
  const document = T.create({id:'triangle',vertices,faces:[{id:'triangle',material:'enamel',corners}]});
  const triangle = {...scene,topologyMeshes:{sign:{...scene.topologyMeshes.sign,document}},
    tilesets:{...scene.tilesets,narrow:ink.createBlankTileset({width:6,height:16})}};
  const req = request('narrow',{ids:['triangle'],clamp:true});
  const editor = ink.createSceneEditor(triangle), report = editor.planTilesetAssignment(req);
  assert.equal(report.canCommit,false);
  assert.deepEqual(report.conflicts,[{reason:'clamp-flipped-uv',face:'triangle',corners:['c0','c1','c2']}]);
  const untextured = ink.createSceneEditor({...triangle,topologyMeshes:{sign:{document}}});
  assert.deepEqual(untextured.planTilesetAssignment(req).conflicts,[{
    reason:'missing-source-atlas',face:'triangle',material:'enamel'
  }]);
});

test('retain a rotated, inset crop that fits the replacement atlas',()=>{
  const {scene} = fixture();
  const row = scene.topologyMeshes.sign;
  const editor = ink.createSceneEditor({...scene,topologyMeshes:{sign:{...row,bakes:[]}}});
  const crop = ink.pickTilesetRectangle(scene,'original',{x:4,y:6,width:26,height:26});
  editor.applyTilesetReskin({object:'sign',face:'left',mode:'crop',selection:{...crop,
    paint:{rotation:90,flipX:true},uvInset:{left:1.5,top:.5,right:2,bottom:1}}});
  const before = editor.eyedropTilesetFace({object:'sign',face:'left'});
  assert(before.canStamp);
  const applied = editor.applyTilesetAssignment(request('large',{ids:['left']}));
  assert(applied.canCommit);
  const after = editor.eyedropTilesetFace({object:'sign',face:'left'});
  assert(after.canStamp);
  assert.deepEqual(after.paint,before.paint);
  assert.deepEqual(after.selection,ink.pickTilesetRectangle(scene,'large',{x:4,y:6,width:26,height:26}));
  for (const edge of ['left','top','right','bottom']) close(before.uvInset[edge],after.uvInset[edge]);
});

test('use the headless preview to inspect a rejected target sheet then publish an approved clamp',t=>{
  const {scene} = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-texel-reassignment-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write = (file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  const read = file=>JSON.parse(fs.readFileSync(path.join(cwd,file),'utf8'));
  const args = [cli,'tileset','assign','assign.json','--scene','sign.json'];
  const run = (...options)=>JSON.parse(execFileSync(process.execPath,args.concat(options),{cwd,encoding:'utf8'}));
  write('sign.json',scene);
  write('assign.json',request('small'));
  const strict = run('--preview','strict');
  assert.equal(strict.canCommit,false);
  assert.equal(strict.preview.nativeAfter,'current');
  assert.equal(strict.preview.destinationTileset,'small');
  assert.deepEqual(strict.preview.destinationSize,[42,30]);
  const image = file=>fs.readFileSync(path.join(cwd,file));
  assert(!image('strict/atlas-before.png').equals(image('strict/atlas-after.png')));
  assert(image('strict/model-before.png').equals(image('strict/model-after.png')));
  const rejected = spawnSync(process.execPath,args.concat('--out','blocked.json'),{cwd,encoding:'utf8'});
  assert.equal(rejected.status,1,rejected.stderr);
  assert(!fs.existsSync(path.join(cwd,'blocked.json')));
  write('assign.json',request('small',{clamp:true}));
  const applied = run('--preview','clamped','--out','approved.json');
  assert(applied.canCommit);
  assert.equal(applied.preview.nativeAfter,'reassigned');
  assert(image('strict/atlas-after.png').equals(image('clamped/atlas-after.png')));
  assert(!image('clamped/model-before.png').equals(image('clamped/model-after.png')));
  assert.deepEqual(read('approved.json').topologyMeshes.sign.document.vertices,scene.topologyMeshes.sign.document.vertices);
});
