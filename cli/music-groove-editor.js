const fs=require('node:fs'),path=require('node:path'), WAV=require('./wav.js');
const {write,json}=require('./asset-files.js'), {assetPaths}=require('./music-production.js');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const human=(value,places=2)=>value==null ? '—' : Number(value).toFixed(places);
const signed=value=>value==null ? '—' : (value>=0 ? '+' : '')+human(value);
const at=row=>row.clip ? [row.clip,row.voice,row.note].join('/') : 'MIDI '+row.midi;
const line=(values,widths)=>values.map((value,i)=>widths[i]>0 ? String(value).padStart(widths[i]) :
  String(value).padEnd(-widths[i])).join('  ').trimEnd();

function timing(report,title) {
  const widths=[8,-21,4,12,12,12,12,9,-1], rate=report.sampleRate;
  const time=sample=>sample===null ? '—' : human(sample*1000/rate);
  const rows=report.events.map(row=>line([human(row.beat,3),
    row.part+(row.take==='reference' ? '' : '/'+row.take),row.midi,
    time(row.gridSample),time(row.playedSample),time(row.triggerSample),time(row.audibleSample),
    signed(row.triggerToAudioMs),at(row)+(row.retrigger ? ' · trigger '+(row.retrigger+1) : '')+(row.inputMuted ? ' · input muted' : '')],widths));
  const gapHeader=['Beat','Anchor → target','Written','Trigger','Audible'];
  const gapWidths=[8,-28,9,9,9];
  const pairs=report.pairs.map(row=>line([human(row.target.beat,3),row.anchor.part+' → '+row.target.part,
    signed(row.writtenGapMs),signed(row.triggerGapMs),signed(row.audibleGapMs)],gapWidths));
  return [title+' · '+report.take+' · beats '+report.range.fromBeat+'–'+report.range.toBeat+' · '+rate+' Hz',
    'Times are absolute milliseconds. Attack is estimated from the isolated voice before the mixer.',
    '',line(['Beat','Track / take','MIDI','Written','Played','Trigger','Attack','Lead-in','Note'],widths),...rows,
    ...(!rows.length ? ['No audible score attacks in this selection.'] : []),
    ...(pairs.length ? ['','Paired gaps in milliseconds · positive means the target follows',
      line(gapHeader,gapWidths),...pairs] : [])].join('\n');
}

function editing(report) {
  const operations=report.operations.flatMap(({op,entries})=>{
    const rate=report.before.sampleRate;
    const widths=[8,-25,11,11,11,-1];
    const rows=entries.map(row=>{
      const {before,after}=row;
      const trigger=after ? (after.triggerSample-before.triggerSample)*1000/rate : null;
      const audible=after?.audibleSample!=null && before.audibleSample!==null ?
        (after.audibleSample-before.audibleSample)*1000/rate : null;
      return line([human(before.beat,3),before.part+(before.take==='reference' ? '' : '/'+before.take),
        ...(op==='trim' ? [signed(trigger),signed(audible),human(after?.sampleOffsetMs)] :
          [signed(row.targetMs),signed(row.gapMs),signed(row.errorMs)]),
        row.reason ?? (after ? at(before) : 'Attack left the selection')],widths);
    });
    const headings=op==='trim' ? ['Beat','Track / take','Δ Trigger','Δ Attack','Start offset','Note'] :
      ['Beat','Track / take','Requested','Measured','Error','Note'];
    return ['',op==='trim' ? 'Sample trim · milliseconds' : 'Gap edit · milliseconds',line(headings,widths),...rows];
  });
  return [timing(report.before,'Before'),...operations,'',timing(report.after,'After')].join('\n');
}

module.exports=function command([mode,file,settings],opt,kit) {
  const P=kit.KIT.procedural,{check}=P.musicInstruments;
  check(file && ['inspect','edit','audition'].includes(mode),'Use music groove inspect, edit or audition with a production or session recipe');
  const recipe=read(file), source=recipe.session ?? recipe.production ?? recipe;
  const paths=assetPaths(recipe,file), assets=Object.fromEntries(Object.entries(paths).map(([id,file])=>[id,WAV.read(file)]));
  const editor=P.musicGrooveEditor.open(source,assets);
  const focus=settings ? read(settings) : {};
  if (!recipe.session && source.format!=='ink-studio/music-edit-session' && focus.sampleRate===undefined && recipe.options?.sampleRate!==undefined)
    focus.sampleRate=recipe.options.sampleRate;
  if (mode==='inspect') {
    const result=editor.inspect(focus);
    if (typeof opt.out==='string') json(opt.out,result);
    else process.stdout.write((opt.json ? JSON.stringify(result,null,2) : timing(result,'Groove'))+'\n');
    return result;
  }
  check(settings && typeof opt.out==='string','Give the groove edit settings and an --out path');
  const {value,report}=editor.edit(focus);
  const name=recipe.session || source.format==='ink-studio/music-edit-session' ? 'session' : 'production';
  function save(target) {
    const folder=path.dirname(path.resolve(target));
    const refs=Object.fromEntries(Object.entries(paths).map(([id,at])=>[id,path.relative(folder,at)]));
    json(target,{[name]:value,...(name==='production' && recipe.options && {options:recipe.options}),
      ...(Object.keys(refs).length && {assets:refs})});
  }
  const table=editing(report);
  let result={edited:path.resolve(opt.out),report};
  if (mode==='edit') {
    save(opt.out);
    if (typeof opt.report==='string') json(opt.report,report);
  } else {
    const out=path.resolve(opt.out), at=name=>path.join(out,name);
    const before=editor.audition(source,report.before,focus.take), after=editor.audition(value,report.after,focus.take);
    check(before.samples.length===after.samples.length && before.sampleRate===after.sampleRate,
      'Auditions must share a sample clock and range');
    let peak=1;
    for (const audio of [before,after]) for (const sample of audio.samples) peak=Math.max(peak,Math.abs(sample));
    for (const [name,audio] of [['before',before],['after',after]]) {
      const comparable=peak===1 ? audio : {...audio,samples:Float64Array.from(audio.samples,value=>value/peak)};
      write(at(name+'.wav'),WAV.encode(comparable,{encoding:'pcm24'}));
    }
    save(at('edited.json'));
    write(at('timing.txt'),table+'\n');
    json(at('report.json'),{...report,audition:{gain:1/peak,frames:before.samples.length/before.channels,
      before:'before.wav',after:'after.wav',edited:'edited.json'}});
    result={edited:at('edited.json'),before:at('before.wav'),after:at('after.wav'),timing:at('timing.txt'),report:at('report.json')};
  }
  process.stdout.write(opt.json ? JSON.stringify(result,null,2)+'\n' : table+'\n\nSaved '+result.edited+'\n');
  return result;
};
