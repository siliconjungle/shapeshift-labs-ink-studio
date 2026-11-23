import { createRenderer } from '../../webgl.mjs';

const W=192, H=148, K=KIT;
const neutral=[[0,'#272b36'],[.29,'#4f5362'],[.53,'#807b79'],[.72,'#b8a897'],[.89,'#f2dec0']];
const preset=[[0,'#19233c'],[.29,'#3b6581'],[.53,'#926377'],[.72,'#df9163'],[.89,'#ffde99']];
const toolkit={KIT,PixelLook,SpriteSurface};
const $=id=>document.getElementById(id);
const copy=rows=>rows.map(row=>row.slice());
let stops=copy(preset), selected=2;

function relay() {
  const palette=[
    0x131d26,0x1d2a34,0x293b4a,0x435560,0x647073,0x969489,
    0x352932,0x6e4840,0xa97849,0xcb945a,0xf0bb74,0xffdc96,
    0x161f28,0x24363b,0x4d7167,0x78a994,0xb5e2b7
  ];
  const B=makeBuilder(57,palette), S=K.sculpt(makeSculpt(B));
  Object.assign(S,{sun:[-.45,.72,.5],amb:.56,sky:.24,sunK:.24,shLen:0,pixel:false});
  const steel={r:[1,2,3,4,5]}, dark={r:[12,1,2,3]}, brass={r:[6,7,8,9,10]}, gold={r:[8,9,10,11]},
    lamp={r:[13,14,15,16]};
  const enamel=K.surface.material({r:[2,3,4,5]},{
    id:'relay-enamel',
    layers:{body:{type:'diffuse',lightingRamp:{stops:preset,interpolation:'step'},wrap:.45}}
  });
  const box=(at,half,mat,res=.042,rd=.028)=>S.box(at,half,mat,{res,rd});
  const ring=(y,r,h,mat)=>S.lathe([0,y,0],h,r,mat,{res:.032});

  box([0,.045,0],[1.33,.083,.88],dark,.059,.071);
  box([0,.157,0],[1.24,.048,.82],steel,.053,.041);
  box([0,.225,0],[1.12,.045,.72],dark,.045,.036);
  for (const side of [-1,1]) {
    box([side*.91,.292,.04],[.185,.061,.48],steel,.04,.047);
    box([side*.9,.338,.53],[.144,.037,.127],brass,.032,.026);
    S.ball([side*.9,.384,.57],.043,gold,{res:.021});
  }
  ring(.34,.65,.132,steel);
  S.lathe([0,.45,0],1.52,t=>K.kf(t,[0,.63,.11,.81,.32,.85,.59,.82,.81,.71,1,.44]),
    enamel,{res:.032,maxRadius:.86});
  ring(.498,.742,.051,brass);
  ring(1.819,.565,.071,brass);
  ring(1.943,.483,.071,steel);
  S.lathe([0,1.997,0],.236,[.381,.258],enamel,{res:.026});
  ring(2.208,.263,.057,brass);
  ring(2.246,.198,.13,steel);
  S.ball([0,2.369,0],[.167,.105,.166],enamel,{res:.024});
  S.tube([[0,2.434,0],[0,2.59,0]],.019,.018,brass,{res:.016});
  S.ball([0,2.596,0],.041,gold,{res:.018});

  for (const side of [-1,1]) {
    const p=[side*.57,0,.61];
    S.tube([[p[0],.539,p[2]],[p[0]*1.17,.70,p[2]*1.10],
      [p[0]*1.21,1.33,p[2]*1.11],[p[0]*.82,1.72,p[2]*.83]],.044,.026,brass,{res:.026});
    for (const y of [.63,1.45]) S.ball([p[0]*(y<1?1.14:1.04),y,p[2]*1.12],.051,steel,{res:.023});
  }
  const frontAx=[[1,0,0],[0,0,1],[0,-1,0]];
  const dial=[-.02,1.29,.762];
  S.lathe(dial,.144,[.328,.349],dark,{ax:frontAx,res:.022});
  S.lathe([dial[0],dial[1],.877],.055,[.308,.308],brass,{ax:frontAx,res:.019});
  S.lathe([dial[0],dial[1],.931],.029,.255,dark,{ax:frontAx,res:.02});
  S.lathe([dial[0],dial[1],.950],.016,.218,lamp,{ax:frontAx,res:.017});
  for (let i=0;i<7;i++) {
    const a=(205-i*38)*Math.PI/180;
    S.ball([dial[0]+Math.cos(a)*.155,dial[1]+Math.sin(a)*.155,.971],.013,dark,{res:.009});
  }
  S.tube([[dial[0]-.075,dial[1]-.06,.976],[dial[0]+.099,dial[1]+.125,.976]],
    .013,.006,gold,{res:.010});
  S.ball([dial[0],dial[1],.98],.028,gold,{res:.014});
  box([-.05,.702,.78],[.30,.099,.071],dark,.024,.024);
  for(let i=0;i<5;i++)
    box([-.249+i*.10,.714,.864],[.020,.036,.013],i<3?gold:brass,.014,.007);

  const atlas=SpriteSurface.make(64,32);
  atlas.face([-.34,.09,.887],[.68,0,0],[0,.095,0],32,5,(x,y)=>{
    if (y===0 || y===4) return 0x6e674f;
    return x>2&&x<29&&((x+y*2)%8)<3 ? 0xc2a475 : 0x202a32;
  });
  S.bake();
  return B.finish({
    radius:5,dither:0,spriteSurfaces:atlas.finish(),
    look:{splatCoverage:'continuous'},fog:{start:1,max:0,c:0},
    cam:{target:[0,1.27,0],dist:5.5,fov:2*Math.atan(1.56/5.5),yaw:.34,pitch:.15,ortho:true}
  });
}

const world=relay(), bindings=world.surfaces;
const viewers=[$('neutral'),$('authored')].map(canvas=>createRenderer(canvas,{
  toolkit,contextAttributes:{preserveDrawingBuffer:true}
}));
const light=$('light'), mode=$('interpolation'), wrap=$('wrap'), position=$('position'), color=$('color'), play=$('play');
const strip=$('strip'), stripContext=strip.getContext('2d');
const chips=[...$('stops').querySelectorAll('button')];
let playing=false, animation, start, lastFrame;

function render() {
  const yaw=Number(light.value)*Math.PI/180, interpolation=mode.value, amount=Number(wrap.value)/100;
  world.surfaceLight=[[0,.91*Math.sin(yaw),.43,.91*Math.cos(yaw)]];
  for (const [i,viewer] of viewers.entries()) {
    const lightingRamp={stops:i===0?neutral:stops,interpolation};
    world.surfaces=bindings.map(binding=>{
      if(binding.settings.id!=='relay-enamel') return binding;
      const settings=binding.settings, body={...settings.layers.body,wrap:amount,lightingRamp};
      return {...binding,settings:{...settings,layers:{...settings.layers,body}}};
    });
    viewer.render(world,{width:W,height:H,raw:true,changedRows:[]});
  }
  const layer=K.surface.prepare({layers:{body:{type:'diffuse',lightingRamp:{stops,interpolation}}}}).layers[0];
  const rgb=[0,0,0], image=stripContext.createImageData(strip.width,strip.height);
  for (let x=0;x<strip.width;x++) {
    layer.lightingRamp.tint(x/(strip.width-1),rgb);
    image.data.set([...rgb.map(c=>c*255),255],x*4);
  }
  const row=image.data.subarray(0,strip.width*4);
  for (let y=1;y<strip.height;y++) image.data.set(row,y*row.length);
  stripContext.putImageData(image,0,0);
  $('light-value').value=light.value+'°';
  $('wrap-value').value=amount.toFixed(2);
  $('position-value').value=stops[selected][0].toFixed(2);
  for (const [i,chip] of chips.entries()) {
    chip.style.setProperty('--swatch',stops[i][1]);
    chip.setAttribute('aria-pressed',String(i===selected));
  }
}

function select(index) {
  selected=index;
  position.min=index===0 ? 0 : Math.round(stops[index-1][0]*100)+1;
  position.max=index===stops.length-1 ? 100 : Math.round(stops[index+1][0]*100)-1;
  position.value=Math.round(stops[index][0]*100);
  color.value=stops[index][1];
  render();
}

function tick(now) {
  start ??= now;
  if(lastFrame===undefined||now-lastFrame>=1000/24) {
    light.value=Math.round(12+72*Math.sin((now-start)/1170));
    render();
    lastFrame=now;
  }
  animation=requestAnimationFrame(tick);
}
function setPlaying(active) {
  cancelAnimationFrame(animation);
  start=undefined;
  lastFrame=undefined;
  playing=active;
  play.textContent=active?'Pause light':'Play light';
  play.setAttribute('aria-pressed',String(active));
  if(active) animation=requestAnimationFrame(tick);
}

for(const [index,chip] of chips.entries()) chip.addEventListener('click',()=>select(index));
for(const input of [light,wrap,mode]) input.addEventListener('input',()=>{setPlaying(false);render();});
color.addEventListener('input',()=>{
  stops[selected][1]=color.value;
  render();
});
position.addEventListener('input',()=>{
  stops[selected][0]=Number(position.value)/100;
  render();
});
play.addEventListener('click',()=>setPlaying(!playing));
$('reset').addEventListener('click',()=>{
  setPlaying(false);
  light.value=36;
  wrap.value=45;
  mode.value='step';
  stops=copy(preset);
  select(2);
});
select(2);
document.body.dataset.ready='true';
