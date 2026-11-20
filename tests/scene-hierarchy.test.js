const test=require('node:test'),assert=require('node:assert/strict'),studio=require('..'),kit=studio.load(),{KIT:K}=kit,{sceneGraph:G,M,V,Q}=K;
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<=e,`${a} != ${b}`),vec=(a,b,e=1e-7)=>a.forEach((v,i)=>near(v,b[i],e));
const nodes={base:{transform:{position:[1,0,2],rotation:Q.fromAxisAngle([0,1,0],.6),scale:[2,1,3]},sockets:{grip:{position:[0,2,0],rotation:Q.fromAxisAngle([0,0,1],.4)}}},arm:{parent:{node:'base',socket:'grip'},transform:{position:[1,0,0],scale:[1,2,1]}},leaf:{parent:'arm',transform:{position:[0,1,0]}}};
function fixture(){const B=kit.makeBuilder(2,[0x091824,0x34697b,0xf5c977]);for(const p of [[0,0,0],[1,0,0],[0,1,0]])B.iso(...p,.12,B.P[1],3);const atlas=kit.SpriteSurface.make(8);atlas.face([-.5,0,.3],[1,0,0],[0,1,0],2,2,()=>0xf5c977);return B.finish({spriteSurfaces:atlas.finish()});}
test('nested affine frames, sockets, inverse coordinates and normals share a consistent transform',()=>{
 const g=G.create({nodes}),base=g.frame('base'),socket=G.compose(base,nodes.base.sockets.grip?G.transform(nodes.base.sockets.grip):null),expected=G.compose(G.compose(socket,G.transform(nodes.arm.transform)),G.transform(nodes.leaf.transform));vec(g.frame('leaf').position,expected.position);vec(g.frame('leaf').matrix,expected.matrix);
 const p=[.3,.4,.5];vec(g.toLocal('leaf',g.toWorld('leaf',p)),p);const normal=g.normal('leaf',[0,1,0]),tangent=g.direction('leaf',[1,0,0]);near(V.dot(normal,tangent),0);near(V.len(normal),1);
 const before=g.frame({node:'base',socket:'grip'});g.setSocket('base','grip',{position:[0,3,0]});assert(g.frame({node:'base',socket:'grip'}).version!==before.version);assert(V.dist(g.frame('leaf').position,expected.position)>.5);
});
test('world-preserving reparenting retains affine shear and all child poses',()=>{
 const g=G.create({nodes:{...nodes,other:{transform:{position:[-4,2,1],rotation:Q.fromAxisAngle([1,1,0],.8),scale:[.7,2,1.3]}}}}),before=g.frame('arm'),leaf=g.frame('leaf');g.reparent('arm','other');vec(g.frame('arm').position,before.position);vec(g.frame('arm').matrix,before.matrix);vec(g.frame('leaf').position,leaf.position);g.reparent('arm',null);vec(g.frame('arm').matrix,before.matrix);g.reparent('arm',{node:'base',socket:'grip'});vec(g.frame('arm').position,before.position);g.reparent('arm','other',{keepWorld:false});assert(V.dist(g.frame('arm').position,before.position)>1);
});
test('visibility is inherited without discarding local intent, changes are cached, reset restores hierarchy',()=>{
 const g=G.create({nodes});g.update();assert.deepEqual(g.update().changed,[]);g.setVisible('base',false);assert(!g.frame('leaf').visible);g.setVisible('arm',false);g.setVisible('base',true);assert(!g.frame('leaf').visible);g.setVisible('arm',true);assert(g.frame('leaf').visible);const snap=g.snapshot();snap.nodes.leaf.transform.position[0]=99;assert.equal(g.local('leaf').position[0],0);g.reparent('leaf',null);g.reset();assert.equal(g.node('leaf').parent.node,'arm');assert.equal(G.create(g.snapshot()).size,3);
});
test('invalid cycles, missing sockets, singular transforms and depth budgets fail without partial edits',()=>{
 const g=G.create({nodes}),before=g.snapshot();assert.throws(()=>g.reparent('base','leaf'),/cycle/);assert.deepEqual(g.snapshot(),before);assert.throws(()=>g.reparent('arm',{node:'base',socket:'missing'}));assert.throws(()=>g.setLocal('base',{scale:[1,0,1]}));assert.throws(()=>g.removeSocket('base','grip'),/children/);assert.throws(()=>g.remove('arm'),/children/);assert.throws(()=>g.add('bad',{parent:'missing'}));assert(!g.has('bad'));g.remove('arm',{subtree:true});assert.equal(g.size,1);
 const deep={};for(let i=0;i<130;i++)deep['n'+i]={...(i&&{parent:'n'+(i-1)})};assert.throws(()=>G.create({nodes:deep}),/depth/);
});
test('native bindings move splats, covariances, sprite triangles, lamps and inspection anchors together',()=>{
 const world=fixture(),g=G.create({nodes:{module:{sockets:{tip:{position:[0,1,0]}}}}}),lamp={p:[0,0,0],r:3,s:1,off:false},source={...lamp},binding=G.attach(world,g,{geometry:[{node:'module',indices:[0,1,2]}],sprites:[{node:'module'}],lights:[{node:'module',socket:'tip',light:lamp,source}],sockets:[{node:'module',socket:'tip',name:'tip'}]});
 const covariance=Array.from(world.data.subarray(4,7));g.setLocal('module',{position:[2,1,0],rotation:Q.fromAxisAngle([0,0,1],Math.PI/2),scale:2});world.anim.update(.02,0);vec(Array.from(world.data.subarray(16,19)),[2,3,0],1e-6);near(world.data[4],covariance[0]*4,1e-6);vec(lamp.p,[0,1,0]);assert.equal(lamp.r,6);vec(world.anim.where('tip'),lamp.p);assert(world.spriteSurfaces.geometryRevision>0);vec(Array.from(world.spriteSurfaces.vertices.subarray(0,3)),g.toWorld('module',[-.5,1,.3]),1e-6);vec(K.inspection.anchor({node:'module',socket:'tip'},{world,time:0}).at,lamp.p);
 g.setVisible('module',false);world.anim.update(.02,.02);assert.equal(world.data[3],0);assert(lamp.off);assert.equal(K.inspection.anchor({node:'module'},{world,time:0}),null);const vertices=world.spriteSurfaces.vertices;vec(Array.from(vertices.subarray(0,3)),Array.from(vertices.subarray(5,8)));g.setVisible('module',true);world.anim.update(.02,.04);assert.equal(world.data[3],3);assert(!lamp.off);
 binding.dispose();vec(Array.from(world.data.subarray(0,3)),[0,0,0]);assert.equal(world.data[3],3);assert.equal(world.sceneGraph,undefined);assert.equal(world.anim.rig,undefined);
});
test('visibility runs after painters and restores changing author opacity instead of reviving hidden content',()=>{
 const world=fixture(),g=G.create({nodes:{a:{}}}),binding=G.attach(world,g,{geometry:[{node:'a',indices:[0,1]}]});world.anim.add({paint(i,rgba){rgba[3]*=.4;},update(){world.anim.repaint(0);}});g.setVisible('a',false);for(let i=0;i<4;i++){world.anim.update(.02,i*.02);assert.equal(world.data[3],0);}g.setVisible('a',true);world.anim.update(.02,.1);near(world.data[3],1.2,1e-6);world.anim.physicsOwned=new Uint8Array(world.count);world.anim.physicsOwned[0]=1;g.setVisible('a',false);world.anim.update(.02,.2);assert(world.data[3]>0);assert.equal(world.data[19],0);binding.dispose();
});
test('static graphs do not dirty sprite geometry repeatedly and removed nodes hide their bindings',()=>{
 const world=fixture(),g=G.create({nodes:{a:{}}});G.attach(world,g,{geometry:[{node:'a',indices:[0]}],sprites:[{node:'a'}]});world.anim.update(.02,0);const revision=world.spriteSurfaces.geometryRevision;world.anim.update(.02,.02);assert.equal(world.spriteSurfaces.geometryRevision,revision);g.remove('a');world.anim.update(.02,.04);assert.equal(world.data[3],0);g.reset();world.anim.update(.02,.06);assert.equal(world.data[3],3);
});
test('existing rigs import at their joints, retain current poses and support additional static groups',()=>{
 const world=fixture(),st=K.stage(world),rig=K.rig.fromGroups(st,{arm:[0,1]});rig.set('arm',M.rot([0,0,1],.4),[0,0,0],[1,0,0]);rig.apply();const before=Array.from(world.data.subarray(16,19)),imported=G.fromRig(rig,{parts:{arm:{joint:[0,1,0]}}});imported.graph.add('static');const binding=G.attach(world,imported.graph,{geometry:[...imported.geometry,{node:'static',indices:[2]}]});vec(Array.from(world.data.subarray(16,19)),before,1e-6);imported.graph.setWorld('arm',{position:[3,2,0]});binding.apply();vec(imported.graph.frame('arm').position,[3,2,0]);assert.equal(st.rig,rig);binding.dispose();vec(Array.from(world.data.subarray(16,19)),before,1e-6);assert.equal(rig.bid[2],0);
});
test('prefab instances and native parts can be imported as a live pose snapshot',()=>{
 const spec={id:'hierarchy-prefab',prefabs:{module:{revision:1,solids:{sign:{kind:'box',at:[0,1,0],half:[.4,.3,.1],mat:'stone',res:.12}}}},instances:{left:{prefab:'module',transform:{translation:[-2,0,0]}},right:{prefab:'module',transform:{translation:[2,0,0]}}}},world=K.diorama.build(spec),imported=G.fromDiorama(world);assert(imported.graph.has('prefab.left'));assert(imported.geometry.length>=2);const binding=G.attach(world,imported.graph,{geometry:imported.geometry}),ids=imported.geometry.find(row=>row.node==='geometry.left.sign').indices,initial=world.data[ids[0]*16];imported.graph.setLocal('prefab.left',{position:[-1,0,0]});binding.apply();near(world.data[ids[0]*16],initial+1,1e-6);binding.dispose();
});

test('hierarchy camera targets, custom adapters and duplicate ownership share validation',()=>{
 const world=fixture(),g=G.create({nodes:{a:{transform:{position:[1,2,0]},sockets:{view:{position:[0,.5,0]}}}}});let last,restored=false;
 assert.throws(()=>G.attach(world,g,{geometry:[{node:'a',indices:[0,0]}]}),/overlapping/);
 const binding=G.attach(world,g,{adapters:[{node:'a',apply:f=>last=f,restore:()=>restored=true}]});assert.deepEqual(last.position,[1,2,0]);
 const program=K.cameraRig.compile({targets:{subject:{node:'a',socket:'view',offset:[0,.2,0]}},shots:{front:{target:'subject',dist:6}}});world.cam={target:[0,0,0],dist:8,yaw:0,pitch:0};const camera=K.cameraRig.bind(world,program);vec(world.cameraRig.sample(0).camera.target,[1,2.7,0]);g.setLocal('a',{position:[2,2,0]});binding.apply();vec(last.position,[2,2,0]);binding.dispose();assert(restored);
});

test('live sprite geometry updates stream only changed vertices without uploading the texture',async()=>{
 const {createSurfacePipeline}=await import('../src/webgl/surfaces.mjs'),calls=[],constants=new Map();let serial=1;const target={getProgramParameter(p,k){return k===gl.LINK_STATUS?true:0;},getShaderParameter:()=>true,getParameter:()=>8192},gl=new Proxy(target,{get(o,k){if(k in o)return o[k];if(/^[A-Z_0-9]+$/.test(k)){if(!constants.has(k))constants.set(k,serial++);return constants.get(k);}return(...args)=>{calls.push({method:k,args});return k.startsWith('create')?{}:undefined;};}}),pipeline=createSurfacePipeline(gl,{geometryUpdatesSince:kit.SpriteSurface.geometryUpdatesSince}),atlas={width:4,height:4,pixels:new Uint8Array(64),vertices:new Float32Array(60)},frame={view:[],projection:[],range:[0,10,1,0],fog:[0,0,0]};
 pipeline.draw(atlas,frame);atlas.vertices[30]=2;kit.SpriteSurface.markGeometryDirty(atlas,{first:6,count:3});pipeline.draw(atlas,frame);assert.equal(pipeline.stats.geometryBytes,60);assert.equal(pipeline.stats.textureBytes,0);assert.equal(calls.filter(c=>c.method==='bufferData').length,1);assert.equal(calls.filter(c=>c.method==='bufferSubData').at(-1).args[1],120);pipeline.dispose();
});

test('repeated bind/dispose removes stage callbacks and keeps runtime rig ownership bounded',()=>{
 const world=fixture(),stage=K.stage(world),rig=K.rig.fromGroups(stage,{existing:[2]}),g=G.create({nodes:{a:{}}});const count=stage.systems.length;
 for(let i=0;i<4;i++){const binding=G.attach(world,g,{geometry:[{node:'a',indices:[0,1]}]});g.setLocal('a',{position:[i,0,0]});binding.apply();binding.dispose();assert.equal(stage.systems.length,count);assert.equal(rig.bid[0],0);}assert(rig.names.length<5);
});
test('point-light intensity and child visibility follow the same inherited branch',()=>{
 const world=fixture(),graph=G.create({nodes:{root:{},bulb:{parent:'root'},card:{parent:'root'}}}),light={p:[0,0,0],radius:2,intensity:3,color:[1,1,1]},source={...light};const binding=G.attach(world,graph,{sprites:[{node:'card'}],lights:[{node:'bulb',light,source}]});graph.setVisible('bulb',false);binding.apply();assert.equal(light.intensity,0);graph.setVisible('root',false);binding.apply();source.intensity=5;graph.setVisible('root',true);binding.apply();assert.equal(light.intensity,0);graph.setVisible('bulb',true);binding.apply();assert.equal(light.intensity,5);binding.dispose();assert.equal(light.intensity,3);
});
test('bindings keep claimed rig transforms authoritative until disposal',()=>{
 const world=fixture(),stage=K.stage(world),rig=K.rig.fromGroups(stage,{part:[0,1]}),graph=G.create({nodes:{a:{}}}),binding=G.attach(world,graph,{geometry:[{node:'a',part:'part'}]});graph.setLocal('a',{position:[2,0,0]});binding.apply();rig.set('part',M.id(),[0,0,0],[9,0,0]);rig.apply();binding.apply();near(world.data[0],2);binding.dispose();
});
test('hierarchy CLI round-trips definitions and preserves world pose on reparent',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-hierarchy-'));try{const file=path.join(dir,'graph.json');fs.writeFileSync(file,JSON.stringify({nodes}));const report=JSON.parse(cp.execFileSync(process.execPath,['cli/ink-studio.js','hierarchy',file,'--node','leaf','--parent','world','--point','0,0,0'],{cwd:path.resolve(__dirname,'..')}));assert.equal(report.node.parent,null);vec(report.point,G.create({nodes}).frame('leaf').position);assert.deepEqual(G.create(report.definition).frame('leaf').position,report.point);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('adapter exceptions restore ownership and allow another binding',()=>{
 const world=fixture(),g=G.create({nodes:{a:{}}});assert.throws(()=>G.attach(world,g,{geometry:[{node:'a',indices:[0]}],adapters:[{node:'a',apply(){throw Error('broken adapter');}}]}),/broken adapter/);assert.equal(world.sceneGraph,undefined);assert.equal(world.anim.systems.length,0);
 const binding=G.attach(world,g,{adapters:[{node:'a',apply(){},restore(){throw Error('restore failure');}}]});assert.throws(()=>binding.dispose(),/restoration failed/);assert(binding.disposed);assert.equal(world.sceneGraph,undefined);assert.equal(world.anim.systems.length,0);G.attach(world,g).dispose();
});
test('camera hierarchy selectors accept the same qualified IDs as scene nodes',()=>{
 const id='prefab:lantern',world=fixture(),graph=G.create({nodes:{[id]:{transform:{position:[1,2,3]}}}});G.attach(world,graph);world.cam={target:[0,0,0],dist:8,yaw:0,pitch:0};K.cameraRig.bind(world,K.cameraRig.compile({targets:{subject:{node:id}},shots:{view:{target:'subject',dist:5}}}));vec(world.cameraRig.sample(0).camera.target,[1,2,3]);
});

test('nested small scales retain invertible point and normal queries',()=>{
 const g=G.create({nodes:{a:{transform:{scale:.001}},b:{parent:'a',transform:{scale:.001}},c:{parent:'b',transform:{scale:.001}}}});vec(g.toLocal('c',g.toWorld('c',[1,2,3])),[1,2,3]);vec(g.normal('c',[0,1,0]),[0,1,0]);
});
