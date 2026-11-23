const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const png = require('./png.js');
const runWebGL = require('./look-webgl.js');
const { difference } = require('./finite-curve-review.js');
const fixture = require('../examples/strand-lod-review.js');

const views = [
  {id:'individual',distance:7.7}, {id:'strand-handoff',distance:11}, {id:'grouped',distance:15.5},
  {id:'card-handoff',distance:21.5}, {id:'cards',distance:30}
];

function browserReview(kit, make, backend, {views,motion,sources}) {
  const atlases = Object.fromEntries(Object.entries(sources).map(([name,{metadata,images}])=>[
    name,{metadata,images:Object.fromEntries(Object.entries(images).map(([map,bytes])=>[
      map,Uint8Array.from(atob(bytes),byte=>byte.charCodeAt(0))
    ]))}
  ]));
  const {world,width,height} = make(kit,atlases);
  const painter = backend(width,height,{width,height,raw:true,dither:0,edges:false,damp:false});
  function capture(distance,enabled) {
    let curves, cards;
    painter.draw(world,{camera:{...world.cam,dist:distance},curveLod:enabled,spriteReconstruction:enabled?'auto':'geometry',
      curveFrame:value=>{curves=value;},spriteReconstructionFrame:value=>{cards=value.states;}});
    return {rgb:painter.image(),curves,cards};
  }
  try {
    return {frames:views.map(({distance})=>({adaptive:capture(distance,true),native:capture(distance,false)})),
      motion:motion.map(distance=>capture(distance,true).rgb),driver:painter.driver};
  } finally { painter.close(); }
}

function run(directory, options = {}) {
  const kit = ink.load(), {world,assets,width,height} = fixture(kit);
  const atlases = {}, sources = {};
  fs.mkdirSync(directory,{recursive:true});
  const baked = assets.map(object=>{
    const bake = ink.bakeCurves(world,{object,width:82,height:104,directions:4,ribbon:false,cutoutMipmaps:true});
    ink.writeCurveBake(path.join(directory,object),bake);
    const {metadata,images} = atlases[object] = bake.atlas;
    sources[object] = {metadata,images:Object.fromEntries(Object.entries(images).map(([map,bytes])=>[
      map,Buffer.from(bytes).toString('base64')
    ]))};
    return {object,nativeSpans:metadata.curveBake.sourceSpans,cardViews:metadata.frames.length};
  });
  const motion = options.motion ? Array.from({length:32},(_,i)=>7.7*Math.pow(30/7.7,i/31)) : [];
  const gpu = runWebGL(options,fixture,browserReview,{views,motion,sources});
  const bound = fixture(kit,atlases).world;
  const report = {width,height,assets:baked,driver:gpu.driver,browser:gpu.browser,views:[],motion};
  for (const [i,{id,distance}] of views.entries()) {
    let cards;
    const frame = ink.render(bound,{w:width,h:height,raw:true,edges:false,px:1,dist:distance,renderStats:true,
      spriteReconstructionFrame:value=>{cards=value.states;}});
    const adaptive = Buffer.from(gpu.frames[i].adaptive.rgb,'base64'), native=Buffer.from(gpu.frames[i].native.rgb,'base64');
    const {pixels,...error} = difference(adaptive,frame.rgb);
    const files = {};
    for (const [label,image] of Object.entries({adaptive,native,headless:frame.rgb,difference:pixels})) {
      const file=files[label]=id+'-'+label+'.png';
      png.write(path.join(directory,file),width,height,image);
    }
    const {curves:lod, cards:gpuCards} = gpu.frames[i].adaptive;
    report.views.push({id,distance,files,error,
      webgl:{native:gpu.frames[i].native.curves,lod,cards:gpuCards},
      headless:{segments:frame.renderStats.curveSegments,strandLod:frame.renderStats.strandLod,cards}});
  }
  if (motion.length) {
    const dir=path.join(directory,'frames');
    fs.mkdirSync(dir,{recursive:true});
    gpu.motion.forEach((rgb,i)=>png.write(path.join(dir,'view-'+String(i).padStart(3,'0')+'.png'),
      width,height,Buffer.from(rgb,'base64')));
  }
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
module.exports = { run };
