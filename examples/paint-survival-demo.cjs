'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const files = require('../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'paint-survival-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const put = (name, document) => files.json(path.join(out, name + '.json'), document);
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: out, encoding: 'utf8', stdio: 'pipe' }));

const camera = { target:[0,.03,.21],dist:3.7,fov:.66,projection:'orthographic' };
const style = { sun:[-.41,.58,.77],amb:.28,sky:.21,
  palette:[0x111e2b,0x183445,0x264552,0x3f6371,0x709397,0x9fb3a0,
    0x57312e,0x884c37,0xc47c4a,0xf3b971,0xffdb99,
    0x173a45,0x265b61,0x508d80,0x83c3a0,0xbfe2b4,
    0x4c3347,0x814b61,0xad7884,0xe0aba2],
  roles:{metal:[1,2,3,4,5],amber:[6,7,8,9,10],jade:[11,12,13,14,15],rose:[16,17,18,19]} };
const box = (id, at, half, round, mat, res) => ({id,kind:'box',at,half,round,mat,res});
const knob = (id,at) => ({id,kind:'ball',at,r:.056,mat:'amber',res:.04});
put('housing',{id:'tide-relay',seed:64,camera:{...camera,yaw:0,pitch:0,sway:0},style,
  finish:{detail:17,dither:0,look:{stableDetail:true}},
  solids:[box('bezel',[0,0,-.16],[1.46,.84,.21],.17,'metal',.037),
    box('face',[0,0,.015],[1.33,.71,.19],.105,'metal',.021),
    ...[-1,1].flatMap(x=>[-1,1].map(y=>knob('screw-'+x+'-'+y,[x*1.16,y*.56,.216])))] });

const face = {kind:'surface',slot:'front',snap:{mode:'surface',direction:[0,0,1],maxDistance:.29}};
const pose = ([x,y,z=.36]) => ({point:[x,y,z]});
const stamp = (id, mat, radius, points) => ({
  id,mat,brush:{kind:'sphere',radius}, poses:points.map(pose), attachment:face, relief:{mode:'flat'},res:.03
});
const holes = Array.from({length:12},(_,i)=>{
  const a=Math.PI*2*i/12;
  return stamp('stamp-'+i,'amber',.025,[[-.60+.29*Math.cos(a),.075+.27*Math.sin(a)]]);
});
const core = [stamp('iris-top','amber',.021,[[-.77,.09],[-.60,.195],[-.43,.09]]),
  stamp('iris-low','amber',.021,[[-.77,.06],[-.60,-.06],[-.43,.06]])];
const ribs = Array.from({length:5},(_,i)=>stamp('rib-'+i,'jade',.022,[
  [.05+i*.145,-.26],[.19+i*.145,.01],[.33+i*.135,.20]
]));
const spark = stamp('crown','amber',.021,[[.63,.49],[.74,.58],[.84,.49]]);
const ticks = Array.from({length:5},(_,i)=>stamp('tick-'+i,'rose',.019,[[-.35+i*.16,-.44],[-.3+i*.16,-.49]]));
put('placement',{id:'ink',bindings:{front:'face'},painting:{id:'relay-inlay',format:KIT.authoring.paintings3d.format,
  version:1,marks:[...holes,...core,...ribs,spark,...ticks]}});
run('painting-3d','apply','housing.json','placement.json','--out','scene.json');

const measure=(a,b)=>({span:[a,b]});
const region=(id, marks, priority, minPixels, measure, fallback)=>({id,placement:'ink',marks:marks.map(item=>item.id),
  priority,minPixels,measure,fallback});
const {id:_id,relief:_relief,...pigment} = stamp('unused','amber',.245,[[-.60,.07]]);
const spec={format:'ink-studio/paint-survival',version:1,camera,raw:true,fallbackBudget:3,pixelBudget:3,
  resolutions:[{id:'close',w:148,h:100},{id:'medium',w:80,h:54},{id:'sprite',w:42,h:28}],
  angles:[{id:'front',yaw:0,pitch:.07},{id:'three-quarter',yaw:.49,pitch:.16},{id:'oblique',yaw:.89,pitch:.07}],
  regions:[
    region('iris',[...holes,...core],80,1.6,measure([-.623,.07,.206],[-.577,.07,.206]),{kind:'pigment',mark:pigment}),
    region('ribs',ribs,60,1.5,measure([.315,.02,.205],[.364,.02,.205]),{kind:'line',attachment:face,
      points:[[.15,-.23,.36],[.49,-.032,.36],[.85,.23,.36]],radius:.057,mat:'jade',res:.032}),
    region('crown',[spark],100,1.1,measure([.717,.54,.206],[.747,.54,.206]),{kind:'silhouette',
      at:[.74,.60,.252],stamp:['.#.','#.#'],color:'#ffdb99',bias:.026}),
    region('ticks',ticks,5,1.45,measure([-.17,-.44,.206],[-.130,-.44,.206]),{kind:'line',attachment:face,
      points:[[-.34,-.445,.36],[.34,-.445,.36]],radius:.02,mat:'rose',res:.025})
  ]};
put('plan',spec);
const review=run('paint-survival','review','scene.json','plan.json','--out','review');
const frame=review.cases.find(row=>row.id==='front/sprite');
assert.deepEqual(frame.regions.map(row=>row.choice),['pigment','line','silhouette','budget']);
assert.equal(frame.regions[2].protected.status,'kept');
assert(review.cases[0].regions.every(row=>row.choice==='detail'));
const result=run('paint-survival','apply','scene.json','plan.json','review/report.json','--case','front/sprite','--out','sprite-scene.json');
assert.deepEqual(result.regions,frame.regions);
console.log(path.join(out,'review',review.sheet));
console.log(path.join(out,'sprite-scene.json'));
