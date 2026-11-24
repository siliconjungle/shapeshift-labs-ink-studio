const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {write,json} = require('../../cli/asset-files.js');
const {pose} = require('../../cli/diarama-pose.js');
const settings = require('./warden-plan.json');

const directory=path.resolve(process.argv[2] ?? 'warden-boundaries');
const kit=ink.load(), scene=require('./warden-key.js')(kit), world=scene.build(scene.seed);
const width=152,height=120,fps=12,count=18;
const originals=[], final=[];
function render(i,extra={},passes) {
  const t=i/fps, phase=i/(count-1);
  return ink.render(world,{w:width,h:height,px:1,t,yaw:-.42+.54*phase,...extra,passes});
}
const report=ink.renderBoundaryShot({
  width,height,count,settings,
  draw(i,options,lane,passes) {
    if (lane==='native') pose(world,i/fps,{kit});
    const frame=render(i,options,passes);
    if (lane==='native') originals[i]=frame;
    return frame;
  },
  output(i,options) {
    pose(world,i/fps,{kit});
    final[i]=render(i,options);
  },
  progress(phase,i) { if (i%6===0) process.stdout.write(phase+' '+i+'\n'); }
});

const pairs=[];
for (const [i,left] of originals.entries()) {
  const right=final[i], w=2*width+4, rgb=new Uint8Array(w*height*3).fill(29);
  for (let y=0;y<height;y++) {
    rgb.set(left.rgb.subarray(y*width*3,(y+1)*width*3),y*w*3);
    rgb.set(right.rgb.subarray(y*width*3,(y+1)*width*3),(y*w+width+4)*3);
  }
  const pathAt=String(i).padStart(2,'0');
  write(path.join(directory,'pair-'+pathAt+'.png'),PNG.encode(w,height,rgb));
  pairs.push({w,h:height,rgb});
}
PNG.animate(path.join(directory,'comparison.png'),pairs,fps);
json(path.join(directory,'report.json'),{...report,fps});
console.log('Native boundary switches',report.transitions);
