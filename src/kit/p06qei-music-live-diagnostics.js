/* Keep rehearsal evidence independently of the rolling live-score trace. */
(function (P) {
  function create(limit) {
    const rows=new Map(), gaps=new Map(), omitted={};
    function issue(kind,fromSample,toSample,details,trigger) {
      if (!rows.has(kind)) rows.set(kind,[]);
      const list=rows.get(kind);
      if (list.length>=limit) {
        omitted[kind]=(omitted[kind] ?? 0)+1;
        return null;
      }
      const row={kind,fromSample,toSample,...details,...(trigger?.beatId && {beatId:trigger.beatId})};
      list.push(row);
      return row;
    }
    function stream(track,gap,frame,details,trigger) {
      if (gap.recovered) close(track,frame);
      else {
        const row=issue('audio-underrun',frame,null,{resource:gap.name,sourceSample:gap.frame,...details},trigger);
        if (row) gaps.set(track,row);
      }
    }
    function close(track,frame) {
      const row=gaps.get(track);
      if (!row) return;
      row.toSample=frame;
      gaps.delete(track);
    }
    function inspect(frame) {
      const findings=[...rows.values()].flat().sort((a,b)=>a.fromSample-b.fromSample)
        .map(row=>({...row,toSample:row.toSample ?? frame}));
      return {findings,omitted};
    }
    return {issue,stream,close,inspect};
  }
  P.musicLiveDiagnostics=Object.freeze({create});
})(KIT.procedural);
