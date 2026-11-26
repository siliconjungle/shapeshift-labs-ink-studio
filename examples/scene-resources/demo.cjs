const fs=require('node:fs');
const path=require('node:path');
const {document}=require('../../cli/glb-file.js');
const PNG=require('../../cli/png.js');
const {convertSceneResource}=require('../..');
const files=require('../../cli/asset-files.js');
const folder=path.resolve(process.argv[2]??'studio/out/scene-resources');
const location=name=>path.join(folder,name);
const doc=document(),d=doc.gltf;
const add=(data,type)=>doc.accessor(Float32Array.from(data),type,{bounds:type==='VEC3'});
const clamp=n=>Math.max(0,Math.min(1,n));
const lerp=(a,b,t)=>a.map((n,i)=>Math.round(n+(b[i]-n)*clamp(t)));

function chart() {
  const w=384,h=232,pixels=new Uint8Array(w*h*3);
  const distance=(a,b)=>Math.hypot(a,b);
  const close=(n,target,epsilon)=>Math.abs(n-target)<=epsilon;
  const stars=[[.16,.25],[.22,.44],[.30,.25],[.46,.20],[.79,.27],[.84,.46],[.64,.16],[.39,.34],[.61,.44]];
  const coast=(u,a)=>a+.03*Math.sin(u*17+a*31)+.013*Math.sin(u*41+a*47);
  for(let y=0,p=0;y<h;y++)for(let x=0;x<w;x++,p++) {
    const u=(x+.5)/w,v=(y+.5)/h, outer=Math.min(u,1-u,v*.62,(1-v)*.62);
    const solar=distance((u-.645)*1.30,(v-.43)*.84);
    const glyph=(Math.abs(u-.325)<.010&&v>.40&&v<.70)||
      (v>.41&&v<.58&&Math.abs(u-.325)<(.59-v)*.21)||
      (v>.577&&v<.595&&Math.abs(u-.325)<.09)||
      (v>.659&&v<.692&&Math.abs(u-.325)<.032);
    const line=Array.from({length:7},(_,i)=>.73+i*.022).some(a=>close(v,coast(u,a),.0027));
    let rgb=lerp([12,27,49],[39,84,104],v+.14*Math.sin(u*10-v*13));
    if(solar<.124 && !close(v,.464+(u-.65)*.18,.009) && !close(v,.509+(u-.65)*.17,.007))
      rgb=lerp([203,70,46],[255,183,96],1.25-v*2+solar);
    if(close(solar,.137,.0021))rgb=[223,166,98];
    if(v>coast(u,.67))rgb=lerp([21,46,70],[55,114,124],(v-.65)*3);
    if(line)rgb=lerp(rgb,[141,189,171],.52);
    if(glyph)rgb=lerp([182,101,58],[248,219,143],(1-v)*.85);
    if(stars.some(([a,b],i)=>Math.abs(u-a)*1.55+Math.abs(v-b)<(i%3?.005:.009)))rgb=[238,205,129];
    if(outer<.043)rgb=[18,36,51];
    if(close(outer,.031,.0017)||close(outer,.041,.0017))rgb=[207,152,87];
    if(outer<.043&&distance(Math.min(u,1-u)-.023,Math.min(v,1-v)-.034)<.006)rgb=[230,175,96];
    const grain=.65*Math.sin(x*2.43+y*1.71)*Math.cos(y*2.2-x*.76)+.35*Math.sin(x*.248+y*.793);
    pixels.set(rgb.map(q=>Math.round(Math.max(0,Math.min(255,q+grain*4)))),p*3);
  }
  return PNG.encode(w,h,pixels);
}
const image=doc.texture(chart(),'Meridian enamel');
const finish=doc.texture(PNG.encode(2,2,Uint8Array.from([
  251,114,207, 255,126,207, 246,122,213, 255,114,216
]),3),'Brass finish');
d.materials=[
  {name:'Marine alloy',pbrMetallicRoughness:{baseColorFactor:[.058,.14,.17,1],metallicFactor:.77,roughnessFactor:.30}},
  {name:'Signal enamel',pbrMetallicRoughness:{baseColorTexture:{index:image,texCoord:1},metallicFactor:.06,roughnessFactor:.35}},
  {name:'Cast brass',pbrMetallicRoughness:{baseColorFactor:[.64,.32,.113,1],metallicFactor:.9,roughnessFactor:.72,
    metallicRoughnessTexture:{index:finish,texCoord:0}}},
  {name:'Pilot lamp',pbrMetallicRoughness:{baseColorFactor:[.51,.17,.047,1],metallicFactor:.02,roughnessFactor:.24},
    emissiveFactor:[.98,.44,.095]}
];

function model(label,draw) {
  const groups=new Map();
  function face(material,points,coord=[[0,1],[1,1],[1,0],[0,0]]) {
    if(!groups.has(material))groups.set(material,{p:[],n:[],uv:[],uv2:[],indices:[]});
    const row=groups.get(material), at=row.p.length/3;
    const delta=(a,b)=>a.map((n,i)=>n-b[i]);
    const [a,b,c]=points, [x,y,z]=delta(b,a),[u,v,w]=delta(c,a);
    const normal=[y*w-z*v,z*u-x*w,x*v-y*u], length=Math.hypot(...normal);
    row.p.push(...points.flat());
    row.n.push(...points.flatMap(()=>normal.map(n=>n/length)));
    row.uv.push(...coord.flatMap(([s,t])=>material===1?[s*.72+.19,t*.9+.036]:[s,t]));
    row.uv2.push(...coord.flat());
    for(let i=1;i+1<points.length;i++)row.indices.push(at,at+i,at+i+1);
  }
  function slab(x,y,z,w,h,depth,material,front=material,bevel=.06) {
    const corners=(a,b,p)=>[[-a+p,-b],[a-p,-b],[a,-b+p],[a,b-p],[a-p,b],[-a+p,b],[-a,b-p],[-a,-b+p]];
    const ring=(a,b,c,r)=>corners(a,b,r).map(([u,v])=>[x+u,y+v,z+c]);
    const a=ring(w-bevel,h-bevel,depth,bevel*.70), b=ring(w,h,depth-bevel,bevel), c=ring(w,h,-depth,bevel);
    for(let i=0;i<8;i++) {
      const j=(i+1)%8;
      face(material,[b[i],b[j],a[j],a[i]]);
      face(material,[c[i],c[j],b[j],b[i]]);
    }
    const uv=([u,v])=>[(u-x)/(2*(w-bevel))+.5,.5-(v-y)/(2*(h-bevel))];
    face(front,a,a.map(uv));
    face(material,c.slice().reverse(),c.slice().reverse().map(uv));
  }
  draw(slab);
  return doc.add('meshes',{name:label,primitives:[...groups].map(([material,row])=>({
    material,indices:doc.accessor(Uint32Array.from(row.indices),'SCALAR'),
    attributes:{POSITION:add(row.p,'VEC3'),NORMAL:add(row.n,'VEC3'),TEXCOORD_0:add(row.uv,'VEC2'),TEXCOORD_1:add(row.uv2,'VEC2')}
  }))});
}
const cabinet=model('Signal face groups',slab=>{
  slab(0,0,0,1.45,.88,.17,0,0,.086);
  slab(0,.025,.16,1.29,.73,.08,2,1,.033);
  slab(-1.24,-.58,.239,.057,.32,.026,2,2,.014);
  slab(1.24,-.58,.239,.057,.32,.026,2,2,.014);
});
const base=model('Plinth groups',slab=>{
  slab(0,0,0,1.57,.17,.36,0,0,.041);
  slab(0,.076,.32,.30,.052,.085,2,2,.012);
  for(const x of [-.11,0,.11])slab(x,.076,.40,.021,.020,.025,3,3,.006);
});
const yaw=Math.PI/48;
d.nodes=[
  {name:'Meridian asset',translation:[.08,.02,-.09],rotation:[0,Math.sin(yaw),0,Math.cos(yaw)],children:[1,2,3]},
  {name:'Enamel instrument',translation:[0,1.14,0],mesh:cabinet},
  {name:'Transformer base',translation:[0,.19,-.02],mesh:base},
  {name:'Relay mount marker',translation:[0,1.92,-.22]}
];
d.scenes[0]={name:'Meridian Switchboard',nodes:[0]};
files.write(location('meridian-source.glb'),doc.finish());
const usd=convertSceneResource(location('meridian-source.glb'),{out:location('meridian.usda')});
convertSceneResource(location('meridian-source.glb'),{out:location('meridian.mtlx')});
const round=convertSceneResource(location('meridian.usda'),{out:location('meridian-reopened.glb'),materialx:location('meridian.mtlx')});
const pack=convertSceneResource(location('meridian.usda'),{out:location('meridian.usdz')});
const report={title:'Meridian Switchboard',usd:usd.roundTrip,roundTrip:round.roundTrip,package:pack.roundTrip,
  groups:round.output.groups,materials:round.output.materials,textureCount:round.output.uniqueTextures};
if(![usd,round,pack].every(row=>Object.values(row.roundTrip).every(Boolean)))throw Error(JSON.stringify(report));
files.json(location('report.json'),report);
const template=fs.readFileSync(path.join(__dirname,'review.html'),'utf8');
files.write(location('index.html'),template.replace('/*SCENE_RESOURCES*/',()=>JSON.stringify(report).replaceAll('<','\\u003c')));
console.log(location('index.html'));
