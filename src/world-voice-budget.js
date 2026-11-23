/* Deterministic admission shared by live Web Audio and recorded spatial soundtracks. */
const WorldVoiceBudget=(()=>{
  const limits=['maxVoices','reservedVoices','groups','stealFade'];
  const record=value=>value&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  const group=name=>typeof name==='string'&&/^[A-Za-z0-9_][A-Za-z0-9._/-]{0,127}$/.test(name);
  const validVoice=voice=>(voice.priority===undefined||integer(voice.priority,-100,100))&&
    (voice.protected===undefined||typeof voice.protected==='boolean')&&(voice.group===undefined||group(voice.group));

  function compile(raw){
    if(!record(raw)||Object.keys(raw).some(key=>!limits.includes(key)))throw TypeError('Invalid world voice budget');
    const {maxVoices=32,reservedVoices=Math.min(3,maxVoices-1),groups={},stealFade=.008}=raw;
    if(!integer(maxVoices,1,128)||!integer(reservedVoices,0,maxVoices)||!record(groups)||
      Object.keys(groups).length>128||!Object.entries(groups).every(([name,count])=>group(name)&&integer(count,0,128))||
      !Number.isFinite(stealFade)||stealFade<0||stealFade>.05)throw TypeError('Invalid world voice budget');
    return Object.freeze({maxVoices,reservedVoices,groups:Object.freeze({...groups}),stealFade});
  }

  function select(candidates,policy,stable=true){
    const ordered=[...candidates].sort((a,b)=>Number(Boolean(b.protected))-Number(Boolean(a.protected))||
      (b.priority??0)-(a.priority??0)||b.gain-a.gain||
      (stable?(Number(Boolean(b.incumbent))-Number(Boolean(a.incumbent))||(a.id<b.id?-1:a.id>b.id?1:0)):0));
    const selected=new Set(), rejected=new Map(), counts=new Map();
    let background=0;
    for(const voice of ordered){
      const {id,group}=voice;
      const count=counts.get(group)??0, cap=group!==undefined&&Object.hasOwn(policy.groups,group)?policy.groups[group]:Infinity;
      if(count>=cap)rejected.set(id,'group-limit');
      else if(selected.size>=policy.maxVoices)rejected.set(id,'voice-limit');
      else if(!voice.protected&&background>=policy.maxVoices-policy.reservedVoices)rejected.set(id,'reserved');
      else{
        selected.add(id);
        if(!voice.protected)background++;
        counts.set(group,count+1);
      }
    }
    return Object.freeze({selected,rejected});
  }
  return Object.freeze({compile,select,validVoice});
})();
if (typeof module !== 'undefined') module.exports = WorldVoiceBudget;
else globalThis[Symbol.for('ink-studio.world-voice-budget')] = WorldVoiceBudget;
