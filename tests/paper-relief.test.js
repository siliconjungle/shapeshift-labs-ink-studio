const test=require('node:test'),assert=require('node:assert/strict'),core=require('..'),kit=core.load(),K=kit.KIT,P=K.paper;
const rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]],near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
function cards(){return P.stack([{id:'back',profile:rect(-1,-1,1,1),depth:0,color:'#28657b'},{id:'frame',rings:[rect(-1,-1,1,1),rect(-.35,-.35,.35,.35)],depth:.4,color:'#e6b875'}],{thickness:.06});}
test('paper sheets keep real holes, physical edge walls and canonical winding',()=>{
 const p=cards(),r=p.layers[1];assert.equal(r.triangles.length,8);assert(Object.isFrozen(r.rings[0][0]));
 let area=0;for(const t of r.triangles){const[a,b,c]=t.map(i=>r.points[i]);area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}near(area,4-.7*.7);
 const center=P.raycast(p,[0,0,2],[0,0,-1]);assert.equal(center.layer,'back');near(center.point[2],.03);
 const edge=P.raycast(p,[.7,0,2],[0,0,-1]);assert.equal(edge.layer,'frame');near(edge.distance,1.57);
 const wall=P.raycast(p,[0,0,.4],[1,0,0]);assert.equal(wall.layer,'frame');assert.equal(wall.part,'edge');near(wall.distance,.35);assert(wall.normal[0]<-.99);
});
test('rotated sheets provide consistent world queries and an exact union SDF',()=>{
 const p=P.stack([{id:'turn',profile:rect(-1,-1,1,1),position:[2,0,0],rotation:[0,Math.PI/2,0],thickness:.1}]);
 const hit=P.raycast(p,[4,0,0],[-1,0,0]);near(hit.point[0],2.05);near(hit.normal[0],1);
 const sdf=P.sdf(p);near(sdf(2,0,0),-.05);near(sdf(2.2,0,0),.15);
 const q=cards(),d=P.sdf(q);assert(d(0,0,.4)>0);assert(d(.7,0,.4)<0);
 assert.deepEqual(P.raycast(JSON.parse(JSON.stringify(q)),[.7,0,2],[0,0,-1]),P.raycast(q,[.7,0,2],[0,0,-1]));
});
test('field cutouts preserve holes and scalar relief makes increasing depth bands',()=>{
 const field=(x,y)=>Math.max(Math.hypot(x,y)-.9,.35-Math.hypot(x,y));
 const rings=P.cut(field,{bounds:{min:[-1,-1],max:[1,1]},cell:.08});assert.equal(rings.length,2);
 const p=P.stack([{rings}]);assert.equal(P.raycast(p,[0,0,1],[0,0,-1]),null);
 const relief=P.relief((x,y)=>1-x*x-y*y,{bounds:{min:[-1.2,-1.2],max:[1.2,1.2]},levels:[.2,.5,.8],cell:.1,gap:.15});
 assert.equal(relief.layers.length,3);near(relief.layers[2].depth,.3);assert(relief.layers[2].points.length<relief.layers[0].points.length);
 let calls=0;assert.throws(()=>P.relief(()=>{calls++;return 0;},{bounds:{min:[-1,-1],max:[1,1]},levels:[0,1],cell:.001,maxCells:10}),/budget/);assert.equal(calls,0);
});
test('baked shadows respect cutouts, thickness, receiver depth and disabled work budgets',()=>{
 const p=P.stack([{id:'receiver',profile:rect(-1,-1,1,1),depth:0},{id:'caster',rings:[rect(-.6,-.6,.6,.6),rect(-.2,-.2,.2,.2)],depth:.3}],{thickness:.04});
 const maps=P.shadows(p,{light:[0,0,1],softness:0,samples:1,texel:.1,maxWork:100000}),back=maps.layers[0],front=maps.layers[1];
 const at=(m,x,y)=>m.coverage[Math.floor((m.bounds.max[1]-y)/(m.bounds.max[1]-m.bounds.min[1])*m.height)*m.width+Math.floor((x-m.bounds.min[0])/(m.bounds.max[0]-m.bounds.min[0])*m.width)];
 assert.equal(at(back,0,0),0);assert.equal(at(back,.4,0),255);assert.equal(at(back,.9,0),0);assert(front.coverage.every(x=>x===0));
 const soft=P.shadows(p,{light:[.2,.1,1],softness:.15,samples:8,texel:.04,maxWork:1000000});assert(soft.layers[0].coverage.some(x=>x>0&&x<255));
 assert.throws(()=>P.shadows(p,{maxPixels:1}),/pixel budget/);assert.throws(()=>P.shadows(p,{maxWork:1}),/work budget/);
 const disabled=P.shadows(p,{enabled:false,maxWork:1});assert.equal(disabled.stats.work,0);assert(disabled.layers.every(m=>m.coverage.every(x=>x===0)));
});
test('bad profiles, duplicate identities and work budgets reject explicitly',()=>{
 assert.throws(()=>P.stack([{id:'same',profile:rect(0,0,1,1)},{id:'same',profile:rect(0,0,1,1)}]),/unique/);
 assert.throws(()=>P.stack([{profile:[[0,0],[1,1],[0,1],[1,0]]}]),/ring|constraint/);
 assert.throws(()=>P.stack([{profile:rect(0,0,1,1)}],{maxVertices:3}),/budget/);
 assert.throws(()=>P.stack([{profile:rect(0,0,1,1),thickness:-1}]));
 const B=kit.makeBuilder(1);assert.throws(()=>P.draw(B,cards(),{maxPixels:1}));assert.equal(B.count(),0);
 assert.throws(()=>P.draw(B,cards(),{paint:'native',maxMarks:1}));assert.equal(B.count(),0);
 assert.throws(()=>P.draw(B,cards(),{texture:{grain:NaN}}));assert.equal(B.count(),0);
});
function fixture(kit,paint='atlas'){
 const K=kit.KIT,rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d]],p=K.paper.stack([{id:'blue',profile:rect(-1,-1,1,1),depth:0,color:'#28657b'},{id:'orange',rings:[rect(-1,-1,1,1),rect(-.35,-.35,.35,.35)],depth:.4,color:'#e6b875'}],{thickness:.06});
 return K.paper.world(p,{background:'#0c1c28',camera:{target:[0,0,.2],dist:4.8,yaw:.18,pitch:.12},draw:{paint,texture:false,shadowSamples:3,texel:.035,shadowStep:.2}});
}
test('hybrid and native authoring keep splat metadata, plane depth and software visibility',()=>{
 const world=fixture(kit),native=fixture(kit,'native');assert(world.spriteSurfaces.vertices.length>0);assert(native.count>world.count);assert(world.splatFootprints.styles.some(s=>s.depth==='plane'));assert(world.renderMetadata.objects.includes('paper'));
 const a=require('../cli/render').render(world,{w:120,h:100,px:1,raw:true}).rgb;assert(a.some((v,i)=>v!==[12,28,40][i%3]));
 const thin=P.stack([{profile:rect(-1,-1,1,1),thickness:0}]);assert.equal(P.world(thin,{draw:{shadowSamples:1}}).count,0);
});
test('hardware paper has matching holes and remains stable when orbiting',{skip:!process.env.INK_TEST_CHROME},()=>{
 const result=require('../cli/look-webgl')({chrome:process.env.INK_TEST_CHROME,hardware:true},fixture,(kit,build,backend)=>{
   const w=build(kit),b=backend(120,100,{raw:true,damp:false});b.draw(w);const holeCenter=b.sample({center:[60,50]}).center,a=b.image();b.draw(w,{camera:{...w.cam,yaw:.75,pitch:.3}});const c=b.image();const thin=kit.KIT.paper.world(kit.KIT.paper.stack([{profile:[[-1,-1],[1,-1],[1,1],[-1,1]],thickness:0,color:'#ffcc88'}]),{camera:{dist:4},draw:{shadowSamples:1,texture:false}});b.draw(thin);const d=b.image(),thinCenter=b.sample({center:[60,50]}).center;b.close();return {a,c,d,holeCenter,thinCenter};
 });assert.notEqual(result.a,result.c);assert.notEqual(result.a,result.d);assert(result.holeCenter[2]>result.holeCenter[0]);assert(result.thinCenter[0]>result.thinCenter[1]&&result.thinCenter[1]>result.thinCenter[2]);
});
