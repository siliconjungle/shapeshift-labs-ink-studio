const fs=require('node:fs');
const path=require('node:path');
const {document}=require('../../cli/glb-file.js');
const {runBakeJob}=require('../../cli/bake-jobs.js');
const {readTexture}=require('../../cli/texture-files.js');
const PNG=require('../../cli/png.js');
const {writeReference}=require('./reference.cjs');

const out=path.resolve(process.argv[2]??'studio/out/nacre-signal');
const at=name=>path.join(out,name);
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const clamp=n=>Math.max(0,Math.min(1,n));
const smooth=(lo,hi,value)=>{const x=clamp((value-lo)/(hi-lo));return x*x*(3-2*x);};

function contour(x,y) {
  return Math.max(Math.abs(x),Math.abs(y),(Math.abs(x)+Math.abs(y))/1.74);
}

function relief(x,y) {
  const r=contour(x,y), radius=Math.hypot(x,y-.12);
  const ridge=(d,w)=>smooth(w,0,Math.abs(d));
  let h=-.038+.123*ridge(r-.924,.044)+.046*ridge(r-.836,.022);
  h+=.095*ridge(radius-.581,.042)+.035*ridge(radius-.507,.019);
  const disc=Math.hypot(x+.051,y-.234);
  h+=.036*smooth(.258,.212,disc)+.025*ridge(disc-.241,.025);
  const needle=.18*(y-.03), mast=y>-.285&&y<.409;
  h+=.107*smooth(.083,.012,Math.abs(x-needle)) *
    (mast?smooth(-.285,-.22,y)*smooth(.409,.35,y):0);
  h+=.076*ridge(Math.hypot(x+.03,y+.037),.096);
  const gaugeAngle=Math.atan2(y-.12,x);
  if(radius>.39&&radius<.566) h+=.014*smooth(.56,.89,Math.cos(gaugeAngle*28))
    *smooth(.39,.424,radius)*smooth(.566,.512,radius);
  for(let i=0;i<3;i++) {
    const wave=-.235-i*.118+.075*Math.sin(x*4.4+i*.75)+.018*Math.sin(x*13.5+1.2*i);
    h+=.058*ridge(y-wave,.038)*smooth(.65,.44,Math.abs(x));
  }
  h-=.028*ridge(y+.682,.025)*smooth(.43,.29,Math.abs(x));
  for(const u of [-.712,.712])for(const v of [-.711,.711]) {
    const screw=Math.hypot(x-u,y-v);
    h+=.108*smooth(.077,.036,screw);
    h-=.052*ridge(y-v,.015)*smooth(.066,.044,Math.abs(x-u));
  }
  return h;
}

const normal=(x,y)=>{
  const e=.001, a=(relief(x-e,y)-relief(x+e,y))/(2*e), b=(relief(x,y-e)-relief(x,y+e))/(2*e);
  const d=Math.hypot(a,b,1);
  return [a/d,b/d,1/d];
};

function asset(high) {
  const doc=document(),{gltf}=doc;
  function primitive(tile) {
    const p=[],n=[],uv=[],idx=[],shift=tile*2.5;
    function point(x,y) {
      p.push(x+shift,y,high?relief(x,y)-(tile?.046:0):0);
      n.push(...(high?normal(x,y):[0,0,1]));
      if(!high)uv.push(tile+(tile?(1.04-x):(x+1.04))/2.08,(1.04-y)/2.08);
    }
    if(high) {
      const grid=174, stride=grid+1;
      for(let y=0;y<=grid;y++)for(let x=0;x<=grid;x++)point((2.02*x/grid)-1.01,(2.02*y/grid)-1.01);
      for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
        const i=y*stride+x;
        idx.push(i,i+1,i+stride+1,i,i+stride+1,i+stride);
      }
    } else {
      const c=.74, e=.98;
      for(const [x,y] of [[-c,-e],[c,-e],[e,-c],[e,c],[c,e],[-c,e],[-e,c],[-e,-c]])point(x,y);
      for(let i=1;i<7;i++)idx.push(0,i,i+1);
    }
    const attributes={POSITION:doc.accessor(Float32Array.from(p),'VEC3',{bounds:true}),NORMAL:doc.accessor(Float32Array.from(n),'VEC3')};
    if(!high)attributes.TEXCOORD_0=doc.accessor(Float32Array.from(uv),'VEC2');
    return {attributes,indices:doc.accessor(Uint32Array.from(idx),'SCALAR')};
  }
  gltf.meshes=[{name:'Seal_'+(high?'high':'low'),primitives:[primitive(0),primitive(1)]}];
  gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
  fs.writeFileSync(at(high?'sculpt.glb':'receiver.glb'),doc.finish());
}

function lit(height,world,coverage,tile) {
  const {width,height:size}=height,n=world.data, z=height.data;
  const bytes=new Uint8Array(width*size*4);
  const mix=(a,b,t)=>a.map((c,i)=>c+(b[i]-c)*t);
  for(let i=0;i<z.length;i++) {
    if(!coverage.data[i])continue;
    const h=z[i]+(tile===1002?.046:0), di=i*3;
    const key=Math.max(.0,n[di]*(-.42)+n[di+1]*.58+n[di+2]*.7);
    const fill=Math.max(.0,n[di]*.42-n[di+1]*.26+n[di+2]*.49);
    const elevation=smooth(-.04,.06,h), gilding=smooth(-.01,.034,h);
    const dark=mix([11,30,42],[27,106,121],elevation);
    const bronze=mix([91,66,54],[219,166,112],smooth(-.009,.085,h));
    const pigment=mix(dark,bronze,gilding), energy=.35+.65*key+.19*fill;
    bytes.set([...pigment.map((c,j)=>Math.round(Math.min(255,c*energy+Math.pow(key,19)*[31,23,11][j]*gilding))),255],i*4);
  }
  return PNG.encode(width,size,bytes,4);
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  asset(false);asset(true);
  const plan={format:'ink-studio/bake-job',version:1,label:'Nacre Signal',source:'receiver.glb',projectionSources:{sculpt:'sculpt.glb'},
    preset:'physical.preset.json',targets:[{id:'seal',mesh:'Seal_low',tiles:[1001,1002],
      projection:{mode:'project',high:'sculpt',front:.26,back:.17,normals:'face'}}]};
  const physical={format:'ink-studio/bake-preset',version:1,label:'Signed EXR and tangent PNG16',defaults:{size:252,padding:3},
    maps:[{id:'normal',overrides:{encoding:'png16'}},{id:'world-normal',overrides:{encoding:'exr'}},
      {id:'height',overrides:{encoding:'exr'}},{id:'coverage'}]};
  const normalized={...physical,label:'Shared range and DirectX',maps:[
    {id:'normal',overrides:{encoding:'png16',orientation:'directx'}},
    {id:'height',overrides:{encoding:'png16',normalization:'minmax'}}]};
  save(at('nacre.bake.json'),plan);save(at('physical.preset.json'),physical);save(at('normalized.preset.json'),normalized);
  const analog=await runBakeJob(at('nacre.bake.json'),{directory:at('physical')});
  const packed=await runBakeJob(at('nacre.bake.json'),{directory:at('normalized'),presetFile:at('normalized.preset.json')});
  const base=result=>(result===analog?'physical':'normalized')+'/revisions/'+result.revision+'/';
  function result(result,id,tile) {
    const row=result.report.maps.find(row=>row.map===id&&row.tileLabel===String(tile));
    return {row,raw:base(result)+row.file,preview:base(result)+(row.previewFile??row.file)};
  }
  const cards={};
  for(const tile of [1001,1002]) {
    const read=row=>readTexture(at(row.raw));
    const raw=result(analog,'height',tile), world=result(analog,'world-normal',tile);
    const coverage=result(analog,'coverage',tile), illustration='seal-'+tile+'.png';
    fs.writeFileSync(at(illustration),lit(read(raw),read(world),read(coverage),tile));
    cards[tile]={lit:{preview:illustration,raw:illustration,label:'Shaded from baked world normals'},
      tangent:result(analog,'normal',tile),directx:result(packed,'normal',tile),world,
      height:raw,normalized:result(packed,'height',tile)};
  }
  const reference=at('reference');
  const expected=writeReference(reference), refJob=path.join(reference,'known-planes.bake.json');
  save(refJob,{...plan,label:'Known mirrored planes',source:'low.glb',projectionSources:{detail:'high.glb'},
    preset:{...physical,defaults:{size:32,padding:2}},targets:[{id:'check',mesh:'low',tiles:expected.tiles,
      projection:{mode:'project',high:'detail',front:.2,back:.12,normals:'face'}}]});
  const proof=await runBakeJob(refJob,{directory:path.join(reference,'proof')});
  const referencePage='reference/proof/revisions/'+proof.revision+'/index.html';
  fs.writeFileSync(at('data.js'),'const demo='+JSON.stringify({cards,workstation:base(analog)+'index.html',referencePage})+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
