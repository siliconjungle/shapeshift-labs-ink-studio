const test=require('node:test'),assert=require('node:assert/strict'),kit=require('..').load(),K=kit.KIT,T=kit.Stippling;
function plane(n=40){return Array.from({length:n*n},(_,i)=>({position:[(i%n)/n,Math.floor(i/n)/n,0],normal:[0,0,1],light:.5}));}
test('variable spacing places more real marks in authored detail without close pairs',()=>{
 const points=plane(),profile={spacing:.06,coarse:2.5,fine:.6,toneDensity:0,importance:p=>p.position[0]>.5?1:0},a=T.sample(points,profile),b=T.sample(points,profile);
 assert.deepEqual(a,b);const left=a.marks.filter(m=>points[m.index].position[0]<.45),right=a.marks.filter(m=>points[m.index].position[0]>.55);assert(right.length>left.length*5);
 for(let i=0;i<a.marks.length;i++)for(let j=i+1;j<a.marks.length;j++){const x=a.marks[i],y=a.marks[j],p=points[x.index].position,q=points[y.index].position;assert(Math.hypot(...p.map((v,k)=>v-q[k]))+1e-8>=(x.spacing+y.spacing)/2);}
});
test('curvature, silhouette hints, shadow lighting and zones contribute independent features',()=>{
 const field=(x,y,z)=>Math.hypot(x,y,z)-1,flat=x=>x-1;
 const a=T.measure(true,field,[1,0,0],[1,0,0],.1),b=T.measure(true,flat,[1,0,0],[1,0,0],.1);assert(a.curvature>b.curvature);
 const c={position:[0,0,0],normal:[1,0,0],curvature:0,light:.5};assert(T.features({views:[[0,0,1]]},c).importance>T.features(true,c).importance);
 assert(T.features({zones:[{at:[0,0,0],radius:1}]},c).importance>.9);
 const shadow=T.measure({light:[1,0,0],shadowSteps:4},()=>-.1,[0,0,0],[1,0,0],.1);assert(shadow.light<.3);
});
test('opposite surfaces and independent moving groups retain their own points',()=>{
 const p=[{position:[0,0,0],normal:[0,0,1],group:'a'},{position:[.001,0,0],normal:[0,0,-1],group:'a'},{position:[.002,0,0],normal:[0,0,1],group:'b'}];assert.equal(T.sample(p).marks.length,3);
});
test('named pigment choices are deterministic and approximate the source mixture',()=>{
 const spec={style:'pointillism',palette:['#000000','#ffffff']};let mean=0;for(let i=0;i<2000;i++)mean+=T.paint(spec,[127.5,127.5,127.5],[i*.013,i*.007,0])[0]/255;assert(Math.abs(mean/2000-.5)<.04);assert.deepEqual(T.paint({ink:'#173b51'},[255,255,255],[0,0,0]),[23,59,81]);
});
test('candidate, neighbor, mark and probe budgets reject predictably',()=>{
 for(const settings of [{fine:0},{size:[.4,.1]},{views:[[0,0,0]]},{seed:.5}])assert.throws(()=>T.prepare(settings));
 assert.throws(()=>T.sample(plane(),{maxCandidates:10}),/budget/);assert.throws(()=>T.sample(plane(),{maxMarks:1}),/budget/);assert.throws(()=>T.sample(plane(),{maxChecks:1}),/budget/);assert.throws(()=>T.measure(true,()=>NaN,[0,0,0],[0,1,0],.1));
});
function fixture(kit){const b=kit.makeBuilder(1,[0xf5ead0,0x306b7c,0xe1a56c]),s=kit.KIT.sculpt(kit.makeSculpt(b));s.stipple={views:[[0,.25,1]],ink:'#173b51',shadowSteps:2};s.ball([0,0,0],1,{r:[1,2,0]},{res:.08,objectId:'orb'});s.bake();return b.finish({cam:{target:[0,0,0],dist:5,yaw:.2,pitch:.1},radius:10,fog:{c:0,start:1,max:0},dither:0,look:{pixelSize:1,clean:1,splatCoverage:'continuous'}});}
test('native sculpt baking emits a sparse retained mark representation with provenance',()=>{
 const w=fixture(kit);assert(w.count>0&&w.count<2500);assert(w.splatFootprints.styles.some(p=>p.depth==='plane'));assert(w.renderMetadata.objects.includes('orb'));
 const copy=kit.SplatProvenance.subset(w,[0,w.count-1]);assert.equal(copy.splatFootprints.frames.length,12);const r=require('../cli/render').render(w,{w:80,h:80,px:1,raw:true});assert(r.rgb.some(v=>v>0));
});
test('scoped builder colors restore after exceptions and reject invalid transform output',()=>{
 const b=kit.makeBuilder(2,[0x123456]);assert.throws(()=>b.withColor([1,2,3],()=>{throw Error('draw')}));b.iso(0,0,0,.1,b.P[0],1);assert.equal(b.finish({}).data[7],0x563412);assert.throws(()=>b.withColor(()=>[NaN,2,3],()=>b.iso(0,0,0,.1,b.P[0],1)));
});
test('disabled stippling follows the original path and JSON tooling accepts profiles',()=>{
 const spec={id:'stipple-test',finish:{res:.15,stipple:false},solids:[{kind:'ball',at:[0,0,0],r:1,mat:'stone'}]};const a=K.diorama.build(spec),b=K.diorama.build({...spec,finish:{res:.15}});assert.deepEqual(a.data,b.data);assert.throws(()=>K.diorama.build({...spec,finish:{stipple:{fine:0}}}),/stipple/);
});
test('hardware renders real mark holes, material colors and free camera changes',{skip:!process.env.INK_TEST_CHROME},()=>{const result=require('../cli/look-webgl')({chrome:process.env.INK_TEST_CHROME,hardware:true},fixture,(kit,build,backend)=>{const w=build(kit),b=backend(96,96,{raw:true});b.draw(w);const a=b.image();b.draw(w,{camera:{...w.cam,yaw:1.1}});const c=b.image();b.close();return {a,c,count:w.count};});assert.notEqual(result.a,result.c);assert(result.count<2500);});
