const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(process.env.INK_STUDIO_REPO ?? path.join(__dirname, '../..'));
const ink = require(repo);
const out = path.resolve(process.argv[2] ?? './crossing-watch-review');
const file = name => path.join(out,name);
const rate = 24000, tau = 2 * Math.PI;
fs.mkdirSync(file('assets'),{recursive:true});
const names = ['crossing-watch.world.json','crossing-watch.story.json','crossing-watch.audio.json'];
for (const name of names) {
  if (path.join(__dirname,name)!==file(name)) fs.copyFileSync(path.join(__dirname,name),file(name));
}
const json = name => JSON.parse(fs.readFileSync(file(name),'utf8'));
const save = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
const cli = (...args) => execFileSync(process.execPath,[path.join(repo,'cli/ink-studio.js'),...args],
  { cwd:out, encoding:'utf8', stdio:'pipe' });
const wave = (hz,t) => Math.sin(tau*hz*t);
const eased = (t,length,attack=.03,release=.08) => Math.max(0,Math.min(1,t/attack,(length-t)/release));
function synth(name,length,channels,fn) {
  const samples = Float32Array.from({length:Math.round(length*rate)*channels},(_,i) =>
    fn(Math.floor(i/channels)/rate,i%channels,length));
  fs.writeFileSync(file('assets/'+name+'.wav'),ink.encodeWav({sampleRate:rate,channels,samples},{encoding:'pcm24'}));
}

synth('watch',2,2,(t,side,length) => {
  const bed = wave(55,t)*.08+wave(82.5,t)*.053+wave(side?165:137.5,t)*.035;
  const accent = .09*wave(side?330:275,t)*Math.exp(-3*(t%.5))*(.5-.5*Math.cos(tau*(t%.5)*2));
  return eased(t,length,.035,.035)*(bed+accent);
});
synth('search',2,2,(t,side,length) => {
  const swell = .68+.32*wave(1,t);
  const bed = wave(55,t)*.10+wave(side?116.5:110,t)*.065+wave(side?174.5:165,t)*.067;
  return eased(t,length,.032,.04)*bed*swell;
});
synth('pulse',2,2,(t,side) => {
  const beat = (t+side*.004)%.5, short = t%.25;
  const drum = .25*wave(52+28*Math.exp(-beat*30),beat)*Math.exp(-beat*14)*eased(beat,.5,.006,.02);
  const tick = .13*(wave(211,short)+.37*wave(975,short))*Math.exp(-short*30)*eased(short,.25,.003,.02);
  return drum+tick;
});
synth('signal',2.35,1,(t,_,length) => [392,523.25,659.25].reduce((sum,n,i)=>{
  const age=t-i*.31;
  if (age<0) return sum;
  return sum+(.22*wave(n,age)+.047*wave(n*2.47,age))*Math.exp(-age*2.6)*eased(age,length-i*.31,.012,.11);
},0));
synth('latch',.34,1,(t,_,length) => .4*eased(t,length,.003,.08)*Math.exp(-t*15)*
  (.7*wave(146,t)+.33*wave(317,t)+.11*wave(1769,t)));
let noise = 411, last = 0;
synth('line',1.9,1,(t,_,length) => {
  noise = (Math.imul(noise,1664525)+1013904223)>>>0;
  last += .23*(noise/2147483648-1-last);
  const rub = .47*last+.14*wave(183,t)*wave(6,t)+.10*wave(331,t);
  return rub*(.63+.37*wave(7,t))*eased(t,length,.045,.25);
});
synth('landing',.62,1,(t,_,length) => .34*eased(t,length,.008,.07)*Math.exp(-7*t)*
  (wave(164,t)+.5*wave(712,t)+.18*wave(1719,t)));

const world = json(names[0]);
for (let tick=96;tick<=144;tick++) {
  const x=-4.2+(tick-96)*8.4/48;
  world.commands.push({tick,action:'world/patch',args:{edits:[{op:'set',path:'/entities/ferry/position',value:[x,0,-2]}]}});
}
save('crossing-watch.take-world.json',world);
cli('sim','run','crossing-watch.take-world.json','--ticks','244','--record','crossing-watch.run.json');
cli('story','audio','crossing-watch.run.json','crossing-watch.audio.json','--out','main');
cli('story','audio','crossing-watch.run.json','crossing-watch.audio.json','--from','5','--to','7.35','--out','source-sweep');
const report = json('main/report.json');
assert.deepEqual(report.sections.map(row=>row.section),['watch','search','watch']);
assert.deepEqual(report.sections.map(row=>row.sample),[0,4*rate,10*rate]);
assert(report.layers[0].peak>.5 && report.layers[1].peak>.95);
const moving = report.cues.find(row=>row.cue==='rope');
assert(moving.position[0]<-2 && moving.lastPosition[0]>3 && moving.source.beatId.includes('/103.'));
assert.equal(report.cues.find(row=>row.cue==='signal-motif').onsetSample,5*rate);
assert.deepEqual(report.cues.find(row=>row.cue==='secure').position,[3.2,0,-2]);

const swept = ink.readWav(file('source-sweep/foley.wav'));
const complete = ink.readWav(file('main/foley.wav'));
assert.deepEqual(swept.samples,complete.samples.subarray(5*rate*2,5*rate*2+swept.samples.length));
function leftOverRight(from,to) {
  let left=0, right=0;
  for (let i=Math.round(from*rate);i<Math.round(to*rate);i++) {
    left+=swept.samples[i*2]**2;
    right+=swept.samples[i*2+1]**2;
  }
  return 10*Math.log10(left/right);
}
assert(leftOverRight(.23,.52)>7);
assert(leftOverRight(1.58,1.85)<-8);
save('rope-beat.json',JSON.parse(cli('beat',moving.source.beatId,'main/report.json','source-sweep/report.json')));
console.log(out);
