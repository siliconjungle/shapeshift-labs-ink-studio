const test=require('node:test'),assert=require('node:assert/strict'),core=require('..'),kit=core.load(),K=kit.KIT,F=K.facets;
const cube={min:[-1.3,-1.3,-1.3],max:[1.3,1.3,1.3]},sphere=(x,y,z)=>Math.hypot(x,y,z)-1;
const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
function edges(plan){const counts=new Map();for(const f of plan.facets)for(let k=0;k<3;k++){const a=f.indices[k],b=f.indices[(k+1)%3],key=a<b?a+'/'+b:b+'/'+a;counts.set(key,(counts.get(key)||0)+1);}return [...counts.values()];}
test('SDF reconstruction has connected outward flat facets and size controls real geometry',()=>{
 const a=F.fromSdf(sphere,{bounds:cube,size:.45}),b=F.fromSdf(sphere,{bounds:cube,size:.22});
 assert(b.facets.length>a.facets.length*2);assert(edges(a).every(n=>n===2));
 for(const f of a.facets){const [p,q,r]=f.indices.map(i=>a.vertices[i]);near(K.V.dot(f.normal,K.V.sub(q,p)),0);near(K.V.dot(f.normal,K.V.sub(r,p)),0);assert(K.V.dot(f.normal,f.center)>.85);}
 assert(Object.isFrozen(a.facets[0].normal));assert.deepEqual(a,F.fromSdf(sphere,{bounds:cube,size:.45}));
 const serialized=JSON.parse(JSON.stringify(a));assert.deepEqual(F.appearance(serialized),F.appearance(a));
});
test('oriented and anisotropic sampling grids change patch layout without rotating the authored object',()=>{
 const field=(x,y,z)=>Math.hypot((x-2)/1.2,(y-1)/.8,z/.6)-1,bounds={min:[.6,0,-.8],max:[3.4,2,.8]};
 const a=F.fromSdf(field,{bounds,size:.3}),b=F.fromSdf(field,{bounds,size:[.25,.4,.2],orientation:[.2,.35,.1]});
 assert.notDeepEqual(a.vertices,b.vertices);for(const p of b.vertices)assert(Math.abs(field(...p))<.2);
 near((b.bounds.min[0]+b.bounds.max[0])/2,2,.1);assert(edges(b).every(n=>n===2));
});
test('dual contouring preserves sharp cuboid planes rather than only changing surface color',()=>{
 const S=kit.makeSculpt(kit.makeBuilder(1)),box=S.box([0,0,0],[.8,.7,.6],null,{hold:true}),p=F.fromSdf(box,{bounds:cube,size:.3});
 for(const v of p.vertices)assert(v.every((n,i)=>Math.abs(n)<[.8,.7,.6][i]+1e-4));
 for(const f of p.facets)assert(Math.max(...f.normal.map(Math.abs))>.9999);
 assert(edges(p).every(n=>n===2));
});
test('color groups are deterministic, configurable per object and validate before drawing',()=>{
 const p=F.fromSdf(sphere,{bounds:cube,size:.4}),a=F.appearance(p,{grouping:'spatial',groupSize:1,seed:9}),b=F.appearance(p,{grouping:'spatial',groupSize:1,seed:9});
 assert.deepEqual(a,b);assert(a.groups.length<p.facets.length);
 const flat=F.appearance(p,{color:'#f0c080',ambient:1,variation:0});assert(flat.rows.every(r=>r.color.join('/')==='240/192/128'));
 const B=kit.makeBuilder(1);let calls=0;assert.throws(()=>F.draw(B,p,{color:()=>++calls>3?[NaN,0,0]:'#ffffff'}));assert.equal(B.count(),0);
 assert.throws(()=>F.draw(B,p,{grouping:()=>({bad:1})}));assert.equal(B.count(),0);
});
test('budgets reject before field work, invalid inputs fail and empty fields remain empty',()=>{
 let calls=0;assert.throws(()=>F.fromSdf(()=>{calls++;return 1;},{bounds:cube,size:.01,maxCells:10}),/budget/);assert.equal(calls,0);
 for(const options of [{size:0},{size:[.01,1,1]},{orientation:[NaN,0,0]},{maxSamples:2}])assert.throws(()=>F.fromSdf(sphere,{bounds:cube,...options}));
 assert.throws(()=>F.fromSdf(()=>NaN,{bounds:cube}));assert.throws(()=>F.fromSdf(sphere,{bounds:cube,maxFacets:1}),/budget/);
 const p=F.fromSdf(()=>1,{bounds:cube});assert.equal(p.facets.length,0);assert.equal(p.bounds,null);
 assert.throws(()=>F.fromMesh({points:[[0,0,0],[1,0,0],[0,1,0]],faces:[[0,1,99]]}),/index/);
 assert.throws(()=>F.fromMesh({positions:Float32Array.from([0,0,0,1,1,1])}),/triples/);
});
function fixture(kit){
 const K=kit.KIT,B=kit.makeBuilder(1,[0x101725,0xd9b279]),S=kit.makeSculpt(B),solid=S.box([0,0,0],[.8,.7,.55],null,{hold:true,rd:.14});
 const p=K.facets.fromSdf(solid,{bounds:{min:[-1,-1,-1],max:[1,1,1]},size:.35}),batch=K.facets.draw(B,p,{palette:['#c3896a','#93677d'],object:'housing',variation:0});
 return {world:B.finish({cam:{target:[0,0,0],dist:4.6,yaw:.35,pitch:.2},radius:10,dither:0,fog:{c:0,start:1,max:0},look:{pixelSize:1,clean:1,splatCoverage:'continuous'}}),batch};
}
test('native triangles have exact footprints, flat normals, provenance and software depth',()=>{
 const {world:w,batch}=fixture(kit);assert.equal(w.count,batch.ids.length);assert.equal(w.splatFootprints.styles.length,1);assert.equal(w.splatFootprints.styles[0].depth,'plane');assert(w.renderMetadata.objects.includes('housing'));
 const rgb=require('../cli/render').render(w,{w:100,h:100,px:1,raw:true}).rgb;assert(rgb.some((v,i)=>v!==[16,23,37][i%3]));
 const p=F.fromMesh({points:[[0,0,0],[1,0,0],[0,1,0],[0,0,0]],faces:[[0,0,0],[0,1,2]]});assert.equal(p.facets[0].id,'1');assert.equal(F.appearance(p).rows[0].facet?.id??F.appearance(p).rows[0].id,'1');
});
test('scene graph exposes faceted SDF plans, meshes and optional native representation',()=>{
 const A=K.procedural.sceneGraph,source=A.shape('box',{half:[.7,.8,.5],round:.1}),f=A.facetedSDF(source,{size:.3});
 assert.equal(f.value.format,'ink-studio/faceted-surface');assert(f.mesh.tri.length>0);
 const w=A.world([A.object(f.mesh,{id:'tooling',facets:true})]);assert.equal(w.count,f.value.facets.length);assert(w.splatFootprints);
 const normal=A.object(f.mesh);assert.equal(normal.facets,undefined);
 const op=A.operations['sdf.facets'].run({source,options:{size:.3}},{time:0});assert.equal(op.value.facets.length,f.value.facets.length);
});
test('hardware patches retain crisp silhouettes while orbiting and following a bone',{skip:!process.env.INK_TEST_CHROME},()=>{
 const result=require('../cli/look-webgl')({chrome:process.env.INK_TEST_CHROME,hardware:true},fixture,(kit,build,backend)=>{
   const {world:w,batch}=build(kit),K=kit.KIT,b=backend(120,100,{raw:true,damp:false});b.draw(w);const a=b.image();b.draw(w,{camera:{...w.cam,yaw:1.2,pitch:.45}});const c=b.image();
   const matrices=new Float32Array(12),rig=K.bones.bind(w,{ids:batch.ids,bid:new Float32Array(batch.ids.length),M:matrices,pose(t){matrices.set([...K.M.rot([0,1,0],t),0,0,0]);}});rig.update(.7,.7);b.draw(w,{changedRows:Array.from({length:Math.ceil(w.count/512)},(_,i)=>i)});const d=b.image();b.close();return {a,c,d};
 });assert.notEqual(result.a,result.c);assert.notEqual(result.a,result.d);
});
