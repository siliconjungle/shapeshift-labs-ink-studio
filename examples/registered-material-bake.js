/* Kestrel survey buoy. The demo uses the exported material maps to render the buoy. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ink=require('..');
const PNG=require('../cli/png.js');
const {projector}=require('../src/drawing-primitives.js');
const {screenDrawing}=require('../src/frame-composite.js');

function buoy(K) {
  const ringCount=52, tau=2*Math.PI;
  const profile=[[.52,.17],[.68,.23],[.86,.42],[.88,.54],[.88,1.94],[.83,2.10],[.64,2.27],[.49,2.36],[.49,2.53],[.40,2.57]];
  const points=profile.flatMap(([r,y])=>Array.from({length:ringCount},(_,i)=>{
    const a=i/ringCount*tau;
    return [r*Math.sin(a),y,r*Math.cos(a)];
  }));
  const faces=[],uvs=[];
  const side=(i,y)=>[.035+i/ringCount*.93,.055+(2.57-y)/2.4*.66];
  for(let j=0;j+1<profile.length;j++)for(let i=0;i<ringCount;i++) {
    const next=(i+1)%ringCount;
    faces.push([j*ringCount+i,j*ringCount+next,(j+1)*ringCount+next,(j+1)*ringCount+i]);
    const y=profile[j][1], h=profile[j+1][1];
    uvs.push([side(i,y),side(i+1,y),side(i+1,h),side(i,h)]);
  }
  const wall=faces.length;
  for (const top of [false,true]) {
    const ring=top?profile.length-1:0, center=points.length, middle=[top ? .72 : .28,.861];
    points.push([0,profile[ring][1],0]);
    const cap=i=> {
      const a=i/ringCount*tau;
      return [middle[0]+.097*Math.sin(a),middle[1]+.097*Math.cos(a)];
    };
    for(let i=0;i<ringCount;i++) {
      const j=(i+1)%ringCount;
      const [a,b]=top?[i,j]:[j,i];
      faces.push([center,ring*ringCount+a,ring*ringCount+b]);
      uvs.push([middle,cap(a),cap(b)]);
    }
  }
  function paint(p,n,f) {
    const [x,y,z]=p, theta=Math.atan2(x,z), raw=Math.hypot(x,z);
    const wallBand=y>.62&&y<1.78, signal=y>1.805&&y<1.875 || y>2.402&&y<2.47 && f<wall;
    const seal=y>.483&&y<.55||y>1.895&&y<1.949||y>2.50;
    const flutes=y>2.1 || y<.58;
    const ridge=Math.sin(52*theta)*Math.sin(6*y), brushed=.02*Math.sin(theta*23+y*39);
    const flecks=(Math.sin(x*69+y*41+z*45)*Math.cos(y*54-z*67))**6;
    const normal=f>=wall ? [0,y>1?1:-1,0] :
      K.V.norm(K.V.add(n,[Math.cos(theta)*ridge*(flutes ? .25 : .055),Math.sin(y*55)*.03,-Math.sin(theta)*ridge*(flutes ? .25 : .055)]));
    const pale=[.71+brushed,.67+brushed,.49+brushed], jade=[.031+brushed*.3,.18+brushed,.175+brushed];
    let color=wallBand?pale:jade;
    if(wallBand&&flecks>.75)color=color.map(x=>x*.92);
    if(seal)color=[.04,.07,.077];
    if(signal)color=[.055,.42,.36];
    if(f>=wall)color=raw<.19?[.11,.24,.22]:[.065,.15,.16];
    return { color,normal,roughness:signal ? .21 : seal ? .36 : wallBand ? .58 : flutes ? .29 : .42,metallic:wallBand ? .05 : .36,
      emission:signal?[.09,.67,.51]:[0,0,0], masks:{ceramic:Number(wallBand),seal:Number(seal),signal:Number(signal)} };
  }
  return {name:'Kestrel survey buoy',points,faces,uvs,closed:true,
    materials:[{name:'survey finish',color:[.5,.5,.5]}],maskNames:['ceramic','seal','signal'],sampleSurface:paint};
}

const factory=({KIT:K,makeBuilder})=>({
  id:'registered-material-bake',name:'Kestrel survey buoy',seed:11,
  build(){return makeBuilder(11).finish({id:'registered-material-bake'});},
  model(){return buoy(K);}
});

function preview(kit, file, bakeDir) {
  const {KIT:K,makeBuilder,makeSculpt}=kit;
  const model=ink.readMesh(file,{attributes:true}), UV=new Float32Array(model.pos.length/3*2);
  for (const [i,v] of model.tri.entries()) UV.set(model.uvs[Math.floor(i/3)][i%3],v*2);
  const report=JSON.parse(fs.readFileSync(path.join(bakeDir,'material-bake.json'),'utf8')).meshes[0];
  const channel=name=>PNG.raster(path.join(bakeDir,report.maps[name].file));
  const pigment=channel('pigment'), normal=channel('normal');
  const mesh=K.sceneMeshes.create({id:'survey-buoy',positions:model.pos,indices:model.tri,uvs:UV,
    materials:[{id:'baked-enamel',texture:{width:pigment.w,height:pigment.h,pixels:pigment.data},normal:normal.data}]});
  const B=makeBuilder(15,[0x122833,0x23424c,0x3b6165,0x628385,0x90a39a,0xbeb49b]);
  const S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:K.V.norm([-.60,.72,.44]),amb:.45,sky:.18,sunK:.50,wob:0});
  S.lathe([0,-.14,0],.37,[1.44,1.44,1.26,1.18],{r:[1,2,3,4,5]},{res:.07,objectId:'dock'});
  S.bake();
  return B.finish({meshes:[mesh],radius:6,cam:{target:[0,1.24,0],dist:5.25,ortho:true,pitch:.12,yaw:0},
    areaLights:[{id:'key',shape:'disk',at:[-2.6,3.5,3.8],normal:[.31,-.52,-.79],size:[.46,.46],
      color:'#fff2df',intensity:6,radius:10,sampleGrid:1,visible:false,shadows:false}],
    skyEnvironment:{defaults:{zenith:'#2f4f64',horizon:'#718b8c',ground:'#162d39',sunStrength:0}},
    look:{splatCoverage:'continuous'},dither:0});
}

function approve(kit,parent,row) {
  const {id,width,height,camera}=row, {KIT:K}=kit;
  const project=projector(camera,width,height);
  const yaw=Math.atan2(camera.view[2],camera.view[10]);
  const at=h=>project.point(project.toView([.88*Math.sin(yaw),h,.88*Math.cos(yaw)]));
  const stroke=(points,width,color)=>({type:'path',points,width,color});
  const label=(message,h,size,color,weight=1.25)=>{
    const strokes=K.poly2.text(message,size,{width:weight}).strokes, [x,y]=at(h);
    return strokes.map(points=>stroke(points.map(([u,v])=>[x+u,y-v]),weight,color));
  };
  const [x,y]=at(1.33);
  const commands=id==='bow' ? [
    ...label('K  07',1.46,18,'#124d54',2.2),
    ...label('SURVEY',1.14,7,'#1d6364',1),
    stroke([[x-32,y+7],[x+32,y+7]],1,'#367c72'),
    {type:'rect',rect:[x-34,y+18,7,4],color:'#cf6546'}
  ] : id==='starboard' ? [
    stroke([[x-25,y-15],[x+20,y-15],[x+29,y+2],[x+20,y+18],[x-25,y+18]],2,'#b95342'),
    ...label('UP',1.38,12,'#b95342',1.8),
    stroke([[x-24,y+26],[x+24,y+26]],1,'#645c53')
  ] : [
    ...label('AFT',1.42,16,'#164c55',2),
    ...label('07',1.15,8,'#b95342',1.4),
    stroke([[x-28,y-9],[x-28,y+12]],2,'#b95342'),
    stroke([[x+28,y-9],[x+28,y+12]],2,'#b95342')
  ];
  const raster=screenDrawing(width,height,commands);
  fs.writeFileSync(path.join(parent,row.paint),PNG.encode(width,height,raster.data,4));
}

function demo(directory) {
  const out=path.resolve(directory), kit=ink.load(), model=factory(kit).model();
  const baseline=path.join(out,'before'), painted=path.join(out,'after');
  const baseGlb=path.join(baseline,'buoy.glb'), afterGlb=path.join(painted,'buoy.glb');
  const capturePaint={format:'ink-studio/material-paint-cameras',version:1,views:[
    {id:'bow',width:256,height:204,camera:{yaw:0,pitch:.03}},
    {id:'starboard',width:256,height:204,camera:{yaw:2.08,pitch:.03}},
    {id:'aft',width:256,height:204,camera:{yaw:-2.08,pitch:.03}}
  ]};
  const first=ink.exportGlb(model,{out:baseGlb,bakeDir:baseline,textureSize:256,capturePaint});
  const base=JSON.parse(fs.readFileSync(first.materialBake,'utf8'));
  const paintViews=path.join(baseline,base.paintManifest);
  const approved=JSON.parse(fs.readFileSync(paintViews,'utf8'));
  for(const row of approved.views)approve(kit,path.dirname(paintViews),row);
  const result=ink.exportGlb(model,{out:afterGlb,bakeDir:painted,textureSize:256,paintViews});
  const after=JSON.parse(fs.readFileSync(result.materialBake,'utf8'));
  assert.equal(after.meshes[0].uvLayout,base.meshes[0].uvLayout);
  assert(after.meshes[0].paintViews.every(row=>row.texels>30));
  for (const name of ['normal','metallicRoughness','emission','roughness'])
    assert.equal(after.meshes[0].maps[name].sha256,base.meshes[0].maps[name].sha256);
  const frames=path.join(out,'frames');
  fs.mkdirSync(frames,{recursive:true});
  for(const [id,file,dir] of [['before',baseGlb,baseline],['after',afterGlb,painted]]) {
    const world=preview(kit,file,dir);
    for(let i=0;i<24;i++){
      const image=ink.render(world,{w:282,h:202,px:1,raw:true,yaw:i*Math.PI*2/24-.12});
      PNG.write(path.join(frames,id+'-'+String(i).padStart(2,'0')+'.png'),image.w,image.h,image.rgb);
    }
  }
  console.log(JSON.stringify(after.meshes[0].paintViews.map(({id,texels,occluded})=>({id,texels,occluded})),null,2));
}
if(require.main===module)demo(process.argv[2]??'kestrel-material-review');
module.exports=factory;
