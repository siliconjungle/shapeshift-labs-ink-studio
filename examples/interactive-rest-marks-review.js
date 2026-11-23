const fs = require('node:fs');
const path = require('node:path');
const runWebGL = require('../cli/look-webgl.js');
const fixture = require('./interactive-rest-marks.js');
const { write } = require('../cli/png.js');

const [dir='interactive-rest-marks-review',...flags]=process.argv.slice(2);
const output=path.resolve(dir);
fs.mkdirSync(output,{recursive:true});
const frameCount=flags.includes('--still')?4:20;

const result=runWebGL({hardware:flags.includes('--hardware')},fixture,(kit,build,backend,count)=>{
  const {world,width,height,pose}=build(kit);
  const renderer=backend(width,height,{offscreen:true});
  const frames=[];
  try {
    for(let i=0;i<count;i++){
      const t=2*Math.PI*i/count;
      pose(t);
      const captures={};
      for(const [id,settings] of Object.entries({engraving:{raw:true},object:{},screen:{ditherSpace:'screen'}})){
        renderer.draw(world,{time:t,dither:.47,changedRows:undefined,...settings});
        captures[id]=renderer.image();
      }
      frames.push(captures);
    }
    return { width,height,frames,driver:renderer.driver };
  } finally { renderer.close(); }
},frameCount);
const {frames,...report}=result;
for(const [i,frame] of frames.entries()) for(const [id,data] of Object.entries(frame))
  write(path.join(output,id+'-'+String(i).padStart(2,'0')+'.png'),report.width,report.height,Buffer.from(data,'base64'));
fs.writeFileSync(path.join(output,'review.json'),JSON.stringify({...report,frameCount,modes:['engraving','object','screen']},null,2)+'\n');
