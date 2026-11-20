const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawn}=require('node:child_process');
const http=require('node:http');
const kit=require('..').load(), {KIT:K}=kit, W=K.world;
const hatch=require('../examples/world-acoustic-hatch.json');
const contacts=require('../examples/world-contact-effects.json');
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,a+' differs from '+b);
const event=(tick,kind,detail)=>({tick,action:'world/event',args:{kind,...detail}});

test('socket emitters track world positions and acoustic transmission without doubling distance falloff',()=>{
  const scene={...hatch,commands:[...hatch.commands,
    {tick:17,action:'world/patch',args:{edits:[{op:'set',path:'/entities/beacon/position',value:[4,0,1]}]}}]};
  const run=W.runtime.create(scene);
  const audio=W.spatialAudio.create({
    cues:{alarm:{asset:'alarm.wav',distance:{reference:1,max:12,rolloff:1,fade:0}}},
    emitters:{wallAlarm:{cue:'alarm',at:{entity:'beacon',socket:'speaker'}}},
    occlusion:{acoustic:'acoustics/audible'},propagationDelay:true
  });
  const sample=()=>audio.frame({query:run.query(),time:run.view().time,listener:{entity:'listen-post'}}).active[0];
  const open=sample();
  const query=run.query().probe('acoustics/audible',{entity:'listen-post'},{from:{entity:'beacon',socket:'speaker'}}).value;
  near(open.gain,query.gain);
  near(open.delay,query.delaySeconds);
  assert.deepEqual(open.apparentSource,query.apparentSource);
  run.advance(8);
  const closed=sample();
  assert(closed.gain<open.gain*.1&&closed.bands.high<closed.bands.low*.03);
  run.advance(16);
  near(sample().gain,open.gain);
  run.advance(17);
  assert.deepEqual(sample().position,[4,1,1]);
  assert(sample().gain<open.gain);
  assert.equal(audio.frame({query:run.query(),listener:[20,1,0]}).active[0].status,'out-of-range');
});

test('simulation events use cue bindings and geometry supplies material-specific occlusion',()=>{
  const run=W.runtime.create({dt:.1,systems:{
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{panel:{fixed:true,half:[.12,.8,1],position:[0,.8,0],material:'glass'}}}},
    rock:{kind:'volume',config:{bounds:{min:[-.6,0,-2],max:[.6,2,2]},cell:.2,materials:{stone:[1,2,3,4]},
      initial:[{op:'fill',material:'stone',shape:{kind:'box',at:[0,.8,0],half:[.1,.8,1]}}]}}
  },commands:[event(1,'door-latched',{at:[2,.8,0],zone:'service'})]});
  run.step();
  const planner=type=>W.spatialAudio.create({cues:{latch:{asset:'latch.wav',distance:{rolloff:0}}},
    bindings:{door:{on:{kind:'door-latched',where:{path:'/zone',value:'service'}},cue:'latch'}},
    occlusion:{[type]:[type==='rays'?'rig/ray':'rock/segment'],materials:{glass:{lossDb:6,cutoff:2200}}}});
  const frame={query:run.query(),listener:[-2,.8,0],events:[...run.events,...run.events]};
  const ray=planner('rays').frame(frame);
  assert.equal(ray.cues.length,1);
  assert.equal(ray.cues[0].status,'occluded');
  assert.equal(ray.cues[0].blocker.id,'panel');
  assert.equal(ray.cues[0].cutoff,2200);
  near(ray.cues[0].gain,10**(-6/20));
  const volume=planner('segments').frame(frame).cues[0];
  assert.equal(volume.status,'occluded');
  assert.equal(volume.blocker.trace,'rock/segment');
  assert.equal(volume.cutoff,1200);
});

test('material feedback and authored animation contacts produce positioned cue requests',()=>{
  const run=W.runtime.create(contacts);
  run.advance(22);
  const planner=W.spatialAudio.create({
    cues:{'trackside/clay.roll':'wheel.wav',boot:'boot.wav',tap:'tap.wav'},
    materials:{oak:{step:'tap'}},
    bindings:{plant:{on:{kind:'animation-contact',where:{path:'/action',value:'plant'}},interaction:'step'}}
  });
  const base={query:run.query(),listener:[0,1,0],time:.3};
  const wheels=planner.frame({...base,events:run.events}).cues;
  const wet=run.events.find(row=>row.kind==='material-sound'&&row.cue==='trackside/clay.roll');
  assert(wheels.some(shot=>shot.position.every((v,i)=>v===wet.at[i])&&shot.rate===wet.pitch));
  const B=kit.makeBuilder(1,[0x141820,0xb34e59]);
  B.iso(0,.25,0,.24,B.P[1],3);
  const world=B.finish({cam:{target:[0,.4,0],yaw:.3,pitch:.2,dist:4}});
  const puppet=K.puppet(world,{parts:{foot:{ids:[0],pivot:[0,.25,0]}}});
  const clip=K.anim.clip({dur:1,tracks:{'foot.pos':[[0,[0,0,0]],[1,[0,.7,0]]]},
    events:[{name:'down',time:.25}]});
  const machine=K.anim.machine({layers:[{id:'base',entry:'moving',states:[{id:'moving',clip}]}],
    eventBindings:{down:[{type:'contact',contact:'sole',action:'plant'},{type:'sound',cue:'boot',contact:'sole'}]}});
  const at=[.4,.25,0];
  const animation=machine.bind({world,puppet,contacts:{sole:{part:'foot',point:[0,.25,0],target:at}}});
  world.anim.update(.3,.3);
  const frame=planner.frame({...base,animation:[{id:'hero',at:[4,1,0],frame:animation.frame(),contacts:{sole:{material:'oak'}}}]});
  assert.deepEqual(frame.cues.map(({cue,position})=>[cue,position]),[['tap',at],['boot',at]]);
});

test('audio tracks retain timeline offsets across trimming and handle one-shot cues once per interval',()=>{
  const timeline=K.timeline.compile({duration:3,sequences:{part:{duration:2,audio:[
    {id:'sustain',time:0,cue:'hum',duration:2,offset:.2},{id:'once',time:1.25,cue:'hit'}
  ]}},clips:[{id:'cut',sequence:'part',time:1,in:.5,out:1.5,duration:2}]});
  const audio=W.spatialAudio.create({cues:{hum:{asset:'hum.wav',at:[1,0,0]},hit:'hit.wav'}});
  const listener=[0,0,0], frame=audio.frame({timeline,from:2,time:2.75,listener});
  assert.equal(frame.cues[0].mode,'cue');
  near(frame.active[0].rate,.5);
  near(frame.active[0].offset,.2+.5+1.75*.5);
  near(frame.active[0].duration,.25);
  assert.deepEqual(audio.frame({timeline,time:2.75,listener}).cues,[]);
});

test('Web Audio renders positional attenuation, muffling, and cancelled late assets',
  {skip:!process.env.INK_TEST_CHROME,timeout:30000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-spatial-audio-'));
  let finished;
  const reportPending=new Promise(resolve=>{finished=resolve;});
  const server=http.createServer((req,res)=>{
    let body='';
    req.on('data',chunk=>{body+=chunk;});
    req.on('end',()=>{res.end('ok');finished(body);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const reportURL='http://127.0.0.1:'+server.address().port;
  const page=path.join(dir,'audio.html'), moduleURL=pathToFileURL(path.resolve(__dirname,'../webgl.mjs')).href;
  const high=4400, low=220, rate=48000, samples=12000;
  const base={time:0,listener:{position:[0,0,0],forward:[0,0,-1],up:[0,1,0]},active:[]};
  const voice={id:'test',asset:'signal',mode:'cue',offset:0,rate:1,delay:0,position:[2,0,0],gain:.5,
    bands:{low:.5,mid:.5,high:.5},cutoff:22000};
  fs.writeFileSync(page,`<!doctype html><meta charset="utf-8"><script type="module">
  import {createSpatialAudioPlayer} from ${JSON.stringify(moduleURL)};
  const base=${JSON.stringify(base)}, voice=${JSON.stringify(voice)}, rate=${rate}, samples=${samples};
  const report=body=>fetch(${JSON.stringify(reportURL)},{method:'POST',mode:'no-cors',body:JSON.stringify(body)});
  async function play(voice,{duplicate=false,cancel=false}={}){
    const context=new OfflineAudioContext(2,samples,rate), signal=context.createBuffer(1,samples,rate);
    for(let i=0;i<samples;i++)signal.getChannelData(0)[i]=.25*Math.sin(i*2*Math.PI*${high}/rate)+.25*Math.sin(i*2*Math.PI*${low}/rate);
    let ready;
    const player=createSpatialAudioPlayer(context,{panning:'equalpower',smoothing:0,
      resolveAsset:()=>cancel?new Promise(resolve=>{ready=resolve;}):signal});
    const frame={...base,cues:[voice]}, started=player.update(frame);
    if(cancel){await Promise.resolve();player.reset();ready(signal);}
    await started;
    if(duplicate)await player.update(frame);
    const output=await context.startRendering();
    const rms=i=>Math.sqrt(output.getChannelData(i).reduce((a,y)=>a+y*y,0)/samples);
    function energy(hz){
      let x=0,y=0;const rows=output.getChannelData(1);
      for(let i=1200;i<rows.length;i++){const a=i*2*Math.PI*hz/rate;x+=rows[i]*Math.cos(a);y+=rows[i]*Math.sin(a);}
      return Math.hypot(x,y)/(samples-1200);
    }
    player.dispose();
    return {rms:[rms(0),rms(1)],low:energy(${low}),high:energy(${high})};
  }
  async function looping(){
    const context=new OfflineAudioContext(2,rate,rate), buffer=context.createBuffer(1,rate,rate), starts=[];
    const create=context.createBufferSource.bind(context);
    context.createBufferSource=()=>{
      const source=create(), start=source.start.bind(source);
      source.start=(...args)=>{starts.push(args[1]);return start(...args);};
      return source;
    };
    const player=createSpatialAudioPlayer(context,{resolveAsset:()=>buffer});
    const frame=(time,offset)=>({...base,time,cues:[],active:[{...voice,mode:'loop',offset}]});
    await player.update(frame(.1,.1));
    await player.update(frame(.35,.35));
    await player.update(frame(1.6,1.6),{seek:true});
    player.dispose();
    return starts;
  }
  try{
    const clear=await play(voice), same=await play(voice,{duplicate:true}),
      obstructed=await play({...voice,gain:.22,bands:{low:.22,mid:.22,high:.06},cutoff:1000}),
      cancelled=await play(voice,{cancel:true});
    await report({clear,same,obstructed,cancelled,starts:await looping()});
  }catch(error){await report({error:error.stack});}
  </script>`);
  const child=spawn(process.env.INK_TEST_CHROME,['--headless','--no-first-run','--disable-background-networking',
    '--allow-file-access-from-files','--user-data-dir='+path.join(dir,'profile'),pathToFileURL(page).href],{stdio:'ignore'});
  t.after(async()=>{
    const exited=child.exitCode===null&&new Promise(resolve=>child.once('exit',resolve));
    child.kill();
    if(exited)await exited;
    server.closeAllConnections();server.close();
    fs.rmSync(dir,{recursive:true,force:true});
  });
  const report=JSON.parse(await Promise.race([reportPending,new Promise((_,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>reject(Error('Audio browser exited with code '+code)));
    t.signal.addEventListener('abort',()=>reject(t.signal.reason),{once:true});
  })]));
  assert(!report.error,report.error);
  const {clear,same,obstructed,cancelled}=report;
  assert(clear.rms[1]>.1&&clear.rms[1]>clear.rms[0]*4);
  assert.deepEqual(clear,same);
  assert(obstructed.low>0&&obstructed.low<clear.low*.6);
  assert(obstructed.high<clear.high*.03);
  assert.deepEqual(cancelled.rms,[0,0]);
  assert.equal(report.starts.length,2);
  near(report.starts[0],.1);
  near(report.starts[1],.6);
});
