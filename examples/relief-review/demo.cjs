/* Review the same carved seal at three native camera ranges. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..');
const PNG=require('../../cli/png.js');
const kit=ink.load();
const scene=path.join(__dirname,'../distance-relief.js');
const out=path.resolve(process.argv[2]??'seal-review');
const file=name=>path.join(out,name);
const save=(name,data)=>fs.writeFileSync(file(name),JSON.stringify(data,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
const w=160,h=104;
const camera=(dist,yaw,pitch)=>({target:[0,1.90,.45],dist,yaw,pitch,ortho:true,fov:.66});
const light={from:[-.84,.42,.38],to:[.79,.49,.43],ambient:.34,intensity:.72};
const plan={format:'ink-studio/relief-review',version:1,asset:'cataract-seal',width:w,height:h,fps:8,raw:true,ranges:[
  {id:'grazing',from:camera(5.65,1.01,.17),to:camera(6.65,.74,.23),frames:5,light},
  {id:'middle',from:camera(9.5,.40,.17),to:camera(12.3,.25,.13),frames:5,light},
  {id:'wide',from:camera(20,.33,.09),to:camera(26,.23,.12),frames:5,light}
]};
const choices={grazing:'geometry',middle:'normal',wide:'painted'};
function cli(...args){
  execFileSync(process.execPath,[path.join(__dirname,'../../cli/ink-studio.js'),...args],{stdio:'pipe'});
}

fs.mkdirSync(out,{recursive:true});
save('plan.json',plan);
save('choices.json',choices);
cli('relief-review',scene,'--plan',file('plan.json'),'--out',file('review'));
cli('relief-review','approve',file('review/report.json'),'--choices',file('choices.json'),'--out',file('approval.json'));
const report=read('review/report.json'), approval=read('approval.json'), world=require(scene)(kit).build();
const approved=[];
for(const range of report.ranges){
  const sample=range.frames.light[2];
  let selection;
  const image=ink.render(world,{...sample.camera,w,h,px:1,raw:true,lockCamera:true,liveSun:sample.light,
    reliefApproval:approval,reliefLODFrame:rows=>{[selection]=rows;}});
  assert.equal(selection.reason,'approved-range');
  assert.equal(selection.approvedRange,range.id);
  assert.equal(selection.tier,choices[range.id]);
  approved.push({id:range.id,camera:sample.camera,selection});
  PNG.write(file('approved-'+range.id+'.png'),w,h,image.rgb);
}
save('approved-views.json',approved);

const width=1068,height=989,commands=[];
const inkBg='#101e29', mute='#9cb6b7', paper='#e9e9d5', mint='#8ad7b8', gold='#dfae77';
const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale,color=paper)=>commands.push({type:'text',text,at:[x,y],scale,color});
const cols=report.tiers, labels={geometry:'GEOMETRY',normal:'NORMAL RELIEF',painted:'TEXEL PAINT'};
const number=n=>Number(n.toFixed(1)).toString();
rect(0,0,width,height,inkBg);
rect(22,23,14,3,mint);
text('INK STUDIO / RELIEF REVIEW',47,18,2,mint);
text('Cataract Seal',21,44,4);
text('THE SAME CARVING IN THREE MATERIAL DESTINATIONS',22,84,1,mute);
for(const [col,tier] of cols.entries()){
  const x=22+col*350,{triangles,materialTexels}=report.ranges[0].summary.motion[tier];
  text(labels[tier],x,109,2,gold);
  text(triangles+' TRIANGLES   /   '+materialTexels+' MATERIAL TEXELS',x,130,1,mute);
}
const labelsByRange={grazing:'GRAZING CLOSE-UP',middle:'WORKING DISTANCE',wide:'WIDE SHOT'};
for(const [row,range] of report.ranges.entries()){
  const y=155+row*266;
  text(labelsByRange[range.id],22,y,1,paper);
  text('APPROVED '+labels[choices[range.id]],790,y,1,mint);
  for(const [i,tier] of cols.entries()){
    const x=22+i*350;
    rect(x-1,y+15,w*2+2,h*2+2,tier===choices[range.id]?mint:'#365360');
    const motion=range.summary.motion[tier], response=range.summary.light[tier].lightResponseRmseMax;
    text('PROFILE '+number(motion.silhouetteErrorMax*100)+'%   MOTION '+number(motion.motionResidualRmseMax)+'   KEY '+number(response),
      x,y+237,1,tier===choices[range.id]?mint:mute);
  }
}
rect(22,952,width-44,1,'#35505a');
text('160 X 104 NATIVE PIXELS AT 2X   /   PROFILE ERROR AND MOTION VS GEOMETRY   /   KEY RESPONSE IN RGB LEVELS',
  22,969,1,mute);
const board=kit.KIT.procedural.drawing2d.render({width,height,commands,edges:'hard'});
for(const [row,range] of report.ranges.entries())for(const [col,tier] of cols.entries()){
  const {rgb}=PNG.read(file('review/'+range.frames.motion[2].lanes[tier].image));
  const x=22+col*350,y=171+row*266;
  for(let j=0;j<h*2;j++)for(let i=0;i<w*2;i++){
    const src=(Math.floor(j/2)*w+Math.floor(i/2))*3;
    board.data.set(rgb.subarray(src,src+3),((y+j)*width+x+i)*4);
  }
}
fs.writeFileSync(file('Cataract-Seal.png'),PNG.encodeFrame(PNG.packRGBA(board)));
