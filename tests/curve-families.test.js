const test=require('node:test'),assert=require('node:assert/strict'),core=require('..'),{KIT:K}=core.load(),C=K.curve,V=K.V;
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<=e,`${a} != ${b}`),vector=(a,b,e=1e-7)=>a.forEach((v,i)=>near(v,b[i],e));
const kinds=['clothoid','torusKnot','lissajous','logSpiral','superellipse','flower',
 'archimedeanSpiral','fermatSpiral','cycloid','epitrochoid','hypotrochoid'];
test('curve families expose the same immutable point-array and route contracts',()=>{
 for(const type of kinds){const curve=C.create({type});assert(curve.points.length>=9);assert(curve.points.every(p=>p.length===3&&p.every(Number.isFinite)));assert(curve.length>0);assert.equal(C.path(curve),curve);assert.equal(C.create(curve),curve);vector(curve.sample(.4),curve.at(curve.length*.4).p);near(V.len(curve.at(.3).tan),1);assert(Object.isFrozen(curve.points));
 const restored=C.create(JSON.parse(JSON.stringify(curve.snapshot())));assert.deepEqual(curve.points,restored.points);assert.deepEqual(C[type](),curve.points);
 if(curve.closed){assert.deepEqual(curve.points[0],curve.points.at(-1));assert.deepEqual(curve.evaluate(0),curve.evaluate(1));vector(curve.at(-.1).p,curve.at(curve.length-.1).p);}
 }
});
test('clothoids reduce to exact straight lines and circular arcs',()=>{
 const line=C.create({type:'clothoid',length:7,startCurvature:0,endCurvature:0,heading:.3,axis:[0,0,1],origin:[1,2,3]});vector(line.evaluate(1),[1+7*Math.cos(.3),2+7*Math.sin(.3),3],1e-11);near(line.length,7,1e-11);
 const arc=C.create({type:'clothoid',length:Math.PI,startCurvature:.5,endCurvature:.5,axis:[0,0,1]});vector(arc.evaluate(1),[2,2,0],1e-11);
 const scaled=C.create({type:'clothoid',length:2,startCurvature:.2,endCurvature:.6,scale:3});near(scaled.properties.arcLength,6);near(scaled.properties.startCurvature,.2/3);near(scaled.properties.endCurvature,.6/3);
});
test('Euler spiral heading and curvature match the analytic linear-curvature law',()=>{
 const length=6,k0=-.2,k1=.7,heading=.1,curve=C.create({type:'clothoid',length,startCurvature:k0,endCurvature:k1,heading,axis:[0,0,1],segments:256});
 for(const u of [.15,.4,.7,.9]){const h=1e-4,a=curve.evaluate(u-h),b=curve.evaluate(u),c=curve.evaluate(u+h),d=V.sub(c,a),theta=heading+k0*u*length+(k1-k0)*length*u*u/2;near(Math.atan2(d[1],d[0]),theta,1e-6);const first=V.mul(V.sub(c,a),1/(2*h*length)),second=V.mul(V.add(V.sub(c,V.mul(b,2)),a),1/(h*h*length*length));near(V.cross(first,second)[2]/V.len(first)**3,k0+(k1-k0)*u,2e-5);}
});
test('clothoid sections join position, heading and curvature without a transition kink',()=>{
 const curve=C.create({type:'clothoid',axis:[0,0,1],sections:[{length:2,curvature:0},{length:3,curvature:.6},{length:2,curvature:.6},{length:3,curvature:0}]}),epsilon=1e-5;
 for(const s of [2,5,7]){const a=curve.evaluate((s-epsilon)/10),b=curve.evaluate(s/10),c=curve.evaluate((s+epsilon)/10);near(V.dot(V.norm(V.sub(b,a)),V.norm(V.sub(c,b))),1,1e-8);}
 near(curve.properties.headingEnd,3);near(curve.properties.arcLength,10);
});
test('torus knots stay on their torus and validate topology and sample budgets',()=>{
 const c=C.create({type:'torusKnot',majorRadius:2,minorRadius:.5,axis:[0,0,1]});for(let i=0;i<40;i++){const p=c.evaluate(i/40);near((Math.hypot(p[0],p[1])-2)**2+p[2]**2,.25,1e-10);}
 assert.throws(()=>C.torusKnot({p:2,q:4}),/coprime/);assert.throws(()=>C.torusKnot({p:9,q:10,segments:16}),/segments/);
});
test('Lissajous paths use the fundamental period and support typed input vectors',()=>{
 const a=C.create({type:'lissajous',frequency:[3,2,1],phase:[.2,.4,.6]}),b=C.create({type:'lissajous',frequency:Float32Array.of(6,4,2),phase:Float64Array.of(.2,.4,.6)});assert.deepEqual(a.points,b.points);
 for(const p of a.points)assert(Math.abs(p[0])<=1.6+1e-10&&Math.abs(p[1])<=.7+1e-10&&Math.abs(p[2])<=1.2+1e-10);
});
test('logarithmic spirals change radius exponentially and support inward winding and axial lift',()=>{
 const c=C.create({type:'logSpiral',startRadius:.2,endRadius:3.2,turns:-2,height:2,axis:[0,0,1]});for(const u of [0,.25,.5,.75,1]){const p=c.evaluate(u);near(Math.hypot(p[0],p[1]),.2*16**u);near(p[2],u*2);}
});
test('superellipses satisfy their implicit equation and flowers preserve petal symmetry',()=>{
 const c=C.create({type:'superellipse',radii:[2,1],exponent:4,axis:[0,0,1]});for(let i=0;i<100;i++){const p=c.evaluate(i/100);near((p[0]/2)**4+p[1]**4,1,1e-10);}vector(c.evaluate(.25),[0,1,0],1e-12);
 const f=C.create({type:'flower',petals:5,radius:2,depth:.4,height:.2,axis:[0,0,1]});for(let i=0;i<5;i++)near(V.len(f.evaluate(i/5)),2.8,1e-10);
});
test('closed frame transport is orthonormal and meets exactly at every seam',()=>{
 for(const type of ['torusKnot','lissajous','superellipse','flower']){
 const curve=C.create({type}),frames=C.frames(curve.points,[.2,1,.3]);for(const f of frames){for(const v of [f.T,f.N,f.B])near(V.len(v),1,1e-8);near(V.dot(f.T,f.N),0,1e-8);near(V.dot(f.N,f.B),0,1e-8);near(V.dot(V.cross(f.T,f.N),f.B),1,1e-8);}assert.deepEqual(frames[0].T,frames.at(-1).T);assert.deepEqual(frames[0].N,frames.at(-1).N);assert.deepEqual(frames[0].B,frames.at(-1).B);
 for(const d of [0,curve.length*.1,curve.length*.75]){const frame=curve.frame(d);near(V.len(frame.N),1);near(V.dot(frame.T,frame.N),0);}
 }
 const reverse=C.create({type:'lissajous',amplitude:[1,0,0],frequency:[1,1,1],phase:[0,0,0]});assert(C.frames(reverse.points).every(f=>f.T.every(Number.isFinite)&&V.len(f.T)>.99));
});
test('the same curve drives SDF sweeps, route motion, particle emission and camera rails',()=>{
 const curve=C.create({type:'superellipse',radii:[1.4,1],exponent:3,segments:64}),B=core.load().makeBuilder(1,[0x081421,0x53bec3,0xffc681]),S=K.sculpt(core.load().makeSculpt(B));
 const solid=K.sweep(S,curve.points,{shape:'round',w:.08,h:.08},{r:[1]},{hold:true,res:.1});assert(Number.isFinite(solid.sd(...curve.points[10])));assert(solid.sd(...curve.points[0])<0);
 const route=K.anim.route(curve,{speed:2});for(const t of [0,.5,1])vector(route.vehicle(t).p,curve.at(route.distanceAt(t)).p,1e-5);
 const pool=K.pool(B,8),W=B.finish(),stage=K.stage(W),ps=stage.add(K.particles(stage,pool));const sample=curve.at(.5),particle=ps.emit({p:sample.p,v:sample.tan,life:1,size:.02,cols:[1]});stage.update(.02,0);vector(particle.p,V.mad(sample.p,sample.tan,.02));assert.equal(ps.live,1);assert(stage.rows.some(Boolean));
 const rig=K.cameraRig.compile({rails:{track:{family:curve.snapshot()}},shots:{ride:{target:[0,0,0],rail:'track',progress:.25}}});const shot=rig.sample(0).camera;const desired=curve.at(curve.length*.25).p;vector(V.mad(shot.target,[Math.sin(shot.yaw)*Math.cos(shot.pitch),Math.sin(shot.pitch),Math.cos(shot.yaw)*Math.cos(shot.pitch)],shot.dist),desired);
});
test('curved typography uses the shared transported frames and supports custom stroke drawings',()=>{
 const line=C.path([[0,0,0],[10,0,0]]),text=C.text(line,'INK',{size:.5,offset:0,align:'start',lift:.2});assert(text.strokes.length>0);assert(text.strokes.flat().every(p=>p.every(Number.isFinite)));
 const drawing=C.drawOnPath(line,{strokes:[[[0,0],[2,1]]],width:.05},{align:'start',offset:1,maxStep:.2});vector(drawing.strokes[0][0],[1,0,0]);vector(drawing.strokes[0].at(-1),[3,1,0]);
 assert.deepEqual(C.text(line,'').strokes,[]);assert.throws(()=>C.text(line,'TOO LONG',{size:10}),/exceeds/);assert(C.text(line,'TOO LONG',{size:10,fit:true}).extent<=10+1e-8);
});
test('invalid definitions fail before generating unbounded or nonfinite geometry',()=>{
 for(const def of [{type:'nope'},{type:'clothoid',length:0},{type:'clothoid',length:100,startCurvature:1000},{type:'flower',petals:0},{type:'flower',depth:1},{type:'superellipse',exponent:0},{type:'logSpiral',startRadius:0},{type:'lissajous',frequency:[0,1,1]},{type:'torusKnot',axis:[0,0,0]},{type:'torusKnot',segments:1e9}])assert.throws(()=>C.create(def));
 assert.throws(()=>C.path([[0,0,0],[0,0,0]]));assert.throws(()=>C.path([[NaN,0,0],[1,0,0]]));assert.throws(()=>C.create({type:'flower',right:[0,1,0]}));
});

test('curve CLI exports reusable definitions, distance samples and mapped lettering',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-curves-'));
 try{const out=path.join(dir,'curve.json');cp.execFileSync(process.execPath,['cli/ink-studio.js','curve','examples/curve-family.json','--distance','2','--text','INK','--out',out],{cwd:path.resolve(__dirname,'..')});const report=JSON.parse(fs.readFileSync(out,'utf8'));assert.equal(report.definition.type,'clothoid');assert.equal(report.closed,false);vector(report.sample.p,[2,0,0]);assert(report.drawing.strokes.length>0);assert(report.points.length===161);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('short spiral defaults and custom path frames remain stable after author edits',()=>{
 const short=C.create({type:'logSpiral',turns:.01});assert.equal(short.points.length,9);
 const points=[[0,0,0],[1,0,0],[2,1,0]],up=[0,0,1],rail=C.path(points,{up});up[2]=0;points[0][0]=99;vector(rail.frame(0).N,[0,0,1]);const snapshot=rail.snapshot(),restored=C.path(snapshot.points,{up:snapshot.up,closed:snapshot.closed});vector(restored.frame(.5).N,rail.frame(.5).N);
});
