/* Bake the Aperture Relay and compare one atlas against its geometry. */
const path = require('node:path');
const fs = require('node:fs');
const ink = require('..');
const R = require('../cli/render.js');
const PNG = require('../cli/png.js');
const { spriteAtlas, writeAtlas } = require('../cli/sprite-atlas.js');

const headings = 8, width = 136, height = 132, pitch = .13, fps = 12;
const pivot = [0,1.48,0], dist = 5.35, first = -Math.PI/headings;
const settings = { w:width,h:height,px:1,target:pivot,pitch,dist,ortho:true,raw:true };
const labels = ['1','2','3'];

function scene(kit, atlas) {
  const { KIT:K, makeBuilder } = kit;
  const B = makeBuilder(1,[0x12202a,0xffffff]);
  K.surfacePatches.triangle(B,[[-.1,1,0],[.1,1,0],[0,1.2,0]],{object:'relay',color:[255,255,255]});
  const world = B.finish({cam:{target:pivot,dist,yaw:0,pitch,ortho:true,sway:0},radius:5,dither:0});
  K.sprite.reconstruction.bind(world,[{object:'relay',at:pivot,asset:K.sprite.reconstruction.asset({atlas})}]);
  return world;
}

function compare(reference, image) {
  let silhouette=0, samples=0, color=0;
  for (let i=0; i<reference.alpha.length; i++) {
    const a=reference.alpha[i]>=128, b=image.alpha[i]>=128;
    if (a!==b) silhouette++;
    if (!a&&!b) continue;
    samples++;
    for (let c=0; c<3; c++) color+=Math.abs(reference.rgb[i*3+c]-image.rgb[i*3+c]);
  }
  return {silhouettePixels:silhouette,meanRGB:color/(samples*3 || 1)};
}

function run(directory) {
  const kit=ink.load(), source=require('./adaptive-impostors/aperture-relay.js')(kit).build(62);
  const atlas=spriteAtlas(source,{width,height,directions:headings,columns:4,pivot,yaw:first,pitches:[pitch],
    maps:['depth','normal','emission','silhouette'],viewBlend:'depth-reprojected',view:settings});
  fs.mkdirSync(directory,{recursive:true});
  writeAtlas(path.join(directory,'atlas'),atlas);
  const world=scene(kit,atlas);
  const frames=[], clip=[];
  let still, best=-Infinity;

  for (let i=0; i<48; i++) {
    const yaw=first+i*Math.PI*2/48, view={...settings,yaw};
    let reprojection;
    const reference=R.render(source,{...view,transparent:true});
    const render=(blend,transparent)=>R.render(world,{...view,transparent,spriteReconstruction:'sprite',
      impostorBlend:blend,spriteReconstructionFrame:plan=>{if (blend==='depth-reprojected') reprojection=plan.states[0].reprojection;}});
    const nearest=compare(reference,render('nearest',true));
    const aligned=compare(reference,render('depth-reprojected',true));
    const picture=R.grid([R.render(source,view),render('nearest',false),render('depth-reprojected',false)],3,labels);
    clip.push(PNG.packFrame(R.upscale(picture,2)));
    const improvement=nearest.meanRGB-aligned.meanRGB;
    if (yaw>.35 && yaw<1.55 && improvement>best) { best=improvement; still={picture,yaw}; }
    frames.push({yaw, nearest, reprojected:aligned,reprojection});
  }
  const preview=R.upscale(still.picture,3);
  PNG.write(path.join(directory,'aperture-relay-comparison.png'),preview.w,preview.h,preview.rgb);
  fs.writeFileSync(path.join(directory,'aperture-relay-orbit.png'),PNG.encodeAnimation(clip,fps));
  const results={ title:'The Aperture Relay',directions:headings,artGrid:[width,height],fps,previewYaw:still.yaw,
    panels:['geometry','nearest','depth-reprojected'],
    mean:Object.fromEntries(['nearest','reprojected'].map(mode=>[mode,Object.fromEntries(
      ['silhouettePixels','meanRGB'].map(field=>[field,frames.reduce((n,f)=>n+f[mode][field],0)/frames.length]))])),
    frames };
  fs.writeFileSync(path.join(directory,'comparison.json'),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results.mean));
}

if (require.main===module) {
  if (!process.argv[2]) throw new Error('Choose an output directory for the demo');
  run(path.resolve(process.argv[2]));
}
module.exports={scene};
