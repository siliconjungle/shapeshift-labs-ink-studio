/* Contextual articulation and release on a score voice's performed clock. */
(function (P) {
  const {fields,finite,integer,id,check,articulationNames}=P.musicInstruments;
  const round=n=>Number(n.toFixed(9)), eps=1e-7;

  function compile(raw,patch) {
    if (raw===undefined) return null;
    check(fields(raw,['connect','repeatGap','rules']) && fields(raw.connect ?? {},['gap','interval','fade']) &&
      Array.isArray(raw.rules ?? []) && (raw.rules?.length ?? 0)<=32,'Invalid instrument performance map');
    const {gap=.085,interval=12,fade=.018}=raw.connect ?? {}, {repeatGap=.16}=raw;
    check(finite(gap,0,1) && integer(interval,0,127) && finite(fade,0,.25) && finite(repeatGap,0,2),
      'Invalid note connection or repeat window');
    const names=articulationNames(patch);
    const rules=Array.from(raw.rules ?? [],row=>{
      check(fields(row,['when','interval','velocity','articulation','attackLead','glide','level','curves']) &&
        ['attack','repeat','legato','release'].includes(row.when) &&
        (row.articulation===undefined || id(row.articulation) && names.has(row.articulation)) &&
        (row.interval===undefined || row.when==='legato' && Array.isArray(row.interval) && row.interval.length===2 &&
          integer(row.interval[0],-127,127) && integer(row.interval[1],row.interval[0],127)) &&
        (row.velocity===undefined || Array.isArray(row.velocity) && row.velocity.length===2 &&
          finite(row.velocity[0],0,1) && finite(row.velocity[1],row.velocity[0],1)) &&
        finite(row.attackLead ?? 0,0,2) && finite(row.glide ?? 0,0,1) && finite(row.level ?? 1,0,2),
      'Invalid articulation performance rule');
      if (row.when==='release')
        check(row.articulation && row.attackLead===undefined && row.glide===undefined,
          'A release needs a named articulation and starts at key up');
      return {...row,...(row.curves!==undefined && {curves:P.musicNoteExpression.validate(row.curves)})};
    });
    check(rules.filter(row=>row.when==='release').length<=1,'Use one release articulation per patch');
    return {gap,interval,fade,repeatGap,rules};
  }

  function apply(model,notes,silence,percussion) {
    const byVoice=new Map(), turns=new Map();
    const select=(kind,span,velocity)=>model.rules.find(row=>row.when===kind &&
      (!row.interval || span>=row.interval[0] && span<=row.interval[1]) &&
      (!row.velocity || velocity>=row.velocity[0] && velocity<=row.velocity[1]));
    for (const note of notes) {
      const voice=note.voice ?? 0, prev=byVoice.get(voice);
      const cleared=silence.findLast(row=>row.endTime<=note.time+eps);
      const floor=cleared?.endTime ?? 0;
      const available=prev && prev.time>=floor-eps && prev.time<note.time-eps &&
        (!prev.choke || prev.choke>=note.time-eps);
      const interval=available ? note.midi-prev.midi : null;
      const gap=available ? note.time-(prev.time+prev.gate) : Infinity;
      let kind='attack';
      if (interval===0 && gap<=model.repeatGap) kind='repeat';
      else if (interval!==null && !percussion && Math.abs(interval)<=model.interval && gap<=model.gap) kind='legato';
      const rule=select(kind,interval,note.velocity), release=select('release',interval,note.velocity);
      const articulation=note.play.articulation ?? rule?.articulation;
      const lead=rule?.attackLead ?? 0;
      const minimum=prev && !percussion ? Math.max(floor,Math.min(note.time,(prev.start ?? prev.time)+.001)) : floor;
      const start=round(Math.min(note.time,Math.max(minimum,note.time-lead)));
      const take=articulation ?? '';
      const counter=turns.get(take) ?? 0;
      turns.set(take,counter+1);
      note.roundRobin=counter;
      if (start<note.time) note.start=start;
      note.performance={kind,interval,attackLead:round(note.time-start),requestedLead:lead,
        ...(kind==='legato' && model.fade && {fadeIn:model.fade})};
      if (rule) {
        note.velocity=Math.min(1,note.velocity*(rule.level ?? 1));
        note.play={...note.play,...(articulation && {articulation}),
          ...(note.play.glide===undefined && rule.glide!==undefined && {glide:rule.glide}),
          ...(rule.curves && {curves:{...rule.curves,...note.play.curves}})};
      }
      if (kind==='legato') {
        note.connected=true;
        note.fromFrequency=prev.frequency;
        prev.gate=round(Math.max(.001,start-prev.time)+model.fade);
        const end=round(start+model.fade);
        if (end<(prev.choke ?? Infinity)) {
          prev.choke=end;
          prev.chokeFade=model.fade;
        }
      }
      if (available && (kind!=='attack' || note.time<prev.time+prev.gate-eps)) delete prev.performance.release;
      if (release) note.performance.release={articulation:release.articulation,level:release.level ?? 1,
        ...(release.curves && {curves:release.curves})};
      byVoice.set(voice,note);
    }
  }
  function releases(notes) {
    let releaseTurn=0;
    for (const note of notes) {
      const row=note.performance?.release;
      if (!row) continue;
      if (note.choke!==undefined && note.choke<=note.time+note.gate+eps) delete note.performance.release;
      else row.roundRobin=releaseTurn++;
    }
  }
  P.musicPhrasing=Object.freeze({compile,apply,releases});
})(KIT.procedural);
