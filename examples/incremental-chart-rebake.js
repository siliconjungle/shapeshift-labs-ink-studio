/* A tide relay with a local sculpt edit and a retained front-camera stencil. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {inflateSync} = require('node:zlib');
const ink = require('..');
const PNG = require('../cli/png.js');
const {projector} = require('../src/drawing-primitives.js');
const {screenDrawing} = require('../src/frame-composite.js');

function relay(K,edited) {
  const points=[],faces=[],uvs=[],labels=[];
  let chart=0;
  function patch(label, at, u, v, nx=1, ny=1, deform) {
    const first=points.length, id=chart++;
    const col=id%6, row=Math.floor(id/6);
    const uv=(x,y)=>[(col+.1+.8*x/nx)/6,(row+.9-.8*y/ny)/5];
    for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++) {
      const p=K.V.mad(K.V.mad(at,u,x/nx),v,y/ny);
      points.push(deform?deform(p):p);
    }
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++) {
      const q=first+y*(nx+1)+x;
      faces.push([q,q+1,q+nx+2,q+nx+1]);
      uvs.push([uv(x,y),uv(x+1,y),uv(x+1,y+1),uv(x,y+1)]);
      labels.push(label);
    }
  }
  function box(label,x,y,z,w,h,d,{front=label,nx=1,ny=1,deform}={}) {
    patch(front,[x,y,z+d],[w,0,0],[0,h,0],nx,ny,deform);
    patch(label,[x+w,y,z+d],[0,0,-d],[0,h,0]);
    patch(label,[x+w,y,z],[ -w,0,0],[0,h,0]);
    patch(label,[x,y,z],[0,0,d],[0,h,0]);
    patch(label,[x,y+h,z+d],[w,0,0],[0,0,-d]);
    patch(label,[x,y,z],[w,0,0],[0,0,d]);
  }
  box('housing',-1.6,.15,-.54,3.2,1.85,.9);
  box('enamel',-1.46,.29,.36,1.42,1.56,.17);
  box('steel',.055,.29,.36,1.405,1.56,.17,{
    front:'service',nx:22,ny:24,deform(p){
      const r=Math.hypot((p[0]-.82)/.60,(p[1]-1.05)/.66);
      const depression=edited ? .147*Math.max(0,1-r*r)**2 : 0;
      return [p[0],p[1],p[2]-depression];
    }
  });
  box('gasket',-1.26,.02,-.42,2.52,.13,.63);
  box('bracket',-.74,2,-.24,1.48,.15,.34);

  function sampleSurface(p,n,f) {
    const [x,y,z]=p, id=labels[f];
    const enamel=id==='enamel', plate=id==='service', metal=id==='steel'||plate||id==='bracket';
    const noise=.027*Math.sin(297*x+539*y+617*z)*Math.sin(467*x-251*y+149*z);
    let color=enamel?[.078,.345,.36]:metal?[.44,.29,.114]:id==='gasket'?[.024,.039,.049]:[.055,.087,.11];
    let normal=n, emission=[0,0,0], impact=0;
    if(enamel && n[2]>.5) {
      const trim=x<-1.38||x>-.12||y<.36||y>1.79;
      const inset=y>.52&&y<.70&&x>-1.23&&x<-.25;
      if(trim) color=[.040,.125,.14];
      if(inset)color=[.019,.065,.07];
      if(inset&&x>-.94&&x<-.29&&y>.565&&y<.634&&((x+.94)*41)%1<.61) {
        color=[.20,.59,.45];
        emission=[.024,.28,.16];
      }
    }
    if(plate) {
      const r=Math.hypot((x-.82)/.6,(y-1.05)/.66);
      const scallop=Math.sin(10*Math.atan2(y-1.05,x-.82));
      if(y>1.45&&x>.285&&x<1.25)color=[.33,.235,.119];
      if(edited&&r<1) {
        impact=Math.max(0,1-r);
        const ridge=Math.exp(-((r-.60)**2)/.012) * (.55+.45*scallop);
        color=color.map((v,c)=>v*(1-.34*impact)+[.17,.23,.29][c]*ridge);
      }
      for(const [a,b] of [[.16,.39],[1.35,.39],[.16,1.75],[1.35,1.75]]) {
        const d=Math.hypot(x-a,y-b);
        if(d<.044)color=Math.abs(y-b+.32*(x-a))<.009?[.045,.058,.062]:[.30,.34,.32];
      }
    }
    if(id==='housing' && n[0]>.5 && y>.55&&y<1.43 && z>-.39&&z<.15) {
      if(((y-.55)*13)%1<.44)color=[.014,.026,.038];
      normal=K.V.norm(K.V.add(n,[0,Math.sin(y*82)*.15,0]));
    }
    return {color:color.map(v=>Math.max(0,v+noise)),normal,roughness:metal?.39:.53,metallic:metal?.36:.05,
      emission,masks:{impact}};
  }
  return {name:'Morrow tide relay',points,faces,uvs,materials:[{name:'relay housing'}],sampleSurface,
    maskNames:['impact']};
}

const factory=({KIT:K,makeBuilder})=>({
  id:'incremental-chart-rebake',name:'Morrow tide relay',seed:0,
  build(){return makeBuilder(0).finish({id:'incremental-chart-rebake'});},
  model(seed){return relay(K,Boolean(seed));}
});

function approve(K,dir,row) {
  const {width,height,camera}=row, project=projector(camera,width,height);
  const at=(x,y)=>project.point(project.toView([x,y,.53]));
  const line=(points,color,w)=>({type:'path',points,width:w,color});
  function lettering(message,x,y,size,color,w) {
    const [cx,cy]=at(x,y);
    return K.poly2.text(message,size,{width:w}).strokes.map(points=>line(points.map(([u,v])=>[cx+u,cy-v]),color,w));
  }
  const cream='#edefb9', amber='#faaf56', inkGray='#493018';
  const strokes=[
    ...lettering('MR  21',-.75,1.37,23,cream,2.4),
    ...lettering('TIDE  RELAY',-.75,1.00,10,cream,1.35),
    ...lettering('CAL  08',-.76,.81,6,amber,1),
    line([at(-1.29,1.12),at(-.19,1.12)],cream,1),
    ...lettering('SERVICE',.78,1.58,9,inkGray,1.4),
    ...lettering('12 KPA',.76,1.08,13,'#f7df95',1.65),
    line([at(.34,.94),at(.59,.94),at(.65,.89),at(1.15,.89)],inkGray,1.6)
  ];
  const raster=screenDrawing(width,height,strokes);
  fs.writeFileSync(path.join(dir,row.paint),PNG.encode(width,height,raster.data,4));
}

function preview(kit, file, manifest, out) {
  const {KIT:K,makeBuilder,makeSculpt}=kit, model=ink.readMesh(file,{attributes:true});
  const uv=new Float32Array(model.pos.length/3*2);
  for(const [i,v] of model.tri.entries())uv.set(model.uvs[Math.floor(i/3)][i%3],v*2);
  const row=JSON.parse(fs.readFileSync(manifest,'utf8')).meshes[0];
  const channel=name=>PNG.raster(path.join(path.dirname(manifest),row.maps[name].file));
  const pigment=channel('pigment'), normal=channel('normal');
  const mesh=K.sceneMeshes.create({id:'tide-relay',positions:model.pos,indices:model.tri,uvs:uv,
    materials:[{id:'relay-atlas',texture:{width:pigment.w,height:pigment.h,pixels:pigment.data},normal:normal.data}]});
  const B=makeBuilder(21,[0x19282f,0x2d4247,0x465958,0x627270,0x8d8f7e,0xb8a990]);
  const S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:K.V.norm([-.57,.65,.49]),amb:.45,sky:.17,sunK:.46,wob:0});
  S.lathe([0,-.27,0],.32,[2.32,2.32,2.17,2.08],{r:[0,1,2,3]},{res:.065,objectId:'display-stand'});
  S.bake();
  const world=B.finish({meshes:[mesh],radius:7,cam:{target:[0,.96,0],dist:5.35,ortho:true,pitch:.24,yaw:.31},
    areaLights:[{id:'key',shape:'disk',at:[-2.7,3.9,3.6],normal:[.45,-.58,-.66],size:[.75,.75],
      color:'#fff0cd',intensity:5.2,radius:10,sampleGrid:1,visible:false,shadows:false}],
    skyEnvironment:{defaults:{zenith:'#293e54',horizon:'#587877',ground:'#1d313e',sunStrength:0}},
    look:{splatCoverage:'continuous'},dither:0});
  const screenshot=ink.render(world,{w:472,h:332,px:1,raw:true});
  PNG.write(out,screenshot.w,screenshot.h,screenshot.rgb);
  const atlas=channel('pigment');
  const owners=inflateSync(fs.readFileSync(path.join(path.dirname(manifest),row.rebakeState.owners.file)));
  const owner=Uint32Array.from({length:atlas.w*atlas.h},(_,i)=>owners.readUInt32LE(i*4));
  function debug(highlight,outFile) {
    const rgb=new Uint8Array(atlas.w*atlas.h*3);
    for(let i=0;i<owner.length;i++) {
      const occupied=owner[i]!==0, selected=occupied&&row.chartReport.updated.includes(owner[i]-1);
      const src=i*4;
      rgb.set(!occupied ? [23,33,43] : highlight ? (selected ? [245,163,89] : [63,118,124]) : atlas.data.subarray(src,src+3),i*3);
    }
    PNG.write(outFile,atlas.w,atlas.h,rgb);
  }
  debug(false,out.replace('.png','-atlas.png'));
  if(row.chartReport.reused.length)debug(true,out.replace('.png','-owners.png'));
  return row;
}

function demo(directory) {
  const dir=path.resolve(directory), kit=ink.load(), {KIT:K}=kit, base=relay(K,false);
  const run=(id,model,opts)=>ink.exportGlb(model,{out:path.join(dir,id,id+'.glb'),bakeDir:path.join(dir,id),
    textureSize:512,...opts});
  const capture=run('capture',base,{capturePaint:{format:'ink-studio/material-paint-cameras',version:1,
    views:[{id:'front',width:412,height:324,camera:{pitch:0,yaw:0}}]}});
  const captureManifest=JSON.parse(fs.readFileSync(capture.materialBake,'utf8'));
  const paintViews=path.join(path.dirname(capture.materialBake),captureManifest.paintManifest);
  const plan=JSON.parse(fs.readFileSync(paintViews,'utf8'));
  approve(K,path.dirname(paintViews),plan.views[0]);
  const before=run('before',base,{paintViews});
  const after=run('after',relay(K,true),{rebakeFrom:before.materialBake});
  const a=preview(kit,before.file,before.materialBake,path.join(dir,'before.png'));
  const b=preview(kit,after.file,after.materialBake,path.join(dir,'after.png'));
  assert.equal(a.uvLayout,b.uvLayout);
  assert.equal(b.chartReport.updated.length,1);
  assert(b.chartReport.reused.length>10);
  assert.equal(a.masks['projected-paint'].sha256,b.masks['projected-paint'].sha256);
  console.log(JSON.stringify({full:a.chartReport,incremental:b.chartReport},null,2));
}

if(require.main===module)demo(process.argv[2]??'incremental-chart-review');
module.exports=factory;
