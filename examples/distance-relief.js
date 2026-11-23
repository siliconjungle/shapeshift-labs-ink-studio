/* The Cataract lockhouse seal at three distances and a matched grazing angle. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const {screenDrawing}=require('../src/frame-composite.js');

function lockhouse({KIT:K,makeBuilder,makeSculpt}) {
  const id='distance-relief', seed=31, width=192,height=124;
  const pigment=new Uint8Array(width*height*4), heights=new Float32Array(width*height);
  const quant=n=>Math.max(0,Math.min(255,Math.round(n)));
  const ramp=(t,a,b)=>K.clamp((t-a)/(b-a),0,1);
  const round=(t,a,b)=>{
    const q=ramp(t,a,b);
    return q*q*(3-2*q);
  };
  const fissure=[[.78,0],[.73,.12],[.765,.23],[.686,.34],[.721,.41],[.611,.55],[.575,.71]];
  function near(x,y,points) {
    let closest=Infinity;
    for(let i=1;i<points.length;i++) {
      const [a,b]=points[i-1], [c,d]=points[i], u=c-a,v=d-b;
      const t=K.clamp(((x-a)*u+(y-b)*v)/(u*u+v*v),0,1);
      closest=Math.min(closest,Math.hypot(x-a-u*t,(y-b-v*t)*.82));
    }
    return closest;
  }
  const emblems=[
    [[.19,.62],[.24,.58],[.28,.59],[.32,.63],[.36,.62],[.41,.55],[.47,.54],[.51,.58],[.56,.58]],
    [[.21,.714],[.27,.674],[.33,.690],[.39,.708],[.45,.65],[.50,.647],[.56,.664]],
    [[.30,.49],[.35,.42],[.41,.39],[.46,.33],[.49,.28],[.54,.292],[.55,.35],[.51,.406],[.45,.449]]
  ];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/(width-1), v=y/(height-1), at=y*width+x;
    const edge=Math.min(v,1-v,(u+v-.12)*.7,(1-u+v-.12)*.7,(u+1-v-.12)*.7,(2-u-v-.12)*.7,u,1-u);
    if(edge<0)continue;
    const radius=Math.hypot((u-.40), (v-.495)*.69);
    const rim=(1-round(Math.abs(edge-.036),.009,.021))*.086;
    const raised=(1-round(Math.abs(radius-.257),.011,.023))*.125;
    const engraved=(1-round(Math.abs(radius-.222),.003,.011))*.066;
    const wave=near(u,v,emblems[0]), swell=near(u,v,emblems[1]), feather=near(u,v,emblems[2]);
    const mark=Math.min(wave,swell,feather), cut=(1-round(mark,.004,.014))*.098;
    const crack=near(u,v,fissure), fault=(1-round(crack,.008,.030))*.27;
    const loft=round(u,.70,.84)*(1-round(v,.27,.56))*.135;
    const grain=Math.sin(u*233+v*256)*Math.cos(u*384-v*189);
    const chatter=(Math.sin(u*58+v*39)+.4*Math.sin(u*129-v*127))*1.8+grain*3.5;
    heights[at]=.032+rim+raised+loft-engraved-cut-fault+.005*grain;
    let base=radius<.26?[164,184,164]:[161,169,146];
    if(raised>.033 || rim>.025)base=[185,179,144];
    if(engraved>.025)base=[63,101,99];
    if(cut>.026)base=wave===mark?[55,105,105]:[80,118,111];
    if(fault>.045)base=[81,89,79];
    if(u>.78&&u<.93&&v>.58&&v<.82)base=[113,136,126];
    pigment.set([...base.map(c=>quant(c+chatter)),255],at*4);
  }
  const stroke=(points,width,color)=>({type:'path',points,width,color});
  const title=(message,x,y,size,color,weight)=>K.poly2.text(message,size,{width:weight}).strokes
    .map(points=>stroke(points.map(([u,v])=>[x+u,y-v]),weight,color));
  const inkMarks=screenDrawing(width,height,[
    ...title('03',164,88,8,'#ced1a1',1.4),
    ...title('CATARACT',96,114,7.2,'#435b53',1.2),
    stroke([[149,103],[179,103]],1.05,'#dd9b6d'),
    stroke([[27,16],[35,16],[35,11]],1.25,'#c78557'),
    ...title('N',76,26,5.1,'#ac7251',1.1)
  ]);
  for(let p=0;p<width*height;p++){
    const i=p*4, opacity=inkMarks.data[i+3]/255;
    if(pigment[i+3]&&opacity)for(let c=0;c<3;c++)
      pigment[i+c]=Math.round(pigment[i+c]*(1-opacity)+inkMarks.data[i+c]*opacity);
  }
  const light=K.V.norm([-.53,.68,.51]);
  const relief=K.procedural.lod.relief.create({
    id:'cataract-seal',objectId:'lockhouse-seal',partId:'carved-panel',materialId:'salt-worn-limestone',
    origin:[-1.88,.75,.58],right:[3.76,0,0],up:[0,2.43,0],texture:{width,height,pixels:pigment},heights,
    featureSize:.22,normalPixels:3.2,geometryPixels:8.7,segments:[132,88],paintedSize:48,
    light,ambient:.48,roughness:.82
  });
  const B=makeBuilder(seed,[0x172936,0x263c47,0x435a59,0x697675,0x7d8a78,0x9ca48c,0xadb49a,0xc9ba96,
    0x604d44,0xa26c54,0xc78463,0xd89972,0x31595a,0x487878,0x689591,0x8db1a4]);
  const S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:light,amb:.41,sky:.16,sunK:.57,wob:0});
  const stone={r:[1,2,3,4,5]}, copper={r:[8,9,10,11]}, glaze={r:[12,13,14,15]};
  S.lathe([0,-.23,0],.29,[2.68,2.68,2.50,2.42],stone,{res:.067,objectId:'museum-plinth'});
  S.lathe([0,.055,0],.14,[1.79,1.81,1.76,1.71],glaze,{res:.068,objectId:'museum-plinth'});
  // A backing several centimeters behind the deepest projected groove.
  S.box([0,1.94,.033],[1.87,1.19,.245],stone,{rd:.16,res:.062,objectId:'seal-body'});
  for(const x of [-1.33,1.33]) {
    S.box([x,.43,.025],[.24,.30,.64],stone,{rd:.074,res:.057,objectId:'cradle'});
    S.box([x,.74,.49],[.17,.14,.235],copper,{rd:.040,res:.046,objectId:'cradle'});
  }
  S.box([0,3.12,-.005],[.52,.12,.20],copper,{rd:.062,res:.048,objectId:'seal-crest'});
  S.bake();
  const world=B.finish({id,reliefLOD:[relief],cam:{target:[0,1.59,0],dist:7.5,ortho:true,yaw:.38,pitch:.22,fov:.66,sway:0},
    radius:6,dither:0,fog:{c:1,start:1,max:0},look:{splatCoverage:'continuous'},
    skyEnvironment:{defaults:{zenith:'#293d52',horizon:'#638684',ground:'#192f3e',sunStrength:0}}});
  return {world,relief,heights,pigment,width,height};
}

const factory=kit=>({id:'distance-relief',name:'Cataract lockhouse seal',seed:31,build(){return lockhouse(kit).world;}});
function demo(directory,animation=false) {
  const {world}=lockhouse(ink.load()), out=path.resolve(directory), w=424,h=302;
  fs.mkdirSync(out,{recursive:true});
  function capture({dist=7.2,yaw=.38,pitch=.22,reliefLOD}={}){
    let report;
    const image=ink.render(world,{w,h,dist,yaw,pitch,reliefLOD,raw:true,px:1,reliefLODFrame:rows=>{[report]=rows;}});
    return {image,report};
  }
  const shots=[['geometry',{dist:7.2,yaw:.43,pitch:.26}],['normal',{dist:13.7,yaw:.27,pitch:.18}],
    ['painted',{dist:34,yaw:.26,pitch:.16}],['grazing-geometry',{dist:7.1,yaw:.79,pitch:.29,reliefLOD:'geometry'}],
    ['grazing-normal',{dist:7.1,yaw:.79,pitch:.29,reliefLOD:'normal'}]];
  const receipt=[];
  for(const [id,options] of shots){
    const {image,report}=capture(options);
    PNG.write(path.join(out,id+'.png'),image.w,image.h,image.rgb);
    receipt.push({shot:id,...report});
    assert.equal(report.tier,id.replace('grazing-',''));
  }
  if(animation){
    const frames=path.join(out,'frames');
    fs.mkdirSync(frames,{recursive:true});
    const motion=[];
    for(let i=0;i<45;i++){
      const u=i/44, dist=7.2*(34/7.2)**u, yaw=.28+.18*(1-u)**2, pitch=.18+.08*(1-u);
      const {image,report}=capture({dist,yaw,pitch});
      PNG.write(path.join(frames,String(i).padStart(3,'0')+'.png'),image.w,image.h,image.rgb);
      motion.push({i,dist,...report});
    }
    assert.deepEqual([...new Set(motion.map(row=>row.tier))],['geometry','normal','painted']);
    fs.writeFileSync(path.join(out,'motion.json'),JSON.stringify(motion,null,2)+'\n');
  }
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt.map(({shot,triangles,normalTexels,featurePixels,profilePixels})=>
    ({shot,triangles,normalTexels,featurePixels,profilePixels})),null,2));
}
if(require.main===module)demo(process.argv[2]??'distance-relief-review',process.argv.includes('--frames'));
module.exports=factory;
