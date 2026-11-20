const test=require('node:test'),assert=require('node:assert/strict'),core=require('..'),{KIT:K,makeBuilder}=core.load(),p=K.palette;
const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
const vector=(a,b,e=1e-6)=>a.forEach((v,i)=>near(v,b[i],e));
const cyan=p.duotone('#4caaa7','#edaa67'),violet=p.duotone('#a57fd3','#c7c864');
const animation=()=>p.animate({keys:[{time:0,recipe:cyan},{time:4,recipe:violet},{time:8,recipe:cyan}],playback:'loop'});
const world=recipe=>{const B=makeBuilder(1,recipe.palette);B.disc(0,0,0,[0,0,1],.8,.01,B.P[recipe.roles.primary[3]],3);const W=B.finish();W.cam={yaw:0,pitch:0,dist:6,target:[0,0,0]};W.look={pixelSize:1};W.paletteRoles=recipe.roles;return W;};
test('independent absolute OKLCh curves preserve channels while gamut mapping keeps output displayable',()=>{
 const a=p.path({curves:{hue:{stops:[[0,200],[1,320]]},chroma:.06,lightness:{stops:[[0,.2],[.4,.8],[1,.95]],interpolation:'smooth'}},steps:11});
 const b=p.path({curves:{hue:{stops:[[0,200],[1,320]]},chroma:.06,lightness:.5}});
 for(const t of [0,.2,.4,.8,1]){near(a.lch(t)[1],b.lch(t)[1]);near(a.lch(t)[2],b.lch(t)[2]);assert(a.sample(t).every(v=>v>=0&&v<=1));}
 const high=p.path({curves:{hue:200,chroma:1,lightness:.6}}).inspect(.5);assert(high.gamutMapped);near(high.requested[0],high.mapped[0],1e-5);near(((high.requested[2]-high.mapped[2]+540)%360)-180,0,1e-3);
});
test('paths preserve exact anchors, handle hue wrapping and use explicit winding for multi-turn curves',()=>{
 const colors=['#032445','#d98250','#f3e9cb'],a=p.path({colors,steps:3});assert.deepEqual(a.hex,colors.map(c=>parseInt(c.slice(1),16)));
 const b=p.path({curves:{lightness:.6,chroma:.05,hue:{stops:[[0,350],[1,370]]}}});near(b.lch(.5)[2],360);
 vector(a.sample(-2),a.sample(0));vector(a.sample(4),a.sample(1));assert.throws(()=>a.sample(NaN));
 const gray=p.path({colors:['#888888','#cccccc']});assert(gray.sample(.5).every(Number.isFinite));
});
test('step paths and animation keys change exactly at a stop',()=>{
 const a=p.path({colors:['#000000',{at:.5,color:'#ff0000'},'#ffffff'],interpolation:'step'});assert.equal(a.inspect(.5).hex,0xff0000);vector(a.lch(.5),K.procedural.materials.perceptual.lab([1,0,0]).map((v,i,lab)=>i===0?v:i===1?Math.hypot(lab[1],lab[2]):Math.atan2(lab[2],lab[1])*180/Math.PI));
 const b=p.animate({keys:[{time:0,recipe:cyan},{time:4,recipe:violet}],interpolation:'step'});assert.deepEqual(b.sample(3).palette,cyan.palette);assert.deepEqual(b.sample(4).palette,violet.palette);
});
test('two-color recipes allocate stable roles and keep independent role curves',()=>{
 const a=p.duotone('#4caaa7','#edaa67',{roles:{stone:{anchor:'primary',steps:7},glow:{anchor:'accent',steps:3,curves:{lightness:{stops:[[0,.55],[1,.98]]}}}}});
 assert.equal(a.palette.length,11);assert.deepEqual(a.roles.background,[0]);assert.deepEqual(a.roles.stone,[1,2,3,4,5,6,7]);assert.deepEqual(a.roles.glow,[8,9,10]);
 assert(a.ramps.stone.every((hex,i)=>hex===a.palette[a.roles.stone[i]]));assert(Object.isFrozen(a.roles.stone));
});
test('reference transfer preserves its profile, aligns the pivot, and survives a JSON round trip',()=>{
 const reference=['#101a31','#28516c','#6da9b0','#e5e6c9'],anchor='#d88b64',a=p.transfer(reference,anchor,{pivot:.45,steps:13});
 assert.equal(a.inspect(.45).hex,0xd88b64);assert(a.lch(0)[0]<a.lch(.45)[0]);assert(a.lch(1)[0]>a.lch(.45)[0]);
 const b=p.path(JSON.parse(JSON.stringify(a.snapshot())));for(const t of [0,.2,.45,.7,1])vector(a.sample(t),b.sample(t));
 const constant=p.transfer(reference,anchor,{strength:0});for(const t of [0,.3,1])vector(constant.sample(t),K.procedural.materials.perceptual.parse(anchor),1e-6);
});
test('compiled paths and reference transfers can be assigned to roles and serialized',()=>{
 const profile=p.transfer(['#12243a','#72aaaa','#faf0cd'],'#9b7ecd');
 const a=p.recipe({anchors:{a:'#7ab4bb'},roles:{stone:{path:profile,steps:9},lamp:{color:'#ffde9c'}}});
 const b=p.recipe(JSON.parse(JSON.stringify(a.snapshot())));assert.deepEqual(a.palette,b.palette);assert.equal(a.roles.lamp.length,1);
});
test('animation is seekable, frame-partition independent, stable across role ordering, and seamless at loop boundaries',()=>{
 const a=animation(),first=a.sample(1.37);for(const t of [7,2,0,9,-1])a.sample(t);assert.deepEqual(a.sample(1.37),first);
 assert.deepEqual(a.sample(0).palette,a.sample(8).palette);assert.deepEqual(a.sample(-1).palette,a.sample(7).palette);
 const reordered=p.recipe({anchors:{primary:'#a57fd3',accent:'#c7c864'},roles:{accent:{anchor:'accent'},primary:{anchor:'primary'}}});
 const b=p.animate({keys:[{time:0,recipe:cyan},{time:4,recipe:reordered}]});assert.deepEqual(b.sample(4).roles,cyan.roles);assert.deepEqual(b.sample(4).ramps.primary,reordered.ramps.primary);
 const copy=p.animate(JSON.parse(JSON.stringify(a.snapshot())));assert.deepEqual(copy.sample(2).palette,a.sample(2).palette);
});
test('clamp and pingpong playback have explicit boundary behavior',()=>{
 const a=p.animate({keys:[{time:0,recipe:cyan},{time:4,recipe:violet}],playback:'pingpong'});assert.deepEqual(a.sample(1).palette,a.sample(7).palette);assert.deepEqual(a.sample(0).palette,a.sample(8).palette);
 const b=p.animate({keys:[{time:0,recipe:cyan},{time:4,recipe:violet}]});assert.deepEqual(b.sample(-1).palette,cyan.palette);assert.deepEqual(b.sample(100).palette,violet.palette);
});
test('binding reuses its world and grade buffers, preserves source geometry and carries live source updates',()=>{
 const W=world(cyan),D=W.data.slice(),binding=p.bind(W,animation()),view=binding.world,grade=binding.grade;binding.update(2);assert.equal(binding.world,view);assert.equal(view.anim.grade,grade);assert.deepEqual(W.data,D);assert(!W.anim?.grade);
 assert.notDeepEqual(Array.from(grade),cyan.rgb.flat());W.fog={c:0,start:.8,max:.1};W.data[1]=.1;binding.update(3);assert.equal(view.fog,W.fog);assert.equal(view.data,W.data);
 delete W.fog;binding.update(4);assert(!Object.hasOwn(view,'fog'));
 const before=Array.from(grade);W.pal=[0];assert.throws(()=>binding.update(1),/layout/);assert.deepEqual(Array.from(grade),before);
});
test('named mappings resample shade counts and preserve unmapped colors and prior grades',()=>{
 const W=world(cyan);W.paletteRoles={wall:[1,2,3],lamp:[8,9,10]};W.anim={grade:Float32Array.from(cyan.rgb.flat())};W.anim.grade[14*3]=.3;
 const b=p.bind(W,violet,{roles:{wall:'primary',lamp:'accent'}});b.update(2);vector(Array.from(b.grade.slice(3,6)),violet.rgb[violet.roles.primary[0]]);vector(Array.from(b.grade.slice(9,12)),violet.rgb[violet.roles.primary.at(-1)]);near(b.grade[42],.3);
});
test('ambiguous aliases and disagreeing shared slots fail before playback',()=>{
 const a=p.duotone('#4caaa7','#edaa67',{roles:{a:{color:'#123456'},b:{color:'#123456'}}}),b=p.duotone('#4caaa7','#edaa67',{roles:{a:{color:'#884422'},b:{color:'#228844'}}});
 const W=world(cyan);W.pal=a.palette;assert.throws(()=>p.bind(W,p.animate({keys:[{time:0,recipe:a},{time:1,recipe:b}]})),/duplicate source colors/);
 const Z=world(cyan);Z.paletteRoles={a:[1,2],b:[2,3]};assert.throws(()=>p.bind(Z,violet,{roles:{a:'primary',b:'accent'}}),/overlapping/);
});
test('both software rendering and color-stack composition use animated palettes without rebaking',()=>{
 const W=world(cyan),b=p.bind(W,animation()),a=core.render(b.update(0),{w:80,h:80,px:1}),c=core.render(b.update(4),{w:80,h:80,px:1});assert.notDeepEqual(a.rgb,c.rgb);
 const d=core.render(b.update(4),{w:80,h:80,px:1,colorCurves:{channels:{red:{stops:[[0,0],[1,.2]]}}}});assert.notDeepEqual(c.rgb,d.rgb);assert.equal(W.data,b.world.data);
});
test('invalid recipes, curves, roles and animation layouts fail explicitly',()=>{
 for(const def of [{curves:{hue:0,chroma:2,lightness:.5}},{colors:['#123456','#abcdef'],curves:{wat:1}},{curves:{hue:0,chroma:.1,lightness:{stops:[[0,.2],[.5,.8]]}}}])assert.throws(()=>p.path(def));
 assert.throws(()=>p.recipe({anchors:{a:'#123456'},roles:{oops:{anchor:'missing'}}}));assert.throws(()=>p.recipe({anchors:{a:'#123456'},roles:{a:{anchor:'a',steps:32},b:{anchor:'a',steps:32}}}),/48/);
 assert.throws(()=>p.animate({keys:[{time:0,recipe:cyan},{time:2,recipe:violet}],playback:'loop'}),/endpoints/);
 assert.throws(()=>p.animate({keys:[{time:0,recipe:cyan},{time:1,recipe:p.duotone('#123456','#aabbcc',{roles:{primary:{anchor:'primary',steps:3},accent:{anchor:'accent'}}})}]}),/counts/);
});
test('reference roles apply default transfer options and expose truthful channel diagnostics',()=>{
 const a=p.recipe({anchors:{primary:'#9f85ca'},roles:{stone:{anchor:'primary',reference:['#10202b','#42717c','#d9d9b9'],steps:7},ink:{color:'#123456'}}});
 const d=a.inspectRole('stone',.5);assert.equal(d.hex,0x9f85ca);assert.equal(d.role,'stone');assert(a.inspectRole('ink',0).rgb.every(Number.isFinite));
 const b=p.recipe(JSON.parse(JSON.stringify(a.snapshot())));assert.deepEqual(a.palette,b.palette);
});
test('CLI samples recipes and animation into reusable palette and role JSON',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ink-palette-'));
 try{const file=path.join(tmp,'animation.json'),out=path.join(tmp,'nested','palette.json');fs.writeFileSync(file,JSON.stringify(animation().snapshot()));
 execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'palette',file,'--t','4','--out',out],{cwd:tmp,stdio:'pipe'});
 const report=JSON.parse(fs.readFileSync(out,'utf8'));assert.deepEqual(report.palette,violet.palette);assert.deepEqual(report.roles,cyan.roles);assert.equal(report.time,4);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('default recipes preserve the chosen anchors at the central shade',()=>{
 assert.equal(cyan.ramps.primary[3],0x4caaa7);assert.equal(cyan.ramps.accent[3],0xedaa67);
});
test('binding rejects changed source-role layouts and invalid unmapped grades atomically',()=>{
 const W=world(cyan);W.paletteRoles={wall:[1,2,3]};const b=p.bind(W,violet,{roles:{wall:'primary'}}),grade=b.grade.slice();
 W.paletteRoles.wall=[2,3,4];assert.throws(()=>b.update(1),/role layout/);assert.deepEqual(b.grade,grade);
 W.paletteRoles.wall=[1,2,3];W.anim={grade:[NaN]};assert.throws(()=>b.update(1),/prior grade/);assert.deepEqual(b.grade,grade);
});
