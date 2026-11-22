const WAV=require('./wav.js');
const {catalog,describe}=require('./music-sound-library.js');
const {isSoundRecipe,readSoundDocument}=require('./sound-source.js');

const stockTags={
  'recorded-reed':['Recorded Harmonica','lead','reed acoustic key-up vibrato'],
  'breathing-reed':['Breathing Harmonica','lead','reed air modelled'],
  'expressive-reed':['Expressive Harmonica','lead','reed legato breath pressure'],
  'brake-drum':['Brake Drum','metal','percussion hard struck iron'],
  'scraped-metal':['Scraped Metal','metal','percussion cymbal gong bell texture'],
  'tuned-metal':['Tuned Metal','metal','percussion resonant pitched modal'],
  'expressive-plate':['Expressive Plate','metal','percussion cymbal bell room velocity'],
  kick:['Acoustic Kick','kick','drum percussion round beater live'],
  snare:['Acoustic Snare','snare','drum percussion rim ghost live'],
  'closed-hat':['Closed Hi-Hat','hat','drum percussion tight live'],
  'open-hat':['Open Hi-Hat','hat','drum percussion ringing live'],
  'electric-bass':['Electric Bass','bass','fingered picked live']
};
const modeled=[
  {id:'rubber-kick',title:'Rubber Kick',roles:['kick'],tags:'drum percussion electronic soft round sub short',
    patch:{type:'drum',kind:'kick',tune:49,decay:.18,sweep:37,click:.025,color:.28}},
  {id:'circuit-kick',title:'Circuit Kick',roles:['kick'],tags:'drum percussion electronic hard punch click tight',
    patch:{type:'drum',kind:'kick',tune:57,decay:.135,sweep:193,click:.44,color:.78}},
  {id:'low-kick',title:'Low Kick',roles:['kick'],tags:'drum percussion electronic sub deep long tail',
    patch:{type:'drum',kind:'kick',tune:40,decay:.55,sweep:34,click:.015,color:.29}}
];
const lab='Ink Instruments';
const reference='reference', exampleRate=8000, exampleFrames=4096;
const pretty=id=>id.replace(/[-_]+/g,' ').replace(/\b[a-z]/g,c=>c.toUpperCase());
const pitch={kick:36,snare:38,hat:42,metal:54,bass:36,lead:64,pad:60,keys:60,percussion:48};
const terms=value=>value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const roleFor=(lane,track,part,patch)=>{
  const names=terms([lane,track?.patch,part?.voice?.instrument,patch?.kind].filter(Boolean).join(' '));
  return ['kick','snare','hat','bass','metal','keys'].find(role=>names.includes(role)) ??
    (patch?.type==='keys' ? 'keys' : part?.role ?? '');
};
const get=(table,key)=>Object.hasOwn(table ?? {},key) ? table[key] : undefined;
const boundedName=(stem,taken)=>{
  let name=stem.slice(0,48),suffix=1;
  while (taken(name)) {
    const end='-'+(++suffix);
    name=stem.slice(0,48-end.length)+end;
  }
  return name;
};

function createSoundBrowser(P,assets,paths) {
  const I=P.musicInstruments,{check,fields,id}=I, stockAssets=new Map(), aliasByFile=new Map(), cached=new WeakMap();
  for (const [name,file] of Object.entries(paths)) aliasByFile.set(file,name);
  const reserved=new Set(Object.keys(assets));
  const stock=[...modeled.map(row=>({...row,group:lab})),...catalog.flatMap(pack=>{
    const {patches,sources}=describe(pack.id);
    return Object.entries(patches).map(([key,patch])=>{
      const [title,role,tags]=stockTags[key] ?? [pretty(key),'',''];
      return {id:'stock-'+key,title,roles:role ? [role] : [],tags,group:pack.title,patch,sources};
    });
  })];
  const recipes=Object.entries(paths).filter(([name,file])=>Object.hasOwn(assets,name) && isSoundRecipe(file)).map(([name,file])=>{
    const recipe=P.mediaGraph.soundRecipe.normalize(readSoundDocument(file));
    return {id:'recipe-'+name,title:pretty(name),roles:['effect'],tags:'seeded one-shot '+recipe.family,
      group:'Session sound recipes',recipe,patch:{type:'sample',zones:[{samples:[name]}]}};
  });
  const rowsIn=context=>[...context.project,...stock,...recipes];
  function sourcesIn(session,lane,source) {
    const base=session.production, revision=source===reference ? {} : get(session.takes,source);
    const tracks={...base.tracks};
    for (const [name,row] of Object.entries(revision?.tracks ?? {})) tracks[name]={...tracks[name],...row};
    const patches={...base.patches,...revision?.patches}, track=get(tracks,lane);
    check(track && revision && get(patches,track.patch)?.type!=='clap','Choose a native score lane and source take');
    const arrangement=base.arrangement.definition ?? base.arrangement, parts=arrangement.parts;
    const currentRole=roleFor(lane,track,parts[lane],patches[track.patch]);
    const project=Object.entries(patches).filter(([,patch])=>patch.type!=='clap').map(([name,patch])=>{
      const descriptions=Object.entries(tracks).filter(([,track])=>track.patch===name)
        .map(([lane,track])=>roleFor(lane,track,parts[lane],patch));
      return {id:'session-'+name,title:pretty(name),roles:[...new Set(descriptions.filter(Boolean))],
        tags:name+' '+patch.type,group:'This session',patch};
    });
    return {track,patches,revision,currentRole,project,current:project.find(row=>row.id==='session-'+track.patch)};
  }
  function options(session,state,lane) {
    const {tracks,patches}=session.production;
    const lanes=Object.keys(tracks).filter(name=>patches[tracks[name].patch].type!=='clap' && state.pins?.[name]!=='all');
    if (!lane || !lanes.includes(lane)) lane=lanes.at(0);
    if (!lane) return {lanes,sources:[]};
    const sources=[reference,...Object.keys(session.takes ?? {})];
    const overlaps=state.comp.filter(row=>row.lane===lane && row.from<state.loop.to && row.to>state.loop.from);
    const whole=overlaps.length===1 && overlaps[0].from<=state.loop.from && overlaps[0].to>=state.loop.to &&
      (!overlaps[0].fadeSamples || overlaps[0].from+overlaps[0].fadeSamples<=state.loop.from &&
        overlaps[0].to-overlaps[0].fadeSamples>=state.loop.to);
    const source=state.lanes[lane]?.take ?? (whole ? overlaps[0].take : overlaps.length ? '' : reference);
    return {lanes,lane,sources,source,role:sourcesIn(session,lane,source || reference).currentRole};
  }
  function asset(row,name) {
    if (!row.sources) return get(assets,name);
    const file=row.sources[name].file;
    if (!stockAssets.has(file)) stockAssets.set(file,WAV.read(file));
    return stockAssets.get(file);
  }
  function features(signal) {
    let peak=0,rise=0;
    for (let i=0;i<signal.length;i++) if (Math.abs(signal[i])>peak) {peak=Math.abs(signal[i]);rise=i;}
    if (peak<1e-5) return null;
    const first=signal.findIndex(x=>Math.abs(x)>peak*.016);
    const offset=Math.max(0,first-8);
    const probe=Float64Array.from({length:exampleFrames},(_,i)=>(signal[i+offset] ?? 0)/peak);
    const pcm={sampleRate:exampleRate,channels:1,samples:probe};
    const {spectrum}=P.mediaGraph.fft(pcm,{time:.256,fps:1/.512,size:exampleFrames,window:'rect'});
    const limits=[35,75,130,240,480,960,1920,4001], energy=limits.map(()=>0);
    for (let bin=1,band=0;bin<spectrum.data.length;bin++) {
      while (bin*exampleRate/exampleFrames>limits[band]) band++;
      energy[band]+=spectrum.data[bin]**2;
    }
    const total=energy.reduce((a,b)=>a+b,0);
    if (total<1e-12) return null;
    let early=0,late=0;
    for (let i=0;i<probe.length;i++) {
      if (i<640) early+=probe[i]**2;
      else late+=probe[i]**2;
    }
    return [...energy.map(value=>Math.sqrt(value/total)),.5*late/(early+late),.2*Math.min(1,Math.max(0,rise-first)/640)];
  }
  function timbre(row,role) {
    const midi=pitch[role || row.roles[0]] ?? 60;
    if (!cached.has(row.patch)) cached.set(row.patch,new Map());
    const notes=cached.get(row.patch);
    if (!notes.has(midi)) {
      const {performance,echo,gestures,...raw}=row.patch;
      const bank=Object.fromEntries(I.assetNames(raw).map(name=>[name,asset(row,name)]));
      const player=I.compile(raw,bank);
      const voice=player.prepare({midi,frequency:I.hz(midi),velocity:.76,play:{},roundRobin:0,salt:9121},exampleRate,.24);
      const signal=Float64Array.from({length:exampleFrames},(_,n)=>{
        const at=n/exampleRate;
        if (at>=voice.duration) return 0;
        const left=voice.signal(at,n,0);
        return voice.stereo ? .5*(left+voice.signal(at,n,1)) : left;
      });
      notes.set(midi,features(signal));
    }
    return notes.get(midi);
  }
  function search(session,state,query) {
    check(fields(query,['lane','source','role','query','sample']) &&
      typeof (query.query ?? '')==='string' && (query.query ?? '').length<=120 &&
      typeof (query.role ?? '')==='string' && (query.role ?? '').length<=40,'Invalid sound search');
    const view=options(session,state,query.lane);
    if (!view.lane) return view;
    const context=sourcesIn(session,view.lane,query.source || view.source || reference);
    const rows=rowsIn(context), requested=query.sample;
    const roles=[...new Set(rows.flatMap(row=>row.roles))].sort();
    let example;
    if (requested==='current') example=timbre(context.current,context.currentRole);
    else if (requested!==undefined) {
      check(typeof requested==='string' && requested.length<=11000 && /^[a-z0-9+/]+={0,2}$/i.test(requested),
        'Use a short WAV sound example');
      const bytes=Buffer.from(requested,'base64');
      check(bytes.length>=128 && bytes.length<=exampleFrames*2 && bytes.length%2===0,'Use a short WAV sound example');
      example=features(Float64Array.from({length:bytes.length/2},(_,i)=>bytes.readInt16LE(i*2)/32768));
    }
    check(requested===undefined || example,'The sound example has no audible signal');
    const role=query.role ?? '', tokens=terms(query.query ?? '');
    const results=rows.filter(row=>{
      const tags=terms([row.id,row.title,row.group,row.tags,...row.roles].join(' '));
      return (!role || row.roles.includes(role)) && tokens.every(word=>tags.some(tag=>tag.startsWith(word)));
    }).map(row=>{
      const comparison=example && timbre(row,role);
      const distance=comparison ? example.reduce((sum,value,i)=>sum+(value-comparison[i])**2,0) : Infinity;
      const preferred=row.roles.includes(context.currentRole);
      return {id:row.id,title:row.title,roles:row.roles,group:row.group,...(row.recipe && {recipe:true}),distance,preferred};
    }).sort((a,b)=>(example ? a.distance-b.distance || 0 : 0) ||
      Number(b.preferred)-Number(a.preferred) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return {...view,roles,results:results.map(({distance,preferred,...row})=>row)};
  }
  function choose(session,{lane,source,id:which}) {
    check(id(lane) && (source===reference || get(session.takes,source)) && typeof which==='string','Choose a source take and a sound');
    const context=sourcesIn(session,lane,source);
    const row=rowsIn(context).find(row=>row.id===which);
    check(row,'Unknown sound');
    return {context,row};
  }
  function candidate(session,args) {
    const {lane}=args, {context,row}=choose(session,args);
    const revision=structuredClone(context.revision), patch=structuredClone(row.patch);
    // Stock WAVs can share names with user recordings. Keep references distinct.
    const names=new Map(), additions=[];
    if (row.sources) for (const key of new Set(I.assetNames(row.patch))) {
      const file=row.sources[key].file;
      if (!aliasByFile.has(file)) {
        const name=boundedName('stock-'+key,name=>reserved.has(name) || Object.hasOwn(assets,name));
        reserved.add(name);
        aliasByFile.set(file,name);
      }
      const name=aliasByFile.get(file);
      names.set(key,name);
      if (!Object.hasOwn(assets,name)) additions.push({name,file,pcm:asset(row,key)});
    }
    if (names.size) {
      const rename=value=>{
        if (!value || typeof value!=='object') return;
        if (Array.isArray(value.samples)) value.samples=value.samples.map(name=>names.get(name) ?? name);
        for (const row of Object.values(value)) rename(row);
      };
      rename(patch);
    }
    const signature=JSON.stringify(patch);
    const key=row.id.startsWith('session-') ? row.id.slice('session-'.length) :
      boundedName(terms(row.title).join('-'),name=>Object.hasOwn(context.patches,name) &&
        JSON.stringify(context.patches[name])!==signature);
    if (!Object.hasOwn(context.patches,key)) revision.patches={...revision.patches,[key]:patch};
    revision.tracks={...revision.tracks,[lane]:{...revision.tracks?.[lane],patch:key}};
    return {revision,additions,title:row.title};
  }
  function isolated(session,args,settings) {
    const {context,row}=choose(session,args);
    if (row.recipe) return {title:row.title,source:{kind:'recipe',recipe:row.recipe},settings:{}};
    const {performance,echo,gestures,...patch}=row.patch;
    const bank=Object.fromEntries([...new Set(I.assetNames(patch))].map(name=>[name,asset(row,name)]));
    const role=row.roles.find(role=>role===context.currentRole) ?? row.roles[0];
    return {title:row.title,source:{kind:'instrument',patch},assets:bank,
      settings:{midi:pitch[role] ?? 60,velocity:.76,gate:.24,roundRobin:0,seed:9121,sampleRate:session.sampleRate,...settings}};
  }
  const nameTake=(session,which)=>boundedName('sound-'+which.replace(/^(stock|session)-/,''),name=>Object.hasOwn(session.takes ?? {},name));
  return {search,candidate,isolated,nameTake};
}

module.exports={createSoundBrowser};
