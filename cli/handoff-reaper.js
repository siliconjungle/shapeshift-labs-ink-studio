/* REAPER project serialization for the portable Ink handoff. */
const {createHash}=require('node:crypto');
const q=s=>'"'+s+'"'; // All names and relative paths originate in validated Ink IDs.
const dec=n=>Number(n.toFixed(12)).toString();
const color=0x1000000;

function guid(id,tag) {
    const hex=createHash('sha256').update(id+'\0'+tag).digest('hex').slice(0,32).toUpperCase();
    return '{'+[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')+'}';
}

function project(plan,midi,files) {
  const {id,sampleRate:rate,frames,beatsPerBar,routing:{strips,routes,output}}=plan;
  const uid=tag=>guid(id,tag);
  const scoreTracks=Object.entries(midi.tracks).filter(([,row])=>row.messages.length);
  const indexes=new Map(Object.keys(strips).map((name,i)=>[name,i+1]));
  const keys=new Map();
  const wiring=routes.slice();
  for (const [name,strip] of Object.entries(strips)) for (const {sidechain} of strip.inserts) {
    if (!sidechain) continue;
    if (!keys.has(name)) keys.set(name,new Map());
    const key=sidechain.strip+'/'+sidechain.tap, channels=keys.get(name);
    if (!channels.has(key)) {
      const pair=channels.size*2+2;
      channels.set(key,pair);
      wiring.push({from:sidechain.strip,to:name,kind:'sidechain',tap:sidechain.tap,channel:pair});
    }
  }
  for (const [i,[name]] of scoreTracks.entries()) wiring.push({to:name,nativeIndex:1+indexes.size+i,tap:'post',kind:'midi-instrument'});

  function envelope(tag,lane,indent,tagId,extra='') {
    if (!lane || lane.points.length<2) return '';
    const mode=lane.curve==='hold' ? 1 : 0, inner=indent+'  ';
    const points=lane.points[0].sample===0 ? lane.points : [{sample:0,value:lane.points[0].value},...lane.points];
    return indent+'<'+tag+'\n'+inner+'EGUID '+uid(tagId)+'\n'+
      inner+'ACT 1 -1\n'+inner+'VIS 1 1 1\n'+inner+'LANEHEIGHT 0 0\n'+inner+'ARM 0\n'+
      inner+'DEFSHAPE '+mode+' -1 -1\n'+(extra ? inner+extra+'\n' : '')+
      points.map(({sample,value})=>inner+'PT '+dec(sample/rate)+' '+dec(value)+' '+mode+'\n').join('')+
      indent+'>\n';
  }
  function audioItem(file,name,gain=1) {
    return item(name,'      <SOURCE WAVE\n        FILE '+q(file)+'\n      >\n',frames/rate,gain);
  }
  function item(name,source,duration,gain=1) {
    return '    <ITEM\n      POSITION 0\n      LENGTH '+dec(duration)+'\n      LOOP 0\n'+
      '      FADEIN 1 0 0 1 0 0 0\n      FADEOUT 1 0 0 1 0 0 0\n      MUTE 0 0\n      NAME '+q(name)+'\n'+
      '      VOLPAN '+dec(gain)+' 0 1 -1\n      IGUID '+uid('item-'+name)+'\n      GUID '+uid('take-'+name)+'\n'+source+'    >\n';
  }
  function midiItem(name,row) {
    // E events use delta ticks from the previous event on this source.
    let prev=0;
    const events=row.messages.map(({tick,data})=>{
      const line='        E '+(tick-prev)+' '+data.map(x=>x.toString(16).padStart(2,'0')).join(' ')+'\n';
      prev=tick;
      return line;
    }).join('');
    return item(name+' - MIDI',
      '      <SOURCE MIDI\n        HASDATA 1 '+midi.ppq+' QN\n        POOLEDEVTS '+uid('pool-'+name)+'\n'+events+
      '        E '+(row.end-prev+1)+' b0 7b 00\n        CCINTERP 32\n        CHASE_CC_TAKEOFFS 1\n'+
      '        GUID '+uid('midi-'+name)+'\n        IGNTEMPO 0 120 4 4\n      >\n',plan.scoreFrames/rate);
  }
  function track(key,name,{mainsend=0,solo=0,mute=0,gain=1,pan=0,channels=2,inkColor=0}={},body='') {
    return '  <TRACK '+uid('track-'+key)+'\n    NAME '+q(name)+'\n    TRACKID '+uid('track-'+key)+'\n'+
      '    PEAKCOL '+inkColor+'\n    NCHAN '+channels+'\n    VOLPAN '+dec(gain)+' '+dec(pan)+' -1 -1 1\n'+
      '    MUTESOLO '+mute+' '+solo+' 0\n    MAINSEND '+mainsend+' 0\n'+body+'  >\n';
  }
  const tempo='  <TEMPOENVEX\n    EGUID '+uid('tempo')+'\n    ACT 1 -1\n    VIS 1 0 1\n    DEFSHAPE 1 -1 -1\n'+
    midi.tempo.map((row,i)=>'    PT '+dec(row.seconds)+' '+dec(row.tempo)+' 1'+(!i ? ' '+(4*65536+beatsPerBar)+' 0 1' : '')+'\n').join('')+
    '  >\n';
  const markers=plan.markers.map(({id,seconds},i)=>'  MARKER '+(i+1)+' '+dec(seconds)+' '+q(id)+' 0 0 1\n').join('');
  let out='<REAPER_PROJECT 0.1 "7.0" 0 0\n  AUTOXFADE 0\n  PANLAW 1\n  PANMODE 3\n'+
    '  TIMELOCKMODE 0\n  TEMPOENVLOCKMODE 1\n  ZOOM '+Math.max(1,Math.min(110,820*rate/frames)).toFixed(4)+' 0 0\n'+
    '  SAMPLERATE '+rate+' 1 0\n  TEMPO '+dec(midi.tempo[0].tempo)+' '+beatsPerBar+' 4 0\n'+
    '  RENDER_FMT 0 2 0\n  RENDER_RANGE 1 0 0 0 1000\n  <RENDER_CFG\n    ZXZhdxgAAQ==\n  >\n'+tempo+markers;
  out+=track('reference-print','Ink - Master Print',{mainsend:1,solo:2,inkColor:color+0xb69c6b},
    audioItem(files.master,'Master print'));
  for (const [name,strip] of Object.entries(strips)) {
    const incoming=wiring.filter(route=>route.to===name).map((route,i)=>{
      const source=route.nativeIndex ?? indexes.get(route.from);
      const mode=route.tap==='input' ? 1 : route.tap==='pre' ? 3 : 0;
      const gain=route.level?.points.length===1 ? route.level.points[0].value : 1;
      return '    AUXRECV '+source+' '+mode+' '+dec(gain)+' 0 0 0 0 0 '+(route.channel ?? 0)+' -1:U 31 -1 \'\'\n'+
        envelope('AUXVOLENV',route.level,'    ','send-'+name+'-'+i);
    }).join('');
    const controls=envelope('VOLENV2',strip.fader,'    ','volume-'+name,'VOLTYPE 0')+
      envelope('PANENV2',strip.pan,'    ','pan-'+name);
    const audio=Object.hasOwn(files.stems,name) ? audioItem(files.stems[name],name+' - Audio',plan.stemGains[name]) : '';
    out+=track('desk-'+name,name,{mainsend:Number(name===output),
      gain:strip.fader.points.length===1 ? strip.fader.points[0].value : 1,
      pan:strip.pan.points.length===1 ? strip.pan.points[0].value : 0,
      channels:2+2*(keys.get(name)?.size ?? 0),inkColor:color+(audio ? 0xa58e56 : 0x8a958c)},
      incoming+controls+audio);
  }
  for (const [name,row] of scoreTracks) out+=track('score-'+name,name+' - MIDI',{mute:1,inkColor:color+0x8e9fca},midiItem(name,row));
  return out+'>\n';
}
module.exports={project,guid,dec};
