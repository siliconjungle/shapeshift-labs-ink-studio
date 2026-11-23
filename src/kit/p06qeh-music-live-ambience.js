/* Acoustic-band envelopes for persistent PCM beds on the live sample clock. */
(function (P) {
  const {check,fields,record,id,finite}=P.musicInstruments;
  const validBands=value=>Array.isArray(value) && value.length===3 &&
    Array.from(value).every(gain=>finite(gain,0,1));
  const table=(value,validate)=>record(value) && Object.keys(value).length<=64 &&
    Object.entries(value).every(([part,row])=>id(part) && validate(row));
  const validGains=value=>table(value,validBands);
  const validIntent=row=>record(row) && row.kind==='music-ambience' && table(row.zones,zone=>
    fields(zone,['bands','ramp']) && validBands(zone.bands) && (zone.ramp===undefined || finite(zone.ramp,0,30))) &&
    Object.keys(row.zones).length>0;

  function open(rate,initial,stemGroups,log) {
    const parts=new Set(stemGroups.flatMap(group=>group.parts.map(stem=>stem.part)));
    check(validGains(initial) && Object.keys(initial).every(part=>parts.has(part)),
      'Ambience gains need declared PCM stem parts and three normalized band gains');
    const rows=new Map(Object.entries(initial).map(([part,gains])=>[part,{
      from:[...gains],target:[...gains],startFrame:0,endFrame:0,lowL:0,lowR:0,upperL:0,upperR:0
    }]));
    const filterStep=hz=>{
      const warped=Math.tan(Math.PI*hz/rate);
      return warped/(1+warped);
    };
    const lowStep=filterStep(350), upperStep=filterStep(2600);
    const progress=(row,frame)=>frame>=row.endFrame ? 1 : (frame-row.startFrame)/(row.endFrame-row.startFrame);
    const gainAt=(row,k,position)=>position===1 ? row.target[k] : row.from[k]+(row.target[k]-row.from[k])*position;

    function update(intent,frame) {
      const changed={}, stale=[];
      for (const [part,{bands,ramp=.12}] of Object.entries(intent.zones)) {
        const row=rows.get(part), {time,serial}=intent;
        if (time<row.time || (time===row.time && serial!==undefined && row.serial!==undefined && serial<=row.serial)) {
          stale.push(part);
          continue;
        }
        row.time=time;
        row.serial=serial;
        if (bands.every((gain,k)=>gain===row.target[k])) continue;
        const position=progress(row,frame);
        row.from=row.from.map((_,k)=>gainAt(row,k,position));
        row.target=bands;
        row.startFrame=frame;
        row.endFrame=frame+Math.round(ramp*rate);
        changed[part]={from:row.from,target:bands,startFrame:frame,endFrame:row.endFrame};
      }
      if (Object.keys(changed).length) log('ambience-gain',{zones:changed,trigger:intent});
      if (stale.length) log('ambience-ignored',{zones:stale,reason:'stale-intent',trigger:intent});
    }

    function process(part,frame,pair) {
      const row=rows.get(part);
      if (!row) return false;
      const position=progress(row,frame), low=gainAt(row,0,position), mid=gainAt(row,1,position), high=gainAt(row,2,position);
      const left=pair[0], right=pair[1];
      const lowL=row.lowL+(left-row.lowL)*lowStep, lowR=row.lowR+(right-row.lowR)*lowStep;
      const upperL=row.upperL+(left-row.upperL)*upperStep, upperR=row.upperR+(right-row.upperR)*upperStep;
      row.lowL=2*lowL-row.lowL;
      row.lowR=2*lowR-row.lowR;
      row.upperL=2*upperL-row.upperL;
      row.upperR=2*upperR-row.upperR;
      pair[0]=left*high+(mid-high)*upperL+(low-mid)*lowL;
      pair[1]=right*high+(mid-high)*upperR+(low-mid)*lowR;
      return true;
    }
    function inspect(frame) {
      return Object.fromEntries([...rows].map(([part,row])=>[part,{
        bands:row.from.map((_,k)=>gainAt(row,k,progress(row,frame))),
        target:row.target,startFrame:row.startFrame,endFrame:row.endFrame
      }]));
    }
    return {knows:intent=>Object.keys(intent.zones).every(part=>rows.has(part)),update,process,inspect};
  }
  P.musicAmbience=Object.freeze({validBands,validGains,validIntent,open});
})(KIT.procedural);
