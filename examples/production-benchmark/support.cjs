const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), {execFileSync}=require('node:child_process');
const ink=require('../..'), {KIT}=ink.load(), P=KIT.procedural, A=P.mediaGraph, M=KIT.music.production;
const WAV=require('../../cli/wav.js'), {write,json}=require('../../cli/asset-files.js');
const rate=32000, tau=2*Math.PI;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const wav=(file,pcm)=>write(file,WAV.encode(pcm,{encoding:'pcm24'}));
const frames=(seconds,fn,channels=1,sampleRate=rate)=>({sampleRate,channels,samples:Float64Array.from(
  {length:Math.round(seconds*sampleRate)*channels},(_,i)=>fn(Math.floor(i/channels)/sampleRate,i%channels))});
const tone=(hz,t)=>Math.sin(tau*hz*t);
function noise(seed) {
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
}
const cli=(folder,...args)=>execFileSync(process.execPath,[path.resolve(__dirname,'../../cli/ink-studio.js'),...args],
  {cwd:folder,encoding:'utf8',maxBuffer:4*1024*1024});
const match=waves=>P.adaptiveRehearsalEvidence.matched(waves,-18,-1.5);
const measure=pcm=>{
  const {lufs,truePeak}=M.meters(pcm,true);
  return {frames:pcm.samples.length/pcm.channels,sampleRate:pcm.sampleRate,lufs,
    truePeakDb:Number((20*Math.log10(truePeak)).toFixed(3))};
};
function pair(folder,baseline,revision) {
  const layout=({sampleRate,channels,samples})=>[sampleRate,channels,samples.length];
  assert.deepEqual(layout(baseline),layout(revision),'Comparison clocks must match');
  const matched=match([baseline,revision]);
  const levels=matched.map(({value,playback})=>({...playback,...measure(value)}));
  assert(levels.every(row=>Number.isFinite(row.lufs) && row.truePeakDb<=-1.49),'Audition must be audible and within its ceiling');
  assert(Math.abs(levels[0].lufs-levels[1].lufs)<.25,'Audition gain mismatch');
  for (const [i,id] of ['previous','revised'].entries()) wav(path.join(folder,id+'.wav'),matched[i].value);
  return levels;
}
function copyStock(folder,names) {
  return Object.fromEntries(names.map(id=>{
    const dest='recordings/'+id+'.wav';
    write(path.join(folder,dest),fs.readFileSync(path.join(__dirname,'../music-production/samples',id+'.wav')));
    return [id,dest];
  }));
}
module.exports={fs,path,ink,KIT,A,M,WAV,write,json,read,rate,wav,frames,tone,noise,cli,match,measure,pair,copyStock};
