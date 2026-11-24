'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ink = require('../..');
const PNG = require('../../cli/png.js');
const motion = require('../../src/pixel-motion-checks.js');

const width = 112, height = 54, count = 41;
const palette = [0x111723,0x382528,0x784630,0xbb7953,0xe0aa70,0xffebbb,0xe4f7e5];
const degrees = index => -65 + 130 * index / (count - 1);

function sweep() {
  const {KIT,makeBuilder} = ink.load(), B = makeBuilder(7,palette);
  KIT.curveSplats.draw(B,[[-2.28,-.57,0],[2.28,.63,0]],{
    color:'#a96545',width:.22,edge:'hard',caps:'rounded',object:'wire',material:'copper'
  });
  const world = B.finish({
    radius:4,fog:{start:1,max:0},dither:0,
    cam:{target:[0,0,0],dist:4.5,yaw:0,pitch:0,fov:.69,ortho:true},
    look:{pbrMaterials:{
      materials:{copper:{roughness:.25,metalness:.85,highlight:{threshold:.075,color:'#ffebbb'}}},
      default:'copper',environment:{sky:'#9e796e',horizon:'#ad9c8e',ground:'#614345',intensity:.52}
    }}
  });
  return [false,true].map(pbrSpecularSampling => {
    const sheet = new Uint8Array(width * height * count * 3);
    const frames = Array.from({length:count},(_,i) => {
      const angle = degrees(i) * Math.PI / 180;
      const lights = [{direction:[0,Math.sin(angle),Math.cos(angle)],intensity:2.1,color:'#fff2dd'}];
      const {rgb} = ink.render(world,{w:width,h:height,px:1,outline:false,dither:0,
        pbrLights:lights,pbrSpecularSampling});
      sheet.set(rgb,i * width * height * 3);
      const rgba = new Uint8Array(width * height * 4);
      for (let p=0;p<width*height;p++) {
        const [r,g,b] = rgb.subarray(p*3,p*3+3);
        rgba.set([r,g,b,(r<<16|g<<8|b)===palette[0]?0:255],p*4);
      }
      return {id:'sample-'+i,width,height,rgba};
    });
    const audit = motion.audit(frames,{alignment:'screen',colorDelta:18,highlights:['#ffebbb','#e4f7e5']});
    const splits = audit.transitions.reduce((sum,row)=>sum+(row.splits??0),0);
    return {sheet,splits,clusterPixels:audit.counts.cluster.pixels,flicker:audit.counts.flicker.pixels};
  });
}

function build(file) {
  const results = sweep(), data = results.map(({sheet,...audit})=>({
    ...audit,image:PNG.encode(width,height*count,sheet).toString('base64')
  }));
  const html = fs.readFileSync(path.join(__dirname,'specular-sweep.html'),'utf8')
    .replace('@SWEEP@',JSON.stringify({width,height,count,data,angles:Array.from({length:count},(_,i)=>degrees(i))}));
  fs.writeFileSync(file,html);
  const report = results.map(({splits,clusterPixels,flicker})=>({splits,clusterPixels,flicker}));
  console.log(JSON.stringify({frames:count,center:report[0],coverage:report[1]},null,2));
}

if (require.main===module) {
  if (process.argv.length!==3) throw new Error('Usage: node specular-sweep.cjs wire-sweep.html');
  build(process.argv[2]);
}
module.exports = {sweep};
