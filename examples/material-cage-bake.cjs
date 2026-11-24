/* Rebake a machined floodgate control plate onto its two-triangle receiver. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const ink = require('..');
const PNG = require('../cli/png.js');
const Composite = require('../src/frame-composite.js');

const width=3.36, height=1.81, west=-width/2, east=1.38, bottom=-height/2, top=height/2;
const round = (d, edge) => {
  const u=Math.min(1,Math.max(0,1-Math.abs(d)/edge));
  return u*u*(3-2*u);
};
const box = (x,y,a,b,w,h) => Math.max(Math.abs(x-a)-w,Math.abs(y-b)-h);
function details(x,y) {
  const r=Math.hypot(x+.555,y+.085), angle=Math.atan2(y+.085,x+.555);
  const rim=round(r-.455,.055), inner=round(r-.314,.035);
  const ticks=round(r-.383,.029)*Math.max(0,Math.cos(angle*14))**3;
  const hub=round(r,.157)*(1+.3*Math.cos(angle*5));
  const bank=round(Math.max(0,box(x,y,.657,-.095,.431,.295)),.047);
  const vent=bank*round(((x-.04)+.21*(y+.095))/.154-Math.round(((x-.04)+.21*(y+.095))/.154),.34);
  const border=round(box(x,y,-.10,0,1.48,.763),.04);
  const screws=[[-1.43,-.65],[-1.43,.64],[1.15,-.64],[1.15,.64]];
  const screw=Math.max(...screws.map(([a,b])=>round(Math.hypot(x-a,y-b),.073)));
  const rail=round(box(x,y,.003,.604,1.13,.12),.029);
  return { rim,inner,ticks,hub,bank,vent,border,screw,rail,
    z:.014+ .024*border + .095*rim + .048*inner + .040*ticks + .103*hub
      -.037*bank+.070*vent+.082*screw + .031*rail };
}

function highMesh(K) {
  const nx=124, ny=72, points=[], faces=[], uvs=[], normals=[], faceParts=[], faceMaterials=[];
  const uv=(x,y)=>[(x-west)/(east-west),(top-y)/(top-bottom)];
  const epsilon=.001;
  for(let j=0;j<=ny;j++) for(let i=0;i<=nx;i++) {
    const x=west+(east-west)*i/nx, y=bottom+(top-bottom)*j/ny;
    points.push([x,y,details(x,y).z]);
    normals.push(K.V.norm([details(x-epsilon,y).z-details(x+epsilon,y).z,
      details(x,y-epsilon).z-details(x,y+epsilon).z,epsilon*2]));
  }
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const a=j*(nx+1)+i;
    const face=[a,a+1,a+nx+2,a+nx+1];
    faces.push(face);
    uvs.push(face.map(id=>uv(...points[id])));
    faceParts.push('drive-plate');
    faceMaterials.push(0);
  }
  const a=points.length;
  points.push([1.098,-.43,.131],[1.302,-.43,.131],[1.302,.32,.131],[1.098,.32,.131]);
  normals.push(...Array.from({length:4},()=>[0,0,1]));
  faces.push([a,a+1,a+2,a+3]);
  uvs.push([[0,1],[1,1],[1,0],[0,0]]);
  faceParts.push('loose-bracket');
  faceMaterials.push(1);
  return { name:'Detailed drive plate',points,faces,uvs,normals,faceParts,faceMaterials,
    materials:[{name:'machined steel',color:[1,1,1],roughness:.31,metallic:.56,texture:'source-pigment.png',
      masks:{machined:.75}},{name:'loose bracket',color:[.6,.14,.06],roughness:.6}] };
}

function pigment(K, file) {
  const w=282,h=168, rgb=new Uint8Array(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const a=west+(east-west)*(x+.5)/w,b=top-(top-bottom)*(y+.5)/h;
    const {rim,inner,ticks,hub,vent,bank,screw,border,rail}=details(a,b);
    let color=[62,111,118];
    if (bank>.75) color=[28,59,69];
    if (vent>.52) color=[56,101,110];
    if (rim>.48 || inner>.56) color=[118,160,156];
    if (ticks>.30) color=[210,182,109];
    if (hub>.24) color=[77,127,138];
    if (border>.60 || rail>.62) color=[36,79,88];
    if (screw>.34) color = (Math.floor((a+b)*92)%7===0) ? [50,63,65] : [173,166,127];
    const noise=((x*37+y*29)%13)-6, at=(y*w+x)*3;
    rgb.set(color.map(n=>n+noise),at);
  }
  const { chars, per, font }=K.ascii.atlas();
  function label(message,x,y,scale,color) {
    for(const [i,ch] of [...message].entries()){
      const glyph=chars.indexOf(ch), ux=glyph%per*6, vy=Math.floor(glyph/per)*8;
      for(let j=0;j<8;j++)for(let k=0;k<6;k++)if(font.data[(vy+j)*font.w+ux+k])
        for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++)
          rgb.set(color,((y+j*scale+sy)*w+x+(i*6+k)*scale+sx)*3);
    }
  }
  label('ASTER LOCK',77,22,2,[238,218,158]);
  label('DRIVE 07',178,122,1,[185,206,199]);
  label('SEA GATE',69,133,1,[170,194,192]);
  PNG.write(file,w,h,rgb);
}

function receiver(K) {
  return K.meshTopology.create({id:'aster-drive',vertices:[[west,bottom,0],[-west,bottom,0],[-west,top,0],[west,top,0]]
    .map((position,i)=>({id:'p'+i,position})),
  faces:[{id:'plate',material:'drive',corners:[[.05,.83],[.95,.83],[.95,.17],[.05,.17]]
    .map((uv,i)=>({id:'rim'+i,vertex:'p'+i,uv}))}]});
}

function modelShot(kit, model, maps, filename, baked) {
  const { KIT:K,makeBuilder,makeSculpt }=kit,{pigment,normal,roughness}=maps;
  const geometry=K.meshTopology.triangulate(model);
  const material={id:'drive',texture:{width:pigment.w,height:pigment.h,pixels:pigment.data},
    roughness:Uint8Array.from({length:roughness.w*roughness.h},(_,i)=>roughness.data[i*4]),
    ...(baked && {normal:normal.data}),mipmaps:{light:[-.81,.42,.39],ambient:.52,specular:.76}};
  const mesh=K.sceneMeshes.create({id:'drive',positions:geometry.positions,uvs:geometry.uvs,indices:geometry.indices,
    materials:[material]});
  const B=makeBuilder(12,[0x152631,0x223945,0x36505a,0x54646a,0x747e77,0xaba68d]), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:K.V.norm([-.62,.48,.53]),amb:.5,sky:.18,sunK:.43,wob:0});
  S.box([0,0,-.22],[1.83,1.045,.20],{r:[0,1,2,3]},{res:.065,objectId:'housing'});
  S.lathe([0,-1.30,-.14],.26,[2.48,2.48,2.40,2.35],{r:[0,1,2,3]},{res:.072,objectId:'stand'});
  S.bake();
  const camera={target:[0,-.13,-.10],dist:5.9,ortho:true,yaw:.25,pitch:.21};
  const world=B.finish({meshes:[mesh],radius:7,cam:camera,look:{splatCoverage:'continuous'},dither:0,
    skyEnvironment:{defaults:{zenith:'#203440',horizon:'#465f62',ground:'#182634',sunStrength:0}}});
  const frame=ink.render(world,{w:428,h:281,px:1,raw:true});
  PNG.write(filename,frame.w,frame.h,frame.rgb);
  return frame;
}

function demo(output) {
  const dir=path.resolve(output), kit=ink.load(), {KIT:K}=kit, model=receiver(K);
  fs.mkdirSync(dir,{recursive:true});
  const save=(name,data)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(data)+'\n');
  save('receiver.json',model);
  fs.writeFileSync(path.join(dir,'receiver-model.js'),
    "module.exports = ({KIT}) => ({ seed: 0, model: () => KIT.model.fromTopology(require('./receiver.json'), " +
    "{ materials: [{id:'drive',color:[.043,.092,.108],roughness:.67}] }) });\n");
  save('high-source.json',highMesh(K));
  pigment(K,path.join(dir,'source-pigment.png'));
  save('cage.json',{format:'ink-studio/material-cage-bake',version:1,receivers:[
    {front:.185,back:.065,parts:{plate:'drive-plate'},source:{kind:'mesh',file:'high-source.json'}}
  ]});
  const bake=path.join(dir,'bake');
  execFileSync(process.execPath,[path.resolve(__dirname,'../cli/ink-studio.js'),'export-glb',path.join(dir,'receiver-model.js'),
    '--cage-bake',path.join(dir,'cage.json'),'--bake-dir',bake,'--texture-size','512','--out',path.join(dir,'aster-drive.glb')],
  {stdio:['ignore','pipe','inherit']});
  const [result]=JSON.parse(fs.readFileSync(path.join(bake,'material-bake.json'))).meshes;
  const report=result.cageBake;
  assert(report.hits>100000 && report.misses>10000 && report.rejectedCrossPart>1000);
  save('cage-receipt.json',report);
  const assets={...result.maps,...result.masks};
  const image=name=>PNG.raster(path.join(bake,assets[name].file));
  const maps=Object.fromEntries(['pigment','normal','roughness'].map(name=>[name,image(name)]));
  const frames=[false,true].map((value,i)=>modelShot(kit,model,maps,path.join(dir,['flat.png','baked.png'][i]),value));
  const covered=image('coverage'), rejected=image('cage-cross-part'), miss=image('cage-miss'), ok=image('cage-hit');
  const diagnostic=new Uint8Array(covered.w*covered.h*3);
  for(let i=0;i<diagnostic.length/3;i++){
    const at=4*i, color= !covered.data[at]?[17,27,38]:rejected.data[at]?[239,134,151]:miss.data[at]?[226,166,89]:
      ok.data[at]?[77,164,159]:[115,123,159];
    diagnostic.set(color,3*i);
  }
  PNG.write(path.join(dir,'cage-diagnostics.png'),covered.w,covered.h,diagnostic);
  const w=888,h=573,layers=[],draw=[];
  const text=(message,x,y,size,color='#cee0dc')=>draw.push({type:'text',text:message,at:[x,y],size,color});
  text('ASTER LOCK  /  GATE DRIVE 07',444,21,16,'#f1d9a0');
  text('MACHINED RELIEF ON A TWO-TRIANGLE RECEIVER',444,42,9);
  text('PIGMENT ONLY',226,68,10);
  text('BAKED TANGENT NORMALS',662,68,10);
  frames.forEach((frame,i)=>layers.push({source:frame,rect:[12+i*436,85,428,281]}));
  const chips=[maps.normal,image('cage-relief'),{w:covered.w,h:covered.h,rgb:diagnostic}];
  chips.forEach((pic,i)=>layers.push({source:pic.data?{w:pic.w,h:pic.h,rgba:pic.data}:pic,rect:[21+190*i,380,174,174]}));
  for (const [i, label] of ['TANGENT NORMALS','SIGNED RELIEF','CAGE DIAGNOSTICS'].entries()) text(label,108+190*i,565,8);
  text('CAGE RESULTS',714,397,12,'#f1d9a0');
  text(report.hits.toLocaleString('en-US')+' ACCEPTED TEXELS',714,427,9,'#72b9ad');
  text(report.misses.toLocaleString('en-US')+' MISSES',714,452,9,'#e2a659');
  text(report.rejectedCrossPart.toLocaleString('en-US')+' WRONG-PART HITS BLOCKED',714,477,9,'#ef8697');
  text('OUTWARD 0.185  /  INWARD 0.065',714,516,8);
  const plan=K.frameComposite.prepare({layers:[...layers,{draw}]},w,h,1);
  const sheet=Composite.compose({w:1,h:1,rgb:Uint8Array.of(12,22,31)},K.frameComposite.layers(plan,{},0),w,h,'nearest');
  PNG.write(path.join(dir,'comparison.png'),w,h,sheet.rgb);
}

if (require.main===module) demo(process.argv[2] ?? 'material-cage-review');
