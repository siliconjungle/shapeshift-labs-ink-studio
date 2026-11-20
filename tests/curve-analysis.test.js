const test=require('node:test'),assert=require('node:assert/strict'),core=require('..'),{KIT:K}=core.load(),C=K.curve,V=K.V,Q=K.Q;
const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<=e,`${a} != ${b}`),vec=(a,b,e=1e-6)=>a.forEach((v,i)=>near(v,b[i],e));
const dot=V.dot;
function brute(path,point){let best={distance:Infinity};let along=0;for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],v=V.sub(b,a),length=V.len(v),f=Math.max(0,Math.min(1,dot(V.sub(point,a),v)/(length*length))),p=V.mad(a,v,f),distance=V.dist(point,p);if(distance<best.distance)best={p,distance,along:along+f*length};along+=length;}return best;}
test('cached closest queries match exhaustive segment projection, including crossings and endpoints',()=>{
 for(const path of [C.path([[0,0,0],[3,0,0],[3,2,0]]),C.create({type:'torusKnot'}),C.create({type:'flower',adaptive:{tolerance:.003}})]){
 for(let i=0;i<40;i++){const p=[Math.sin(i*1.7)*4,Math.cos(i*.7)*2,Math.sin(i*.3)*3],a=path.closest(p),b=brute(path,p);near(a.distance,b.distance,1e-10);near(a.along,b.along,1e-9);vec(a.p,path.at(a.along).p,1e-9);near(V.len(a.tan),1);if(path.parameters)assert(a.parameter>=0&&a.parameter<=1);}}
 const crossing=C.path([[-1,-1,0],[1,1,0],[-1,1,0],[1,-1,0]]).closest([0,0,0]);assert.equal(crossing.segment,0);near(crossing.distance,0);
 const line=C.path([[0,0,0],[2,0,0]]);vec(line.closest([-3,0,0]).p,[0,0,0]);vec(line.closest([9,0,0]).p,[2,0,0]);
});
test('parametric curvature agrees with circles, helices, scaled curves and Euler curvature',()=>{
 const circle=C.create({type:'superellipse',radii:[2,2],exponent:2});for(const u of [0,.2,.6,.999]){const k=circle.curvature(circle.length*u);assert(k.defined);near(k.value,.5,2e-6);near(k.radius,2,1e-5);near(dot(k.tan,k.normal),0,1e-7);assert.equal(k.method,'parametric');}
 const R=2,b=.4,helix=C.adaptive(u=>[R*Math.cos(u*Math.PI*4),b*u*Math.PI*4,R*Math.sin(u*Math.PI*4)],{tolerance:.002});for(const u of [0,.5,1])near(helix.curvature(helix.length*u).value,R/(R*R+b*b),1e-5);
 const c=C.create({type:'clothoid',length:6,startCurvature:.1,endCurvature:.7,scale:3});for(const u of [.05,.3,.8]){const k=c.curvature(c.length*u);near(k.value,(.1+.6*k.parameter)/3,1e-5);}
 const tiny=C.create({type:'superellipse',radii:[.001,.001],exponent:2,scale:.001});near(tiny.curvature(0).value,1e6,2);
 const line=C.path([[0,0,0],[1,0,0]]).curvature(.3);assert.equal(line.value,0);assert.equal(line.radius,Infinity);
});
test('discrete curvature estimates fit circles and identify undefined reversal cusps',()=>{
 const pts=Array.from({length:65},(_,i)=>[3*Math.cos(i*Math.PI/32),0,3*Math.sin(i*Math.PI/32)]),circle=C.path(pts);for(const u of [0,.2,.8])near(circle.curvature(circle.length*u).value,1/3,1e-9);
 const reversal=C.path([[0,0,0],[1,0,0],[0,0,0]]);assert.equal(reversal.curvature(1).defined,false);assert.equal(reversal.curvature(1).value,null);
 const cusp=C.adaptive(u=>[(u-.5)**2,0,0],{minSegments:9,tolerance:.001});assert.equal(C.curvature(cusp,cusp.closest([0,0,0]).along).defined,false);
});
test('adaptive sampling meets measured deviation on a circle and spends samples near bends',()=>{
 const circle=C.adaptive(u=>[2*Math.cos(u*Math.PI*2),2*Math.sin(u*Math.PI*2),0],{closed:true,tolerance:.002,minSegments:8});assert(!circle.sampling.limited);assert(circle.points.length<150);assert.deepEqual(circle.points[0],circle.points.at(-1));
 for(let i=0;i<1000;i++){const p=circle.evaluate(i/1000);assert(circle.closest(p).distance<=.00201);}
 const shape=C.interpolate([[0,0,0],[4,0,0],[5,0,0],[5.1,1,0],[5,2,0]],{adaptive:{tolerance:.001,minSegments:1}});assert(!shape.sampling.limited);assert(shape.parameters.length===shape.points.length);const params=shape.parameters;assert(params.some((v,i)=>i&&v-params[i-1]<(params[1]-params[0])*.5));
});
test('adaptive budgets are explicit and mandatory knots survive refinement and snapshots',()=>{
 const def={type:'clothoid',sections:[{length:2,curvature:0},{length:1,curvature:1},{length:2,curvature:0}],adaptive:{minSegments:8,tolerance:.0001}},p=C.create(def),restored=C.create(JSON.parse(JSON.stringify(p.snapshot())));assert.deepEqual(restored.points,p.points);assert(p.parameters.includes(.4));assert(p.parameters.includes(.6));
 const limited=C.adaptive(u=>[Math.cos(u*6),Math.sin(u*6),0],{tolerance:1e-10,minSegments:1,maxSegments:4});assert(limited.sampling.limited);assert.equal(limited.points.length,5);
 const depth=C.adaptive(u=>[u,u*u,0],{maxDepth:0,tolerance:1e-9});assert(depth.sampling.limited);
 assert.equal(C.adaptive(u=>[u,0,0]).points.length,9);
});
test('periodic interpolation meets position and first derivative and preserves transported frame seam',()=>{
 const pts=[[0,0,0],[2,0,0],[3,2,1],[0,3,0],[-1,1,-1]],p=C.interpolate(pts,{closed:true,adaptive:{tolerance:.002}}),h=1e-5;
 assert.deepEqual(p.evaluate(0),p.evaluate(1));vec(V.mul(V.sub(p.evaluate(h),p.evaluate(0)),1/h),V.mul(V.sub(p.evaluate(1),p.evaluate(1-h)),1/h),.003);
 for(const u of p.breaks.slice(1,-1)){vec(V.mul(V.sub(p.evaluate(u),p.evaluate(u-h)),1/h),V.mul(V.sub(p.evaluate(u+h),p.evaluate(u)),1/h),.003);}
 const a=p.frame(0),b=p.frame(p.length-1e-6);near(Q.angle(a.rotation,b.rotation),0,1e-5);for(let i=0;i<60;i++){const f=p.frame(i*p.length/60);near(V.len(f.T),1);near(dot(f.T,f.N),0);near(K.M.det(f.matrix),1);vec(Q.toMatrix(f.rotation),f.matrix,1e-12);}
 const snapshot=p.snapshot(),r=C.interpolate(snapshot.points,snapshot.options);assert.deepEqual(r.points,p.points);assert.equal(p.curvature(.5).method,'parametric');
});
test('interpolation supports open endpoints, two-point lines and optional uniform parameterization',()=>{
 const p=C.interpolate([[0,0,0],[3,0,0]],{alpha:0});vec(p.evaluate(0),[0,0,0]);vec(p.evaluate(1),[3,0,0]);vec(p.evaluate(.4),[1.2,0,0]);assert.equal(p.closed,false);near(p.length,3);near(p.curvature(p.length*.4).value,0,1e-8);
 const pts=[[0,0,0],[1,1,0],[3,1,0]],q=C.interpolate(pts,{alpha:0,segmentsPerSpan:8});vec(q.evaluate(.5),pts[1]);assert.equal(q.points.length,17);
});
test('invalid analysis inputs reject nonfinite queries and unbounded work',()=>{
 const path=C.create({type:'flower'});for(const point of [[NaN,0,0],[1,2],Array(3)])assert.throws(()=>path.closest(point));assert.throws(()=>path.curvature(NaN));assert.throws(()=>path.curvature(0,{step:0}));
 for(const opts of [{tolerance:0},{maxSegments:5000},{minSegments:5,maxSegments:4},{maxDepth:99},{closed:'yes'}])assert.throws(()=>C.adaptive(u=>[u,0,0],opts));assert.throws(()=>C.adaptive(()=>[NaN,0,0]));assert.throws(()=>C.adaptive(u=>[u,0,0],{closed:true}));
 assert.throws(()=>C.interpolate([[0,0,0],[1,0,0]],{tension:2}));assert.throws(()=>C.interpolate([[0,0,0],[1,0,0]],{segmentsPerSpan:5000}));
});

test('derived adaptive and interpolated paths remain reusable by typography and existing consumers',()=>{
 for(const path of [C.adaptive(u=>[u*4,Math.sin(u*6),0]),C.interpolate([[0,0,0],[2,2,0],[4,0,0]])]){assert.equal(C.path(path),path);assert.equal(C.create(path),path);assert(C.text(path,'INK',{size:.2}).strokes.length>0);const route=K.anim.route(path,{speed:1});vec(route.vehicle(.5).p,path.at(route.distanceAt(.5)).p,1e-5);assert(path.closest([1,1,0]).parameter!==undefined);}
});

test('retained parameter knots track collapsed samples and authored options are copied',()=>{
 const line=C.create({type:'lissajous',amplitude:[1,0,0],frequency:[1,1,1],phase:[Math.PI/2,0,0],segments:33});assert.equal(line.points.length,line.parameters.length);assert(line.closest([0,0,0]).parameter!==undefined);
 const options={closed:true,adaptive:{tolerance:.002}},points=[[0,0,0],[2,0,0],[2,2,0],[0,2,0]],p=C.interpolate(points,options);options.adaptive.tolerance=.1;options.closed=false;const s=p.snapshot();assert(s.options.closed);assert.equal(s.options.adaptive.tolerance,.002);
 assert.throws(()=>C.create({type:'torusKnot',p:7,q:8,adaptive:{minSegments:4}}),/floor/);
});

test('interpolated camera rails use the same sampled curve without a second smoothing pass',()=>{
 const definition={points:[[0,0,3],[3,2,0],[0,4,-3],[-3,2,0]],options:{closed:true,adaptive:{tolerance:.002}}},path=C.interpolate(definition.points,definition.options),rig=K.cameraRig.compile({rails:{track:{interpolated:definition}},shots:{follow:{target:[0,2,0],rail:'track',progress:.37}}}),camera=rig.sample(0).camera;
 vec(V.mad(camera.target,[Math.sin(camera.yaw)*Math.cos(camera.pitch),Math.sin(camera.pitch),Math.cos(camera.yaw)*Math.cos(camera.pitch)],camera.dist),path.at(path.length*.37).p,1e-9);
});
test('CLI exports analysis for adaptive families and interpolated control points',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-analysis-'));try{const file=path.join(dir,'curve.json');fs.writeFileSync(file,JSON.stringify({points:[[0,0,0],[2,1,0],[4,0,0]],options:{adaptive:{tolerance:.005}}}));const report=JSON.parse(cp.execFileSync(process.execPath,['cli/ink-studio.js','curve',file,'--closest','1,2,0','--curvature','1'],{cwd:path.resolve(__dirname,'..')}));assert(report.closest.distance>0);assert(report.curvature.defined);assert.equal(report.sampling.mode,'adaptive');assert.equal(report.points.length,report.parameters.length);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('curvature normals remain scale invariant and adaptive interpolation has its own budget',()=>{
 const circle=C.create({type:'superellipse',radii:[1e-6,1e-6],exponent:2,scale:1e-4,segments:32}),bend=circle.curvature(0);near(bend.value,1e10,2e4);vec(bend.normal,[-1,0,0],1e-5);
 const points=Array.from({length:400},(_,i)=>[i/100,0,0]),path=C.interpolate(points,{adaptive:{tolerance:.005}});assert(!path.sampling.limited);near(path.length,3.99);assert(path.points.length<450);
});
