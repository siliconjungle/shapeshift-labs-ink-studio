/* Fixed cameras on a cached kiln plume and a condensed cloud bank. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'), files=require('../../cli/asset-files.js');
const {KIT:K,makeBuilder,makeSculpt}=require('../..').load(), {V}=K;
const PNG=require('../../cli/png.js'), Render=require('../../cli/render.js');
const cache=require('../../cli/atmosphere-cache.js'), {readCheckpoint}=require('../../cli/checkpoint-file.js');
const {studies}=require('./study.cjs'), kit=require('../..').load(), R=K.world.runtime;
const out=path.resolve(process.argv[2]??'studio/kiln-and-cloudbank'), asset=name=>path.join(out,name);
const cli=path.join(__dirname,'../../cli/ink-studio.js'), command=(...args)=>execFileSync(process.execPath,[cli,...args],{encoding:'utf8'});
const read=name=>JSON.parse(fs.readFileSync(asset(name),'utf8'));
const selected=36, takes={}, verification={};
for(const [name,plan] of Object.entries(studies())){
  files.json(asset(name+'.json'),plan);
  command('atmosphere3d','bake',asset(name+'.json'),'--out',asset(name));
  const manifest=asset(name+'/cache.json');
  takes[name]=cache.open(kit,manifest);
  verification[name]=JSON.parse(command('atmosphere3d','verify',manifest));
  assert(verification[name].verified&&verification[name].detailFrames===takes[name].index.frames.length);
  const check=readCheckpoint(asset(name+'/checkpoints/'+selected+'.json')), resumed=R.create(check.world,{checkpoint:check});
  resumed.advance(takes[name].index.ticks);
  const end=readCheckpoint(asset(name+'/checkpoints/'+takes[name].index.ticks+'.json'));
  assert(R.checkpointsEqual(resumed.checkpoint(),end));
  for(const level of ['base','detail'])command('atmosphere3d','playback',manifest,'--tick',String(selected),'--level',level,
    '--out',asset(name+'-'+level+'.json'));
}
const kiln=takes.kiln.index, cloud=takes.cloud.index, flame=kiln.summary, bank=cloud.summary;
assert(flame.peakTemperature>1300&&flame.reaction.fuelBurned>.73&&bank.reaction.condensed>2&&flame.peakActive<6000);
assert(flame.after<flame.before*.12&&bank.after<bank.before*.12);
for(const receipt of [flame,bank]){
  assert(receipt.peakDetailRms>.02&&receipt.peakRefinementDrift<1e-7&&receipt.work<receipt.maxWork);
  assert(Object.values(receipt.maxBalanceError).every(n=>n<1e-7));
}
const mixed=takes.cloud.playback({time:(selected+2)*cloud.dt,level:'detail',blend:'linear'});
assert.deepEqual(mixed.report.frames,[36,40]);
files.write(asset('cloud-between.json'),cache.serial(mixed.volume));

const W=1160,H=653, bg='#111e2a', panel='#172b36', lineColor='#354d57', muted='#94aeb0',
  pale='#f1dfb2', hot='#f0a275', blue='#91d5db', teal='#7abcaa';
const rect=(x,y,w,h,fill)=>({type:'rect',rect:[x,y,w,h],fill});
const text=(text,x,y,scale=1,color=pale)=>({type:'text',text,at:[Math.round(x),Math.round(y)],scale,color});
const curve=(points,stroke,width=1)=>({type:'path',points,stroke,width});
const render=(width,height,commands)=>K.procedural.drawing2d.render({width,height,commands,edges:'hard'});
const clamp=n=>Math.max(0,Math.min(1,n));

function crop(volume){
  const {grid,brickSize:b,fields}=volume, {spacing,origin,size}=grid,
    state=K.procedural.sparseVolume.inspect(volume), keys=['density','temperature'];
  const boxes=keys.map(name=>state.fields[name].activeIndexBounds).filter(Boolean);
  if(!boxes.length)return null;
  const lo=origin.map((_,k)=>Math.max(0,Math.min(...boxes.map(box=>box.min[k]))-1)),
    hi=origin.map((_,k)=>Math.min(size[k]-1,Math.max(...boxes.map(box=>box.max[k]))+1)),
    dims=hi.map((n,i)=>n-lo[i]+1), count=dims.reduce((n,s)=>n*s,1), [nx,ny]=dims;
  assert(count<180000,'Volume preview crop exceeds its budget');
  const values=Object.fromEntries(keys.map(name=>[name,new Float32Array(count)]));
  for(const brick of volume.bricks)for(const name of keys)for(const row of brick.fields[name]??[]){
    for(const [i,v] of row.values.entries()){
      const slot=row.start+i, p=[slot%b,Math.floor(slot/b)%b,Math.floor(slot/(b*b))]
        .map((n,k)=>n+brick.at[k]*b-lo[k]);
      if(p.some((n,k)=>n<0||n>=dims[k]))continue;
      values[name][p[0]+nx*(p[1]+ny*p[2])]=v-fields[name].background;
    }
  }
  const bounds={min:lo.map((n,i)=>origin[i]+n*spacing[i]),max:hi.map((n,i)=>origin[i]+(n+1)*spacing[i])};
  function sample(name,x,y,z){
    const q=[x,y,z].map((n,k)=>(n-bounds.min[k])/spacing[k]-.5),
      p=q.map(Math.floor), a=q.map((n,k)=>n-p[k]), arr=values[name];
    let value=0;
    for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const u=p[0]+i,v=p[1]+j,w=p[2]+k;
      if(u<0||u>=nx||v<0||v>=ny||w<0||w>=dims[2])continue;
      value+=arr[u+nx*(v+ny*w)]*(i?a[0]:1-a[0])*(j?a[1]:1-a[1])*(k?a[2]:1-a[2]);
    }
    return value;
  }
  return {bounds,sample};
}

const palette=[0x172a39,0x293845,0x405360,0x5e6870,0x85594e,0xb4775e,0xd69470,0xf5ae6b,0xeaddb5,
  0x29464f,0x527983,0x8cb2b5,0x6b7c8a,0x203b49,0x385662,0x648c99,0x9fbab9,0xc8d6ca,0xf2e9c9,
  0x96715d,0xc38464,0xdf9b66,0xf6ce86];
function stage(name){
  const b=makeBuilder(name==='kiln'?8:51,palette), s=K.sculpt(makeSculpt(b));
  Object.assign(s,{pixel:true,sun:V.norm([-.45,.8,.54]),amb:.34,sky:.23,sunK:.66,shLen:0});
  if(name==='kiln'){
    s.box([0,-.18,.04],[1.24,.18,.82],{r:[1,2,3]},{res:.12,rd:.082});
    s.box([-.08,.015,0],[.66,.17,.56],{r:[1,4,5,6]},{res:.092,rd:.068});
    s.box([-.08,.20,0],[.51,.07,.42],{r:[1,4,5,7]},{res:.067,rd:.048});
    for(const dx of [-.33,.06,.34])s.box([dx,.045,.55],[.046,.070,.024],{r:[5,7,8],em:true},{res:.04,rd:.032});
  }else{
    s.box([-.19,.14,-.16],[1.17,.066,.57],{r:[1,2,3,10]},{res:.093,rd:.069});
    for(const x of [-1.25,1.0]){
      s.box([x,.02,-.17],[.09,.12,.43],{r:[1,2,10]},{res:.08,rd:.06});
      s.box([x,.39,-.60],[.048,.24,.054],{r:[2,10,11]},{res:.048,rd:.033});
    }
  }
  s.bake();
  const cam=name==='kiln'?{target:[1.60,1.17,.05],yaw:-.26,pitch:.25,dist:8.90,fov:.51}:
    {target:[.70,1.22,0],yaw:-.28,pitch:.21,dist:8.55,fov:.51};
  return b.finish({cam:{...cam,ortho:true,sway:0},radius:12,dither:0,volumeQuality:{steps:72,jitter:'off'}});
}
const bases={kiln:stage('kiln'),cloud:stage('cloud')};
function view(name,volume,width,height){
  const cropped=crop(volume), sky=bases[name], volumes=[];
  if(cropped){
    const {bounds,sample}=cropped, rho=(x,y,z)=>sample('density',x,y,z);
    const field=(fn,density,color)=>K.atmosphere.field({
      field:K.procedural.density.bounded({bounds,sample:fn}),density,step:.071,color,lit:false
    });
    if(name==='kiln'){
      volumes.push(field(rho,4.9,'#788e9a'));
      volumes.push(field((x,y,z)=>{
        const t=sample('temperature',x,y,z), d=rho(x,y,z);
        return clamp((t-75)/550)*(.15+d*.75);
      },7.5,'#eb975f'));
      volumes.push(field((x,y,z)=>clamp((sample('temperature',x,y,z)-310)/650)*rho(x,y,z),4.8,'#ffcf86'));
    }else{
      volumes.push(field(rho,2.5,'#7693a8'));
      volumes.push(field((x,y,z)=>rho(x,y,z)*Math.exp(-.92*(rho(x-.16,y+.22,z+.19)+rho(x-.32,y+.44,z+.38))),
        4.25,'#f0e6c9'));
    }
  }
  return Render.render({...sky,atmosphere:volumes},{w:width,h:height,px:1,t:0,raw:false,edges:false,lockCamera:true,volumeJitter:'off'});
}

function rasterCopy(dst,value,left,top,factor=2){
  const {w,h,rgb}=value;
  for(let y=0;y<h*factor;y++)for(let x=0;x<w*factor;x++){
    const src=(Math.floor(x/factor)+Math.floor(y/factor)*w)*3, at=(left+x+(top+y)*W)*4;
    dst[at]=rgb[src];dst[at+1]=rgb[src+1];dst[at+2]=rgb[src+2];dst[at+3]=255;
  }
}
function slice(volume){
  const w=106,h=63,rgb=new Uint8Array(w*h*3), {sample}=crop(volume);
  const tones=[[22,42,55],[32,61,73],[41,79,88],[52,98,107],[68,124,125],[88,153,145],
    [117,177,162],[158,204,175],[201,219,182],[233,224,188]];
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const x=-1.36+i/w*3.37,y=2.21-j/h*1.99,z=.065, d=sample('density',x,y,z);
    const tilt=sample('density',x-.05,y+.055,z)-sample('density',x+.05,y-.055,z);
    const tone=Math.max(0,Math.min(tones.length-1,Math.floor((d*.64-tilt*.55)*tones.length)));
    rgb.set(tones[tone],(i+j*w)*3);
  }
  return {w,h,rgb};
}
const coarse=slice(read('cloud-base.json')), detail=slice(read('cloud-detail.json'));
const detailPixelRms=Math.sqrt(detail.rgb.reduce((n,v,i)=>n+(v-coarse.rgb[i])**2,0)/detail.rgb.length);
assert(detailPixelRms>.7);
function chart(cmd,tick){
  const left=39,top=460,width=620,height=108,bottom=top+height-15;
  cmd.push(rect(left,top,width,height,panel));
  for(let i=0;i<4;i++)cmd.push(rect(left+11,bottom-i*24,width-22,1,lineColor));
  const px=at=>left+11+(width-22)*at/kiln.ticks,py=v=>bottom-73*v;
  const series=(take,color)=>{
    const max=Math.max(...take.frames.map(row=>row.quality.densityMass));
    cmd.push(curve(take.frames.map(row=>[px(row.tick),py(row.quality.densityMass/max)]),color,2));
  };
  series(kiln,hot);series(cloud,blue);
  cmd.push(rect(px(tick),top+8,1,height-24,muted),text('0',left+12,top+height-10,1,muted),
    text('TICK '+kiln.ticks,left+width-61,top+height-10,1,muted));
}

function board(tick){
  const result=[rect(0,0,W,H,bg),rect(0,0,W,4,teal),text('KILN & CLOUDBANK',33,24,4),
    text('SPARSE COMBUSTION / CLOUD CONDENSATION / NATIVE PLAYBACK',35,66,1,muted),rect(33,86,1094,1,lineColor),
    rect(33,103,535,290,panel),rect(592,103,535,290,panel),text('BEACON KILN',44,117,2,hot),
    text('CIRRUS DECK',603,117,2,blue),text('TICK '+String(tick).padStart(2,'0'),504,119,1,muted),
    text('TICK '+String(tick).padStart(2,'0'),1063,119,1,muted),
    text('PEAK HEAT  '+Math.round(flame.peakTemperature)+' K',44,377,1,hot),
    text('FUEL BURNED  '+flame.reaction.fuelBurned.toFixed(3),292,377,1,muted),
    text('VAPOR CONDENSED  '+bank.reaction.condensed.toFixed(3),604,377,1,blue),
    text('VAPOR EVAPORATED  '+bank.reaction.evaporated.toFixed(3),898,377,1,muted),
    text('DENSITY OVER TIME',38,416,2),text('KILN',379,421,1,hot),text('CLOUD',464,421,1,blue),
    text('EACH CURVE SCALED TO ITS PEAK',40,443,1,muted),
    text('2X DETAIL / MATCHED CAMERA',687,416,2),text('DENSITY SLICE AT TICK '+selected,687,443,1,muted),
    rect(683,456,444,139,panel),text('BASE',690,583,1,muted),text('REFINED',909,583,1,blue),
    rect(33,609,1094,1,lineColor),text('1,200,000 LOGICAL CELLS',34,627,1,muted),
    text('PEAK MATERIAL CELLS '+flame.peakActive.toLocaleString('en-US')+' / '+bank.peakActive.toLocaleString('en-US'),328,627,1,muted),
    text('30 BASE + 30 DETAIL FRAMES VERIFIED',889,627,1,muted)];
  chart(result,tick);
  const board=render(W,H,result), a=takes.kiln.playback({tick,level:'detail'}).volume, b=takes.cloud.playback({tick,level:'detail'}).volume;
  rasterCopy(board.data,view('kiln',a,260,111),40,142);
  rasterCopy(board.data,view('cloud',b,260,111),599,142);
  rasterCopy(board.data,coarse,687,456);
  rasterCopy(board.data,detail,909,456);
  return board;
}

const still='kiln-and-cloudbank.png', loop='kiln-and-cloudbank-loop.png', image=board(selected);
files.write(asset(still),PNG.encode(W,H,image.data,4));
const ticks=kiln.frames.map(row=>row.tick), loopFrames=[...Array(3).fill(0),...ticks,...Array(4).fill(ticks.at(-1))], boards=new Map();
boards.set(selected,PNG.packRGBA(image));
const animation=loopFrames.map(tick=>{
  if(!boards.has(tick))boards.set(tick,PNG.packRGBA(board(tick)));
  return boards.get(tick);
});
files.write(asset(loop),PNG.encodeAnimation(animation,8));
files.json(asset('demo-report.json'),{still,loop,selected,logicalCells:flame.logicalCells,kiln:flame,cloud:bank,verification,
  detailPixelRms,linearFrames:mixed.report.frames,restartedFrom:selected});
console.log(asset(still));
