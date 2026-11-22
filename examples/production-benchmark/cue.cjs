const assert=require('node:assert/strict');
const {path,A,WAV,json,rate,wav,pair,copyStock}=require('./support.cjs');
const reed=require('../music-production/split-reed.cjs');
const note=(beat,duration,midi,velocity,play)=>({beat,duration,midi,velocity,...(play && {play})});
const pitchShape=(index,open)=>({articulation:'steady',vibrato:[13,6,21,14][index%4],
  curves:{pitchCents:[[0,[-38,14,-27,8][index%4]],[.25,4],[.67,0],[1,-12]],
    amplitude:[[0,.34],[.21,open ? .96 : .73],[.69,1],[1,.57]],
    pressure:[[0,.23],[.31,.67],[.76,.79],[1,.22]],
    breath:[[0,.61],[.24,.26],[.73,.23],[1,.68]]}});
const call=[[1.16,.75,74,.65],[2.12,1.02,77,.76],[3.77,.49,76,.64],[5.17,1.54,69,.71]];
const length=144;
const sections=[
  ['soundings',[38,45,50,53]],[ 'undertow',[34,41,48,50]],[ 'current',[41,48,53,57]],
  ['undertow-far',[36,43,50,55]],['weir',[31,43,46,53]],['empty-channel',[33,45,52,55]],
  ['return',[38,45,52,53]],['sluice',[34,46,48,53]],['last-light',[38,45,50,52]]
];
const roles={reed:'lead',piano:'pad',bass:'bass',metal:'percussion',kick:'percussion',air:'pad'};
const phrases={
  1:[[.7,1.52,72,.55],[2.95,.86,67,.47],[5.4,2.33,69,.50]],
  2:[[.18,.63,74,.53],[1.31,.64,76,.57],[2.67,.93,77,.69],[4.48,1.55,79,.63],[7.19,1.81,76,.49]],
  3:[[.64,1.61,72,.48],[4.34,1.23,74,.55],[6.2,.52,77,.67],[7.02,2.12,81,.56]],
  4:[[.3,.75,82,.63],[1.78,2.6,81,.53],[5.04,.43,77,.52],[6.4,.78,76,.55],[8.56,2.97,67,.55]],
  5:[[.8,2.9,69,.49],[11.38,.73,73,.39]],7:[[.1,1.34,82,.65],[2.28,1.34,81,.71],[5.32,1.31,84,.64],[8.91,1.76,79,.60]],
  8:[[.79,.9,77,.51],[4.32,.53,76,.49],[6.09,3.48,74,.53],[11.1,1.9,62,.34]]
};
function score(revised) {
  const tracks=Object.fromEntries(Object.keys(roles).map(id=>[id,[]]));
  const add=(id,voice,rows)=>{
    let slot=tracks[id].find(row=>row.id===voice);
    if (!slot) {slot={id:voice,notes:[]};tracks[id].push(slot);}
    slot.notes.push(...rows.map(row=>({...row,id:voice+'-'+slot.notes.length+'-'+row.beat.toString().replace('.','-')})));
  };
  const melody=(base,rows,open=false)=>add('reed','solo',rows.map(([beat,gate,midi,velocity],i)=>
    note(base+beat,gate,midi,velocity,pitchShape(i,open))));
  melody(0,call);
  for (const [section,[name,chord]] of sections.entries()) {
    const at=section*16;
    if (phrases[section]) melody(at,phrases[section],revised && section>=4);
    if (section===6) melody(at,revised ? call.concat([[8.43,.95,72,.68],[10.17,.77,77,.65],[11.57,2.83,81,.72]]) :
      call.concat([[8.03,.75,74,.65],[9.12,1.02,77,.76],[10.77,.49,76,.64],[12.17,1.54,69,.71]]),revised);
    const sparse=section===0 || section===5 || section===8;
    for (const [voice,pitch] of chord.slice(1).entries()) {
      const rising=(section+voice)%3===0, fade=section===8 ? .55 : .78;
      const first=section===6 && revised ? (voice===0 ? 5.64 : 2.12+voice*.84) : section===0 ? 2.55+voice*.74 : .28+voice*.37;
      add('piano','voice-'+voice,[
        note(at+first,Math.min(4.2,7.8-first),pitch+12,.37+voice*.035,{brightness:.43}),
        note(at+8.2+voice*.43,3.2+voice*.41,pitch+12+(rising?12:0),.38*fade,{brightness:.37+voice*.09})
      ]);
    }
    if (section!==0) for (const [i,b] of (sparse ? [3.11,10.26] :
        section===6 && revised ? [5.66,7.63,10.76,13.44] : [.14,2.73,5.42,7.18,8.08,10.84,13.56,15.1]).entries()) {
      add('bass','line',[note(at+b,sparse?1.66:i%3===0?.86:.62,chord[0]+(i%4===2?7:0),
        (.63+(i%3)*.065)*(sparse?.63:1),{brightness:.3+i%2*.19})]);
    }
    if (section>0 && section<8 && !(section===5 && revised)) {
      const strikes=section===6 && revised ? [4.92,7.48,9.48,13.31] : [2.42,6.85,9.13,11.72,14.52];
      add('metal','hits',strikes.map((b,i)=>note(at+b,.12,53+(i%3)*2,[.48,.63,.36,.53,.40][i])));
    }
    if ((!sparse && section>=2) || (section===5 && !revised)) {
      const pulse=section===6 && revised ? [5.66,9.02,11.48,13.45,15.17] : [.14,3.08,6.42,8.1,11.0,13.59,15.12];
      add('kick','hits',pulse.map((b,i)=>note(at+b+(i%2)*.024,.13,36,[.73,.49,.62,.73,.45,.59,.52][i])));
    }
    if (section!==0) add('air','held',[note(at+(section===6 && revised?6.05:1.8),section===6 && revised?8.95:11.9,
      chord[1]+12,section===5?.32:.46,{curves:{amplitude:[[0,.07],[.35,.71],[.68,1],[1,.04]]}})]);
  }
  return {seed:51,arrangement:{score:{tempoMap:{tempo:96},key:{root:'D3',mode:'minor'},endFade:.19,harmonies:{key:{root:'D3',quality:'minor'}}},
    parts:Object.fromEntries(Object.entries(roles).map(([id,role])=>[id,{role}])),motifs:{},
    sections:sections.map(([id])=>({id,bars:4,harmony:'key'}))},
    patches:{
      reed:{...reed,echo:{delay:.469,feedback:.32,damping:.54,send:.2,width:.83}},
      piano:{type:'keys',tine:.61,bite:.24,dust:.07,wear:.41,env:{attack:.014,decay:.94,sustain:.22,release:.87}},
      bass:{type:'subtractive',saw:.23,pulse:.16,sub:.78,filter:{cutoff:323,keyTrack:.22,envAmount:19},
        env:{attack:.025,decay:.37,sustain:.54,release:.26}},
      metal:{type:'sample',zones:[{samples:['metal-soft','metal-alt','metal-hit'],root:57,levels:[1,.7,.55]}]},
      kick:{type:'drum',kind:'kick',tune:43,sweep:81,decay:.16,click:.16},
      air:{type:'fm',ratio:1.996,index:.27,env:{attack:.81,decay:1.5,sustain:.62,release:1.34}}
    },tracks:Object.fromEntries(Object.keys(tracks).map((id,i)=>[id,{
      patch:id,gain:[-10,-16,-13,-18,-15,-23][i],pan:[.025,-.19,0,.26,0,.27][i],
      send:[.30,.50,.02,.37,0,.55][i],clips:[{id:id+'-part',beat:0,length,voices:tracks[id],
        ...(roles[id]==='percussion' && {mode:'layer'})}]
    }])),room:{gain:-6.6,size:1.6,decay:1.52,damping:.67}};
}
module.exports=function cue(folder) {
  const assets=copyStock(folder,['metal-soft','metal-alt','metal-hit']);
  const bank=Object.fromEntries(Object.entries(assets).map(([id,ref])=>[id,WAV.read(path.join(folder,ref))]));
  const editor=A.musicSession.create(bank);
  const results=[false,true].map((revised,index)=>{
    const session={format:'ink-studio/music-edit-session',version:1,id:revised?'water-revised':'water-first',sampleRate:rate,
      production:score(revised),mixer:{output:'master',strips:{master:{fader:1.31}},tail:'cut',peakPolicy:'error'}};
    const id=index?'revised':'previous';
    json(path.join(folder,id+'.session.json'),{session,assets});
    const result=editor.render(session);
    assert.equal(result.value.samples.length,90*rate*2);
    wav(path.join(folder,id+'.print.wav'),result.value);
    const notes=editor.inspect(session).lanes.reed.takes.reference;
    return {audio:result.value,opening:notes.slice(0,4).map(({time,midi})=>({time,midi})),
      return:notes.filter(row=>row.beat>=96 && row.beat<103).map(({time,midi})=>({time,midi}))};
  });
  assert.deepEqual(results[0].opening,results[1].opening);
  assert.deepEqual(results[1].opening.map(row=>row.midi),results[1].return.map(row=>row.midi));
  assert(Math.abs(results[1].return[0].time-results[1].opening[0].time-60)<1e-6);
  const levels=pair(folder,...results.map(row=>row.audio));
  const evidence={durationSeconds:90,opening:results[1].opening,return:results[1].return,levels,
    sessions:['previous.session.json','revised.session.json'],sources:Object.values(assets)};
  json(path.join(folder,'report.json'),evidence);
  return evidence;
};
