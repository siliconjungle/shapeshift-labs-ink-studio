/* Three valve assembly parts with local profile revisions and two retained gauge mounts each. */
const assert = require('node:assert/strict');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const files = require('../cli/asset-files.js');

const colors={enamel:0x438985,lip:0x294c5a,brass:0xc09058,detail:0xd9b87f,ceramic:0xb87e60,
  shoe:0x263a49};
const rails=[
  {id:'inlet',material:'lip',crease:1},{id:'collar',material:'brass',crease:.8},{id:'throw',material:'enamel'},
  {id:'bend',material:'enamel'},{id:'shoulder',material:'brass',crease:.65},{id:'outlet',material:'lip',crease:1}
];
const marker=(id,section,u)=>({id,section,u});
const octagon=[[.93,0],[.72,.65],[0,.85],[-.72,.65],[-.93,0],[-.72,-.65],[0,-.85],[.72,-.65]];

function fixtures(K) {
  const P=K.procedural;
  const duct=K.sweep.mesh([
    [-2.18,-.46,0],[-1.79,-.46,0],[-.98,-.37,0],[.04,-.12,.13],[1.31,.57,.19],[2.02,.57,.19]
  ],{shape:'rect',w:t=>.32+.08*t,h:.25,round:.25,twist:.07},{
    id:'duct',sides:16,sections:rails,capMaterial:'lip',
    attachments:[marker('feed-gauge','collar',.06),marker('return-gauge','shoulder',.11)]
  });
  const housing=P.forms.loft.mesh([
    {id:'skid',y:-1.08,profile:octagon,scale:1.14,material:'lip'},
    {id:'foot',y:-.88,profile:octagon,scale:1.14,material:'brass',crease:.7},
    {id:'body',y:-.70,profile:octagon,scale:.88,material:'enamel'},
    {id:'funnel',y:.25,profile:octagon,scale:.67,material:'enamel'},
    {id:'throat',y:.77,profile:octagon,scale:.54,roll:.15,material:'brass',crease:.65},
    {id:'lip',y:.97,profile:octagon,scale:.60,roll:.15,material:'lip'}
  ],{id:'housing',profileCreases:[0,2,4,6],capMaterial:'lip',
    attachments:[marker('base-gauge','foot',.22),marker('upper-gauge','throat',.30)]});
  const valve=P.sectionMeshes.revolve([[[0,-1.12],[.59,-1.12],[.71,-.93],[.69,-.75],[.38,-.62],
    [.38,-.04],[.69,.10],[.69,.29],[.27,.48],[.27,1.04],[0,1.04]]],[0,0,0],{
    id:'valve',sides:32,sections:[[
      {id:'floor',material:'lip'},{id:'foot',material:'lip',crease:.75},{id:'skirt',material:'brass',crease:.65},
      {id:'land',material:'lip',crease:.65},{id:'stem',material:'enamel'},
      {id:'cone',material:'enamel'},{id:'disc',material:'brass',crease:.75},
      {id:'rim',material:'lip',crease:.6},{id:'spindle',material:'enamel'},
      {id:'tip',material:'brass',crease:.7},{id:'pole'}
    ]],attachments:[marker('skirt-gauge','land',.29),marker('stem-gauge','tip',.18)]
  });
  return [
    {label:'Intake duct',method:'SWEEP',note:'WIDENED THE BEND AND ADDED A CREASE',fixture:duct,
      edit:{id:'bend',w:.60,roll:.35,position:[.04,.04,.13],crease:.72,material:'ceramic'},
      camera:{target:[0,.08,0],dist:5.25,yaw:-.31,pitch:.25,ortho:true}},
    {label:'Guide housing',method:'LOFT',note:'FLARED THE MIDDLE PROFILE',fixture:housing,
      edit:{id:'funnel',scale:1.14,center:[.14,.05],roll:.12,material:'ceramic'},
      camera:{target:[0,0,0],dist:4.10,yaw:.34,pitch:.35,ortho:true}},
    {label:'Needle valve',method:'REVOLVE',note:'EXTENDED THE CENTRAL COLLAR',fixture:valve,
      edit:{id:'disc',radius:.92,y:.06,material:'ceramic'},
      camera:{target:[0,0,0],dist:4.10,yaw:.12,pitch:.25,ortho:true}}
  ];
}

function textured(id, color) {
  const width=96,height=96,pixels=new Uint8Array(width*height*4);
  const base=[color>>16&255,color>>8&255,color&255];
  for (let v=0;v<height;v++) for (let u=0;u<width;u++) {
    const grid=(u%17===0?-.10:0)+(v%13===0?.10:0);
    const chip=((u*17+v*29)%101===0) ? .26 : 0;
    const hatch=id==='brass' && (u+v*2)%11<2 ? .15 : 0;
    const paint=id==='enamel' && u>27 && u<39 ? .25 : 0;
    const tint=1+grid+chip+hatch+paint;
    const i=(v*width+u)*4;
    pixels.set([...base.map(n=>Math.min(255,Math.round(n*tint))),255],i);
  }
  return {id,texture:{width,height,pixels}};
}

const w=200,h=122;
const stockPalette=[0x112130,0x162635,0x223646,0x2e4758,0x496274,0x748890,0xa77b52,0xf5c484,0xffdf9b,0xffedbb];

function native(kit, document, report, camera) {
  const {KIT:K,makeBuilder,makeSculpt}=kit;
  const builder=makeBuilder(31,stockPalette), S=K.sculpt(makeSculpt(builder));
  const mesh=K.meshTopology.toSceneMesh(document,{materials:Object.entries(colors).map(([id,c])=>textured(id,c))});
  Object.assign(S,{sun:K.V.norm([-.65,.95,.8]),amb:.55,sky:.14,sunK:.46,wob:0});
  const stand=document.id==='duct' ? [-.12,-.78,-.12] : [0,-1.21,0];
  const rails=document.id==='duct' ? [2.45,.09,.45] : [1.14,.09,1.05];
  S.box(stand,rails,{r:[1,2,3,4]},{res:.065,rd:.10});
  S.box(K.V.add(stand,[0,-.10,0]),[rails[0]*1.06,.048,rails[2]*1.08],
    {r:[1,2,3]},{res:.055,rd:.04});
  for (const {p} of report.attachments) {
    const point=K.V.add(p,[0,.02,.065]);
    S.ball(point,[.086,.087,.07],{r:[6,7,8]},{res:.025});
    S.ball(K.V.add(point,[0,.006,.066]),[.040,.045,.024],{r:[9],em:true},{res:.014});
  }
  S.bake();
  const world=builder.finish({meshes:[mesh],cam:camera,radius:4,dither:0,look:{pixelSize:1},
    liveSun:{direction:[-.6,.9,.85],intensity:.75,shadows:false}});
  return ink.render(world,{w,h,px:1,t:0,raw:true,camera,edges:false});
}

function board(K, results) {
  const width=1260,height=698,scale=2,commands=[];
  const rect=(x,y,w,h,fill)=>commands.push({type:'rect',rect:[x,y,w,h],fill});
  const text=(label,x,y,scale,color='#e7efe8')=>commands.push({type:'text',text:label,at:[x,y],scale,color});
  rect(0,0,width,height,'#0e1a25');
  rect(20,20,22,3,'#83dbc0');
  text('INK STUDIO / GENERATED MESH TOPOLOGY',53,16,2,'#8fdfc9');
  text('Flow bench',20,44,4);
  text('LOCAL PROFILE EDITS AT A MATCHED ART GRID',21,80,1,'#a3bccc');
  for (const [i,{label,method,note,before,after}] of results.entries()) {
    const x=20+410*i;
    text(label,x,103,2);
    text(method,x+331,109,1,'#8fdfc9');
    for (const [j,stage] of ['BEFORE','REVISED'].entries()) {
      const y=136+j*258;
      rect(x-1,y-1,w*scale+2,h*scale+2,'#324d5e');
      text(stage,x+9,y+10,1,j===0?'#aec5cf':'#f6c180');
    }
    text(note,x,651,1,'#d3e1df');
    text(after.report.dirtyFaces.length+' OF '+before.mesh.faces.length+' FACES AFFECTED',x,666,1,'#94b0bd');
  }
  rect(20,687,1220,1,'#324d5e');
  rect(926,68,7,7,'#ffd78d');
  text('GAUGE MOUNTS STAY FIXED',941,68,1,'#ddc49c');
  const design=K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
  const bg=[17,33,48];
  for (const [i,{frames}] of results.entries()) for (const [j,frame] of frames.entries()) {
    const x=20+410*i,y=136+j*258;
    for (let r=0;r<h*scale;r++) for (let c=0;c<w*scale;c++) {
      const from=(Math.floor(r/scale)*w+Math.floor(c/scale))*3, to=((y+r)*width+x+c)*4;
      const pixel=frame.rgb.subarray(from,from+3);
      if (r<27 && c<75 && pixel.every((v,k)=>v===bg[k])) continue;
      design.data.set(pixel,to);
    }
  }
  return PNG.encodeFrame(PNG.packRGBA(design));
}

function run(dir) {
  const kit=ink.load(),{KIT:K}=kit,api=K.procedural.sectionMeshes;
  const results=fixtures(K).map(({fixture:before,edit,camera,...copy})=>{
    const request={revision:before.report.revision,meshRevision:before.report.meshRevision,sections:[edit]};
    const after=api.plan(before.source,request);
    assert(after.report.attachments.every(row=>row.displacement===0));
    const root=path.join(dir,before.source.id);
    files.json(path.join(root,'source.json'),before.source);
    files.json(path.join(root,'edit.json'),request);
    files.json(path.join(root,'revised-source.json'),after.source);
    files.json(path.join(root,'receipt.json'),after.report);
    files.json(path.join(root,'patch.json'),after.patch);
    for (const [name,value] of [['before',before],['after',after]]) {
      files.json(path.join(root,name+'.json'),value.mesh);
      const model=K.model.fromTopology(value.mesh,{materials:Object.entries(colors).map(([id,color])=>({
        ...textured(id,color),color:[1,1,1]
      }))});
      ink.exportGlb(model,{out:path.join(root,name+'.glb'),textureSize:0});
    }
    const frames=[before,after].map(row=>native(kit,row.mesh,row.report,camera));
    frames.forEach((frame,i)=>files.write(path.join(root,['before.png','after.png'][i]),PNG.encode(w,h,frame.rgb)));
    return {...copy,before,after,frames};
  });
  files.write(path.join(dir,'comparison.png'),board(K,results));
  console.log(dir);
}

module.exports={fixtures};
if (require.main===module) run(path.resolve(process.argv[2] ?? 'studio/out/section-meshes'));
