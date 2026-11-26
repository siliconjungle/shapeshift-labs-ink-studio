'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KIT } = require('..').load();
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

const out = path.resolve(process.argv[2] ?? 'painting-cels-demo');
const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const at = (...parts) => path.join(out, ...parts);
const put = (name, value) => files.json(at(name + '.json'), value);
const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli,...args], {
  cwd: out, encoding: 'utf8', stdio: 'pipe'
}));

const camera = { target:[0,.10,.3], dist:4.12, pitch:.10, yaw:-.14, projection:'orthographic', sway:0 };
const style = { sun:[-.47,.58,.65], amb:.25, sky:.19,
  palette: [0x0e1723,0x142b3b,0x224052,0x2e4e60,0x496875,0x72959b,0xa7b6ad,
    0x4c2944,0x923d5b,0xd97586,0xf3a8a1,0x15434f,0x2d7e82,0x65b8a8,0xaae7bc,
    0x6d3928,0xac5c3f,0xea965a,0xffd28d,0xffecb6],
  roles:{ frame:[1,2,3,4,5,6], coral:[7,8,9,10], jade:[11,12,13,14], gold:[15,16,17,18,19] }
};
const box = (id, p, half, round, mat='frame') => ({ id, kind:'box', at:p, half, round, mat, res:.044 });
const ball = (id, p, r) => ({ id, kind:'ball', at:p, r, mat:'frame', res:.035 });
put('stage',{ id:'night-signal', camera, style, finish:{ detail:15, dither:0 },
  solids:[box('rim',[0,0,-.28],[1.89,1.22,.18],.18),box('slate',[0,0,-.1],[1.75,1.09,.15],.14),
    ...[-1,1].flatMap(s=>[-1,1].map(t=>ball('pin-'+s+'-'+t,[1.54*s,.91*t,.05],.047)))] });
put('view',{w:344,h:236,camera,raw:true,opacity:.72});

const p = (point,pressure=1)=>({point,pressure});
const mark=(id,mat,radius,poses)=>({id,mat,brush:{kind:'sphere',radius},step:.037,res:.037,poses});
const poses=(spread, lift, tip, side) => {
  const x = n=>side*n*spread;
  return [
    p([x(.08),.14,.35],.7),p([x(.40),.41+lift*.28,.38],.9),p([x(.96),.52+lift*.64,.44+tip*.16],1.1),
    p([x(1.13),.30+lift*.72,.65+tip*.22],1),p([x(.92),.06+lift*.76,.53+tip*.30],.92),
    p([x(.68),-.15+lift*.62,.44+tip*.22],.82),p([x(.45),-.29+lift*.37,.39],.8),p([x(.13),-.16,.32],.52)
  ];
};
const wings = (spread,lift,tip) => [-1,1].map(side=>({
  id:side<0?'wing-left':'wing-right',poses:poses(spread,lift,tip,side)
}));
const [left,right]=wings(.65,.22,.15);
const marks = [
  mark(left.id,'jade',.065,left.poses),mark(right.id,'jade',.065,right.poses),
  mark('body','gold',.086,[p([0,-.32,.32],.49),p([0,-.12,.41],1),p([0,.15,.47],1.17),p([0,.28,.47],.82)]),
  mark('feelers','gold',.037,[p([-.17,.44,.46],.7),p([-.11,.32,.48]),p([0,.23,.48],.9),
    p([.12,.33,.49]),p([.17,.44,.48],.75)]),
  { ...mark('dial-line','coral',.032,[p([-.79,-.72,.15]),p([.79,-.72,.15])]),
    relief:{mode:'flat'},attachment:{kind:'surface',slot:'dial',snap:{mode:'surface',direction:[0,0,1],maxDistance:.25}} }
];
put('placement',{id:'moth',bindings:{dial:'slate'},painting:{id:'signal-moth',version:1,
  format:KIT.authoring.paintings3d.format,marks}});
run('painting-3d','apply','stage.json','placement.json','--out','scene.json');
run('painting-cels','init','scene.json','--id','moth','--fps','12','--out','seed.json');
const poseEdit = (id, after, hold, spread, lift, depth, motes) => [
  {op:'insert',id,after,from:'cel-1',hold},
  {op:'edit-marks',id,edits:[
    ...wings(spread,lift,depth).map(({id,poses})=>({op:'set',id,patch:{poses}})),
    ...motes.map(([x,y,z],i)=>{
      const {id,...spark}=mark('spark-'+i,'gold',.055,[p([x,y,z])]);
      return {op:'add',id,mark:spark};
    })
  ]}
];
put('cels-edit',{format:'ink-studio/painting-cel-edit',version:1,operations:[
  {op:'set-hold',id:'cel-1',hold:2},
  ...poseEdit('open','cel-1',3,1.24,.14,.2,[[-1.52,.56,.47],[1.48,.42,.53]]),
  ...poseEdit('lift','open',2,.83,.63,.7,[[-1.64,.72,.45],[1.64,.71,.48]]),
  ...poseEdit('fold','lift',2,.46,-.07,-.48,[[-1.42,.49,.41],[1.39,.61,.51]])
]});
run('painting-cels','edit','scene.json','seed.json','cels-edit.json','--out','moth-cels.json');
const preview=run('painting-cels','preview','scene.json','moth-cels.json','--frame','open','--view','view.json','--out','review');
const sequence=run('painting-cels','export','scene.json','moth-cels.json','--view','view.json','--out','flipbook');
assert(preview.neighbors.every(row=>row.pixels>50 && row.shared.includes('wing-left') && row.changed.includes('wing-left')));
assert.deepEqual(sequence.cels.map(row=>row.hold),[2,3,2,2]);
run('painting-cels','sample','scene.json','moth-cels.json','--frame','lift','--out','editable-lift.json');

const { w, h } = PNG.raster(at('review','active.png'));
const gap=14, W=3*w+gap*4, H=h+86;
const cards=[['previous.png','01  PREVIOUS'],['onion.png','02  ACTIVE + ONION SKIN'],['next.png','03  NEXT']];
const ink='#efdeb9', pale='#a4c2c9';
const commands=[
  {type:'rect',rect:[0,0,W,H],fill:'#0b1521'},
  {type:'text',text:'SIGNAL MOTH',at:[gap,12],scale:3,color:ink},
  {type:'text',text:'RETAINED 3D PAINTING CEL REVIEW',at:[W-268,19],scale:1,color:pale},
  ...cards.map(([,title],i)=>({type:'text',text:title,at:[gap+i*(w+gap),46],scale:2,color:i===0?'#ff90aa':i===2?'#90dfcd':ink})),
  {type:'text',text:'PINK  PREVIOUS POSE',at:[gap,H-17],scale:1,color:'#ff90aa'},
  {type:'text',text:'MINT  NEXT POSE',at:[gap+(w+gap),H-17],scale:1,color:'#90dfcd'},
  {type:'text',text:'SAME CAMERA  /  SHARED WING IDS',at:[gap+2*(w+gap),H-17],scale:1,color:pale}
];
const page=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for (const [i,[name]] of cards.entries()) {
  const frame=PNG.raster(at('review',name));
  for (let y=0; y<h; y++) page.data.set(frame.data.subarray(y*w*4,(y+1)*w*4),
    ((66+y)*W+gap+i*(w+gap))*4);
}
files.write(at('signal-moth-review.png'),PNG.encode(W,H,page.data,4));
console.log(at('signal-moth-review.png'));
console.log(at('flipbook','painting.png'));
