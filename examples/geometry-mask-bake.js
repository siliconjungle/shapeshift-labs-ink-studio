'use strict';

function spillway() {
  const points = [], faces = [], faceMaterials = [];
  const xs = [-2.55,-2.18,-1.48,-1.15,-.76,-.52,.46,.70,1.12,1.43,2.03,2.50];
  const zs = [-1.85,-1.38,-.88,-.24,.40,.96,1.43,1.75];
  const profile = [1.02,1.12,1.08,.77,.50,.24,.23,.43,.76,1.22,1.19,.96];
  const width = xs.length, layer = width*zs.length;
  for (const [zIndex,z] of zs.entries()) for (const [i,x] of xs.entries()) {
    const drop = .14*(zIndex/(zs.length-1));
    points.push([x,profile[i]-drop+(Math.abs(x)>1.3 ? .065*Math.cos(z*1.8+i) : 0),z]);
  }
  points.push(...points.map(([x,_y,z]) => [x,-.36,z]));
  const boundaries = new Map();
  function add(face, material) { faces.push(face); faceMaterials.push(material); }
  for (let j=0; j<zs.length-1; j++) for (let i=0; i<width-1; i++) {
    const a = j*width+i, face = [a,a+width,a+width+1,a+1];
    add(face,i===5 ? 0 : j>=6 ? 2 : 1);
    add(face.map(v=>v+layer).reverse(),2);
    for (let k=0; k<4; k++) {
      const x=face[k], y=face[(k+1)%4], key=x<y ? x+'/'+y : y+'/'+x;
      if (!boundaries.delete(key)) boundaries.set(key,[x,y]);
    }
  }
  for (const [a,b] of boundaries.values()) add([b,a,a+layer,b+layer],2);

  function block(min,max,material) {
    const [x,y,z] = min, [X,Y,Z] = max, start = points.length;
    points.push([x,y,z],[X,y,z],[X,y,Z],[x,y,Z],[x,Y,z],[X,Y,z],[X,Y,Z],[x,Y,Z]);
    for (const face of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]])
      add(face.map(i=>i+start),material);
  }
  block([-1.03,1.05,-1.12],[1.06,1.23,.20],3);
  block([-.99,.63,-1.02],[-.84,1.035,-.85],3);
  block([.89,.64,-1.02],[1.04,1.035,-.85],3);
  block([-1.00,1.25,-1.06],[1.03,1.29,-.98],4);
  const i = points.length;
  points.push([1.62,1.24,.89],[2.16,1.24,.89],[2.16,1.67,.89],[1.62,1.67,.89]);
  add([i,i+1,i+2,i+3],4);
  const materials = [
    {name:'flume',color:[.16,.30,.33]},
    {name:'basalt',color:[.22,.255,.245]},
    {name:'cut-stone',color:[.28,.215,.16]},
    {name:'canopy',color:[.34,.20,.115],roughness:.42},
    {name:'survey-metal',color:[.5,.29,.12],metallic:.28}
  ];
  return { name:'Spillway Nine',points,faces,materials,faceMaterials,smooth:false };
}

module.exports = () => ({id:'spillway-nine',name:'Spillway Nine',seed:9,model:spillway});

if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const ink = require('..'), PNG = require('../cli/png.js');
  const directory = path.resolve(process.argv[2] ?? 'out/spillway-nine');
  const model = path.join(directory,'spillway-nine.glb');
  const { materialBake } = ink.exportGlb(spillway(),{out:model,bakeDir:directory,textureSize:256,
    geometryMasks:{samples:24,cavityRadius:.70,exposureDistance:4.5,thicknessScale:1.75}});
  const { meshes:[row] } = JSON.parse(fs.readFileSync(materialBake,'utf8'));
  const { KIT:K,makeBuilder } = ink.load(), source = ink.readMesh(model,{attributes:true});
  const uv = new Float32Array(source.pos.length/3*2);
  for (const [i,v] of source.tri.entries()) uv.set(source.uvs[Math.floor(i/3)][i%3],2*v);
  const read = descriptor => PNG.raster(path.join(directory,descriptor.file));
  const pigment = read(row.maps.pigment), coverage = read(row.maps.coverage);
  const raw = Object.fromEntries(Object.entries(row.masks).map(([name,descriptor])=>[name,read(descriptor)]));
  const tones = {
    slope:[[34,57,71],[240,164,99]],
    cavity:[[38,42,69],[243,134,182]],
    exposure:[[34,41,68],[248,223,134]],
    thickness:[[34,60,69],[160,235,188]]
  };
  const preview = {};
  function dataURL(bytes) { return 'data:image/png;base64,'+bytes.toString('base64'); }
  for (const name of ['model',...Object.keys(tones)]) {
    const channel = raw[name], pixels = name === 'model' ? pigment.data : new Uint8Array(channel.data.length);
    if (channel) {
      const [low,high] = tones[name];
      for (let p=0; p<pixels.length; p+=4) {
        const q = channel.data[p]/255;
        const color = name === 'thickness' && !raw['thickness-valid'].data[p] ? [153,78,75] :
          low.map((v,i)=>Math.round(v+(high[i]-v)*q));
        pixels.set([...color,255],p);
      }
    }
    const mesh = K.sceneMeshes.create({ id:'spillway',positions:source.pos,uvs:uv,indices:source.tri,
      materials:[{id:name,texture:{ width:pigment.w,height:pigment.h,pixels }}] });
    const world = makeBuilder(9,[0x182529]).finish({ meshes:[mesh],radius:8,dither:0,
      cam:{target:[0,.51,0],dist:8.85,yaw:.58,pitch:.60,ortho:true},
      areaLights:[{id:'fill',shape:'disk',at:[-.6,5,3],normal:[.1,-.85,-.51],size:[1.15,1.15],
        color:'#ffeddd',intensity:3.7,radius:15,sampleGrid:1,visible:false,shadows:false}] });
    const frame = ink.render(world,{w:588,h:388,px:1,raw:true,transparent:true});
    preview[name] = dataURL(PNG.encodeFrame(PNG.packFrame(frame)));
  }
  const atlases = Object.fromEntries(Object.entries({...raw,coverage}).map(([name,atlas]) => {
    const rgba = new Uint8Array(atlas.data);
    for (let p=0; p<rgba.length; p+=4) rgba[p+3] = coverage.data[p];
    return [name,dataURL(PNG.encode(atlas.w,atlas.h,rgba,4))];
  }));
  const summary = { size:[row.width,row.height],...row.geometryMasks,masks:Object.keys(row.masks) };
  const template = fs.readFileSync(path.join(__dirname,'geometry-mask-bake.html.template'),'utf8');
  fs.writeFileSync(path.join(directory,'spillway-review.html'),template.replace('/*DATA*/',
    () => JSON.stringify({preview,atlases,summary}).replaceAll('<','\\u003c')));
  console.log(JSON.stringify({directory,model,materialBake,summary},null,2));
}
