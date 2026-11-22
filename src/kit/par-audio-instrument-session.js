/* Build native multisampled and fitted instruments from related takes. */
(function (P) {
  const A=P.mediaGraph,S=P.mediaGraphSupport,I=P.musicInstruments;
  const {check,fields,record,id,integer,finite}=I, {clock,proposals,energy,bounded,round,median}=S.instrumentSessionAnalysis;
  const format='ink-studio/session-instrument', noteRange=(lo,hi)=>[round(lo,6),round(hi,6)];

  function build(session,assets,options={}) {
    check(fields(options,['perspective','body','fit','fill','alternates']) &&
      ['hybrid','recorded'].includes(options.body ?? 'hybrid') &&
      ['auto','modal','spectral'].includes(options.fit ?? 'auto') &&
      ['nearest','none'].includes(options.fill ?? 'nearest') && integer(options.alternates ?? 3,1,3),
    'Choose a body, fitting method, alternate count, and missing-cell policy');
    const {body='hybrid',fit='auto',fill='nearest',alternates=3}=options;
    const analysis=proposals(session,assets), resolved=analysis.value, model=clock(resolved,assets);
    const {rate,slice}=model, perspective=options.perspective ?? model.perspective;
    check(Object.hasOwn(model.mics,perspective),'Unknown build perspective');
    const rows=analysis.report.takes, marks=new Map(resolved.takes.map(row=>[row.id,row]));
    const rendered={}, instruments={}, zones=[], cover=[], bodies=new Map();
    function bake(name,from,to,fadeIn,fadeOut) {
      const source=slice(perspective,from,to), n=to-from;
      rendered[name]={...source,samples:Float64Array.from(source.samples,(x,i)=>{
        const at=Math.floor(i/source.channels);
        return x*Math.min(1,at/Math.max(1,fadeIn),(n-1-at)/Math.max(1,fadeOut));
      })};
      return name;
    }
    function fitCell(cell,notes,index) {
      const id='voice-'+(index+1), levels=notes.map(row=>row.bodyRms), center=median(levels);
      const brightness=median(notes.map(row=>row.brightness)), clipped=row=>row.flags.includes('near-full-scale');
      const clean=notes.filter(row=>!clipped(row)), eligible=clean.length ? clean : notes;
      const sorted=eligible.slice().sort((a,b)=>Math.abs(a.bodyRms-center)+.15*Math.abs(a.brightness-brightness)-
        Math.abs(b.bodyRms-center)-.15*Math.abs(b.brightness-brightness) || a.id.localeCompare(b.id));
      const representative=body==='recorded' ? sorted.find(row=>marks.get(row.id).loop) ?? sorted[0] : sorted[0];
      const selected=[representative,...eligible.filter(row=>row.id!==representative.id)].slice(0,alternates);
      const take=marks.get(representative.id), count=take.attackEndSample-take.onsetSample;
      const minimum=Math.ceil(rate*.02), heldEnd=take.releaseSample ?? take.toSample;
      const audioEnd=heldEnd-take.fromSample>=minimum ? heldEnd : take.toSample;
      const first=Math.max(take.fromSample,Math.min(take.attackEndSample,audioEnd-minimum));
      const stereo=model.mics[perspective].pcm.channels===2, channels=stereo ? ['left','right'] : ['mix'];
      const widths=selected.map(row=>marks.get(row.id)).map(row=>row.attackEndSample-row.onsetSample);
      const attackSeconds=median(widths)/rate;
      let nodes, bodyOutput, tail, loop=null, fitReport=null, method;
      if (body==='hybrid') {
        const source=slice(perspective,first,Math.min(audioEnd,first+Math.floor(rate*5.9)));
        const result=A.instrumentFit.fit(source,{root:cell.key,partials:3,modes:7,analysis:{lowHz:35,highHz:1500},attackMs:20});
        method=fit==='modal' && result.value.patches.modal ? 'modal' : fit==='auto' ? result.value.preferred : 'synth';
        const patch=result.value.patches[method];
        nodes={...patch.nodes};
        bodyOutput=patch.output;
        tail=patch.tail;
        fitReport=result.report.particulars;
        const ring=nodes.ring;
        if (ring?.type==='resonator') ring.modes=ring.modes.map((mode,i)=>
          ({...mode,shape:Math.min(6,i+1)}));
      } else {
        const end=Math.max(take.onsetSample+1,audioEnd);
        const start=Math.min(take.attackEndSample-1,end-1,take.loop?.[0] ?? take.attackEndSample-1);
        const source=bake(id+'-sustain',start,end,Math.round(rate*.003),Math.round(rate*.01));
        loop=take.loop && noteRange((take.loop[0]-start)/rate,(take.loop[1]-start)/rate);
        const loopFade=loop && Math.min(.008,(loop[1]-loop[0])*.20);
        const root=integer(representative.root?.suggestedNote,0,127) &&
          Math.abs(representative.root.midi-cell.key)<1.5 ? representative.root.suggestedNote : cell.key;
        const zone={samples:[source],root,oneShot:false,...(loop && {loop,loopFade})};
        method=loop ? 'looped-recording' : 'recorded-body';
        nodes={sustain:{type:'sample',channel:stereo ? 'left' : 'mix',zones:[zone],
          env:{attack:.004,decay:.050,sustain:1,release:.060}}};
        if (stereo) nodes['sustain-right']={...nodes.sustain,channel:'right'};
        bodyOutput='sustain';
        tail=.075;
      }
      const attacks=selected.map((row,i)=>{
        const {onsetSample,attackEndSample}=marks.get(row.id);
        return bake(id+'-attack-'+(i+1),onsetSample,attackEndSample,
          Math.round(rate*.001),Math.round(Math.min(rate*.020,(attackEndSample-onsetSample)*.55)));
      });
      const releases=selected.flatMap((row,i)=>{
        const marked=marks.get(row.id);
        return marked.releaseSample!==null && row.releaseRms>.0003 ?
          [bake(id+'-release-'+(i+1),marked.releaseSample,marked.releaseEndSample,
            Math.round(rate*.0015),Math.round(rate*.013))] : [];
      });
      // Sample bodies start where the captured attack ends, on an independent playback clock.
      if (body==='recorded') for (const name of ['sustain','sustain-right']) if (nodes[name]) {
        const node=nodes[name], onset=round(count/rate,6);
        nodes[name]={...node,startSeconds:onset};
      }
      const bodyFade=round(attackSeconds,6);
      nodes['body-fade']={type:'curve',clock:'seconds',points:[[0,0],[round(bodyFade*.25,8),.10],[bodyFade,1]]};
      nodes['body-mono']={type:'gain',input:bodyOutput,amount:{base:0,from:{'body-fade':1}}};
      if (nodes['sustain-right']) nodes['body-right']={...nodes['body-mono'],input:'sustain-right'};
      const outputs={}, off={};
      for (const ch of channels) {
        const attack='take-'+ch, out='out-'+ch, release='release-'+ch;
        nodes[attack]={type:'sample',channel:ch,zones:[{samples:attacks,root:cell.key,gain:-.7}]};
        nodes[out]={type:'mix',inputs:[attack,ch==='right' && nodes['body-right'] ? 'body-right' : 'body-mono']};
        nodes[release]=releases.length ? {type:'sample',channel:ch,zones:[{samples:releases,root:cell.key,gain:-1}]} :
          {type:'gain',input:attack,amount:0};
        outputs[ch]=out;off[ch]=release;
      }
      const releaseTail=Math.max(.04,...releases.map(name=>rendered[name].samples.length/rendered[name].channels/rate));
      const layout=names=>stereo ? {left:names.left,right:names.right} : names.mix;
      const instrument={type:'graph',nodes,output:layout(outputs),tail,
        controls:{pressure:.5,breath:bounded(brightness*1.15,.12,.80),damping:0,contact:.5},
        articulations:{'key-up':{output:layout(off),tail:round(releaseTail,6)}}};
      instruments[id]=instrument;
      return {id,method,take:take.id,sourceCount:notes.length,clipped:selected.some(clipped),alternates:selected.map(row=>row.id),attackSamples:attacks,
        releaseSamples:releases,loop,bodyRms:center,brightness,fit:fitReport};
    }
    for (const [index,cell] of model.cells.entries()) {
      const notes=rows.filter(row=>row.cell===cell.id && !row.flags.includes('inaudible'));
      if (notes.length) {
        check(bodies.size<16,'An instrument can build up to 16 populated cells. Narrow the requested banks');
        bodies.set(cell.id,fitCell(cell,notes,index));
      }
    }
    for (const cell of model.cells) {
      const actual=bodies.get(cell.id);
      const nearby=actual || fill==='none' ? undefined : model.cells.filter(other=>other.articulation===cell.articulation &&
        bodies.has(other.id)).sort((a,b)=>distance(a,cell)-distance(b,cell) || a.key-b.key || a.velocity-b.velocity)[0];
      const modelRow=actual ?? (nearby && bodies.get(nearby.id));
      const status=actual ? actual.sourceCount>1 ? 'recorded' : 'single-take' : nearby ? 'borrowed' : 'missing';
      cover.push({...cell,status,donor:nearby?.id ?? null,...(modelRow && {instrument:modelRow.id}),
        capturedTakeCount:actual?.sourceCount ?? 0,playableTakeCount:modelRow?.alternates.length ?? 0,
        flags:[...(modelRow?.clipped ? ['clipped-source'] : []),...(modelRow?.releaseSamples.length ? [] : ['no-key-up']),
          ...(body==='recorded' && !modelRow?.loop ? ['no-loop'] : [])]});
      if (modelRow) zones.push({instrument:modelRow.id,low:cell.low,high:cell.high,
        velocity:cell.band,articulation:cell.articulation});
    }
    check(zones.length>0 && Object.keys(rendered).length<=128 &&
      Object.values(rendered).reduce((sum,pcm)=>sum+pcm.samples.length,0)<=12e6,'Playable session assets are empty or exceed the bank budget');
    const patch={type:'zoned',instruments,zones,defaultArticulation:session.articulations[0],
      performance:{connect:{gap:0,interval:0,fade:0},rules:[{when:'release',articulation:'key-up',level:.86}]}};
    P.musicGestures.patch(patch,rendered);
    const value={format,version:1,id:session.id,patch,coverage:cover};
    return {value,assets:rendered,report:{perspective,body,fill,coverage:cover,takes:rows,
      models:Object.fromEntries(bodies),takeCount:rows.length,assetCount:Object.keys(rendered).length},session:resolved};
  }

  function distance(a,b) {
    return Math.abs(a.key-b.key)/12+Math.abs(a.velocity-b.velocity)*1.6;
  }

  function audition(value,assets,options={}) {
    check(fields(value,['format','version','id','patch','coverage']) && value.format===format && value.version===1 &&
      id(value.id) && value.patch?.type==='zoned' && Array.isArray(value.coverage) && integer(value.coverage.length,1,96) &&
      Array.from(value.coverage).every(row=>record(row) && id(row.articulation) && integer(row.key,0,127) &&
        finite(row.velocity,.02,1) && ['recorded','single-take','borrowed','missing'].includes(row.status)) &&
      fields(options,['sampleRate','cases','from','limit']) && integer(options.sampleRate ?? 24000,8000,96000) &&
      integer(options.from ?? 0,0,value.coverage.length-1) && integer(options.limit ?? 16,1,24),
    'Use a built session instrument and a bounded audition grid');
    const {sampleRate=24000,from=0,limit=16}=options, defaults=value.coverage.slice(from,from+limit);
    const cases=options.cases ?? defaults.map((row,i)=>({
      id:'case-'+(from+i+1),key:row.key,velocity:row.velocity,articulation:row.articulation,gate:.52
    }));
    const names=new Set();
    check(Array.isArray(cases) && integer(cases.length,1,24) && Array.from(cases).every(row=>{
      const valid=fields(row,['id','key','velocity','articulation','gate','play']) && id(row.id) && !names.has(row.id) &&
        integer(row.key,0,127) && finite(row.velocity,.02,1) && id(row.articulation) &&
        finite(row.gate ?? .52,.08,2.5) && fields(row.play ?? {},['pressure','breath','damping','contact','curves']);
      if (valid) names.add(row.id);
      return valid;
    }),'Choose named key, velocity and articulation probes');
    check(record(assets) && integer(Object.keys(assets).length,1,128),'Use the built session instrument assets');
    const tail=Math.max(.78,...Object.values(value.patch.instruments).map(row=>row.tail ?? 0));
    let at=0;
    const probes=cases.map(row=>{
      const gate=row.gate ?? .52, start=at;
      at+=Math.ceil((gate+tail+.12)*sampleRate);
      return {...row,gate,fromSample:start,toSample:at};
    });
    check(at<=6e6 && at/sampleRate<=125,'Audition exceeds its render budget');
    const bars=Math.ceil(at/sampleRate/2);
    const production={seed:141,arrangement:{score:{tempoMap:{tempo:120},endFade:0,key:{root:'C4'},
      harmonies:{base:{root:'C4',quality:'unison'}}},parts:{lead:{role:'lead'}},motifs:{},
      sections:[{id:'coverage',bars,harmony:'base'}]},patches:{build:value.patch},
      tracks:{lead:{patch:'build',gain:-4,clips:[{id:'probes',beat:0,length:bars*4,voices:[{id:'probe',notes:
        probes.map(row=>({id:row.id,beat:round(row.fromSample/sampleRate*2,9),duration:round(row.gate*2,9),
          midi:row.key,velocity:row.velocity,play:{...row.play,articulation:row.articulation}}))}]}]}}};
    const result=P.musicProduction.render(production,assets,{sampleRate});
    const normalized=Math.min(1,.91/Math.max(1e-8,result.report.peak));
    const pcm={...result.value,samples:Float64Array.from(result.value.samples.subarray(0,at*2),x=>x*normalized)};
    const report=probes.map(row=>{
      const zone=I.zoneFor(value.patch.zones,row.key,row.velocity,row.articulation);
      const metrics=energy(pcm,row.fromSample,row.toSample);
      const gateEnd=Math.round(row.fromSample+row.gate*sampleRate);
      const released=energy(pcm,gateEnd,Math.min(row.toSample,gateEnd+Math.round(sampleRate*.22)));
      const cell=value.coverage.find(cell=>cell.articulation===row.articulation && row.key>=cell.low && row.key<=cell.high &&
        row.velocity>=cell.band[0] && (row.velocity<cell.band[1] || cell.band[1]===1));
      return {...row,status:cell?.status ?? (zone ? 'mapped' : 'missing'),
        instrument:zone?.instrument ?? null,peak:round(metrics.peak),rms:round(metrics.rms),
        afterKeyUpRms:round(released.rms),silent:metrics.peak<.0003};
    });
    return {value:pcm,production,report:{sampleRate,from,probes:report,missing:report.filter(row=>row.silent).map(row=>row.id)}};
  }

  function auditionTakes(session,assets,options={}) {
    const model=clock(session,assets);
    check(fields(options,['takes','sampleRate','gapSeconds']) && Array.isArray(options.takes) &&
      integer(options.takes.length,1,24),'Choose addressed takes and optional perspectives to hear');
    const rows=Array.from(options.takes,(row,index)=>{
      const perspective=row?.perspective ?? model.perspective, take=model.takes.find(item=>item.id===row?.take);
      check(fields(row,['take','perspective']) && take && Object.hasOwn(model.mics,perspective),'Unknown take or perspective');
      const {fromSample,toSample}=take, {offset,asset}=model.mics[perspective];
      return {id:'source-'+(index+1),take:take.id,perspective,asset,
        fromSample:fromSample+offset,toSample:toSample+offset,value:model.slice(perspective,fromSample,toSample)};
    });
    const result=A.gestureBank.audition(rows.map(({id,value})=>({id,value})),
      {sampleRate:options.sampleRate,gapSeconds:options.gapSeconds ?? .22,levelMatch:'shared'});
    return {value:result.value,report:{...result.report,sources:rows.map(({value,...row})=>row)}};
  }

  A.instrumentSession=Object.freeze({analyze:proposals,build,audition,auditionTakes});
})(KIT.procedural);
