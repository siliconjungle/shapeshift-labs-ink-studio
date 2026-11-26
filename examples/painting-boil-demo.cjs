'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {KIT} = require('..').load();
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'painting-boil-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const at = (...parts) => path.join(out, ...parts);
const put = (name, value) => files.json(at(name + '.json'), value);
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding:'utf8', stdio:'pipe' }));

const camera = {target:[0,.08,.17],dist:4.30,projection:'orthographic',yaw:-.055,pitch:.068,sway:0,fov:.68};
const style={sun:[-.39,.57,.77],amb:.30,sky:.16,
  palette:[0x111c2b,0x193246,0x284b5b,0x466b73,0x709091,0xa5b0a1,
    0x9b4f37,0xd4774f,0xf6ad62,0xffda92,0xffffc5,
    0x234859,0x3a767e,0x62b4a5,0xa8deae,0xcde8b5,
    0x3f344d,0x784a62,0xb87681,0xe0a4a0],
  roles:{board:[1,2,3,4,5],paper:[1,2,2,3],orange:[6,7,8,9,10],jade:[13,14,15],rose:[17,18,19]}};
const box=(id,at,half,round,mat='board')=>({id,kind:'box',at,half,round,mat,res:.037});
const stud=(id,at)=>({id,kind:'ball',at,r:.049,mat:'orange',res:.034});
put('stage',{id:'night-lantern',seed:45,camera,style,finish:{detail:16,dither:0},
  solids:[box('outer',[0,.04,-.23],[1.57,1.11,.18],.16),box('drawing',[0,.04,-.03],[1.43,.98,.23],.10,'paper'),
    ...[-1,1].flatMap(x=>[-1,1].map(y=>stud('pin-'+x+'-'+y,[x*1.24,y*.80+.04,.205])))]});
put('view',{w:294,h:224,camera,raw:true});

const attachment={kind:'surface',slot:'plate',snap:{mode:'surface',direction:[0,0,1],maxDistance:.28}};
const cadence={fps:12,holds:[2,3,2,3],loop:true};
const draw=(id,mat,radius,xy,boil)=>({id,mat,brush:{kind:'sphere',radius},step:.038,res:.04,
  poses:xy.map(([x,y],i)=>({point:[x,y,.36],pressure:i===0?.86:1})),attachment,relief:{mode:'flat'},
  ...(boil&&{boil})});
const protect=[{points:[[-.66,.54,.20],[-.46,.64,.20],[.47,.64,.20],[.66,.54,.20]],radius:.16,feather:.30},
  {points:[[-.49,-.59,.20],[.49,-.59,.20]],radius:.13,feather:.35}];
const config=(seed,amplitude,scale)=>({seed,amplitude,scale,cadence});
const marks=[
  draw('frame','jade',.047,[[-.66,.54],[-.46,.64],[.47,.64],[.66,.54],[.62,.32],[.61,-.35],
    [.49,-.59],[-.49,-.59],[-.62,-.34],[-.65,.29],[-.66,.54]],{...config(40,.085,.44),protect}),
  draw('hanger','jade',.046,[[-.28,.64],[-.22,.77],[-.09,.86],[.09,.86],[.22,.77],[.28,.64]]),
  draw('flame','orange',.061,[[-.28,-.38],[-.38,-.18],[-.29,.01],[-.10,.14],[.05,.46],[.19,.23],
    [.18,.06],[.32,.21],[.38,.02],[.33,-.20],[.14,-.40],[-.10,-.45],[-.28,-.38]],config(53,.11,.41)),
  draw('ember','orange',.041,[[-.07,-.31],[-.15,-.16],[-.02,-.05],[.06,.13],[.17,-.12],[.11,-.29]],config(65,.10,.34)),
  ...[-1,1].flatMap(s=>[
    draw('ray-high-'+s,'rose',.030,[[s*.86,.31],[s*1.10,.45]],config(11,.07,.36)),
    draw('ray-low-'+s,'rose',.032,[[s*.86,-.14],[s*1.14,-.22]],config(12,.075,.30)),
    draw('speck-'+s,'orange',.044,[[s*.98,.07]],config(22,.08,.44))
  ])
];
put('placement',{id:'ink',bindings:{plate:'drawing'},painting:{format:KIT.authoring.paintings3d.format,version:1,id:'lantern',marks}});
run('painting-3d','apply','stage.json','placement.json','--out','scene.json');
run('painting-cels','init','scene.json','--id','ink','--fps','12','--out','seed.json');
put('hold-edit',{format:'ink-studio/painting-cel-edit',version:1,operations:[{op:'set-hold',id:'cel-1',hold:10}]});
run('painting-cels','edit','scene.json','seed.json','hold-edit.json','--out','clip.json');
const exportClip=run('painting-cels','export','scene.json','clip.json','--view','view.json','--out','loop');
assert.deepEqual(exportClip.frames.map(row=>row.hold),[2,3,2,3]);

const read=(...parts)=>PNG.raster(at(...parts));
const stamps=[['.0','FIRST EXPOSURE'],['.11','HELD TICK'],['.18','NEXT EXPOSURE']];
for (const [i,[time]] of stamps.entries())
  run('painting-cels','preview','scene.json','clip.json','--at',time,'--view','view.json','--out','review-'+i);
const shots=stamps.map((_,i)=>read('review-'+i,'active.png'));
assert.deepEqual(shots[0].data,shots[1].data);
assert.notDeepEqual(shots[1].data,shots[2].data);
assert.deepEqual(shots[2].data,read('loop',exportClip.frames[1].image).data);
run('painting-cels','sample','scene.json','clip.json','--at','.18','--out','editable-exposure.json');

const {w,h}=shots[0], gap=14, W=3*w+gap*4, H=h+84;
const commands=[{type:'rect',rect:[0,0,W,H],fill:'#0e1927'}];
const text=(text,x,y,scale=1,color='#f3d9b4')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('LANTERN INK',gap,10,3);
text('SEEDED PAINT BOIL',W-133,18,1,'#a3c9c5');
for(const [i,[,label]] of stamps.entries()) text(label,gap+i*(w+gap),43,2);
text('TOP AND LOWER CONTOURS PINNED',gap,H-16,1,'#9bd8c7');
text('PIXEL-IDENTICAL HOLD',gap+w+gap,H-16,1,'#9bd8c7');
text('INTERIOR LINES SHIFT',gap+2*(w+gap),H-16,1,'#e6ad83');
const sheet=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for(const [i,image] of shots.entries()) for(let y=0;y<h;y++)
  sheet.data.set(image.data.subarray(y*w*4,(y+1)*w*4),((y+60)*W+gap+i*(w+gap))*4);
files.write(at('lantern-ink-review.png'),PNG.encode(W,H,sheet.data,4));
console.log(at('lantern-ink-review.png'));
console.log(at('loop','painting.png'));
