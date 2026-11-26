const fs=require('node:fs');
const path=require('node:path');
const {document}=require('../../cli/glb-file.js');
const {runBakeJob}=require('../../cli/bake-jobs.js');
const {readTexture}=require('../../cli/texture-files.js');
const PNG=require('../../cli/png.js');

const out=path.resolve(process.argv[2]??'studio/out/moonwater-cloister');
const at=name=>path.join(out,name), clamp=n=>Math.min(1,Math.max(0,n));
const save=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value,null,2)+'\n');

function buildScene() {
  const doc=document(), {gltf}=doc;
  const stream=()=>({positions:[],uv:[],indices:[]});
  function polygon(output,points,uv=false) {
    const first=output.positions.length/3;
    for(const p of points) {
      output.positions.push(...p);
      if(uv)output.uv.push((p[0]+2.72)/5.44,(2.72-p[1])/5.44);
    }
    for(let i=1;i<points.length-1;i++)output.indices.push(first,first+i,first+i+1);
  }
  function box(output,x,y,z,w,h,d) {
    const ring=q=>[[x-w/2,y-h/2,q],[x+w/2,y-h/2,q],[x+w/2,y+h/2,q],[x-w/2,y+h/2,q]];
    const lower=ring(z),upper=ring(z+d);
    polygon(output,upper);
    polygon(output,lower.slice().reverse());
    for(let i=0;i<4;i++){const j=(i+1)%4;polygon(output,[lower[i],lower[j],upper[j],upper[i]]);}
  }
  function cylinder(output,x,y,z,r,h) {
    const ring=height=>Array.from({length:12},(_,i)=>{
      const a=i/12*2*Math.PI;
      return [x+r*Math.cos(a),y+r*Math.sin(a),height];
    });
    const lower=ring(z),upper=ring(z+h);
    polygon(output,upper);
    for(let i=0;i<12;i++){const j=(i+1)%12;polygon(output,[lower[i],lower[j],upper[j],upper[i]]);}
  }
  function arch(output,x,y,r,z) {
    const width=.48, coarse=16;
    for(let i=0;i<coarse;i++) {
      const ring=(angle,depth)=>[x+r*Math.cos(angle),y+depth,z+r*Math.sin(angle)];
      const a=i/coarse*Math.PI,b=(i+1)/coarse*Math.PI;
      polygon(output,[ring(a,-width/2),ring(b,-width/2),ring(b,width/2),ring(a,width/2)]);
    }
    for(const px of [x-r,x+r])box(output,px,y,0,.18,width,z+.08);
  }
  const floor=stream(), stone=stream(), canopy=stream();
  const e=2.55,c=2.05;
  polygon(floor,[[-c,-e,0],[c,-e,0],[e,-c,0],[e,c,0],[c,e,0],[-c,e,0],[-e,c,0],[-e,-c,0]],true);
  for(const x of [-2.21,2.21]) {
    box(stone,x,.88,0,.21,2.37,.57);
    box(stone,x,-1.55,0,.21,1.12,.32);
  }
  for(const x of [-1.61,1.61])for(const y of [-1.52,.86]) {
    box(stone,x,y,0,.53,.49,.115);
    cylinder(stone,x,y,.108,.203,.82);
    box(stone,x,y,.92,.48,.45,.115);
  }
  box(stone,0,2.11,0,2.85,.22,.49);
  for(const y of [-.58,-.95,-1.32,-1.69,-2.06])box(canopy,-.84,y,1.02,2.38,.17,.12);
  for(const y of [.84,1.85])arch(canopy,.98,y,.72,.32);
  box(canopy,1.61,1.33,.9,.31,1.47,.095);
  function primitive({positions,uv,indices}) {
    const attributes={POSITION:doc.accessor(Float32Array.from(positions),'VEC3',{bounds:true})};
    if(uv.length)attributes.TEXCOORD_0=doc.accessor(Float32Array.from(uv),'VEC2');
    return {attributes,indices:doc.accessor(Uint32Array.from(indices),'SCALAR')};
  }
  gltf.meshes=[{name:'Cloister',primitives:[primitive(floor),primitive(stone)]},{name:'Brass arcade',primitives:[primitive(canopy)]}];
  gltf.nodes=[{mesh:0},{mesh:1}];gltf.scenes[0].nodes=[0,1];
  fs.writeFileSync(at('cloister.glb'),doc.finish());
}

function composite(unit,contact,bent,footprint) {
  const {width,height,data:ao}=unit, pixels=new Uint8Array(width*height*4);
  const frac=n=>n-Math.floor(n), blend=(a,b,t)=>a.map((c,i)=>c+(b[i]-c)*t);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=x+y*width;
    if(!footprint.data[i])continue;
    const u=(x+.5)/width*5.44-2.72,v=2.72-(y+.5)/height*5.44;
    const ring=Math.hypot(u,v+.02), edge=Math.max(Math.abs(u),Math.abs(v),(Math.abs(u)+Math.abs(v))/1.804);
    const sy=(v+3)/.294, sx=(u+3)/.485+.5*(Math.floor(sy)%2);
    const joint=Math.min(frac(sy),1-frac(sy),frac(sx),1-frac(sx));
    const variation=.62+.24*Math.sin(Math.floor(sy)*85.6+Math.floor(sx)*55.8);
    let color=blend([37,75,83],[90,144,144],variation);
    if(ring<1.19||edge>2.25)color=blend([27,60,74],[50,107,118],variation);
    if(joint<.033)color=blend(color,[18,37,46],.68);
    if(Math.abs(edge-2.34)<.026||Math.abs(edge-2.28)<.009||
       Math.abs(ring-1.19)<.024||Math.abs(ring-1.02)<.012) color=[180,133,80];
    const petal=Math.abs(Math.abs(u)+Math.abs(v)*.88-.40);
    if(ring<.54&&petal<.029)color=[208,157,91];
    if(ring<.111||(Math.abs(u)<.018||Math.abs(v)<.018)&&ring<.73)color=[198,155,100];
    if(ring>1.047&&ring<1.16&&Math.cos(Math.atan2(v,u)*16)>.95)color=[196,142,79];
    const open=ao[i]/65535, soft=contact.data[i]/255;
    const light=.19+.72*open+.15*soft+.16*Math.max(0,bent.data[i*3]*-.6+bent.data[i*3+1]*.45);
    const grain=.96+.04*Math.sin(x*29.7+y*67.3)*Math.cos(x*7.2-y*15.3);
    pixels.set([...color.map((c,j)=>Math.round(255*clamp(c*light*grain/255+(1-open)*[.016,.026,.040][j]))),255],i*4);
  }
  return PNG.encode(width,height,pixels,4);
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  buildScene();
  const ambient={rays:48,spread:90,range:2.9,falloff:'linear',selfOcclusion:'all'};
  const preset={format:'ink-studio/bake-preset',version:1,label:'Courtyard lighting',defaults:{size:232,padding:3},maps:[
    {id:'ao',overrides:{...ambient,encoding:'png16'}},
    {id:'bent-normal',overrides:{...ambient,encoding:'exr'}},
    {id:'occlusion-direction',overrides:{...ambient,encoding:'exr'}},
    {id:'ao-contact',overrides:{rays:32,range:.48}},
    {id:'ao-directional',overrides:{rays:40,spread:28,range:2.9,falloff:'linear',direction:[.65,-.22,1],encoding:'png16'}},
    {id:'coverage'}
  ]};
  const different=(name,selfOcclusion)=>({...preset,label:name,maps:[{id:'ao',overrides:{...ambient,selfOcclusion,encoding:'png16'}}]});
  save('cloister.preset.json',preset);
  save('own.preset.json',different('Own mesh','only'));
  save('neighbors.preset.json',different('Neighbors','exclude'));
  save('cloister.bake.json',{format:'ink-studio/bake-job',version:1,label:'Moonwater Cloister',source:'cloister.glb',
    preset:'cloister.preset.json',targets:[{id:'pavers',mesh:'Cloister',submeshes:[0],tiles:[1001]}]});
  async function run(folder,preset) {
    const result=await runBakeJob(at('cloister.bake.json'),{directory:at(folder),...(preset&&{presetFile:at(preset)})});
    const root=folder+'/revisions/'+result.revision+'/';
    return {results:new Map(result.report.maps.map(row=>[row.map,{
      file:root+row.file,preview:root+(row.previewFile??row.file),rays:row.occlusion?.rayCount,
      blocked:row.occlusion?.blockedRays
    }])),workstation:root+'index.html'};
  }
  const main=await run('review'), own=await run('own','own.preset.json'), neighbors=await run('neighbors','neighbors.preset.json');
  const read=id=>readTexture(at(main.results.get(id).file));
  fs.writeFileSync(at('moonwater-lit.png'),composite(read('ao'),read('ao-contact'),read('bent-normal'),read('coverage')));
  const maps=Object.fromEntries(main.results);
  maps.lit={file:'moonwater-lit.png',preview:'moonwater-lit.png'};
  maps.own=own.results.get('ao');
  maps.neighbors=neighbors.results.get('ao');
  fs.writeFileSync(at('data.js'),'const demo='+JSON.stringify({maps,workstation:main.workstation})+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
