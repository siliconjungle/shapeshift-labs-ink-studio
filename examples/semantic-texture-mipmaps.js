/* Pelagic telegraph. One textured surface, with a matched level-zero comparison. */
const fs=require('node:fs');
const path=require('node:path');
const ink=require('..');
const PNG=require('../cli/png.js');
const {screenDrawing}=require('../src/frame-composite.js');
const {projector}=require('../src/drawing-primitives.js');

function telegraph({KIT:K,makeBuilder,makeSculpt,SemanticTextureMipmaps:Mips}) {
  const seed=92, id='semantic-texture-mipmaps', width=256,height=160;
  const colors=[0x122330,0x284854,0x315561,0x436a6e,0x8bad9f,0xc3d7b6,
    0xfad183,0xbb8257,0x765848,0x137063,0x5ab3a1,0x1a3346];
  const palette=[0x13263a,0x294252,0x4e6268,0x737f73,0x9ca28c,0xbcaa8a,...colors.slice(4,10)];
  const indices=new Uint8Array(width*height), coverage=new Uint8Array(indices.length).fill(255);
  const normal=new Uint8Array(indices.length*4), roughness=new Uint8Array(indices.length);
  const emission=new Uint8Array(indices.length*3);
  const {V}=K;
  const slot=(x,y)=>y*width+x;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=slot(x,y), inside=x>11&&x<245&&y>11&&y<148;
    let shade=inside?2:1, n=[0,0,1], r=.55;
    if(inside && (y<15||y>145||x<15||x>241))shade=7;
    if(x>26&&x<180&&y>84&&y<126){
      const phase=(x+y*3)%7;
      shade=phase<3?1:2;
      n=phase<3?[.38,.08,.92]:[-.73,.11,.68];
      r=.115;
      if(y===85||y===124)shade=4;
      if(x%17===1 && y%11===0)shade=6;
    }
    if(x>25&&x<178&&y>129&&y<141){
      shade=0;
      if((x%12===0||x%12===1)&&y>131&&y<140){
        shade=9;
        emission.set([15,166,119],i*3);
      }
    }
    if(x>196&&x<236&&y>28&&y<128){
      shade=8;
      if((x-198)%7<3 && y>32 && y<124 && y%22!==0){
        shade=0;
        coverage[i]=0;
      }
    }
    for(const [a,b] of [[8,8],[247,8],[8,151],[247,151]]) {
      const distance=Math.hypot(x-a,y-b);
      if(distance<4){shade=(x-a)+(y-b)<0?6:8;r=.11;n=[(x-a)*.2,(b-y)*.2,.65];}
    }
    indices[i]=shade;
    const encoded=V.norm(n).map(q=>128+Math.round(q*127));
    normal.set([...encoded,255],i*4);
    roughness[i]=Math.round(r*255);
  }
  const line=(points,width,color)=>({type:'path',points,width,color});
  const text=(value,x,y,size,weight,color)=>K.poly2.text(value,size,{width:weight}).strokes
    .map(points=>line(points.map(([u,v])=>[x+u,y-v]),weight,color));
  const drawing=screenDrawing(width,height,[
    ...text('PELAGIC',100,45,21,2.9,'#c3d7b6'),
    ...text('SIGNAL STATION',101,70,7.9,1.55,'#8bad9f'),
    line([[31,57],[164,57]],1.9,'#fad183'),
    ...text('12',213,22,7,1.4,'#fad183'),
    ...text('RX',217,142,8.5,1.6,'#8bad9f'),
    line([[21,78],[181,78],[186,73],[186,29]],1.6,'#8bad9f')
  ],{edges:'hard'});
  for(let i=0;i<indices.length;i++){
    if(drawing.data[i*4+3]<128)continue;
    const c=(drawing.data[i*4]<<16)|(drawing.data[i*4+1]<<8)|drawing.data[i*4+2];
    const found=colors.indexOf(c);
    if(found>=0)indices[i]=found;
  }
  const material={id:'stenciled-enamel',texture:{width,height,indices,palette:colors,coverage},
    normal,roughness,emission,emissionStrength:1.3,mipmaps:{protect:[colors[6],colors[5]],
      protectCoverage:.105,light:[.68,.17,.74],specular:.66}};
  function quad(name,{x0,x1,y0,y1,z},materials){
    return K.sceneMeshes.create({id:name,objectId:'pelagic-rack',partId:name,
      positions:[x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z],uvs:[0,1,1,1,0,0,1,0],indices:[0,1,2,1,3,2],materials});
  }
  const face=quad('telegraph-face',{x0:-1.83,x1:1.83,y0:.76,y1:3.04,z:.49},[material]);
  const B=makeBuilder(seed,palette),S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:V.norm([-.57,.72,.46]),amb:.43,sky:.2,sunK:.57,wob:0});
  const stone={r:[1,2,3,4]}, ochre={r:[6,7,8,9]}, metal={r:[1,2,3]}, dark={r:[0,1,2]};
  S.lathe([0,-.26,0],.29,[2.32,2.33,2.23,2.14],stone,{res:.064,objectId:'dock'});
  S.lathe([0,.025,0],.10,[1.92,1.93,1.88,1.82],ochre,{res:.079,objectId:'dock'});
  S.box([0,1.90,-.095],[1.89,1.19,.51],metal,{rd:.10,res:.068,objectId:'cabinet'});
  S.box([0,1.90,.442],[1.86,1.16,.025],dark,{rd:.021,res:.040,objectId:'backing'});
  for(const x of [-1.19,1.18]){
    S.box([x,.39,.03],[.24,.31,.52],stone,{rd:.072,res:.060,objectId:'feet'});
    S.box([x,3.03,-.06],[.19,.14,.26],ochre,{rd:.033,res:.047,objectId:'mounts'});
  }
  for(let y=.96;y<2.71;y+=.20)S.box([1.90,y,-.10],[.027,.030,.36],dark,{rd:.014,res:.056,objectId:'sides'});
  S.bake();
  const world=B.finish({id,meshes:[face],cam:{target:[0,1.58,0],dist:8.1,pitch:.14,yaw:.10,ortho:true,fov:.65},
    radius:6,dither:0,fog:{c:1,start:1,max:0},look:{splatCoverage:'continuous'},
    skyEnvironment:{defaults:{zenith:'#293d56',horizon:'#577c7f',ground:'#182f40',sunStrength:0}}});
  return {world,face,mips:K.sceneMeshes.layer(face).semanticMipmaps[0].chain};
}

const factory=kit=>({
  id:'semantic-texture-mipmaps',name:'Pelagic telegraph',seed:92,
  build(){return telegraph(kit).world;}
});

function demo(directory,frames=false) {
  const kit=ink.load(),{world,mips}=telegraph(kit),out=path.resolve(directory), w=366,h=264;
  fs.mkdirSync(out,{recursive:true});
  const targetPoints=[[-.85,1.50,.49],[-.46,1.46,.49],[-.02,1.45,.49],[.29,1.55,.49],[.61,1.64,.49]];
  const stats={base:[],semantic:[]};
  function draw(i,enabled) {
    const t=i/32, camera={yaw:.08+.10*Math.sin(Math.PI*t),pitch:.12+.038*t,dist:10.3+5.2*t,
      target:[.08*Math.sin(t*Math.PI*3),1.68,0]}, options={w,h,raw:true,px:1,...camera,semanticMipmaps:enabled};
    const image=ink.render(world,options);
    const lens=kit.CameraLens.frame(world,options,w,h);
    const map=projector({...lens,tangent:lens.ortho?lens.tangent*lens.dist:lens.tangent},w,h);
    const tracked=targetPoints.map(p=>{
      const [x,y]=map.point(map.toView(p)).map(Math.floor);
      return [...image.rgb.subarray((y*w+x)*3,(y*w+x)*3+3)];
    });
    return {image,tracked};
  }
  for(const enabled of [false,true]){
    const mode=enabled?'semantic':'base';
    const still=draw(16,enabled).image;
    PNG.write(path.join(out,mode+'.png'),still.w,still.h,still.rgb);
    const dir=path.join(out,mode);
    if(frames)fs.mkdirSync(dir,{recursive:true});
    for(let i=0;i<33;i++){
      const {image,tracked}=draw(i,enabled);
      stats[mode].push(tracked);
      if(frames)PNG.write(path.join(dir,String(i).padStart(3,'0')+'.png'),image.w,image.h,image.rgb);
    }
  }
  const variation=rows=>rows.slice(1).reduce((sum,row,i)=>sum+row.reduce((n,rgb,j)=>
    n+rgb.reduce((d,c,k)=>d+Math.abs(c-rows[i][j][k]),0),0),0)/((rows.length-1)*targetPoints.length*3);
  const receipt={levels:mips.levels.map(({width,height})=>[width,height]),
    trackedMeanFrameChange:{base:variation(stats.base),semantic:variation(stats.semantic)}};
  fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}

if(require.main===module)demo(process.argv[2]??'pelagic-mipmaps',process.argv.includes('--frames'));
module.exports=factory;
