'use strict';

// Generate three registered RGB-D captures of a brass and enamel hatch.
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const {V,M,Q}=ink.load().KIT;
const width=110,height=100, camera={type:'orthographic',height:3.2};

const boxes=[
  {min:[-1.10,-.99,-.42],max:[-.61,.64,.42],kind:'enamel'},
  {min:[.61,-.99,-.42],max:[1.10,.64,.42],kind:'enamel'},
  {min:[-1.15,.64,-.42],max:[1.15,1.11,.42],kind:'brass'},
  {min:[-1.15,-1.08,-.43],max:[1.15,-.88,.43],kind:'sill'},
  {min:[-.695,-.72,.42],max:[-.607,.67,.47],kind:'trim'},
  {min:[.607,-.72,.42],max:[.695,.67,.47],kind:'trim'}
];

function rayBox(origin,direction,box) {
  let low=0, high=Infinity, axis=-1, sign=1;
  for (let i=0;i<3;i++) {
    if (Math.abs(direction[i])<1e-9) {
      if (origin[i]<box.min[i]||origin[i]>box.max[i]) return;
      continue;
    }
    const t1=(box.min[i]-origin[i])/direction[i], t2=(box.max[i]-origin[i])/direction[i];
    const entry=Math.min(t1,t2);
    if (entry>low) {low=entry;axis=i;sign=t1<t2?-1:1;}
    high=Math.min(high,Math.max(t1,t2));
    if (high<low) return;
  }
  if (axis<0) return;
  return {t:low,axis,sign,kind:box.kind};
}

function pigment(p,hit) {
  const [x,y,z]=p, grain=3*Math.sin(x*37+z*41)+3*Math.cos(y*43+x*8);
  const face=hit.axis===2&&hit.sign>0;
  const dark=face ? 1 : .75;
  let c;
  if (hit.kind==='brass') {
    const stripe=(y>.695&&y<.73)||(y>1.035&&y<1.066);
    const signPlate=face&&Math.abs(x+.53)<.36&&Math.abs(y-.875)<.105;
    const rivet=face&&Math.hypot(Math.abs(x)-1.005,y-.91)<.047;
    const letter=signPlate&&(Math.abs(x+.65)<.021||Math.abs(x+.54)<.019||
      Math.abs(y-.879)<.021&&x>-.67&&x<-.53||Math.hypot(x+.44,y-.879)<.034);
    c=letter||rivet ? [246,216,143] : signPlate ? [62,67,53] :
      stripe ? [218,163,89] : [164+19*y,108+15*y,58+11*y];
  } else if (hit.kind==='sill'||hit.kind==='trim') {
    const scored=face&&(Math.abs(y+.974)<.018||Math.floor((x+.08)*25)%11===0);
    c=scored ? [205,151,87] : [124,90,61];
  } else {
    const bolt=face&&[.39,-.63].some(cy=>Math.hypot(Math.abs(x)-.944,(y-cy))<.043);
    const paint=face&&y<.18&&y>.13&&Math.abs(x)>.73&&Math.abs(x)<1.02;
    const runner=Math.abs(z-.24)<.024 || Math.abs(z+.23)<.024 || face&&Math.abs(Math.abs(x)-1.035)<.017;
    c=bolt ? [201,145,76] : paint ? [178,159,93] : runner ? [79,145,136] : [38,99+11*y,93+12*y];
  }
  return c.map(n=>Math.round(n*dark+grain));
}

function capture(id,yaw,pitch,glitch) {
  const back=[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
  const right=V.norm(V.cross([0,1,0],back)), up=V.cross(back,right), matrix=M.cols(right,up,back);
  const direction=V.mul(back,-1), pose={position:V.mul(back,5),rotation:Q.fromMatrix(matrix)};
  const depth=new Float32Array(width*height), image=new Uint8Array(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const origin=V.mad(V.mad(pose.position,right,(x-(width-1)/2)*camera.height/height),
      up,((height-1)/2-y)*camera.height/height);
    const hits=boxes.map(box=>rayBox(origin,direction,box)).filter(Boolean).sort((a,b)=>a.t-b.t);
    if (!hits.length) continue;
    const hit=hits[0], p=V.mad(origin,direction,hit.t), i=x+y*width;
    // All captures have an unmeasured patch in the front brass lintel.
    if (hit.kind==='brass'&&hit.axis===2&&hit.sign===1&&p[0]>.14&&p[0]<.77&&p[1]>.80&&p[1]<1.01) continue;
    const error=glitch&&hit.kind==='enamel'&&hit.axis===2&&hit.sign===1&&p[0]>.74&&p[0]<1.05&&p[1]>-.42&&p[1]<.22 ? .12 : 0;
    depth[i]=hit.t+error;
    image.set([...pigment(p,hit),255],i*4);
  }
  return {id,depth,image,pose};
}

const directory=path.resolve(process.argv[2]??'studio/out/registered-scan-fusion');
fs.mkdirSync(directory,{recursive:true});
const views=[
  capture('front',.04,.06,false),
  capture('port',-.67,.37,false),
  capture('starboard',.63,.29,true)
].map(({id,depth,image,pose})=>{
  const input=id+'-depth.json', rgb=id+'-capture.png';
  fs.writeFileSync(path.join(directory,input),JSON.stringify({width,height,camera,maxDepthJump:.10,
    depth:Array.from(depth,n=>Math.round(n*1e6)/1e6)})+'\n');
  fs.writeFileSync(path.join(directory,rgb),PNG.encode(width,height,image,4));
  return {id,depth:input,image:rgb,pose,...(id==='front' && {weight:1.25})};
});
const approval={by:'Demo art direction',reason:'Restore the center of the brass lintel from the original construction drawing'};
const fills=[{id:'lintel-insert',vertices:[[.22,.82,.42],[.70,.82,.42],[.70,.99,.42],[.22,.99,.42]],
  triangles:[[0,1,2],[0,2,3]],color:[184,124,70],approval}];
const manifest={format:'ink-studio/scan-fusion',version:1,name:'Harbor hatch',views,
  bounds:{min:[-1.31,-1.23,-.61],max:[1.31,1.27,.64]},
  options:{resolution:.045,truncation:.15,supportTolerance:.065,conflictTolerance:.081,
    maxTriangles:55000,paintRadius:2,rgbThreshold:22,residualLimit:1800},fills};
for (const [name,plan] of [['hatch',manifest],['hatch-measured',{...manifest,fills:[]}]])
  fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify(plan,null,2)+'\n');
