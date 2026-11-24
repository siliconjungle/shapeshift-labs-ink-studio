/* An original mechanical iris. The review uses the browser renderer itself. */
function build({makeBuilder,KIT}) {
  const palette=[0x0b101c,0x101d31,0x192b43,0x26374d,0x354862,0x385872,0x536d81,0x765549,
    0xaa785b,0xcd9c68,0xe5b881,0xffe5ad,0x173f51,0x216271,0x328c94,0x59b6ad,0xa3e5cb,
    0x492e58,0x714178,0xa45d83,0xe5899f,0xeebba5];
  const B=makeBuilder(87,palette), movers=[];
  const poly=(vertices,softness=.018)=>({shape:'polygon',vertices,softness});
  const oval={shape:'circle',softness:.025}, square={shape:'square',softness:.025};
  const shell=poly([[-.72,1],[.72,1],[1,.63],[1,-.62],[.62,-1],[-.62,-1],[-1,-.62],[-1,.63]]);
  const diamond=poly([[0,1],[1,0],[0,-1],[-1,0]]);
  const chamber=poly([[-.65,1],[.65,1],[1,.59],[1,-.50],[.55,-1],[-.6,-1],[-1,-.50],[-1,.62]]);
  const shutter=poly([[-.86,1],[.36,1],[.60,.70],[.62,.33],[.91,-.07],[.84,-.47],
    [.38,-1],[-.53,-1],[-.90,-.54],[-1,.52]]);
  const shutterFace=poly([[-.83,1],[.34,1],[.59,.54],[.83,-.10],[.68,-.56],[.30,-1],[-.48,-1],[-1,-.27],[-1,.62]]);
  const leftFace=poly([[-1,.86],[.60,1],[1,.60],[.74,-1],[-.8,-.93]]);
  const flip=shape=>({...shape,vertices:shape.vertices.map(([x,y])=>[-x,y]).reverse()});
  function dab(x,y,z,sx,sy,c,shape,object='gate',part='body',move=0,tilt=0) {
    const i=B.count(), normal=[Math.sin(tilt),0,Math.cos(tilt)];
    B.dab(x,y,z,normal,[normal[2],0,-normal[0]],sx,sy,.015,B.P[c],1.05);
    B.describeSplats(i,i+1,{object,material:'paint-'+c,target:{part}});
    B.describeFootprint(i,i+1,shape);
    if (move) movers.push([i,x,y,z,move]);
  }
  dab(0,-.015,-.50,1.07,1.16,1,shell);
  dab(.022,-.027,-.27,1.00,1.10,2,shell);
  dab(-.022,.045,-.12,1.00,1.09,8,shell,'gate','rim');
  dab(.006,.005,-.065,.967,1.047,4,shell,'gate','rim');
  dab(0,.012,.012,.88,.96,3,shell);
  dab(0,.011,.065,.775,.833,8,chamber,'gate','rim');
  dab(.01,.018,.082,.754,.808,10,chamber,'gate','rim');
  dab(.01,.018,.106,.704,.754,1,chamber);
  dab(.01,-.022,.132,.638,.686,2,chamber);
  dab(.01,-.022,.157,.593,.637,17,chamber,'iris','well');
  dab(.01,-.017,.179,.448,.475,18,oval,'iris','well');
  dab(.01,-.017,.197,.333,.356,19,oval,'iris','well');
  dab(.01,-.017,.220,.267,.299,20,oval,'iris','well');
  dab(.01,-.005,.239,.202,.235,11,diamond,'iris','beacon');
  dab(.01,-.005,.258,.124,.183,7,diamond,'iris','beacon');
  dab(.01,-.005,.269,.083,.142,0,diamond,'iris','beacon');
  dab(-.021,.052,.28,.049,.050,21,diamond,'iris','beacon');
  for (const s of [-1,1]) {
    const edge=s<0?shutter:flip(shutter), face=s<0?shutterFace:flip(shutterFace);
    dab(s*.322,-.014,.391,.41,.581,1,edge,'iris','shutter',s,-s*.12);
    dab(s*.318,.018,.420,.398,.526,8,edge,'iris','shutter',s,-s*.12);
    dab(s*.347,.026,.443,.375,.499,12,face,'iris','shutter',s,-s*.12);
    dab(s*.388,.103,.466,.270,.344,13,s<0?leftFace:flip(leftFace),'iris','shutter',s,-s*.12);
    dab(s*.510,.220,.490,.113,.100,14,diamond,'iris','shutter',s);
    dab(s*.491,.228,.503,.061,.057,16,diamond,'iris','shutter',s);
    for (let i=0;i<4;i++) {
      dab(s*(.41+i*.035),-.205-i*.041,.492,.037-.004*i,.017,15,square,'iris','shutter',s);
    }
    // Fixed outer joints in front of the sliding vanes.
    dab(s*.830,0,.674,.218,.233,2,chamber,'gate','rim',0,s*.19);
    dab(s*.855,.035,.715,.161,.183,5,chamber,'gate','rim',0,s*.19);
    dab(s*.861,.054,.741,.095,.101,8,diamond,'gate','rim');
    dab(s*.856,.056,.763,.057,.065,11,diamond,'gate','rim');
    for (const y of [-.7,.67]) {
      dab(s*.724,y,.234,.050,.050,9,diamond,'gate','bolt');
      dab(s*.736,y+.015,.255,.025,.023,11,diamond,'gate','bolt');
    }
    for (let i=0;i<4;i++) {
      const y=.28+i*.108;
      dab(s*.93,y,.045,.058,.024,i===0?10:5,square,'gate','fastener');
    }
    for (let i=0;i<5;i++) {
      const at=i*.067+.23;
      dab(s*at,.870,.177,.024,.053,i===0?10:6,square,'gate','fascia');
      dab(s*at,-.860,.177,.022,.041,i===0?8:4,square,'gate','fascia');
    }
  }
  dab(0,.925,.186,.100,.082,10,diamond,'gate','seal');
  dab(0,.927,.211,.052,.047,11,diamond,'gate','seal');
  dab(0,-.929,.188,.093,.075,7,diamond,'gate','seal');
  dab(0,-.927,.213,.051,.048,10,diamond,'gate','seal');

  const world=B.finish({id:'chime-iris',cam:{target:[0,0,0],dist:5,yaw:-.13,pitch:.035,fov:.491},
    radius:3.4,fog:{start:1,max:0},dither:0});
  const features=[{id:'iris-shutters',select:{object:'iris',part:'shutter'}},
    {id:'bronze-rim',select:{object:'gate',part:'rim'}}];
  function pose(f,count) {
    const p=f/count, a=p*Math.PI*2;
    const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
    const open=smooth(.28,.46,p)*(1-smooth(.68,.86,p));
    const tremor=.009*Math.sin(f*Math.PI*2/3)+.004*Math.sin(f*Math.PI*2/5);
    for (const [row,x,y,z,s] of movers) {
      const i=row*16;
      world.data[i]=x+s*(.16+open*.35+tremor);
      world.data[i+1]=y+s*open*.047;
      world.data[i+2]=z-open*.19;
    }
    return {yaw:-.15+.145*Math.sin(a),pitch:.065+.036*Math.cos(a),open};
  }
  return {world,pose,features,w:120,h:112};
}

module.exports=build;

if (require.main===module) {
  const fs=require('node:fs'), path=require('node:path'), ink=require('../..'), PNG=require('../../cli/png.js');
  const run=require('../../cli/look-webgl.js');
  const out=path.resolve(process.argv[2]??'live-iris-review'), count=54;
  const result=run({hardware:true},build,(kit,fixture,backend,{count})=>{
    const {world,pose,features,w,h}=fixture(kit);
    const view={offscreen:true,damp:false,clean:false,colored:false,dither:0,outline:false};
    const native=backend(w,h,view), live=backend(w,h,view);
    const cases=[], track=[];
    const reversals=[0,0];
    try {
      for (let f=-5;f<count;f++) {
        const {open,...camera}=pose((f+count)%count,count);
        const frame={...camera,time:(f+5)/18,changedRows:[0]};
        native.draw(world,frame);
        let report;
        live.draw(world,{...frame,livePixelBoundaries:{features,temporal:1.1,spatial:.18,maxMotion:3},
          livePixelBoundaryFrame:value=>{report=value;}});
        if (f>=0) {
          const mask=Array.from(report.mask,(code,p)=>code===3?p:-1).filter(p=>p>=0);
          cases.push({center:native.image(),live:live.image(),open,counts:report.counts,mask});
          track.push({open,fields:[report.nativeFeature,report.resolvedFeature]});
          if (track.length===3) {
            // Count a one-frame ownership reversal at the central seam while
            // the mechanism is in a held pose. Camera and tremor still move.
            if (track.every(sample=>sample.open===0)) for (let lane=0;lane<2;lane++) {
              const [first,mid,last]=track.map(sample=>sample.fields[lane]);
              for (let y=43;y<79;y++) for (let x=39;x<81;x++) {
                const p=y*w+x;
                if (first[p]===last[p] && first[p]!==mid[p] && (first[p]===1 || mid[p]===1)) reversals[lane]++;
              }
            }
            track.shift();
          }
        }
      }
      return {w,h,cases,reversals};
    } finally {native.close();live.close();}
  },{count});
  const {w,h,cases}=result, border=10, gutter=9, compare=105, title=40;
  const width=2*w+3*border+compare,height=h+title+gutter;
  const text=ink.load().KIT.poly2.text, {screenDrawing}=require('../../src/frame-composite.js');
  const label=(value,x,y,size,color)=>text(value,size,{width:1}).strokes.map(points=>({
    type:'path',width:1,color,points:points.map(([u,v])=>[x+u,y-v])}));
  const labels=screenDrawing(width,height,[
    ...label('THE CHIME IRIS',width/2,7,9,'#f1d6aa'),
    ...label('CENTER SAMPLE',border+w/2,24,7,'#879bb4'),
    ...label('SHARED BOUNDARY',2*border+w*1.5,24,7,'#9ce2c7'),
    ...label('EDGE DETAIL',3*border+2*w+compare/2,24,7,'#e2b499')
  ],{edges:'hard'}).data;
  const frames=path.join(out,'frames');
  fs.mkdirSync(frames,{recursive:true});
  let rescues=0;
  const review=[];
  for (const [i,example] of cases.entries()) {
    const image=new Uint8Array(width*height*3);
    const palette=[[12,17,29],[17,26,43],[57,44,47],[127,85,63]];
    const copy=(data,sx,sy,x,y)=>image.set(data.subarray((sy*w+sx)*3,(sy*w+sx)*3+3),(y*width+x)*3);
    for (let y=0,p=0;y<height;y++) for(let x=0;x<width;x++,p++) {
      const seam=y===20||y===height-4;
      image.set(seam?palette[2]:(x%8===3&&y%8===3?palette[1]:palette[0]),p*3);
      if(labels[p*4+3]) image.set(labels.subarray(p*4,p*4+3),p*3);
    }
    const a=Buffer.from(example.center,'base64'),b=Buffer.from(example.live,'base64');
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      copy(a,x,y,x+border,y+title); copy(b,x,y,x+w+border*2,y+title);
    }
    // Use the same native crop from each render. The lower tile adds markers
    // only around pixels actually changed by a verified history match.
    const x0=3*border+w*2+7, scale=2, cropW=42, cropH=24, sx0=39, sy0=44;
    const temporal=new Set(example.mask);
    for(let y=0;y<cropH*scale;y++) for(let x=0;x<cropW*scale;x++) {
      const sx=sx0+Math.floor(x/scale),sy=sy0+Math.floor(y/scale);
      copy(a,sx,sy,x0+x,title+y);
      copy(b,sx,sy,x0+x,title+cropH*scale+10+y);
      if (temporal.has(sy*w+sx)&&x%scale===0&&y%scale===0)
        image.set([255,232,167],((title+cropH*scale+10+y)*width+x0+x)*3);
    }
    const caption=screenDrawing(width,height,label(
      example.open>.85?'IRIS OPEN':example.open>.03?'IRIS IN MOTION':'IRIS HOLD',
      x0+cropW*scale/2,height-9,6,'#bda18b'),{edges:'hard'}).data;
    for(let p=0;p<width*height;p++) if(caption[p*4+3]) image.set(caption.subarray(p*4,p*4+3),p*3);
    PNG.write(path.join(frames,String(i).padStart(3,'0')+'.png'),width,height,image);
    rescues+=example.mask.length;
    review.push({open:example.open,...example.counts});
  }
  fs.writeFileSync(path.join(out,'review.json'),JSON.stringify({driver:result.browser,
    width:w,height:h,seconds:count/18,historyChanges:rescues,
    oneFrameShutterReversals:{native:result.reversals[0],live:result.reversals[1]},frames:review},null,2)+'\n');
  console.log('Wrote '+count+' frames. History changed '+rescues+' pixel decisions.');
  console.log('Shutter reversals during holds: '+result.reversals.join(' native, ')+' live.');
}
