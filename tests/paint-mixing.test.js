const test=require('node:test'),assert=require('node:assert/strict'),core=require('..'),{KIT:K,ColorLUT}=core.load(),p=K.paint;
const near=(a,b,e=1e-8)=>assert(Math.abs(a-b)<e,`${a} != ${b}`),vector=(a,b,e=1e-8)=>a.forEach((v,i)=>near(v,b[i],e));
const blue=p.preset('blue'),yellow=p.preset('yellow'),red=p.preset('red'),white=p.preset('white');
const blend=(a,b,t)=>p.mix([{paint:a,weight:1-t},{paint:b,weight:t}]);
test('RGB swatches reconstruct smooth displayable spectra and identify estimates explicitly',()=>{
 for(const color of ['#2d55a6','#f2d02e','#ce4935','#ffffff','#000000','#ff0000']){
 const paint=p.swatch(color);assert.equal(paint.reflectance.length,36);assert(paint.rgb.every(v=>v>=0&&v<=1));assert(paint.reflectance.every(v=>v>0&&v<=1));assert.equal(paint.diagnostics.source,'estimated-rgb');assert(paint.diagnostics.maxRGBError<.035);}
 assert(Object.isFrozen(blue.reflectance));assert.equal(p.swatch(blue),blue);
});
test('Kubelka–Munk absorption and scattering mix by physical concentration',()=>{
 const a=p.swatch({reflectance:.25}),b=p.swatch({reflectance:.75}),mix=blend(a,b,.5),ks=((1-.25)**2/(2*.25)+(1-.75)**2/(2*.75))/2,expected=1/(1+ks+Math.sqrt(ks*ks+2*ks));
 mix.reflectance.forEach(r=>near(r,expected));assert(mix.rgb.every(Number.isFinite));
 const green=blend(blue,yellow,.5),rgb=blue.rgb.map((v,i)=>(v+yellow.rgb[i])/2);assert(green.rgb[1]>green.rgb[0]*1.6&&green.rgb[1]>green.rgb[2]*1.2);assert(Math.abs(green.rgb[0]-rgb[0])>.2);
});
test('mixtures are scale invariant, exchange symmetric, and associative with conserved amounts',()=>{
 vector(p.mix([{paint:blue,weight:2},{paint:yellow,weight:3}]).rgb,p.mix([{paint:yellow,weight:300},{paint:blue,weight:200}]).rgb);
 const ab=p.mix([{paint:blue,weight:1},{paint:yellow,weight:2}]),nested=p.mix([{paint:ab,weight:3},{paint:red,weight:4}]),flat=p.mix([{paint:blue,weight:1},{paint:yellow,weight:2},{paint:red,weight:4}]);vector(nested.absorption,flat.absorption);vector(nested.rgb,flat.rgb);
 vector(p.mix([{paint:blue,weight:1e300},{paint:yellow,weight:1e300}]).rgb,blend(blue,yellow,.5).rgb);
 vector(blend(blue,yellow,0).rgb,blue.rgb);vector(blend(blue,yellow,1).rgb,yellow.rgb);
});
test('scattering and tinting strength affect mixtures while preserving a pure paint color',()=>{
 const strong=p.swatch({color:'#2d55a6',strength:4});vector(strong.rgb,blue.rgb);assert.notDeepEqual(blend(strong,yellow,.5).rgb,blend(blue,yellow,.5).rgb);
 const flat=p.swatch({reflectance:.4,scattering:1}),dense=p.swatch({reflectance:.4,scattering:4});vector(flat.rgb,dense.rgb);assert.notDeepEqual(blend(flat,white,.5).rgb,blend(dense,white,.5).rgb);
});
test('tint and shade use separate paint constituents, have exact endpoints and change lightness',()=>{
 const light=c=>K.procedural.materials.perceptual.lab(c.rgb)[0];for(const paint of [blue,yellow,red]){assert(light(p.tint(paint,.5))>light(paint));assert(light(p.shade(paint,.5))<light(paint));vector(p.tint(paint,0).rgb,paint.rgb);vector(p.tint(paint,1).rgb,white.rgb);}
 vector(p.shade(blue,1).rgb,p.preset('black').rgb);
});
test('custom spectra resample wavelength grids and coefficient snapshots round trip',()=>{
 const a=p.swatch({name:'Measured',wavelengths:[380,730],absorption:[1,3],scattering:[2,2]});a.absorption.forEach((v,i)=>near(v,1+2*i/35));
 vector(p.swatch(JSON.parse(JSON.stringify(a.snapshot()))).rgb,a.rgb);const mixed=p.mix([blue,yellow,red]);vector(p.swatch(mixed.snapshot()).rgb,mixed.rgb);
 const strong=p.swatch({reflectance:.003,strength:1e6,scattering:5});vector(p.swatch(strong.snapshot()).rgb,strong.rgb);
 const absorber=p.swatch({absorption:1,scattering:0});vector(absorber.rgb,[0,0,0]);
});
test('swatch books resolve reusable recipes, support nesting, and snapshot solved spectra',()=>{
 const book=p.book({blue:{preset:'blue'},yellow:{preset:'yellow'},leaf:{mix:[{paint:'blue',weight:2},{paint:'yellow',weight:3}]},pale:{mix:[{paint:'leaf',weight:1},{paint:{preset:'white'},weight:1}]}});
 vector(book.get('leaf').rgb,p.mix([{paint:blue,weight:2},{paint:yellow,weight:3}]).rgb);vector(p.book(book.snapshot()).get('pale').rgb,book.get('pale').rgb);vector(book.mix(['blue','yellow']).rgb,blend(blue,yellow,.5).rgb);
 assert.throws(()=>p.book({a:'b',b:'a'}),/cyclic/);assert.throws(()=>book.get('missing'),/unknown/);
});
test('pigment gradients preserve stops and support smooth and step concentration progress',()=>{
 const g=p.gradient({stops:[{at:0,paint:blue},{at:.4,paint:yellow},{at:1,paint:red}],interpolation:'step'});assert.equal(g.sample(.2),blue);assert.equal(g.sample(.4),yellow);assert.equal(g.sample(1),red);
 const smooth=p.gradient({stops:[{at:0,paint:blue},{at:1,paint:yellow}],interpolation:'smooth'});vector(smooth.sample(.5).rgb,blend(blue,yellow,.5).rgb);vector(p.gradient(smooth.snapshot()).sample(.25).rgb,smooth.sample(.25).rgb);assert.equal(g.sample(-1),blue);
});
test('baked ramps interpolate only cached RGB and retain exact grid samples',()=>{
 const g=p.gradient({stops:[{at:0,paint:blue},{at:1,paint:yellow}]}),r=p.bakeRamp(g,{steps:257});
 for(const t of [0,.125,.5,.875,1])vector(r.sample(t),g.sample(t).rgb);const out=new Float32Array(3);assert.equal(r.sample(.3,out),out);vector(Array.from(out),g.sample(.3).rgb,.001);
 const B=core.load().makeBuilder(1,[0,...p.bakeRamp(g,{steps:7}).hex]);B.disc(0,0,0,[0,0,1],.5,.01,B.P[4],3);const W=B.finish();W.cam={target:[0,0,0],dist:5,yaw:0,pitch:0};const frame=core.render(W,{w:40,h:40,px:1});assert(frame.rgb.some(v=>v>0));
});
test('mixture tables preserve zero-paint edges, pure paints and normalized concentrations',()=>{
 for(const paints of [[blue,yellow],[blue,yellow,red],[blue,yellow,red,white]]){
 const table=p.bakeTable({paints,size:9});assert.equal(table.data.length,9**(paints.length-1)*3);
 paints.forEach((paint,i)=>vector(table.sample(paints.map((_,j)=>i===j?1:0)),paint.rgb));
 const amounts=paints.map(()=>1);vector(table.sample(amounts),p.mix(paints).rgb,.015);vector(table.sample(amounts.map(v=>v*1e300)),table.sample(amounts));
 const edge=paints.map((_,i)=>i<2?.5:0);vector(table.sample(edge),blend(blue,yellow,.5).rgb);assert.equal(table.coordinates(edge).length,paints.length-1);
 const copy=p.restoreTable(JSON.parse(JSON.stringify(table.snapshot())));vector(copy.sample(amounts),table.sample(amounts));const rgba=table.rgba();assert.equal(rgba.data.length,table.data.length/3*4);
 }
});
test('mixture table exports reuse existing color LUT sampling with matching coordinates',()=>{
 const table=p.bakeTable({paints:[blue,yellow,red,white],size:9}),lut=ColorLUT.prepare(table.asLUT());
 for(const weights of [[1,2,3,4],[0,1,1,0],[1,0,0,0],[0,0,0,1]])vector(lut.sample(table.coordinates(weights)),table.sample(weights),1e-12);
 const recipe=K.palette.recipe({anchors:{paint:blue.rgb},roles:{paint:{path:{colors:p.bakeRamp(p.gradient({stops:[{at:0,paint:blue},{at:1,paint:yellow}]}),{steps:7}).rgb},steps:7}}});assert.equal(recipe.palette.length,8);
});
test('invalid inputs, empty mixtures and corrupted baked data fail explicitly',()=>{
 for(const input of [{reflectance:1.1},{color:'#ff00ff',reflectance:.4},{absorption:0,scattering:0},{color:'#112233',strength:0},{wavelengths:[400,700],reflectance:[.1,.9]},{reflectance:Array(35).fill(.5)}])assert.throws(()=>p.swatch(input));
 for(const entries of [[],[{paint:blue,weight:0}],[{paint:blue,weight:-1}],[{paint:blue,weight:Infinity}]])assert.throws(()=>p.mix(entries));
 assert.throws(()=>p.tint(blue,2));assert.throws(()=>p.gradient({stops:[{at:0,paint:blue},{at:.9,paint:yellow}]}));assert.throws(()=>p.bakeTable({paints:[blue]}));assert.throws(()=>p.bakeTable({paints:[blue,yellow],size:34}));
 const data=p.bakeTable({paints:[blue,yellow],size:3}).snapshot();data.data[0]=NaN;assert.throws(()=>p.restoreTable(data));
});
test('baked ramp snapshots restore without spectral work and sparse inputs are rejected',()=>{
 const ramp=p.bakeRamp(p.gradient({stops:[{at:0,paint:blue},{at:1,paint:yellow}]}),{steps:33}),restored=p.restoreRamp(JSON.parse(JSON.stringify(ramp.snapshot())));
 for(const t of [0,.14,.5,1])vector(restored.sample(t),ramp.sample(t));assert.throws(()=>restored.sample(.5,new Float32Array(2)));
 assert.throws(()=>p.swatch({reflectance:new Array(36)}));assert.throws(()=>p.swatch(new Array(3)));
});
test('CLI exports mixtures, reusable swatches, ramps and native LUT-compatible tables',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-paint-cli-'));
 try{const file=path.resolve(__dirname,'../examples/paint-mixture.json'),cli=path.resolve(__dirname,'../cli/ink-studio.js');
 const run=(action,extra=[])=>JSON.parse(execFileSync(process.execPath,[cli,'paint',action,file,...extra],{cwd:tmp,encoding:'utf8'}));
 const paint=run('mix');vector(p.swatch(paint.paint).rgb,blend(blue,yellow,.5).rgb);assert(p.book(run('swatches')).get('leaf'));
 assert.equal(p.restoreRamp(run('ramp',['--steps','7'])).rgb.length,7);const table=p.restoreTable(run('table',['--size','3']));assert.equal(table.dimensions,3);
 assert.equal(ColorLUT.normalize(run('table',['--size','3','--lut'])).size,3);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('typed spectra and weight vectors work with rendering buffers',()=>{
 const a=p.swatch({wavelengths:Float64Array.of(380,730),absorption:Float32Array.of(1,3),scattering:Float32Array.of(2,2)});assert.equal(a.reflectance.length,36);
 const rgb=p.swatch(Float32Array.of(.2,.4,.6));assert(rgb.rgb.every(Number.isFinite));
 const table=p.bakeTable({paints:[blue,yellow,red],size:3});vector(table.sample(Float64Array.of(1,2,3)),table.sample([1,2,3]));
});
