const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');
const { runBakeJob } = require('../../cli/bake-jobs.js');
const PNG = require('../../cli/png.js');
const {readTexture} = require('../../cli/texture-files.js');

const out = path.resolve(process.argv[2] ?? 'studio/out/azimuth-gate');
const at = file => path.join(out,file), size=256;
const clamp=n=>Math.max(0,Math.min(1,n));
const mix=(a,b,t)=>a+(b-a)*t;
const band=(n,a,w)=>Math.max(0,1-Math.abs(n-a)/w);

function frame(angle) {
  return .385+.019*Math.cos(8*angle)+.008*Math.cos(16*angle);
}

function paint() {
  const width=768,height=384,pixels=new Uint8Array(width*height*3);
  const sea=[37,72,92], rim=[197,147,88], navy=[24,42,65], jade=[60,118,107], mica=[232,192,120];
  const color=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=(x+.5)/width*2,v=(y+.5)/height;
    const dx=(u-1)/1.63,dy=v-.51,angle=Math.atan2(dy,dx),r=Math.hypot(dx,dy);
    const rad=r/frame(angle), facet=.5+.5*Math.cos(angle*8), lighting=.78+.15*Math.cos(angle+1.8);
    let base=color(navy,sea,clamp(facet*.32+rad*.47));
    const grain=.97+.055*Math.sin(x*63.32+y*31.99)*Math.cos(y*8.47);
    if(rad>.932&&rad<1.018)base=color(rim,mica,1-clamp((rad-.93)*7));
    if(rad>.73&&rad<.754)base=rim;
    if(rad>.80&&rad<.813)base=color(jade,mica,.38);
    if(rad>.826&&rad<.912&&Math.cos(angle*48)>.93)base=mica;
    if(rad>.68&&rad<.71)base=jade;
    if(rad>.885&&rad<.925&&Math.cos(angle*8)>.80&&Math.cos(angle*8)<.91)base=rim;
    if(u<.38||u>1.62||v<.16||v>.85) {
      const left=u<1, arm=left?u:2-u;
      const t=Math.hypot((arm-.23)*1.2,(v-.295)*1.5);
      base=color(navy,jade,.52+.28*Math.cos(x*.031+y*.014));
      if(band(t,.106,.012)>.35||band(t,.056,.008)>.35)base=rim;
      if((Math.floor(v*210)%13===0||Math.floor(arm*135)%12===0)&&v>.62)base=color(rim,jade,.25);
    }
    pixels.set(base.map(n=>Math.round(255*clamp(n/255*lighting*grain+.033))),3*(y*width+x));
  }
  return PNG.encode(width,height,pixels,3,{srgb:true});
}

function carrier(proof,painted) {
  const doc=document(),{gltf}=doc, primitives=[];
  function part(points, indices, z=0) {
    const q=new Float32Array(points.flat()), coords=new Float32Array(points.flatMap(([u,v])=>[u,1-v,z]));
    const source=new Float32Array(points.flatMap(([u,v])=>[u*.5,v]));
    primitives.push({material:0,attributes:{
      POSITION:doc.accessor(coords,'VEC3',{bounds:true}),TEXCOORD_0:doc.accessor(q,'VEC2'),
      TEXCOORD_1:doc.accessor(source,'VEC2')
    },indices:doc.accessor(Uint16Array.from(indices),'SCALAR')});
  }
  function annulus(steps,start,end,point,mid) {
    const uvs=[],faces=[];
    for(let i=start;i<=end;i++)for(const level of [mid,1])
      uvs.push(point(i%steps/steps*2*Math.PI,level));
    for(let i=start;i<end;i++){
      const a=(i-start)*2;faces.push(a,a+3,a+1,a,a+2,a+3);
    }
    part(uvs,faces);
  }
  const gate=(theta,t)=>[1+Math.cos(theta)*frame(theta)*1.63*t,.51+Math.sin(theta)*frame(theta)*t];
  // Each half contributes to the same UV chart, across both a primitive break and a tile seam.
  annulus(128,0,64,gate,.68);
  annulus(128,64,128,gate,.68);
  for(const x of [.186,1.814]) {
    const edge=(theta,t)=>[x+Math.cos(theta)*.126*t,.294+Math.sin(theta)*.12*t];
    annulus(32,0,32,edge,.41);
  }
  const plates=[
    [[.066,.574],[.170,.528],[.292,.560],[.331,.621],[.281,.714],[.136,.747],[.066,.716]],
    [[1.923,.552],[1.823,.511],[1.718,.558],[1.686,.646],[1.735,.733],[1.869,.735],[1.923,.690]],
    [[.795,.946],[.926,.936],[1.074,.936],[1.205,.946],[1.173,.985],[.827,.985]]
  ];
  for(const polygon of plates) {
    const indices=[];
    for(let k=1;k<polygon.length-1;k++)indices.push(0,k+1,k);
    part(polygon,indices);
  }
  if(proof)part([[.347,.423],[.599,.413],[.635,.548],[.372,.605]],[0,2,1,0,3,2],.2);
  const texture=doc.texture(painted,'Indigo enamel');
  gltf.materials=[{name:'Indigo enamel',pbrMetallicRoughness:{baseColorTexture:{index:texture,texCoord:1},roughnessFactor:.38}}];
  gltf.meshes=[{name:'Azimuth gate',primitives}];gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
  return doc.finish();
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  const save=(file,record)=>fs.writeFileSync(at(file),JSON.stringify(record,null,2)+'\n');
  const painted=paint();
  fs.writeFileSync(at('gate-pigment.png'),painted);
  const modes={};
  for(const mode of ['atlas','conflict']) {
    const test=mode==='conflict', name=test?'Overlap check':'Azimuth Gate', glb=mode+'.glb';
    fs.writeFileSync(at(glb),carrier(test,painted));
    const maps=test?['coverage','uv-outline']:['pigment','coverage','uv-outline'];
    save(mode+'.bake.json',{format:'ink-studio/bake-job',version:1,label:name,source:glb,
      targets:[{id:'gate',mesh:'Azimuth gate',tiles:[1001,1002]}],
      preset:{format:'ink-studio/bake-preset',version:1,label:name,defaults:{size,padding:5},maps:maps.map(id=>({id}))}});
    const result=await runBakeJob(at(mode+'.bake.json'),{directory:at(mode)});
    const base=mode+'/revisions/'+result.revision+'/';
    const debug=result.report.uvDebug.map(row=>({...row,files:Object.fromEntries(Object.entries(row.files).map(([id,file])=>[id,base+file]))}));
    const tiles=debug.map(row=>{
      if(test)return row;
      const color=readTexture(at(base+result.report.maps.find(map=>map.map==='pigment'&&map.tileLabel===row.tileLabel).file));
      const footprint=readTexture(at(row.files.coverage)).data, pixels=new Uint8Array(size*size*4);
      for(let i=0;i<footprint.length;i++)if(footprint[i]) {
        pixels.set(color.data.subarray(i*color.channels,i*color.channels+3),i*4);
        pixels[i*4+3]=255;
      }
      const pigment='tile-'+row.tileLabel+'.png';
      fs.writeFileSync(at(pigment),PNG.encode(size,size,pixels,4,{srgb:true}));
      return {...row,pigment};
    });
    modes[mode]={review:base+'index.html',tiles};
  }
  if(!modes.conflict.tiles.some(tile=>tile.overlaps)||modes.atlas.tiles.some(tile=>tile.overlaps))
    throw new Error('Expected an overlap in the diagnostic variant only');
  fs.writeFileSync(at('data.js'),'const demo = '+JSON.stringify(modes)+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
