const fs=require('node:fs');
const path=require('node:path');
const runWebGL=require('../cli/look-webgl.js');
const build=require('./surface-history.js');
const {write}=require('../cli/png.js');

const [dir='pressure-deck-review',...flags]=process.argv.slice(2);
const output=path.resolve(dir);
fs.mkdirSync(output,{recursive:true});
const count=flags.includes('--still')?8:20;
const {poses,width,height,...meta}=runWebGL({hardware:flags.includes('--hardware')},build,(kit,fixture,backend,count)=>{
  const {world,width,height,sample}=fixture(kit);
  const options={offscreen:true,colored:false,dither:0}, fresh=backend(width,height,options), reused=backend(width,height,options);
  const poses=[];
  try{
    for(let i=0;i<count;i++){
      const frame=sample(i,count);
      let report;
      fresh.draw(world,{...frame,surfaceHistory:false});
      reused.draw(world,{...frame,surfaceHistoryFrame:value=>{report=value;}});
      const {mask,...details}=report;
      let flags='';
      for(const code of mask)flags+=String.fromCharCode(code);
      poses.push({time:frame.time,baseline:fresh.image(),history:reused.image(),mask:btoa(flags),...details});
    }
    return {poses,width,height,driver:reused.driver};
  }finally{fresh.close();reused.close();}
},count);
const colors=[[39,55,85],[95,160,148],[22,29,45],[125,117,170],[210,93,128],[235,162,87]];
for(const [i,frame] of poses.entries()){
  const index=String(i).padStart(2,'0');
  for(const mode of ['baseline','history'])write(path.join(output,mode+'-'+index+'.png'),
    width,height,Buffer.from(frame[mode],'base64'));
  const mask=Buffer.from(frame.mask,'base64'), rgb=Buffer.alloc(mask.length*3);
  for(let p=0;p<mask.length;p++)rgb.set(colors[mask[p]],p*3);
  write(path.join(output,'checks-'+index+'.png'),width,height,rgb);
}
let changed=0;
for(const frame of poses){
  const a=Buffer.from(frame.baseline,'base64'),b=Buffer.from(frame.history,'base64'),mask=Buffer.from(frame.mask,'base64');
  for(let p=0;p<mask.length;p++){
    const q=p*3;
    if(a[q]===b[q] && a[q+1]===b[q+1] && a[q+2]===b[q+2])continue;
    if(mask[p]!==1)throw new Error('History changed a rejected pixel at time '+frame.time);
    changed++;
  }
}
fs.writeFileSync(path.join(output,'review.json'),JSON.stringify({width,height,...meta,changed,
  poses:poses.map(({baseline,history,mask,...pose})=>pose)},null,2)+'\n');
