const fs=require('node:fs');
const path=require('node:path');
const {document}=require('../../cli/glb-file.js');
const {runBakeBatch}=require('../../cli/bake-batch.js');
const PNG=require('../../cli/png.js');

const out=path.resolve(process.argv[2]??'studio/out/breakwater-signal');
const at=name=>path.join(out,name);
const n=192, clamp=x=>Math.max(0,Math.min(1,x)), mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const ink=[19,36,48], highlight=[246,203,144];
const colors={
  west:[[30,61,82],[56,123,142],[107,196,171]],
  axis:[[71,32,63],[142,66,95],[213,135,134]],
  east:[[68,43,41],[159,73,55],[242,133,70]],
  edited:[[15,56,58],[30,134,114],[109,217,158]]
};
function draw(id) {
  const pixels=new Uint8Array(n*n*3), colorset=colors[id];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const u=(x+.5)/n*2-1,v=(y+.5)/n*2-1, r=Math.hypot(u,v), a=Math.atan2(v,u);
    const rim=Math.max(Math.abs(u)*1.02,Math.abs(v)*1.10,(Math.abs(u)+Math.abs(v))* .64);
    const wave=.5+.5*Math.cos(5*(r+.055*Math.cos(6*a))+.75*Math.sin(v*12));
    const grain=.96+.034*Math.sin(x*31.23+y*12.81)*Math.cos(y*7.1);
    let base=mix(colorset[0],colorset[1],.45+.46*wave);
    if(r<.57)base=mix(colorset[1],colorset[2],.24+.51*(1-r/.57));
    if(Math.abs(r-.61)<.012||Math.abs(r-.72)<.022||rim>.802&&rim<.829)base=highlight;
    if(Math.abs(r-.69)<.010||rim>.827&&rim<.851||r>.574&&r<.591)base=ink;
    if(r>.635&&r<.674&&Math.cos(a*24)>.82)base=mix(colorset[2],highlight,.52);
    const symbol=id==='axis'?Math.min(Math.abs(Math.abs(u)+Math.abs(v)*.77-.206),Math.abs(Math.abs(u)-Math.abs(v)*.76)):
      id==='west'?Math.abs(v-(Math.abs(u)*.66-.07)):Math.abs(v-.092*Math.cos(u*13));
    if((r<.24&&symbol<.018)||(r>.30&&r<.366&&Math.cos(a*4)>.993))base=highlight;
    if(id==='edited'&&r>.394&&r<.441&&Math.cos(a*8)>.72)base=mix(highlight,colorset[2],.28);
    if(rim>.86)base=mix(ink,colorset[0],.19);
    pixels.set(base.map(v=>Math.max(0,Math.min(255,Math.round(v*grain)))),(y*n+x)*3);
  }
  return PNG.encode(n,n,pixels,3,{srgb:true});
}

function scene() {
  const doc=document(),{gltf}=doc;
  function polygon(points,material,z=0) {
    const indices=[];
    for(let i=1;i<points.length-1;i++)indices.push(0,i+1,i);
    const coords=Float32Array.from(points.flatMap(([x,y])=>[x,1-y,z]));
    return {material,attributes:{POSITION:doc.accessor(coords,'VEC3',{bounds:true}),
      TEXCOORD_0:doc.accessor(Float32Array.from(points.flat()),'VEC2')},indices:doc.accessor(Uint16Array.from(indices),'SCALAR')};
  }
  const plate=[[-.43,-.26],[-.31,-.37],[.31,-.37],[.43,-.26],[.43,.26],[.31,.37],[-.31,.37],[-.43,.26]];
  const plates=[-1,0,1].map(u=>polygon(plate.map(([x,y])=>[x+.5+u,y+.5]),0));
  const ring=(x,y,r)=>Array.from({length:12},(_,i)=>[x+r*Math.cos(i*Math.PI/6),y+r*Math.sin(i*Math.PI/6)]);
  const fasteners=[];
  for(const y of [.27,.73])fasteners.push(polygon(ring(.275,y,.144),1),polygon(ring(.725,y,.144),2));
  gltf.meshes=[{name:'Signal plates',primitives:plates},{name:'Deck fittings',primitives:fasteners}];
  gltf.materials=[{name:'Painted enamel'}, {name:'Satin brass',pbrMetallicRoughness:{baseColorFactor:[.62,.32,.113,1]}},
    {name:'Verdigris',pbrMetallicRoughness:{baseColorFactor:[.08,.27,.23,1]}}];
  gltf.nodes=[{mesh:0},{mesh:1}];gltf.scenes[0].nodes=[0,1];
  fs.writeFileSync(at('breakwater.glb'),doc.finish());
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  scene();
  for(const id of Object.keys(colors))fs.writeFileSync(at(id+'.png'),draw(id));
  fs.copyFileSync(at('east.png'),at('live-east.png'));
  const save=(name,value)=>fs.writeFileSync(at(name),JSON.stringify(value,null,2)+'\n');
  const preset=(label,maps,size)=>({format:'ink-studio/bake-preset',version:1,label,defaults:{size,padding:3},maps});
  save('enamel.bake.json',{format:'ink-studio/bake-job',version:1,label:'Enamel plates',source:'breakwater.glb',
    targets:[{id:'enamel',mesh:'Signal plates'}],textureInputs:{pigments:{tiles:[
      {tile:[-1,0],file:'west.png'},{tile:1001,file:'axis.png'},{tile:1002,file:'live-east.png'}
    ]}},preset:preset('Signal finishes',[
      {id:'pigment',overrides:{textureInput:'pigments',format:'png',precision:'unorm16',antialiasing:2,
        width:144,height:144,mipmaps:2,gutters:'transparent'}},{id:'coverage'}
    ],144)});
  save('fittings.bake.json',{format:'ink-studio/bake-job',version:1,label:'Deck fittings',source:'breakwater.glb',
    targets:[{id:'fittings',mesh:'Deck fittings'}],preset:preset('Fitting maps',[{id:'pigment'},{id:'coverage'}],128)});
  const batch={format:'ink-studio/bake-batch',version:1,label:'Breakwater Signal',workers:3,memoryMb:640,
    tileSets:{plates:[[-1,0],1001,1002],deck:[1001]},jobs:[
      {id:'plates',job:'enamel.bake.json',heapMb:128,tiles:{enamel:'plates'},aliases:[{name:'signal-glaze',target:'enamel',map:'pigment'}]},
      {id:'hardware',job:'fittings.bake.json',heapMb:128,tiles:{fittings:'deck'},
        aliases:[{name:'fitting-coverage',target:'fittings',map:'coverage'}]}
    ]};
  const runs={};
  for(const mode of ['cold','warm','incremental']) {
    if(mode==='incremental')fs.copyFileSync(at('edited.png'),at('live-east.png'));
    save('breakwater.batch.json',mode==='cold'?{...batch,cache:{policy:'refresh'}}:batch);
    const result=await runBakeBatch(at('breakwater.batch.json'),{directory:at('output')});
    const base='output/revisions/'+result.revision+'/';
    runs[mode]={base,...result.data};
  }
  if(runs.cold.totals.baked!==4||runs.warm.totals.cached!==4||
    runs.incremental.totals.cached!==3||runs.incremental.totals.baked!==1)
    throw new Error('Demo requires one edited tile and three reusable work units');
  fs.writeFileSync(at('data.js'),'const demo = '+JSON.stringify(runs)+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
