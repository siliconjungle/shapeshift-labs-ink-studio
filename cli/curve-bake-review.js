const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const png = require('./png.js');
const fixture = require('../examples/curve-bake-reeds.js');
const runWebGL = require('./look-webgl.js');
const { difference } = require('./finite-curve-review.js');

const views = [
  { id:'curves', mode:'geometry', distance:7.95 },
  { id:'ribbons', mode:'ribbon', distance:7.95 },
  { id:'cards', mode:'card', distance:7.95 },
  { id:'near', mode:'auto', distance:6.25 },
  { id:'handoff', mode:'auto', distance:7.95 },
  { id:'far', mode:'auto', distance:10.6 }
];

function browser(kit, make, backend, { views, sources }) {
  const atlases = Object.fromEntries(Object.entries(sources).map(([name,{metadata,images}])=>[
    name,{metadata,images:Object.fromEntries(Object.entries(images).map(([map,bytes])=>[
      map,Uint8Array.from(atob(bytes),byte=>byte.charCodeAt(0))
    ]))}
  ]));
  const { width,height } = make(kit);
  const painter = backend(width,height,{ width,height,raw:true,dither:0,edges:false,damp:false });
  try {
    return { frames:views.map(({mode,distance})=>{
      const { world } = make(kit,mode,atlases);
      let state,depth;
      painter.draw(world,{ camera:{...world.cam,dist:distance},
        spriteReconstruction:mode==='card' ? 'sprite' : 'auto',
        spriteReconstructionFrame:value=>{state=value;},
        hybridDepthFrame:frame=>{depth=frame.depth.filter(Number.isFinite).length;}
      });
      return { rgb:painter.image(), state:state && {geometryRows:state.geometryRows,parts:state.states}, depth };
    }),driver:painter.driver };
  } finally { painter.close(); }
}

function run(directory, options = {}) {
  const kit = ink.load(), {world,assets,width,height} = fixture(kit);
  const atlases = {}, sources = {}, summary = [];
  fs.mkdirSync(directory,{recursive:true});
  for (const {object,part} of assets) {
    const bake = ink.bakeCurves(world,{object,part,width:76,height:88,directions:6,normals:true,
      yaw:world.cam.yaw,pitches:[world.cam.pitch],ribbon:{alphaCutoff:.45,depthTolerance:.018}});
    ink.writeCurveBake(path.join(directory,object),bake);
    const {metadata,images} = atlases[object] = bake.atlas;
    sources[object] = { metadata,images:Object.fromEntries(Object.entries(images).map(([map,bytes])=>[
      map,Buffer.from(bytes).toString('base64')
    ])) };
    summary.push({ object,part,sourceSpans:metadata.curveBake.sourceSpans,cardViews:metadata.frames.length,
      strips:bake.ribbon.strips,triangles:bake.ribbon.mesh.triangles,maxDepthError:bake.ribbon.maxDepthError });
  }
  const gpu = runWebGL(options,fixture,browser,{ views,sources });
  const report = { width,height,driver:gpu.driver,browser:gpu.browser,assets:summary,views:[] };
  for (const [i,{id,mode,distance}] of views.entries()) {
    const {world} = fixture(kit,mode,atlases);
    let state;
    const frame = ink.render(world,{w:width,h:height,px:1,raw:true,dither:0,edges:false,dist:distance,
      spriteReconstruction:mode==='card' ? 'sprite' : 'auto',
      spriteReconstructionFrame:value=>{state=value;} });
    const native = Buffer.from(gpu.frames[i].rgb,'base64'), {pixels,...error} = difference(frame.rgb,native);
    const files = {};
    for (const [label,image] of Object.entries({ webgl:native,headless:frame.rgb,difference:pixels })) {
      const filename = files[label] = id+'-'+label+'.png';
      png.write(path.join(directory,filename),width,height,image);
    }
    report.views.push({ id,distance,files,error,webgl:gpu.frames[i].state,depthPixels:gpu.frames[i].depth,
      headless:state && { geometryRows:state.geometryRows,parts:state.states } });
  }
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

module.exports = { run };
