/* The Mothglass Seal. Bake an approval, then fit the unfinished native splats. */
const palette=[0x111724,0x1a2b37,0x284149,0x45676a,0x3f6c65,0x6c9290,0x9ac0ae,
  0x6c3c34,0x8d5c38,0xb28043,0xd5a456,0xf8da94,0xf0ead0,0xba7959,0x8c4756,0xe6baa3];
const border={shape:'polygon',softness:.025,vertices:[[-.96,.37],[-.84,.72],[-.45,.88],[0,.91],
  [.45,.88],[.84,.72],[.96,.37],[.87,-.12],[.61,-.55],[0,-1],[-.61,-.55],[-.87,-.12]]};
const diamond={shape:'square',rotation:Math.PI/4,stretch:[.72,.72],softness:.03};
const square={shape:'square',softness:.045};
const wedge={shape:'wedge',softness:.03};

function scene({KIT:{M,bones},makeBuilder},approved=false) {
  const B=makeBuilder(72,palette);
  const styles=[];
  const dab=(id,xyz,size,color,shape,normal=[0,0,1])=>{
    const i=B.count();
    const u=[normal[2],0,-normal[0]];
    B.dab(...xyz,normal,u,...size,.018,B.P[color],1.06);
    B.describeSplats(i,i+1,{object:'mothglass',material:id,target:{part:id}});
    B.describeAlbedo(i,i+1,'#'+palette[color].toString(16).padStart(6,'0'));
    if (shape) B.describeFootprint(i,i+1,shape);
    styles.push(id);
  };
  dab('backplate',[0,-.012,-.21],[.94,.99],8,border);
  dab('gilt edge',[0,0,0],[.92,.99],approved?10:8,approved?border:{shape:'circle',softness:.12});
  dab('enamel',[0,.015,.17],[.79,.85],approved?4:7,border,[.11,0,Math.sqrt(1-.11**2)]);
  dab('enamel',[-.025,.15,.30],[.66,.61],approved?3:7,
    {shape:'polygon',stretch:[1,1],softness:.01,vertices:[[-.91,.42],[-.5,.73],[0,.8],[.5,.73],[.91,.42],
      [.8,-.24],[0,-.82],[-.8,-.24]]},[-.13,0,Math.sqrt(1-.13**2)]);
  dab('side clasps',[-.83,.53,.14],[.20,.15],approved?10:7,
    approved?{...wedge,rotation:Math.PI}:square);
  dab('side clasps',[.83,.53,.13],[.20,.15],approved?10:7,approved?wedge:square);
  dab('crest',[0,.66,.34],[.17,.16],9,diamond);
  dab('crest',[0,-.80,.28],[.12,.14],10,diamond);
  for (const s of [-1,1]) {
    for(const [x,y,size] of [[.32,.55,.049],[.52,.49,.041],[.66,.35,.035],[.67,.12,.028],
      [.58,-.21,.032],[.45,-.38,.030],[.29,-.56,.036]]) {
      dab('engraving',[s*x,y,.335],[size,size],x<.4?10:9,diamond);
    }
  }
  // The inset and all of its moth marks are locked by the fit plan.
  dab('emblem',[0,.055,.42],[.52,.39],1,{shape:'polygon',softness:.03,
    vertices:[[-1,.44],[-.70,.91],[0,.98],[.70,.91],[1,.44],[.91,-.67],[0,-1],[-.91,-.67]]});
  for(const s of [-1,1]){
    const wing={shape:'polygon',softness:.02,vertices:[[0,-.12],[-s*.23,.31],[s*.36,.91],
      [s,1],[s*.79,.19],[s*.57,-.14],[s*.58,-.57],[s*.23,-.89]]};
    dab('emblem',[s*.045,.045,.50],[.35,.29],11,wing);
    dab('emblem',[s*.134,.125,.55],[.072,.034],8,{...wedge,rotation:s*.37});
    dab('emblem',[s*.24,.206,.55],[.034,.021],12,diamond);
    dab('emblem',[s*.086,-.102,.56],[.024,.024],13,diamond);
    dab('emblem',[s*.027,.259,.55],[.015,.049],11,{...square,rotation:s*.47});
  }
  dab('emblem',[0,.024,.57],[.041,.20],12,diamond);
  const world=B.finish({id:'mothglass-seal',cam:{target:[0,0,0],dist:5.7,yaw:0,pitch:0,fov:.52},radius:4,
    fog:{c:0,start:1,max:0},dither:0,look:{splatOrder:'surface'},
    liveSun:{direction:[-.48,.74,.56],ambient:.47,intensity:.54,shadows:false}});
  const matrices=new Float32Array(12);
  const ids=styles.map((_,i)=>i);
  bones.bind(world,{ids,bid:ids.map(()=>0),M:matrices,pose(t){
    const r=M.mul(M.rot([0,1,0],.49*Math.sin(t)),M.rot([0,0,1],.12*Math.sin(t*.85)));
    matrices.set([...r,0,0,0]);
  }});
  world.anim.update(0,0);
  return world;
}

module.exports=kit=>({id:'mothglass-seal',name:'The Mothglass Seal',seed:72,build:()=>scene(kit)});

async function review(directory) {
  const fs=require('node:fs'), path=require('node:path'), ink=require('../..'), PNG=require('../../cli/png.js');
  const {fit}=require('../../cli/splat-fit.js'), {writePasses}=require('../../cli/pass-preview.js');
  const {pose:poseScene}=require('../../cli/diarama-pose.js');
  const kit=ink.load(), source=scene(kit), approved=scene(kit,true);
  const w=148,h=136, view={w,h,px:1,raw:true,transparent:true,passes:['splatId','depth','normal','pigment','surfaceKind']};
  const pose=(world,t)=>poseScene(world,t,{kit});
  const out=path.resolve(directory), frames=path.join(out,'frames');
  fs.mkdirSync(frames,{recursive:true});
  const shots=[{time:0,camera:{yaw:-.28,pitch:.02}},{time:.66,camera:{yaw:.16,pitch:.08}},
    {time:1.18,camera:{yaw:.34,pitch:-.08},holdout:true}];
  const color=(frame,data=new Uint8Array(w*h*4))=>{
    for(let p=0;p<w*h;p++){data.set(frame.rgb.subarray(p*3,p*3+3),p*4);data[p*4+3]=frame.alpha[p];}
    return data;
  };
  const draw=(world,entry,options)=>{
    pose(world,entry.time);
    return ink.render(world,{...view,...entry.camera,t:entry.time,...options});
  };
  const emblem=kit.TargetSelectors.index(source);
  const plans=shots.map((entry,i)=>{
    const name='approval-'+i, reference=draw(approved,entry), before=draw(source,entry);
    const pins=new Uint8Array(w*h*4);
    for (let p=0;p<w*h;p++) {
      const id=before.passes.splatId[p]-1;
      const target=before.passes.pigment[p];
      const center=Math.abs(p%w-w/2)<8 && Math.abs(Math.floor(p/w)-h/2)<10;
      if (center && id>=0 && emblem.row(id).material==='emblem' && before.alpha[p]===255 &&
          [palette[11]+1,palette[12]+1].includes(target)) pins.set([255,255,255,255],p*4);
    }
    const baked=color(reference);
    writePasses(path.join(out,name),reference);
    fs.writeFileSync(path.join(out,name,'approved.png'),PNG.encode(w,h,baked,4));
    fs.writeFileSync(path.join(out,name,'pins.png'),PNG.encode(w,h,pins,4));
    return {...entry,reference:{w,h,max:255,data:baked},depth:reference.passes.depth,normal:reference.passes.normal,
      pigment:reference.passes.pigment,pins:{w,h,max:255,data:pins}};
  });
  const settings={width:w,height:h,rounds:5,prune:0,select:['gilt edge','enamel','side clasps'].map(material=>({material})),
    pins:{material:'emblem'},search:{footprints:[border,wedge,square],rotations:[0,Math.PI],
      swatches:[palette[3],palette[4],palette[10]],trials:108,maxRows:6}};
  fs.writeFileSync(path.join(out,'approvals.json'),JSON.stringify({...settings,views:shots.map((entry,i)=>({
    ...entry,reference:'approval-'+i+'/approved.png',depth:'approval-'+i+'/depth.f32le',
    normal:'approval-'+i+'/normal.png',pigment:'approval-'+i+'/pigment.png',pins:'approval-'+i+'/pins.png'
  }))},null,2)+'\n');
  const asset=fit(source,{...settings,pose,view:extra=>({...view,...extra}),views:plans,sdfAssist:false});
  fs.writeFileSync(path.join(out,'fit.json'),JSON.stringify(asset,null,2)+'\n');
  const DW=3*w+16,DH=h+26;
  const punctuation=kit.KIT.poly2.text, operators=require('../../src/frame-composite.js').screenDrawing;
  const label=(title,x,y,size,color)=>punctuation(title,size,{width:1}).strokes.map(points=>({
    type:'path',width:1,color,points:points.map(([u,v])=>[x+u,y-v])}));
  function sheet(rows, caption) {
    const image=new Uint8Array(DW*DH*3);
    for(let y=0;y<DH;y++)for(let x=0;x<DW;x++){
      const i=(y*DW+x)*3, m=Math.max(0,1-Math.hypot((x%DW-DW/2)/(DW*.75),(y-h/2)/h));
      const grid=Number(x%12===0&&y%12===0)*2;
      image.set([9+9*m+grid,14+13*m+grid,23+16*m+grid],i);
    }
    for (const [lane,frame] of rows.entries()) for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const from=y*w+x,to=(y*DW+8+lane*w+x)*3,a=frame.alpha[from]/255;
      for(let c=0;c<3;c++) image[to+c]=frame.rgb[from*3+c]*a+image[to+c]*(1-a);
    }
    const text=operators(DW,DH,[
      ...label('BEFORE',8+w*.5,h+7,9,'#a3a4a4'),...label('FITTED',8+w*1.5,h+7,9,'#a7d9c5'),
      ...label('APPROVED',8+w*2.5,h+7,9,'#d9bb86'),...label(caption,DW*.5,h+18,6,'#81949c')
    ],{edges:'hard'});
    for(let p=0;p<DW*DH;p++) if(text.data[p*4+3])
      image.set(text.data.subarray(p*4,p*4+3),p*3);
    return image;
  }
  const rows=entry=>[draw(source,entry),draw(source,entry,{splatFit:asset}),draw(approved,entry)];
  PNG.write(path.join(out,'holdout.png'),DW,DH,sheet(rows(shots[2]),'HELD-OUT ANGLE AND POSE'));
  for(let i=0;i<80;i++){
    const phase=i/80*2*Math.PI;
    const entry={time:.82+.76*Math.cos(phase),camera:{yaw:.31*Math.sin(phase),pitch:.04+.08*Math.sin(phase+.8)}};
    PNG.write(path.join(frames,String(i).padStart(3,'0')+'.png'),DW,DH,sheet(rows(entry),'MOTHGLASS SEAL'));
  }
  console.log(JSON.stringify(asset.report,null,2));
}

if (require.main===module) review(process.argv[2]??'mothglass-fit').catch(error=>{console.error(error);process.exitCode=1;});
