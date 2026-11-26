const fs=require('node:fs');
const path=require('node:path');
const {document}=require('../../cli/glb-file.js');
const {runBakeJob}=require('../../cli/bake-jobs.js');
const {readTexture}=require('../../cli/texture-files.js');
const PNG=require('../../cli/png.js');

const out=path.resolve(process.argv[2]??'studio/out/kiln-and-tide');
const at=name=>path.join(out,name), dims={width:129,height:83};
const clamp=n=>Math.max(0,Math.min(1,n));
const seam=v=>.5+.035*Math.sin((v-.12)*9)+.013*Math.cos(v*39);

function pigment() {
  const width=516,height=332, data=new Uint8Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=(x+.5)/width,v=(y+.5)/height, left=u<seam(v), a=left?u:1-u;
    const xp=(a-.235)*1.93, yp=v-.49, r=Math.hypot(xp,yp);
    const fan=Math.atan2(yp,xp), glow=clamp(.62+Math.sin(u*3+v*5)*.24);
    const ramp=left?[[116,37,49],[233,105,51],[250,175,89]]:[[23,48,101],[46,141,179],[106,214,208]];
    const wave=.5+.5*Math.sin((r+.015*Math.cos(fan*5)+.021*Math.sin(v*19))*35);
    const flank=Math.abs(u-seam(v)), stripe=(r>.11&&r<.34&&wave>.965)||flank<.013;
    const diamonds=(Math.abs(a-.206)*1.6+Math.abs(v-.44));
    const gilt=diamonds>.087&&diamonds<.095||v>.67&&v<.685&&Math.floor((a-.02)*90)%5<2;
    const t=clamp(.20+.55*wave+.2*glow), spot=t<.6?(t/.6):(t-.6)/.4,j=t<.6?0:1;
    const rgb=ramp[j].map((value,c)=>value+(ramp[j+1][c]-value)*spot);
    const accent=left?[255,212,120]:[176,242,225], grain=.96+.046*Math.sin(x*81.1-y*71.22)*Math.cos(y*.84);
    data.set((gilt||stripe?accent:rgb).map(n=>Math.round(n*grain)),(x+y*width)*3);
  }
  return PNG.encode(width,height,data,3,{srgb:true});
}

function scene() {
  const doc=document(),{gltf}=doc, image=pigment(), texture=doc.texture(image,'Enamel glaze');
  fs.writeFileSync(at('glaze.png'),image);
  function panel(left) {
    const uv=[], positions=[], indices=[], rows=96, sign=left?-1:1;
    for(let i=0;i<=rows;i++) {
      const t=i/rows,v=.108+.782*t, tip=Math.sin(t*Math.PI)**.70;
      const center=seam(v)+sign*.0018, edge=center+sign*(.309*tip+.058+.032*Math.sin(t*16)*tip);
      for(const u of [left?edge:center,left?center:edge]) {
        uv.push(u,v);
        positions.push(u,1-v,.04*(.5-Math.abs(.5-u)));
      }
      if(i) {
        const a=2*(i-1);
        indices.push(a,a+3,a+1,a,a+2,a+3);
      }
    }
    return {material:0,attributes:{
      POSITION:doc.accessor(Float32Array.from(positions),'VEC3',{bounds:true}),
      TEXCOORD_0:doc.accessor(Float32Array.from(uv),'VEC2')
    },indices:doc.accessor(Uint16Array.from(indices),'SCALAR')};
  }
  gltf.meshes=[{name:'Enamel pair',primitives:[panel(true),panel(false)]}];
  gltf.materials=[{name:'Painter’s glaze',pbrMetallicRoughness:{baseColorTexture:{index:texture},roughnessFactor:.48}}];
  gltf.nodes=[{mesh:0}];gltf.scenes[0].nodes=[0];
  fs.writeFileSync(at('enamel.glb'),doc.finish());
}

function stored(file,output) {
  const {width,height,channels,data,bitDepth}=readTexture(at(file));
  const max=bitDepth===16?65535:255;
  const rgb=new Uint8Array(width*height*3);
  for(let i=0;i<width*height;i++)for(let c=0;c<3;c++)rgb[i*3+c]=Math.round(data[i*channels+c]/max*255);
  fs.writeFileSync(at(output),PNG.encode(width,height,rgb,3,{srgb:true}));
}

async function main() {
  fs.mkdirSync(out,{recursive:true});
  scene();
  const save=(file,value)=>fs.writeFileSync(at(file),JSON.stringify(value,null,2)+'\n');
  const variants={};
  for(const name of ['draft','finished']) {
    const finished=name==='finished', label=finished?'Chart-aware finish':'Single sample';
    const mapOptions={...dims,antialiasing:finished?4:1,padding:6,dilation:finished?5:0,
      diffusion:finished?5:0,gutters:finished?'transparent':'empty',mipmaps:'full'};
    const maps=[
      {id:'pigment',overrides:{...mapOptions,format:finished?'tiff':'png',precision:finished?'unorm16':'unorm8'}},
      {id:'coverage',overrides:{...mapOptions,format:'png',precision:'unorm16'}},
      {id:'normal',overrides:{width:97,height:61,antialiasing:2,padding:4,mipmaps:3,format:'exr',precision:'float16'}}
    ];
    save(name+'.bake.json',{format:'ink-studio/bake-job',version:1,label:'Kiln & Tide',source:'enamel.glb',
      targets:[{id:'enamel',mesh:'Enamel pair'}],preset:{format:'ink-studio/bake-preset',version:1,label,defaults:{size:128,padding:3},maps}});
    const baked=await runBakeJob(at(name+'.bake.json'),{directory:at(name)}), prefix=name+'/revisions/'+baked.revision+'/';
    const mapsById={};
    for(const row of baked.report.maps) {
      mapsById[row.map]=[row,...row.mips].map((mip,i)=>{
        const file=prefix+mip.file, level={width:mip.width,height:mip.height,file,preview:prefix+(mip.previewFile??mip.file)};
        if(row.map==='pigment') {
          level.rgb=name+'-rgb-'+i+'.png';
          stored(file,level.rgb);
        }
        return level;
      });
    }
    variants[name]={label,maps:mapsById,review:prefix+'index.html'};
  }
  fs.writeFileSync(at('data.js'),'const demo = '+JSON.stringify(variants)+';\n');
  fs.copyFileSync(path.join(__dirname,'gallery.html'),at('index.html'));
  console.log(at('index.html'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
