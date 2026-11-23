import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ink from '../../index.js';
import study from '../selective-transparency.js';

const shot=study(ink.load()), world=shot.build(shot.seed);
const width=288, height=168;
const opaque=ink.render({...world,count:0,data:new Float32Array(),renderMetadata:undefined},
  {w:width,h:height,px:1,raw:true,passes:['depth']});
const surface=new Float32Array(width*height*4);
for(let i=0;i<opaque.passes.depth.length;i++){
  const depth=opaque.passes.depth[i];
  if(Number.isFinite(depth))
    surface.set([opaque.rgb[i*3]/255,opaque.rgb[i*3+1]/255,opaque.rgb[i*3+2]/255,depth],i*4);
}
const output=process.argv[2]??fileURLToPath(new URL('./pack/',import.meta.url));
await mkdir(output,{recursive:true});
const {cam,radius,bg,count}=world;
await Promise.all([
  writeFile(path.join(output,'shot.json'),JSON.stringify({width,height,cam,radius,bg,count})+'\n'),
  writeFile(path.join(output,'opaque.bin'),Buffer.from(surface.buffer)),
  writeFile(path.join(output,'splats.bin'),Buffer.from(world.data.buffer,world.data.byteOffset,world.data.byteLength))
]);
console.log('Prepared',output);
