'use strict';

// Build an editable Gaussian PLY and two fit plans for a perforated contact ribbon.
const fs = require('node:fs');
const path = require('node:path');
const ink = require('..');
const { identities } = require('../src/splat-provenance.js');

async function main(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const scan=path.join(directory,'copper-ribbon.ply');
  const rows=[];
  function add(x,y,z,color,sigma,shine) {
    const dc=color.map(n=>(n/255-.5)/.28209479177387814);
    const lobe=color.flatMap((_,i)=>[shine*[1,.72,.38][i],-.31*shine,0]);
    rows.push([x,y,z,...sigma.map(Math.log),1,0,0,0,2.9,...dc,...lobe]
      .map(n=>n.toFixed(6)).join(' '));
  }
  for (let j=0;j<=100;j++) {
    const y=j*.034;
    const holder=j<14, tip=j>96, waist=j>15 && j<90;
    const width=holder ? 17 : tip ? 11-(j-97) : 12;
    for (let i=-width;i<=width;i++) {
      const slot=waist && Math.abs(i)<=3 && [26,45,64,83].some(c=>Math.abs(j-c)<=4);
      if (slot) continue;
      const x=i*.033, edge=width-Math.abs(i), ridge=(1-(i/width)**2)*.058;
      const warmth=Math.round(7*Math.sin(j*.23+i*.75)+4*Math.sin(j*.91-i*.23));
      const trace=waist && Math.abs(i)>=7 && Math.abs(i)<=8;
      const lugs=holder && j>3 && j<11 && Math.abs(i)>10 && Math.abs(i)<14;
      let color;
      if (edge===0) color=[79,41,33];
      else if (edge===1) color=[178,114,58];
      else if (holder) color=lugs ? [235,194,116] : j<3 || j>=11 ? [206,142,79] : [92,66,47];
      else if (trace) color=[38+warmth,113+warmth,103+warmth];
      else if (waist && (Math.abs(i)===4 || Math.abs(i)<=4 && [21,31,40,50,59,69,78,88].includes(j)))
        color=[204,147,85];
      else color=[155+warmth,83+warmth,52+warmth];
      add(x,y,.047+ridge,color,[.022,.023,.014],trace?.12:.28);
      add(x,y,-.044-ridge*.3,color.map(n=>n*.69),[.022,.023,.014],.12);
      if (edge===0) add(x,y,.002,[96,54,36],[.015,.023,.036],.16);
    }
  }
  const properties=['x','y','z','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3',
    'opacity','f_dc_0','f_dc_1','f_dc_2',...Array.from({length:9},(_,i)=>'f_rest_'+i)];
  fs.writeFileSync(scan,['ply','format ascii 1.0','comment Ink Studio perforated contact ribbon',
    'element vertex '+rows.length,...properties.map(name=>'property float '+name),'end_header',...rows,''].join('\n'));
  const world=await ink.gaussianSplatWorld(await ink.readGaussianSplat(scan),{size:4,objectId:'gaussian-cloud',colorMode:'rgb',up:'y'});
  const ids=identities(world), members=[], mask=[];
  for (let i=0;i<world.count;i++) {
    const id=ids.idAt(i), y=world.data[i*16+1];
    members.push(id);
    if (y< -1.34) {
      const t=Math.max(0,Math.min(1,(y+1.5)/.16));
      mask.push([id,t*t*(3-2*t)]);
    }
  }
  const target={object:'gaussian-cloud'};
  const pivot=[0,-1.53,0], bend={type:'bend',axis:[0,1,0],side:[1,0,.45],length:3.53,angle:63};
  const curl={id:'contact-ribbon',pivot,members,mask,modifiers:[bend]};
  const taper={type:'taper',axis:[0,1,0],length:3.53,amount:-.29};
  const lattice={type:'lattice',bounds:{min:[-1,0,-1],max:[2.8,3.8,2]},size:[2,2,2],
    handles:[{at:[1,1,0],offset:[.1,.04,-.33]},{at:[1,1,1],offset:[.12,.03,-.38]}]};
  for (const [name,modifiers] of [['bend',[bend]],['finish',[taper,bend,lattice]]]) {
    const groups=[{...curl,modifiers}];
    fs.writeFileSync(path.join(directory,name+'-plan.json'),JSON.stringify({target,groups},null,2)+'\n');
  }
}

if (!process.argv[2]) throw new Error('Use node examples/retained-splat-groups.cjs <output-directory>');
main(path.resolve(process.argv[2])).catch(error=>{console.error(error);process.exitCode=1;});
