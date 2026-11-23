/* One committed sound description for playback and perception. */
(function(K){
  const W=K.world, {check,record,vector}=W.data;
  const kind='world-sound', bands=Object.freeze(['low','mid','high']), maxDuration=3600;
  const levelOK=n=>Number.isFinite(n)&&n>=-200&&n<=250;
  const detailsOK=row=>record(row)&&typeof row.cue==='string'&&row.cue.length<=512&&!!row.cue.trim()&&
    levelOK(row.sourceLevelDb)&&bands.includes(row.band)&&Number.isFinite(row.duration)&&
    row.duration>=.001&&row.duration<=maxDuration;
  function validate(row){
    check(detailsOK(row)&&vector(row.at)&&row.at.every(n=>Math.abs(n)<=1e6),
    'A world sound needs a cue, XYZ at, sourceLevelDb, low/mid/high band and duration in seconds');
  }
  const describe=({cue,at,sourceLevelDb,band,duration})=>({cue,at,sourceLevelDb,band,duration});
  W.soundEvents=Object.freeze({kind,levelOK,detailsOK,validate,describe});
})(KIT);
