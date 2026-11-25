'use strict';

// Make a scan-style signal plate and matching review plans.
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const {identities}=require('../src/splat-provenance.js');

async function main(directory) {
  fs.mkdirSync(directory,{recursive:true});
  const scan=path.join(directory,'signal-plate.ply'), rows=[], marked={};
  function add(p,sigma,color,alpha,shine=0,name) {
    const dc=color.map(n=>(n/255-.5)/.28209479177387814);
    const harmonics=color.flatMap((_,c)=>[shine*[.7,.9,.55][c],-shine*.25,0]);
    if (name) marked[name]=rows.length;
    rows.push([...p,...sigma.map(Math.log),1,0,0,0,Math.log(alpha/(1-alpha)),...dc,...harmonics]
      .map(n=>n.toFixed(6)).join(' '));
  }
  for (let yi=-23;yi<=23;yi++) for (let xi=-49;xi<=49;xi++) {
    const x=xi*.032, y=yi*.032;
    const edge=Math.hypot(Math.max(0,Math.abs(x)-1.32),Math.max(0,Math.abs(y)-.46));
    if (edge>.28) continue;
    const slot=[-.46,0,.46].some(center=>Math.hypot((x-center)*1.85,(y+.28))<.135);
    if (slot) continue;
    const rim=edge>.20 || Math.abs(x)>1.48 || Math.abs(y)>.667;
    const slotEdge=[-.46,0,.46].some(center=>Math.hypot((x-center)*1.85,(y+.28))<.176);
    const ripple=Math.round(4*Math.sin(x*13+y*19)+3*Math.cos(x*31-y*11));
    let c;
    if (rim) c=edge>.258 || Math.abs(y)>.714 || Math.abs(x)>1.54 ? [87,54,43]
      : [161+24*y+ripple,104+24*y+ripple,63+15*y];
    else if (slotEdge || Math.abs(yi)===17 || Math.abs(yi)===18 && Math.abs(x)<1.17)
      c=[148+12*y,107+15*y,70];
    else if (Math.abs(x)<.07 && y>.15 && y<.45 || Math.abs(x)<.18 && Math.abs(y-.30)<.03)
      c=[163,133,77];
    else c=[28+ripple,76+24*y+ripple,78+27*y+ripple];
    const z=.042+.035*(1-(x/1.65)**2)+.014*Math.cos(y*5);
    add([x,y,z],[.023,.023,.013],c,.93,.024);
  }
  for (const [x,y] of [[-1.33,.48],[1.33,.48],[-1.33,-.48],[1.33,-.48]]) {
    add([x,y,.102],[.071,.061,.016],[184,122,69],.88,.05);
    add([x-.013,y+.014,.143],[.032,.023,.01],[238,193,106],.88,.07);
  }
  add([-.62,.30,.205],[.22,.112,.035],[122,247,203],.78,.18,'split');
  add([.566,.30,.205],[.159,.101,.032],[241,179,70],.45,.16,'nearA');
  add([.616,.312,.208],[.159,.101,.032],[244,183,73],.47,.14,'nearB');
  add([-1.08,-.31,.20],[.083,.094,.031],[224,98,62],.81,.09,'farA');
  add([1.08,-.31,.20],[.083,.094,.031],[224,98,62],.81,.09,'farB');

  const props=['x','y','z','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3',
    'opacity','f_dc_0','f_dc_1','f_dc_2',...Array.from({length:9},(_,i)=>'f_rest_'+i)];
  fs.writeFileSync(scan,['ply','format ascii 1.0','comment Ink Studio enamel signal plate',
    'element vertex '+rows.length,...props.map(name=>'property float '+name),'end_header',...rows,''].join('\n'));
  const world=await ink.gaussianSplatWorld(await ink.readGaussianSplat(scan),
    {objectId:'gaussian-cloud',colorMode:'rgb',up:'y',size:4});
  const ids=identities(world), id=name=>ids.idAt(marked[name]);
  const target={object:'gaussian-cloud'};
  const review={width:168,height:112,views:[
    {id:'front',yaw:0,pitch:.12,ortho:true,zoom:1.62},
    {id:'oblique',yaw:-.62,pitch:.28,ortho:true,zoom:1.62}
  ]};
  const split={op:'split',splat:id('split'),children:[
    {id:'green-left',offset:[-.15,.012,0],weight:1},
    {id:'green-center',offset:[0,-.004,0],weight:4},
    {id:'green-right',offset:[.15,-.004,0],weight:1}
  ]};
  const merge={op:'merge',id:'amber-lens',from:[id('nearA'),id('nearB')]};
  const unsafe={op:'merge',id:'bridged-guards',from:[id('farA'),id('farB')]};
  for (const [name,operations] of [['approved',[split,merge]],['wide-merge',[unsafe]]])
    fs.writeFileSync(path.join(directory,name+'-plan.json'),JSON.stringify({target,operations,review},null,2)+'\n');
}
if (!process.argv[2]) throw new Error('Use node examples/splat-redistribution.cjs <output-directory>');
main(path.resolve(process.argv[2])).catch(error=>{console.error(error);process.exitCode=1;});
