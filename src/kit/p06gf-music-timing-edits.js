/* An addressed correction lives after groove and before instrument timing. */
(function (P) {
  const {check,fields,finite,id,integer}=P.musicInstruments;
  const number=value=>Number(value.toFixed(9));
  const address=row=>({beat:number(row.beat),...(row.clip ? {clip:row.clip,voice:row.voice,note:row.note} : {midi:row.midi})});
  const key=row=>row.clip ? JSON.stringify([number(row.beat),row.clip,row.voice,row.note]) : JSON.stringify([number(row.beat),row.midi]);
  function compile(rows=[]){
    check(Array.isArray(rows) && rows.length<=4096,'Expected up to 4096 addressed timing edits');
    const lookup=new Map();
    for (const row of rows) {
      const at=row?.at;
      check(fields(row,['at','delay','offset']) &&
        fields(at,['beat','midi','clip','voice','note']) && finite(at.beat,0,65536) &&
        (at.clip===undefined ? integer(at.midi,0,127) && at.voice===undefined && at.note===undefined :
          [at.clip,at.voice,at.note].every(id) && at.midi===undefined) &&
        (row.delay!==undefined || row.offset!==undefined) &&
        finite(row.delay ?? 0,-.25,.25) && finite(row.offset ?? 0,0,5),'Invalid addressed timing edit');
      const token=key(at);
      check(!lookup.has(token),'Timing edits must have distinct note addresses');
      lookup.set(token,row);
    }
    return lookup;
  }
  P.musicTimingEdits=Object.freeze({compile,key,address});
})(KIT.procedural);
