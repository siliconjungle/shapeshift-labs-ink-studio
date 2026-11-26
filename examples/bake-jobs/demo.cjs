const path=require('node:path');
const Ink=require('../..');
const {document}=require('../../cli/glb-file.js');
const PNG=require('../../cli/png.js');
const files=require('../../cli/asset-files.js');

const root=path.resolve(process.argv[2]??'studio/out/brineglass-bake');
const at=name=>path.join(root,name);
const d=document(), g=d.gltf, clamp=n=>Math.min(1,Math.max(0,n));
const mix=(a,b,t)=>a.map((n,i)=>Math.round(n+(b[i]-n)*clamp(t)));
const width=520,height=260, pigment=new Uint8Array(width*height*3), finish=new Uint8Array(width*height*3);
const normal=new Uint8Array(width*height*3);
const tau=2*Math.PI;
const close=(a,b,w)=>Math.abs(a-b)<w;
const specks=[[.15,.22],[.24,.46],[.31,.19],[.45,.31],[.58,.18],[.77,.21],[.82,.41],[.69,.37],[.40,.22]];
for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p++) {
  const right=x>=width/2,u=(x%(width/2)+.5)/(width/2),v=(y+.5)/height;
  const edge=Math.min(u,1-u,v,1-v), grain=Math.cos(u*151+v*93)*Math.sin(v*173-u*230);
  const t=.36+.44*v+.14*Math.cos(u*11+v*8);
  let rgb=right?mix([25,33,66],[79,103,116],t):mix([25,52,61],[51,112,111],t);
  const disc=Math.hypot(u-(right?.64:.52),(v-.39)*1.12);
  const halo=close(disc,.216,.004), copper=close(edge,.087,.0045)||close(edge,.116,.0027);
  const sun=disc<.20&&!close(v,.447+(u-.5)*.15,.010)&&!close(v,.503+(u-.5)*.18,.006);
  if(sun)rgb=right?mix([196,79,65],[243,177,125],1-v*.94):mix([171,83,45],[251,213,146],1-v*.9);
  if(halo)rgb=right?[226,160,132]:[238,188,107];
  const ridge=v>.63+.038*Math.sin(u*15)+.032*Math.sin(u*29+2);
  if(ridge)rgb=right?mix([28,42,68],[58,85,99],(v-.62)*2):mix([23,65,75],[52,112,119],(v-.60)*2);
  const wave=ridge&&Array.from({length:6},(_,i)=>.646+i*.041+.024*Math.sin(u*14+i*.62)+.009*Math.sin(u*26-i*.31))
    .some(a=>close(v,a,.004));
  if(wave)rgb=mix(rgb,right?[106,163,171]:[115,176,162],.66);
  const mast=!right&&v>.31&&v<.715&&Math.abs(u-(.47+(v-.31)*.052))<.014+.025*(v-.3);
  const lamp=!right&&v>.283&&v<.339&&Math.abs(u-.47)<.043;
  const arch=right&&v>.52&&v<.77&&close(Math.hypot((u-.43)*1.25,(v-.779)),.194,.011);
  const stars=specks.some(([a,b],i)=>Math.abs(u-a)+Math.abs(v-b)<(i%3===1?.007:.010));
  if(mast||lamp||arch)rgb=lamp?[252,220,155]:right?[142,160,161]:[208,161,97];
  if(edge<.08)rgb=mix([13,33,42],[31,61,66],.55+.15*grain);
  if(copper||stars&&edge>.12)rgb=right?[225,170,128]:[237,188,112];
  pigment.set(rgb.map(n=>Math.round(Math.max(0,Math.min(255,n+grain*3)))),p*3);
  finish.set([255,Math.round(255*(copper?.29:wave?.58:sun?.34:.45+.11*t)),copper?190:18],p*3);
  const slope=.045*Math.sin(u*tau*19+v*70)+.045*Math.cos(v*123-u*20);
  const raised=wave||copper?.10:0;
  normal.set([Math.round(127+127*(slope+raised)),Math.round(127-127*slope),253],p*3);
}
const base=d.texture(PNG.encode(width,height,pigment),'Brineglass enamels');
const surface=d.texture(PNG.encode(width,height,finish),'Glaze finish');
const n=d.texture(PNG.encode(width,height,normal),'Surface relief');
g.materials=[
  {name:'Glazed chart',pbrMetallicRoughness:{baseColorTexture:{index:base,texCoord:0},metallicRoughnessTexture:{index:surface,texCoord:0}},
    normalTexture:{index:n,texCoord:0}},
  {name:'Brass fittings',pbrMetallicRoughness:{baseColorFactor:[.57,.26,.080,1],metallicFactor:.64,roughnessFactor:.39}},
  {name:'Blued brass',pbrMetallicRoughness:{baseColorFactor:[.095,.163,.205,1],metallicFactor:.74,roughnessFactor:.31}}
];

function poly(material) {
  const points=[],normal=[],uv0=[],uv1=[],indices=[];
  function quad(face,n,uv,chart) {
    const offset=points.length/3;
    points.push(...face.flat());normal.push(...face.flatMap(()=>n));
    uv0.push(...uv.flat());uv1.push(...chart.flat());
    indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  const add=(values,type)=>d.accessor(Float32Array.from(values),type,{bounds:type==='VEC3'});
  function result() {
    return {material,indices:d.accessor(Uint32Array.from(indices),'SCALAR'),attributes:{
      POSITION:add(points,'VEC3'),NORMAL:add(normal,'VEC3'),TEXCOORD_0:add(uv0,'VEC2'),TEXCOORD_1:add(uv1,'VEC2')}};
  }
  return {quad,result};
}
const unit=[[0,1],[1,1],[1,0],[0,0]];
const plate=poly(0), bevel=poly(1), cap=poly(2);
plate.quad([[-1.6,-.87,0],[1.6,-.87,0],[1.6,.87,0],[-1.6,.87,0]],[0,0,1],unit,
  [[.03,.95],[1.97,.95],[1.97,.05],[.03,.05]]);
function cuboid(part,[x,y,z],[a,b,c],first) {
  const ring=(p,q)=>[[p,-b,q],[p,b,q]];
  const [t,u]=ring(-a,-c),[v,w]=ring(a,-c),[l,m]=ring(-a,c),[r,s]=ring(a,c);
  const rows=[[[l,r,s,m],[0,0,1]],[[v,t,u,w],[0,0,-1]],[[t,l,m,u],[-1,0,0]],
    [[r,v,w,s],[1,0,0]],[[m,s,w,u],[0,1,0]],[[t,v,r,l],[0,-1,0]]];
  for(const [i,[verts,n]] of rows.entries()) {
    const ox=(i%3)*.32+.025, oy=Math.floor(i/3)*.455+.04;
    const chart=unit.map(([u,v])=>[first+ox+u*.285,oy+v*.405]);
    part.quad(verts.map(p=>[p[0]+x,p[1]+y,p[2]+z]),n,chart.map(([u,v])=>[u-first,v]),chart);
  }
}
// Two physical braces can occlude the chart even though their UVs stay on tile 1003.
cuboid(bevel,[0,-.72,.095],[1.46,.036,.09],2);
cuboid(cap,[0,0,0],[.56,.41,.17],0);
g.meshes=[{name:'Tidal chart assembly',primitives:[plate.result(),bevel.result()]},
  {name:'Pilot cap',primitives:[cap.result()]}];
g.nodes=[{name:'Brineglass',children:[1,2]},{name:'Chart',mesh:0},{name:'Cap',mesh:1,translation:[1.9,0,0]}];
g.scenes[0]={name:'Brineglass Signal',nodes:[0]};
files.write(at('brineglass.glb'),d.finish());

const ref=node=>({node,port:'value'});
const tilePixels=PNG.encode(1,1,Uint8Array.of(44,82,87),3);
const gray=PNG.encodeGray(1,1,Uint8Array.of(126));
const tangent=PNG.encode(1,1,Uint8Array.of(128,128,255),3);
const resources=Object.fromEntries([
  ['glaze',tilePixels,{intent:'color',colorSpace:'srgb'}],
  ['glaze-normal',tangent,{intent:'normal',normalOrientation:'opengl'}],
  ['cavity-mask',gray,{intent:'mask'}]
].map(([id,bytes,interpretation])=>[id,{format:'bitmap',interpretation,tiles:[1001,1002].map(udim=>({
  udim,source:{encoding:'png',base64:bytes.toString('base64')}
}))}]));
const nodes=Object.fromEntries(Object.keys(resources).map(name=>[name,{op:'bitmapAsset',inputs:{name,tile:{input:'tile'}}}]));
const source={format:'ink-studio/graph-project',version:1,inputs:{tile:{type:'vec2',default:[0,0]}},
  assets:resources,nodes,outputs:{paint:ref('glaze'),normal:ref('glaze-normal'),cavity:ref('cavity-mask')}};
const graph=Ink.openMaterialGraph(source,{id:'brineglass-signal'});
graph.label='Brineglass Signal';
Ink.writeMaterialGraph(at('brineglass.material.json'),graph);
const preset={format:'ink-studio/bake-preset',version:1,label:'Glaze and cavity',defaults:{size:176,padding:4,samples:12},
  maps:[
    {id:'pigment'},{id:'normal',overrides:{size:208,orientation:'opengl'}},{id:'roughness'},
    {id:'cavity',overrides:{size:132,cavityRadius:.27}},{id:'coverage'},
    {id:'metalness',enabled:false},{id:'emission',enabled:false},{id:'opacity',enabled:false},
    {id:'slope',enabled:false},{id:'exposure',enabled:false},{id:'thickness',enabled:false},{id:'thickness-valid',enabled:false}
  ]};
Ink.saveBakePreset(at('finish.preset.json'),preset);
const plan={format:'ink-studio/bake-job',version:1,label:'Brineglass Signal',source:'brineglass.glb',preset:'finish.preset.json',
  targets:[{id:'chart',mesh:'Tidal chart assembly',submeshes:[0],slots:['Glazed chart'],uvSet:1,tiles:[1001,1002]},
    {id:'cap',mesh:'Pilot cap',submeshes:[0],slots:['Blued brass'],uvSet:1,tiles:[1001]}],
  refresh:{material:'brineglass.material.json',bindings:[
    {target:'chart',map:'pigment',resource:'glaze',storage:'linked'},
    {target:'chart',map:'normal',resource:'glaze-normal',storage:'embedded'},
    {target:'chart',map:'cavity',resource:'cavity-mask',storage:'embedded'}
  ]}};
files.json(at('brineglass.bake.json'),plan);
Ink.runBakeJob(at('brineglass.bake.json'),{directory:at('review')})
  .then(result=>console.log(result.file)).catch(error=>{console.error(error);process.exitCode=1;});
