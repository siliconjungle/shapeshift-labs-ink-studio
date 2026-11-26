'use strict';

const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const ink = require('..'), T = ink.load().KIT.meshTopology, UV = T.uv;
const cli = path.join(__dirname, '../cli/ink-studio.js');
const snapshot = {width:200,height:100,focal:100,ortho:false,clipNear:.5,clipFar:10,
  view:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
const project = (fields={})=>({op:'project-camera',ids:['panel'],...fields});
const approx = (actual,expected)=>actual.forEach((n,i)=>assert(Math.abs(n-expected[i])<1e-8,JSON.stringify({actual,expected})));

function fixture() {
  const vertices = [[-1,-1,-2],[1,-1,-4],[1,1,-4],[-1,1,-2],[2,-1,-4],[2,1,-4]]
    .map((position,i)=>({id:'v'+i,position}));
  const face = (id,ids,uvs)=>({id,material:'paint',corners:ids.map((n,i)=>({
    id:id+'/'+i,vertex:'v'+n,uv:uvs[i],attributes:{'uv/1':uvs[i]}
  }))});
  return T.create({id:'test-panel',uvBindings:{normal:1},vertices,faces:[
    face('panel',[0,1,2,3],[[.12,.42],[.37,.42],[.37,.20],[.12,.20]]),
    face('end',[1,4,5,2],[[.37,.42],[.49,.42],[.49,.20],[.37,.20]])
  ]});
}

test('map native raster corners with the correct depth, active UV layout, inset rectangle and seams',()=>{
  const doc = fixture(), selection = UV.select(doc,{domain:'faces',ids:['panel'],uvSet:'normal'});
  const request = {uvSet:'normal',operations:[project({ids:undefined,selection,rect:[.25,.25,.5,.5]})]};
  const plan = UV.plan(doc,request,{camera:snapshot});
  assert(plan.report.canCommit);
  const {evidence} = plan.report.operations[0], [near,far] = evidence.corners;
  assert.deepEqual(evidence.camera,snapshot);
  assert.deepEqual([near.pixel,far.pixel],[[50,100],[125,75]]);
  assert.deepEqual([near.depth,far.depth],[2,4]);
  assert.deepEqual([near.uv,far.uv],[[.375,.75],[.5625,.625]]);
  assert.equal(evidence.edgeChanges[0].before,'continuous');
  assert.equal(evidence.edgeChanges[0].after,'seam');
  assert.deepEqual(plan.report.seams,[]);
  assert.deepEqual(plan.document.vertices,doc.vertices);
  assert.deepEqual(plan.document.faces[1],doc.faces[1]);
  assert.deepEqual(plan.document.faces[0].corners.map(c=>c.uv),doc.faces[0].corners.map(c=>c.uv));
  assert.deepEqual(plan.document.faces[0].corners.map(c=>c.attributes['uv/1']),evidence.corners.map(c=>c.uv));
  assert.deepEqual(T.edit(doc,plan.patch),plan.document);
  assert.throws(()=>UV.plan(plan.document,request,{camera:snapshot}),/mesh revision/);
  const planOrtho = UV.plan(doc,request,{camera:{...snapshot,focal:50,ortho:true}});
  const [orthoNear,orthoFar] = planOrtho.report.operations[0].evidence.corners;
  assert(planOrtho.report.canCommit);
  assert.deepEqual([orthoNear.pixel,orthoFar.pixel],[[50,100],[150,100]]);
  assert.deepEqual([orthoNear.uv,orthoFar.uv],[[.375,.75],[.625,.75]]);
});

test('reject clipped, offscreen, collapsed and protected projections atomically',()=>{
  const doc = fixture(), request = {operations:[project()]};
  const attempt = (camera,code,source=doc,projectionPositions)=>{
    const result = UV.plan(source,request,{camera,projectionPositions});
    assert.equal(result.report.canCommit,false);
    assert.deepEqual(result.patch,{});
    assert.equal(result.document,source);
    assert(result.report.operations[0].conflicts.some(row=>row.code===code));
    return result.report.operations[0].evidence.corners;
  };
  const clipped = attempt({...snapshot,clipNear:2.5},'camera-depth-clip');
  assert.equal(clipped[0].pixel,null);
  assert.equal(clipped[0].depth,2);
  const offscreen = attempt({...snapshot,focal:120},'outside-camera-frame');
  assert.deepEqual(offscreen[0].pixel,[40,110]);
  const edgeOn = new Map(doc.vertices.map(({id,position:[,y,z]})=>[id,[0,y,z]]));
  attempt(snapshot,'collapsed-uv-triangle',doc,edgeOn);
  const pinned = UV.plan(doc,{operations:[{op:'pin',ids:['panel/0'],pinned:true}]}).document;
  assert(attempt(snapshot,'pinned-corner',pinned).every(row=>row.status==='projected'));
  const preflight = UV.plan(doc,{operations:[{op:'pin',ids:['panel/0'],pinned:true},project()]},{camera:snapshot});
  assert.equal(preflight.report.canCommit,false);
  assert.deepEqual(preflight.patch,{});
  assert.throws(()=>UV.plan(doc,request),/approved native raster camera/);
  assert.throws(()=>UV.plan(doc,request,{camera:{...snapshot,view:Array(16).fill(0)}}),/approved native raster camera/);
});

test('use the SDK camera sample with scene transactions and undo',()=>{
  const doc = fixture(), scene = {id:'panels',solids:[],topologyMeshes:{panel:{document:doc,
    bakes:[{id:'paint-bake',material:'paint',maps:{roughness:.5}}]}}};
  const editor = ink.createSceneEditor(scene), original = editor.snapshot();
  const request = {revision:T.revision(doc),operations:[project()]};
  const projectionPositions = new Map(doc.vertices.map(({id,position:[x,y,z]})=>[id,[x+.25,y,z]]));
  const options = {camera:snapshot,projectionPositions};
  const plan = editor.planMeshUV('panel',request,options);
  assert.deepEqual(plan.report.operations[0].evidence.corners[0].pixel,[62.5,100]);
  const commit = editor.editMeshUV('panel',request,options);
  assert.deepEqual(commit.uv,plan.report);
  assert.deepEqual(editor.meshTopology('panel').document,plan.document);
  assert.deepEqual(editor.meshTopology('panel').bakes[0].invalidated,{faces:['panel']});
  assert(editor.undo());
  assert.deepEqual(editor.snapshot(),original);
  assert(editor.redo());
  assert.deepEqual(editor.meshTopology('panel').document,plan.document);
});

test('project both explicitly approved camera rig shots through the CLI',t=>{
  const doc = fixture(), cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-camera-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write = (file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  const read = file=>JSON.parse(fs.readFileSync(path.join(cwd,file),'utf8'));
  const invoke = args=>[cli,'mesh-uv','edit','scene.json','edit.json','--object','panel',...args];
  const run = (...args)=>JSON.parse(execFileSync(process.execPath,invoke(args),{cwd,encoding:'utf8'}));
  const shot = {target:[0,0,-3],eye:[0,0,2],fov:.70};
  write('scene.json',{id:'posed-panel',style:'slate',solids:[],cameraRig:{duration:2,shots:{
    ortho:{...shot,projection:'orthographic'},
    perspective:{...shot,projection:'perspective'}
  }},topologyMeshes:{panel:{document:doc}}});
  write('edit.json',{revision:T.revision(doc),operations:[project()]});
  const missing = spawnSync(process.execPath,invoke([]),{cwd,encoding:'utf8'});
  assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/approved --view/);
  const rows = [];
  for (const id of ['ortho','perspective']) {
    write(id+'.json',{w:160,h:120,cameraShot:id,t:.5,cameraTime:.75});
    const args = ['--view',id+'.json'];
    const preview = run(...args,'--preview',id+'-review');
    assert(preview.canCommit);
    assert(fs.existsSync(path.join(cwd,id+'-review/comparison.png')));
    const commit = run(...args,'--out',id+'-edited.json','--report',id+'-receipt.json');
    assert.deepEqual(commit.operations,preview.operations);
    assert.deepEqual(commit.operations,read(id+'-receipt.json').operations);
    const {camera,corners,sample} = commit.operations[0].evidence;
    assert.equal(camera.ortho,id==='ortho');
    assert.equal(sample.shot,id);
    assert.equal(sample.poseTime,.5);
    assert.equal(sample.cameraTime,.75);
    assert.deepEqual(corners.map(row=>row.depth),[4,6,6,4]);
    for (const row of corners) {
      const magnification = camera.focal / (camera.ortho ? 1 : row.depth);
      approx(row.pixel,[80+row.position[0]*magnification,60-row.position[1]*magnification]);
    }
    rows.push(corners.map(row=>row.pixel));
    assert.deepEqual(read(id+'-edited.json').topologyMeshes.panel.document.faces[0].corners.map(c=>c.uv),
      corners.map(row=>row.uv));
  }
  assert.deepEqual(rows[0][0][1],rows[0][1][1]);
  assert(rows[1][0][1]>rows[1][1][1]);
});

test('allow an explicit camera on a standalone mesh and block file output when it clips',t=>{
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'ink-uv-camera-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const write = (file,value)=>fs.writeFileSync(path.join(cwd,file),JSON.stringify(value));
  write('panel.json',fixture());
  write('request.json',{operations:[project()]});
  const w = 200, h = 100, camera = {target:[0,0,-3],yaw:0,pitch:0,dist:4,projection:'orthographic'};
  const run = (...args)=>spawnSync(process.execPath,[cli,'mesh-uv','edit','panel.json','request.json','--view','view.json',...args],
    {cwd,encoding:'utf8'});
  write('view.json',{w,h,camera});
  const valid = run('--out','projected.json');
  assert.equal(valid.status,0,valid.stderr);
  assert.equal(JSON.parse(valid.stdout).operations[0].evidence.camera.ortho,true);
  assert(fs.existsSync(path.join(cwd,'projected.json')));
  write('view.json',{w,h,camera:{...camera,fov:.19}});
  const blocked = run('--out','blocked.json','--report','blocked-receipt.json');
  assert.equal(blocked.status,1);
  assert(!fs.existsSync(path.join(cwd,'blocked.json')));
  const receipt = JSON.parse(fs.readFileSync(path.join(cwd,'blocked-receipt.json'),'utf8'));
  assert.equal(receipt.canCommit,false);
  assert(receipt.operations[0].conflicts.some(row=>row.code==='outside-camera-frame'));
});
