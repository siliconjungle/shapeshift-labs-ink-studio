const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const {write,json} = require('../../cli/asset-files.js');
const look = require('./relay-look.json');

const directory=path.resolve(process.argv[2] ?? 'relay-path-ink');
const scene=require('./relay-pool.js')(ink.load()), world=scene.build(scene.seed);
const width=160,height=128,samples=16,count=12,fps=10;
const settings={width,height,samples,bounces:0,seed:19};
const reports=[], paired=[];
const neutral={reflectors:look.reflectors};
for (let i=0;i<count;i++) {
  const u=i/(count-1), phase=u*u*(3-2*u), time=i/fps;
  const view={t:time,yaw:-.17+.31*phase,pitch:.505+.013*phase};
  const base=ink.renderPathInk(world,{...view,pathInk:neutral},settings);
  const styled=ink.renderPathInk(world,{...view,pathInk:look},settings);
  const w=width*2+4, rgb=new Uint8Array(w*height*3).fill(28), map=new Uint8Array(width*height*3);
  let changed=0, changedWithoutInk=0;
  const key=String(i).padStart(2,'0');
  for (let y=0;y<height;y++) {
    rgb.set(base.rgb.subarray(y*width*3,(y+1)*width*3),y*w*3);
    rgb.set(styled.rgb.subarray(y*width*3,(y+1)*width*3),(y*w+width+4)*3);
  }
  for (let p=0;p<width*height;p++) {
    const {reflection,transmission,lines}=styled.inkCoverage;
    map[p*3]=Math.max(reflection[p],lines[p]);
    map[p*3+1]=Math.max(lines[p],transmission[p]);
    map[p*3+2]=transmission[p];
    if ([0,1,2].some(c=>base.rgb[p*3+c]!==styled.rgb[p*3+c])) {
      changed++;
      if (!reflection[p]&&!transmission[p]) changedWithoutInk++;
    }
  }
  paired.push({w,h:height,rgb});
  write(path.join(directory,'pair-'+key+'.png'),PNG.encode(w,height,rgb));
  write(path.join(directory,'routes-'+key+'.png'),PNG.encode(width,height,map));
  reports.push({time,...styled.stats,changed,changedWithoutInk});
  if (i%3===0) console.log('Compared frame',i+1);
}
PNG.animate(path.join(directory,'comparison.png'),paired,fps);
json(path.join(directory,'report.json'),{scene:world.id,settings,fps,frames:reports});
