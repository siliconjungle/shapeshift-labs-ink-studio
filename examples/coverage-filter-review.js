const fs = require('node:fs');
const path = require('node:path');
const runWebGL = require('../cli/look-webgl.js');
const fixture = require('./coverage-filter.js');
const { write } = require('../cli/png.js');

const [dir='coverage-filter-review',...flags]=process.argv.slice(2);
const out=path.resolve(dir);
fs.mkdirSync(out,{recursive:true});
const frameCount=flags.includes('--still')?4:20;
const {frames,...review}=runWebGL({hardware:flags.includes('--hardware')},fixture,(kit,build,backend,count)=>{
  const {world,width,height,camera}=build(kit);
  const renderer=backend(width,height,{offscreen:true,colored:false,dither:0});
  const frames=[];
  try {
    for(let i=0;i<count;i++){
      const captured={};
      for(const [id,coverageFilter] of Object.entries({center:false,filtered:true,tuned:world.look.coverageFilter})){
        renderer.draw(world,{camera:camera(i/count),coverageFilter});
        captured[id]=renderer.image();
      }
      frames.push(captured);
    }
    return {frames,width,height,driver:renderer.driver};
  } finally {renderer.close();}
},frameCount);
for(const [i,frame] of frames.entries())for(const [mode,image] of Object.entries(frame))
  write(path.join(out,mode+'-'+String(i).padStart(2,'0')+'.png'),review.width,review.height,Buffer.from(image,'base64'));
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({...review,frameCount,modes:['center','filtered','tuned']},null,2)+'\n');
