/* Switchyard: a heard cue, a late cart, and an overloaded burst on the story clock. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {execFileSync}=require('node:child_process');
const ink=require('../..'), {KIT}=ink.load(), WAV=require('../../cli/wav');

const sampleRate=32000, dt=.05, tau=2*Math.PI;
const dir=path.resolve(process.argv[2] ?? 'switchyard');
fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
function write(name,value) {
  fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');
}
const cli=path.resolve(__dirname,'../../cli/ink-studio.js');
const command=(...args)=>execFileSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
let seed=1417, brown=0;
function noise() {
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/2147483648-1;
}
function wav(name,length,render) {
  const file='assets/'+name+'.wav';
  const samples=Float32Array.from({length:Math.round(length*sampleRate)},(_,i)=>render(i/sampleRate));
  fs.writeFileSync(path.join(dir,file),WAV.encode({sampleRate,channels:1,samples},{encoding:'pcm24'}));
  return file;
}
function strike(t,modes,grit) {
  return Math.min(1,t*1200)*(modes.reduce((sample,[gain,hz,decay])=>
    sample+gain*Math.sin(tau*hz*t)*Math.exp(-decay*t),0)+grit*noise()*Math.exp(-78*t));
}
const soft=[[.38,233,14],[.2,507,23],[.12,899,31]];
const hard=[[.33,278,16],[.24,619,21],[.16,1144,25]];
const assets={
  stamp:wav('stamp',.19,t=>strike(t,[[.5,122,38],[.13,471,62]],.19)),
  thin:wav('thin',.48,t=>strike(t,soft,.12)),
  bright:wav('bright',.48,t=>strike(t,hard,.14)),
  cart:wav('cart',2.35,t=>{
    brown+=.19*(noise()-brown);
    const roll=.72+.28*Math.cos(tau*7.3*t), curve=Math.sin(Math.PI*t/2.35)**.7;
    return curve*roll*(.18*Math.sin(tau*(107*t+3.7*t*t))+.11*Math.sin(tau*311*t)+.31*brown);
  }),
  plate:wav('plate',.76,t=>strike(t,[[.35,178,8],[.24,371,11],[.16,1362,17]],.17)),
  loose:wav('loose',.63,t=>strike(t,[[.32,321,17],[.29,731,14],[.11,1470,31]],.26)),
  amber:wav('amber',.65,t=>strike(t,[[.35,523,6],[.17,784,9],[.12,1051,11]],.018)),
  room:wav('room',6.2,t=>{
    brown+=.016*(noise()-brown);
    const floor=.018*Math.sin(tau*47*t)+.016*Math.sin(tau*71*t+.5);
    return (.9+.1*Math.sin(tau*.48*t))*(.065*brown+floor);
  })
};
const event=(tick,kind,args)=>({tick,action:'world/event',args:{kind,...args}});
const world={id:'switchyard',dt,entities:{cart:{position:[-10,0,-1],sockets:{axle:[0,0,0]}}},commands:[
  event(16,'permit-stamped',{at:[0,0,-1]}),
  event(30,'cart-dispatched',{at:{entity:'cart',socket:'axle'}}),
  {tick:45,action:'world/patch',args:{edits:[{op:'set',path:'/entities/cart/position',value:[-1.8,0,-1]}]}},
  ...[1,.82,.69].map((gain,index)=>event(72,'basket-dropped',{at:[.7,0,-1],gain,object:'basket-'+index})),
  event(81,'clearance-signal',{at:[0,0,-1]}),
  event(81,'stray-clink',{at:[1,0,-1]}),
  event(103,'basket-dropped',{at:[50,0,0],gain:.85,object:'distant-basket'})
]};
const mix={format:'ink-studio/scene-audio',version:1,sampleRate,gain:.88,assets,post:{},
  tracks:[{asset:'room',bus:'ambience',gain:.8}],spatial:{
    soundSeed:81,distance:{reference:2,max:6,fade:.3},
    voiceBudget:{maxVoices:2,reservedVoices:1,groups:{metal:1},stealFade:.012},
    cues:{
      stamp:{asset:'stamp',bus:'foley',gain:.6},
      thin:{asset:'thin',bus:'effects',gain:.67},
      bright:{asset:'bright',bus:'effects',gain:.66},
      cart:{asset:'cart',bus:'foley',gain:.72,follow:true,priority:-1},
      plate:{asset:'plate',bus:'effects',gain:.7,priority:30,group:'metal'},
      loose:{asset:'loose',bus:'effects',gain:.67,priority:30,group:'metal'},
      amber:{asset:'amber',bus:'dialogue',gain:.8,protected:true,priority:90},
      stray:{asset:'bright',bus:'foley',gain:.4}
    },
    soundFamilies:{counter:{takes:{thin:'thin',bright:'bright'},variation:{pitchCents:[-32,24]}},
      basket:{takes:{plate:'plate',loose:'loose'},variation:{rotate:true,pitchCents:[-22,36]}}},
    bindings:{
      stamp:{on:{kind:'permit-stamped'},impactLayers:{
        strike:{cue:'stamp',bus:'foley'},tail:{select:[{id:'counter',family:'counter'}],delay:.0625,bus:'effects'}
      }},
      cart:{on:{kind:'cart-dispatched'},cue:'cart'},
      basket:{on:{kind:'basket-dropped'},select:[{id:'basket',family:'basket'}]},
      amber:{on:{kind:'clearance-signal'},cue:'amber'},
      stray:{on:{kind:'stray-clink'},cue:'stray'}
    }
  }};
write('world.json',world);
write('score.json',mix);
const run=KIT.world.runtime.create(world);
run.advance(124);
write('world.run.json',run.recording());
command('story','audio','world.run.json','score.json','--out','mix');
const receipts=JSON.parse(fs.readFileSync(path.join(dir,'mix/playback.json'),'utf8')).receipts;
assert(fs.existsSync(path.join(dir,'mix/receipts.json')));
const cart=receipts.find(row=>row.cue==='cart');
assert.equal(cart.outcome,'late');
assert.equal(cart.requestedSample,48000);
assert.equal(cart.actualSample,72000);
assert.equal(receipts.filter(row=>row.reason==='group-limit').length,2);
assert(receipts.some(row=>row.cue==='stray' && row.reason==='voice-limit'));
assert(receipts.some(row=>row.outcome==='muted' && row.reason==='out-of-range'));
assert(receipts.some(row=>row.variant?.family==='counter' && row.plannedSample===27600 && row.actualSample===27600));
const ids=[...new Set(receipts.map(row=>row.beatId))];
write('beat-inspection.json',ids.map(beatId=>JSON.parse(command('beat',beatId,'mix/playback.json'))));
console.log(path.join(dir,'mix/playback.json'));
