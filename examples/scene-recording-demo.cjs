'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {KIT}=require('..').load();
const PNG=require('../cli/png.js');
const files=require('../cli/asset-files.js');

const dir=path.resolve(process.argv[2]??'scene-recording-demo'), at=name=>path.join(dir,name);
const put=(name,data)=>files.json(at(name+'.json'),data);
const cli=path.resolve(__dirname,'../cli/ink-studio.js');
function run(...args) {
  const text=execFileSync(process.execPath,[cli,...args],{cwd:dir,stdio:'pipe',encoding:'utf8'}).trim();
  return text.startsWith('{')?JSON.parse(text):text;
}
const pose='/poses/cart/translation', rotation='/poses/cart/rotation', lamp='/effects/0/strength', yaw='/camera/yaw';
const style={sun:[-.37,.62,.59],amb:.23,sky:.17,palette:[
  0x101927,0x1c2a3e,0x30455d,0x53697a,0x819699,0xb4c1b4,
  0x204653,0x2d727a,0x63b4ae,0xb4ebd2,
  0x713749,0xa94c5d,0xef8277,0xffc099,
  0x684934,0xb98253,0xf4bf77,0xffe1a6
],roles:{stone:[0,1,2,3,4,5],rim:[1,2,3,4,5],mint:[6,7,8,9],coral:[10,11,12,13],
  brass:[14,15,16,17],glow:[2,6,7,8,9]}};
const box=(id,at,half,round,mat='rim',extra={})=>({id,kind:'box',at,half,round,mat,res:.036,...extra});
const cart={part:'cart'};
put('stage',{
  id:'signal-dolly',seed:43,style,camera:{target:[0,.34,.05],dist:5.04,yaw:-.16,pitch:.25,fov:.62,projection:'orthographic',sway:0},
  finish:{detail:15,dither:0},parts:{cart:{joint:[0,.13,0]}},
  effects:[{do:'lamp',at:[.03,1.13,1.1],r:1.63,strength:.45}],
  timeline:{duration:2,markers:[{id:'punch-in',time:.8},{id:'punch-out',time:1.2}],
    tracks:[{target:'/camera/pitch',keys:[{time:0,value:.21,ease:'linear'},{time:2,value:.29}]}]},
  solids:[
    box('bed',[0,-.14,-.02],[1.64,.12,.58],.10),
    box('backdrop',[0,.37,-.39],[1.59,.47,.16],.10,'stone'),
    ...[-1,1].flatMap(side=>[
      box('rail-'+side,[0,-.012,side*.20],[1.42,.044,.032],.014,'brass'),
      box('buffer-'+side,[side*1.39,.06,-.02],[.10,.133,.35],.042,'coral'),
      box('indicator-'+side,[side*1.36,.39,-.204],[.066,.257,.022],.016,'mint')
    ]),
    box('dolly-base',[0,.13,0],[.42,.127,.28],.064,'mint',cart),
    box('case',[0,.41,-.025],[.31,.275,.19],.07,'coral',cart),
    box('face',[0,.41,.125],[.252,.222,.081],.058,'stone',cart),
    {id:'lens',kind:'torus',at:[0,.45,.226],R:.113,r:.026,turn:[90,0,0],mat:'brass',res:.030,...cart},
    {id:'glass',kind:'ball',at:[0,.45,.219],r:.085,mat:'mint',res:.030,...cart},
    box('cap',[0,.713,-.039],[.206,.051,.14],.035,'brass',cart),
    ...[-1,1].map(side=>box('shoe-'+side,[side*.24,.033,0],[.09,.035,.277],.024,'stone',cart))
  ]
});

const plan=(id,channels,extra={})=>({format:KIT.sceneRecording.planFormat,version:1,id,channels,from:0,to:2,...extra});
const packet=(elapsed,...changes)=>({elapsed,changes:changes.map(([target,value])=>({target,value}))});
const saveMoves=(name,rows)=>files.write(at(name+'.ndjson'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
put('overdub-plan',plan('cart-pass',[pose,rotation,yaw,lamp],{countIn:.5}));
saveMoves('overdub-gestures',[
  packet(.25,[pose,[1.1,0,0]]),
  packet(.5,[pose,[-.75,0,0]],[rotation,[0,-.14,0]],[yaw,-.34],[lamp,.20]),
  packet(.95,[pose,[-.48,0,0]],[rotation,[0,-.12,0]],[yaw,-.26],[lamp,.38]),
  packet(1.23,[pose,[-.21,0,0]],[rotation,[0,-.07,0]],[yaw,-.14],[lamp,.52]),
  packet(1.5,[pose,[.11,0,0]],[rotation,[0,.08,0]],[yaw,.09],[lamp,.62]),
  packet(1.83,[pose,[.53,0,0]],[rotation,[0,.22,0]],[yaw,.23],[lamp,.85]),
  packet(2.10,[pose,[.75,0,0]],[rotation,[0,.13,0]],[yaw,.32],[lamp,.60]),
  packet(2.37,[pose,[.78,0,0]],[rotation,[0,0,0]],[yaw,.33],[lamp,.44])
]);
const move=run('scene-record','capture','stage.json','overdub-plan.json','--input','overdub-gestures.ndjson','--out','overdub-take.json');
assert.equal(move.ignored.countIn,1);
run('scene-record','apply','stage.json','overdub-take.json','--out','overdub.json');

put('punch-plan',plan('lamp-pass',[lamp],{countIn:.25,mode:'punch',punch:[.8,1.2]}));
saveMoves('punch-gestures',[
  packet(.51,[lamp,4]),packet(1.05,[lamp,.54]),packet(1.15,[lamp,2.15]),
  packet(1.25,[lamp,3.8],[yaw,-.5]),packet(1.35,[lamp,2.8]),packet(1.435,[lamp,.72]),
  packet(1.51,[lamp,7])
]);
const cut=run('scene-record','capture','overdub.json','punch-plan.json','--input','punch-gestures.ndjson','--out','punch-take.json');
assert.equal(cut.ignored.outside,2);
assert.equal(cut.ignored.unarmed,1);
run('scene-record','apply','overdub.json','punch-take.json','--out','recorded.json');

const w=300,h=176,fps=8, view=['--w',String(w),'--h',String(h),'--px','1','--raw','--ortho'];
const times=[.5,1,1.5];
const images=['overdub.json','recorded.json'].map((source,row)=>times.map((time,i)=>{
  const file='pose-'+row+'-'+i+'.png';
  run('render',source,'--t',String(time),...view,'--out',file);
  return PNG.raster(at(file));
}));
assert.deepEqual(images[0][0].data,images[1][0].data);
assert.notDeepEqual(images[0][1].data,images[1][1].data);
assert.deepEqual(images[0][2].data,images[1][2].data);
run('clip','recorded.json','--from','0','--to','2','--fps',String(fps),...view,'--out','signal-dolly-loop.png');

const gap=12,W=3*w+gap*4,H=2*h+124;
const commands=[{type:'rect',rect:[0,0,W,H],fill:'#101927'}];
const text=(text,x,y,scale=1,color='#f1dfca')=>commands.push({type:'text',text,at:[x,y],scale,color});
text('SIGNAL DOLLY',gap,13,3);
for(const [i,label] of ['BEFORE  .50 S','IN PUNCH  1.00 S','AFTER  1.50 S'].entries()) text(label,gap+i*(w+gap),49,2);
text('CART AND CAMERA OVERDUB',gap,75,1,'#9ed6c6');
text('LAMP PUNCH',gap,103+h,1,'#ffcb94');
const sheet=KIT.procedural.drawing2d.render({width:W,height:H,edges:'hard',commands});
for(const [r,row] of images.entries()) for(const [i,image] of row.entries()) for(let y=0;y<h;y++)
  sheet.data.set(image.data.subarray(y*w*4,(y+1)*w*4),((y+87+r*(h+28))*W+gap+i*(w+gap))*4);
files.write(at('signal-dolly.png'),PNG.encode(W,H,sheet.data,4));
console.log(at('signal-dolly.png'));
console.log(at('signal-dolly-loop.png'));
