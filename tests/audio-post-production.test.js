const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {KIT}=require('..').load(), P=KIT.procedural, A=P.mediaGraph, Q=A.postProduction, E=A.audioEditorial;
const WAV=require('../cli/wav.js'), Reaper=require('../cli/post-reaper.js');
const rate=8000;
const take=(asset,sync=500)=>({asset,sync:{sample:sync},fromSample:300,toSample:1100});
const tone=(frames=1800,hz=210,gain=.24)=>({sampleRate:rate,channels:1,
  samples:Float64Array.from({length:frames},(_,i)=>Math.sin(2*Math.PI*hz*i/rate)*gain)});
const session={format:'ink-studio/audio-editorial',version:1,id:'post-round-trip',sampleRate:rate,
  picture:{fps:{numerator:24000,denominator:1001},startFrame:5,
    shots:[{id:'approach',inFrame:8,frames:12},{id:'gate',inFrame:27,frames:36}]},
  clips:[{id:'line',track:'dialogue',spot:{shot:'gate',sourceFrame:32},
    take:'guide',takes:{guide:take('guide')}},
    {id:'hinge',track:'foley',spot:{shot:'gate',sourceFrame:40},take:'metal',takes:{metal:take('metal')}},
    {id:'temp',track:'effects',spot:{shot:'approach',sourceFrame:9},take:'noise',takes:{noise:take('guide')}}]};
const guide=tone(), metal=tone(1800,500), stock={guide,metal};
const relinks={recordings:[
  {id:'boom',asset:'poly',kind:'boom',scene:'24C',take:'02',channels:[0]},
  {id:'lav',asset:'poly',kind:'lav',scene:'24C',take:'02',channels:[1]},
  {id:'adr',asset:'adr-file',kind:'adr',scene:'24C',take:'08',anchors:{delivery:874}},
  {id:'outtake',asset:'adr-file',kind:'lav',scene:'24C',take:'04',anchors:{delivery:230}}
],links:[{clip:'line',scene:'24C',take:'02',recorderSample:'100600',anchor:'delivery',alternates:['adr'],
  handles:256,prefer:'boom'}]};

test('SCENE and TAKE relink separates polyphonic boom and lav and aligns externally marked ADR',()=>{
  const poly={...guide,channels:2,bwf:{timeReference:'100000'},samples:
    Float64Array.from({length:guide.samples.length*2},(_,i)=>i%2===0 ? guide.samples[i>>1] : metal.samples[i>>1])};
  const result=Q.relink(session,{...stock,poly,'adr-file':tone(2100,146)},relinks);
  const linked=result.report.links[0];
  assert.equal(linked.selected,'boom');
  assert.deepEqual(linked.alternates.map(({id,sourceSample,alignment})=>[id,sourceSample,alignment]),
    [['boom',600,'broadcast-wave'],['lav',600,'broadcast-wave'],['adr',874,'marked']]);
  assert.deepEqual(result.assets['rec-boom'].samples,guide.samples);
  assert.deepEqual(result.assets['rec-lav'].samples,metal.samples);
  const line=result.value.clips[0];
  assert.deepEqual(line.takes.guide,session.clips[0].takes.guide);
  assert.equal(line.takes.adr.fromSample,674);
  const options=['boom','lav','adr'].map(name=>E.revise(result.value,result.assets,[{op:'take',clip:'line',take:name}]).report.clips[0]);
  assert(options.every(row=>row.spot.sample===options[0].spot.sample&&row.range.fromSample===options[0].range.fromSample));
  const rerun=Q.relink(result.value,result.assets,{...relinks,links:[{...relinks.links[0],take:'missing',prefer:undefined,
    alternates:[]}]});
  assert.equal(rerun.report.links[0].issues[0].reason,'scene-take-not-found');
  assert.equal(rerun.value.clips[0].take,'boom');
});

test('post review exposes lost anchors, moved clips, and retained sample nudges at a fractional frame rate',()=>{
  const nudged=E.revise(session,stock,[{op:'nudge',clip:'hinge',offsetSamples:21}]).value;
  const revision={picture:{...session.picture,shots:[{id:'approach',inFrame:11,frames:9},session.picture.shots[1]]}};
  const result=Q.reviewPicture(nudged,stock,revision), {changes,attention,picture}=result.report;
  assert.equal(changes.find(row=>row.id==='temp').after.issue,'source-frame-trimmed');
  assert.deepEqual(attention,[{clip:'temp',reason:'source-frame-trimmed',action:'respots-or-remove'}]);
  assert.equal(picture[0].change,'trimmed');
  assert.equal(picture[1].change,'moved');
  assert.equal(changes.find(row=>row.id==='line').status,'moved');
  const hinge=changes.find(row=>row.id==='hinge');
  assert.equal(hinge.after.sample,hinge.after.anchorSample+21);
  assert.equal(hinge.after.sourceFrame,40);
  const print=E.render(result.session,stock,{stems:true,allowUnresolved:true});
  assert(Q.verify(print.value,print.stems).maxError<1e-12);
  const fractionFrames={...session,clips:[{...session.clips[0],spot:{frame:0},offsetSamples:667}]};
  const spot=E.inspect(fractionFrames,stock).clips[0].spot;
  assert.equal(spot.frame,2);
});

test('matched tone stays on its sample grid and approaches the quiet reference level across loop joins',()=>{
  const source=tone(1600,135,.013), reference=tone(1200,240,.036);
  const settings={donor:{fromSample:100,toSample:1300},reference:{fromSample:0,toSample:1200},
    frames:7400,crossfadeSamples:210,seed:93};
  const result=Q.matchRoom(source,reference,settings);
  assert.equal(result.value.samples.length,7400);
  assert.equal(result.value.sampleRate,rate);
  assert(Math.abs(result.report.referenceDbFS-result.report.outputDbFS)<.01);
  assert(result.report.bandGainDb.some(value=>Math.abs(value)>.02));
  assert.deepEqual(Q.matchRoom(source,reference,settings),result);
  let jump=0;
  for (let i=1;i<settings.frames;i++) jump=Math.max(jump,Math.abs(result.value.samples[i]-result.value.samples[i-1]));
  assert(jump<.012);
});

function capture(manifest,folder) {
  return {format:'ink-studio/reaper-editorial-capture',version:1,application:'test fixture',project:path.join(folder,'edit.rpp'),
    tracks:manifest.tracks.map(track=>({guid:track.guid,gain:1,pan:0,mute:0,polarity:0,width:1,solo:0,
      fx:0,envelopes:0,sends:0,faderLaw:-1,mainSend:track.mainSend})),
    items:manifest.items.map(row=>({guid:row.guid,track:row.track,take:row.takes.find(take=>take.id===row.active).guid,
      takes:row.takes.map(take=>take.guid),file:row.takes.find(take=>take.id===row.active).file,
      position:row.first/rate,length:row.frames/rate,itemGain:1,mute:0,allTakes:0,loop:0,fadeIn:0,
      fadeOut:0,autoIn:-1,autoOut:-1,offset:0,rate:1,takeGain:1,pan:0,pitch:0,channelMode:0,fx:0,envelopes:0}))};
}

test('REAPER return applies addressed take and Foley offsets without replacing exact Ink state',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ink-post-'));
  try {
    const folder=path.join(directory,'handoff'), files=Object.fromEntries(Object.entries(stock).map(([name,pcm])=>{
      const file=path.join(directory,name+'.wav');
      fs.writeFileSync(file,WAV.encode(pcm,{encoding:'float64'}));
      return [name,file];
    }));
    const initial=E.revise(session,stock,[{op:'put-take',clip:'line',take:'inner',source:take('metal',620)},
      {op:'comp',clip:'line',ranges:[{take:'inner',fromOffset:12,toOffset:60,fadeSamples:12}]}]).value;
    Reaper.publish(P,initial,stock,files,{},folder);
    const manifest=Reaper.read(path.join(folder,'handoff.json')), returned=capture(manifest,folder);
    assert.deepEqual(Reaper.read(path.join(folder,'ink/project.json')).session,initial);
    assert.equal(manifest.reference.placement.frames,manifest.frames);
    assert(manifest.reference.verification.maxError<=manifest.reference.verification.quantizationBound);
    assert.match(fs.readFileSync(path.join(folder,'edit.rpp'),'utf8'),/^      TAKE$/m);
    assert.deepEqual(Reaper.addressed(P,folder,returned).session,initial);

    const item=manifest.items.find(row=>row.clip==='line'), alternate=item.takes.find(row=>row.id==='inner');
    const target=returned.items.find(row=>row.guid===item.guid);
    Object.assign(target,{take:alternate.guid,file:alternate.file});
    const hinge=manifest.items.find(row=>row.clip==='hinge');
    returned.items.find(row=>row.guid===hinge.guid).position+=27/rate;
    const applied=Reaper.addressed(P,folder,returned);
    assert.deepEqual(applied.changes,[
      {op:'comp',clip:'line',ranges:[]},{op:'take',clip:'line',take:'inner'},{op:'nudge',clip:'hinge',offsetSamples:27}]);
    assert.deepEqual(applied.session.clips[1].spot,session.clips[1].spot);
    assert.equal(applied.log.find(row=>row.clip==='hinge').syncSample,hinge.syncSample+27);
    const moved=path.join(directory,'relocated');
    fs.renameSync(folder,moved);
    assert.deepEqual(Reaper.addressed(P,moved,returned).changes,applied.changes);
    fs.renameSync(moved,folder);

    target.fadeIn=.01;
    assert.throws(()=>Reaper.addressed(P,folder,returned),/trim, fade/);
    target.fadeIn=0;
    fs.appendFileSync(path.join(folder,alternate.file),Buffer.from([14]));
    assert.throws(()=>Reaper.addressed(P,folder,returned),/media changed/);
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
