/* TUM RGB-D desktop globe. Pass the unpacked Open3D sample directory and an output folder. */
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const R = require('../cli/render.js');
const files = require('../cli/asset-files.js');

function crop(source) {
  const rgb=PNG.raster(path.join(source,'TUM_color.png')), range=PNG.raster(path.join(source,'TUM_depth.png'));
  const left=51, top=8, width=112, height=100, data=new Uint8Array(width*height*4), depth=Array(width*height).fill(0);
  const outline=[[60,29],[72,18],[86,12],[105,12],[127,18],[144,30],[153,44],[158,63],[157,80],
    [150,93],[132,103],[112,106],[92,103],[76,94],[64,82],[57,69],[53,55],[54,40]];
  function inside(x,y) {
    let hit=false;
    for (const [i,[a,b]] of outline.entries()) {
      const [c,d]=outline[(i+1)%outline.length];
      if ((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a) hit=!hit;
    }
    return hit;
  }
  for(let v=0;v<height;v++) for(let u=0;u<width;u++) {
    const x=left+u,y=top+v, j=(rgb.w*y+x)*4, i=v*width+u, z=range.data[j]/5000;
    if (!inside(x,y)||z<1.93||z>2.39) continue;
    data.set(rgb.data.subarray(j,j+4),i*4);
    depth[i]=z;
  }
  return {width,height,depth,camera:{type:'perspective',fx:525,fy:525,cx:319.5-left,cy:239.5-top},
    image:{width,height,data,channels:4}};
}

function bar(id,color,y,z,[x]) {
  const {KIT}=ink.load(), half=.30, h=.012;
  return KIT.sceneMeshes.create({id,positions:[x-half,y-h,z,x+half,y-h,z,x+half,y+h,z,x-half,y+h,z],
    indices:[0,1,2,0,2,3],uvs:new Float32Array(8),materials:[{id,color}]});
}

function error(reference, variant) {
  let sum=0,count=0;
  for(let i=0;i<reference.alpha.length;i++) {
    if(reference.alpha[i]<128 && variant.alpha[i]<128) continue;
    count++;
    for(let k=0;k<3;k++) sum+=Math.abs(reference.rgb[i*3+k]-variant.rgb[i*3+k]);
  }
  return sum/(3*count||1);
}

async function review(source,out) {
  const capture=crop(source);
  const result=await ink.scanToMesh({...capture,maxDepthJump:.044},{meshStride:2,paintRadius:2,rgbThreshold:15,name:'TUM desktop globe'});
  const worlds=await Promise.all(['source','mesh','hybrid'].map(result.world));
  const target=[-.914,.766,-2.22], view={target,w:164,h:140,px:1,dist:.86,pitch:.08,ortho:true,raw:true,
    reflection:false,atmosphere:false};
  const label=['1','2','3'], fps=12;
  const group=images=>R.grid(images,3,label);
  const write=(name,image)=>PNG.write(path.join(out,name),image.w,image.h,image.rgb);
  const {image,...depth}=capture;
  files.write(path.join(out,'globe-capture.png'),PNG.encode(image.width,image.height,image.data,4));
  files.json(path.join(out,'globe-depth.json'),depth);
  files.write(path.join(out,'capture-globe.glb'),result.glb);
  files.json(path.join(out,'capture-globe.scan.json'),result.report);

  const frames=[], orbit=[];
  for(let i=0;i<36;i++) {
    const yaw=-.80*Math.cos(i*Math.PI*2/36), frame={...view,yaw};
    const [full,mesh,hybrid]=worlds.map(world=>R.render(world,{...frame,transparent:true}));
    frames.push({yaw,meshRGBError:error(full,mesh),hybridRGBError:error(full,hybrid)});
    orbit.push(PNG.packFrame(R.upscale(group(worlds.map(world=>R.render(world,frame))),2)));
  }
  files.write(path.join(out,'globe-orbit.png'),PNG.encodeAnimation(orbit,fps));
  write('globe-comparison.png',R.upscale(group(worlds.map(world=>R.render(world,{...view,yaw:.31}))),3));

  const front=bar('coral-front',0xeaa573,target[1]-.047,-2.01,target);
  const rear=bar('violet-rear',0xba96e8,target[1]+.033,-2.40,target);
  const occlusion=worlds.map(world=>R.render({...world,meshes:[...world.meshes,front,rear]},
    {...view,yaw:.03,pitch:0,passes:['objectId','depth','surfaceKind']}));
  write('globe-occlusion.png',R.upscale(group(occlusion),3));
  const coverage=im=>{
    const pixels={};
    im.passes.objectId.forEach(id=>{
      const key=im.passes.objects[id];
      if(key) pixels[key]=(pixels[key]??0)+1;
    });
    return pixels;
  };
  const light={id:'amber-inspection',shape:'disk',at:[target[0]-.26,target[1]+.14,target[2]+.24],
    normal:[.64,-.34,-.68],size:[.08,.08],color:'#ffad65',intensity:5,radius:.72,sampleGrid:1,visible:false,shadows:false};
  const unlit=worlds.map(world=>R.render(world,{...view,yaw:.11}));
  const relight=worlds.map(world=>R.render({...world,areaLights:[light]},{...view,yaw:.11}));
  write('globe-relighting.png',R.upscale(R.grid([...unlit,...relight],3,['1','2','3','1','2','3']),3));
  files.json(path.join(out,'comparison.json'),{
    panels:['measured RGB-D splats','opaque mesh','mesh and residual splats'], source:'TUM RGB-D desktop globe, Open3D sample',
    artGrid:[view.w,view.h],count:frames.length,
    orbit:{frames,meshRGBError:frames.reduce((n,f)=>n+f.meshRGBError,0)/frames.length,
      hybridRGBError:frames.reduce((n,f)=>n+f.hybridRGBError,0)/frames.length},
    occlusion:occlusion.map(coverage),relighting:relight.map((im,i)=>{
      const base=unlit[i].rgb;
      return im.rgb.reduce((n,v,j)=>n+Number(v!==base[j]),0);
    })
  });
  console.log(result.report);
}

if (require.main===module) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Supply the unpacked TUM sample and output directory');
  const out=path.resolve(process.argv[3]);
  fs.mkdirSync(out,{recursive:true});
  review(path.resolve(process.argv[2]),out).catch(error=>{console.error(error);process.exitCode=1;});
}
