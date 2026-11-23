const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const fixture=require('./protected-pixels.js');
const runWebGL=require('../cli/look-webgl.js');
const {write}=require('../cli/png.js');

const [dir='protected-pixels-review',...flags]=process.argv.slice(2);
const out=path.resolve(dir);
fs.mkdirSync(out,{recursive:true});
const {carrier}=fixture(ink.load());
const atlas=ink.spriteAtlas(carrier,{width:80,height:48,directions:1,maps:['depth'],view:{dist:6.9,raw:true}});
const baked={metadata:atlas.metadata,images:Object.fromEntries(Object.entries(atlas.images).map(([id,data])=>[id,Array.from(data)]))};
const count=flags.includes('--still')?4:20;
const {poses,...meta}=runWebGL({hardware:flags.includes('--hardware')},fixture,(kit,build,backend,{baked,count})=>{
  const {world,view,width,height}=build(kit,baked), r=backend(width,height,{offscreen:true,colored:false,dither:0});
  const poses=[];
  try{
    for(let i=0;i<count;i++){
      const time=i/count*2.8, camera=view(i/count), options={camera,time,changedRows:undefined};
      world.anim.update(1/10,time);
      let representation;
      const images={},marks={};
      for(const [mode,protectedPixels] of Object.entries({off:false,tight:{budget:2},full:{budget:60}})){
        r.draw(world,{...options,protectedPixels,protectedPixelsFrame:report=>{marks[mode]=report;},
          spriteReconstructionFrame:report=>{representation=report.states[0];}});
        images[mode]=r.image();
      }
      poses.push({images,time,dist:camera.dist,representation,marks});
    }
    return {poses,width,height,driver:r.driver};
  } finally {r.close();}
},{baked,count});
for(const [i,{images}] of poses.entries())for(const [mode,data] of Object.entries(images))
  write(path.join(out,mode+'-'+String(i).padStart(2,'0')+'.png'),meta.width,meta.height,Buffer.from(data,'base64'));
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({...meta,poses:poses.map(({images,...pose})=>pose)},null,2)+'\n');
