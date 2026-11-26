/* Sparse pose snapshots and bounded native timeline overlays. */
(function (K) {
  const format='ink-studio/sparse-scene-poses';
  const roots=['camera','effects','poses'];
  const poseRest={translation:[0,0,0],rotation:[0,0,0],scale:1,orientation:[1,0,0,0,1,0,0,0,1]};
  const fields=(row,keys)=>K.world.data.record(row)&&Object.keys(row).every(key=>keys.includes(key));
  const range=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const name=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,40}$/.test(value);
  const targetOf=value=>K.world.data.selector(value).map(String);
  const idOf=target=>JSON.stringify(target);
  function same(a,b) {
    if (Number.isFinite(a)&&Number.isFinite(b))
      return Math.abs(a-b)<=16*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));
    if (Array.isArray(a)&&Array.isArray(b)) return a.length===b.length&&Array.from(a).every((n,i)=>same(n,b[i]));
    return K.world.data.equal(a,b);
  }
  const copy=value=>K.procedural.data.clone(value);

  function bind(source,scene,channel,timeline,time,cameraAt) {
    if (!range(time,0,3600)) throw new RangeError('Pose capture time must be in 0–3600 seconds');
    const known=target=>roots.includes(target[0])&&channel(target);
    const lookup=new Map((timeline?.sample(time).edits??[]).map(({path,value})=>[idOf(path),{target:path,value}]));
    function authored([root,index,field]) {
      if (root==='poses') return poseRest[field];
      if (root==='camera') return scene.camera?.[index]??cameraAt(index);
      const effect=scene.effects?.[index], value=effect?.[field];
      if (field==='box'&&Array.isArray(value)) return value.flat();
      if (value!==undefined) return value;
      if (effect?.do==='lamp') return {r:6,strength:.9,flicker:0}[field];
      if (effect?.do==='rain') return field==='rate'?60:undefined;
      return {n:3,every:.5,spread:1,speed:6,dir:[0,.6,0]}[field];
    }
    const current=target=>lookup.get(idOf(target))?.value??
      (target[0]==='camera'&&scene.cameraRig?cameraAt(target[1])??authored(target):authored(target));

    function readChanges(rows) {
      if (!Array.isArray(rows)||rows.length>128) throw new RangeError('A sparse pose supports up to 128 changed properties');
      const ids=new Set();
      return Array.from(rows,row=>{
        if (!fields(row,['target','value'])||!Object.hasOwn(row,'value'))
          throw new TypeError('A pose change needs a target and value');
        const target=targetOf(row.target), id=idOf(target);
        if (!known(target)||ids.has(id))
          throw new RangeError('Pose changes need distinct editable timeline channels: /'+target.join('/'));
        ids.add(id);
        return {target,value:copy(row.value)};
      });
    }

    function snapshot(edited) {
      if (edited.id!==source.id) throw new RangeError('Pose snapshots must use the same scene ID');
      const candidates=new Map();
      const add=(target,value)=>{
        if (value!==undefined&&known(target)) candidates.set(idOf(target),{target,value});
      };
      for (const [id,row] of [...lookup,...edited.keyed()]) {
        const target=row.target;
        if (known(target)&&!same(current(target),edited.current(target))) add(target,edited.current(target));
      }
      const compare=target=>{
        if (!known(target)) return;
        const next=edited.authored(target);
        if (!same(authored(target),next)) add(target,next);
      };
      for (const key of new Set([...Object.keys(scene.camera??{}),...edited.cameraFields()]))
        compare(['camera',key]);
      for (const [i,prior] of (scene.effects??[]).entries()) {
        const next=edited.effect(i);
        if (prior.do!==next?.do) continue;
        for (const key of new Set([...Object.keys(prior),...Object.keys(next)]))
          compare(['effects',String(i),key]);
      }
      return [...candidates.values()];
    }

    function key(raw,duration) {
      if (!fields(raw,['time','hold','blend','changes'])||!range(raw.time,0,duration)||raw.time===duration||
          !range(raw.hold??0,0,duration)||!K.anim.keyframeTrack.eases.includes(raw.blend??'smooth'))
        throw new RangeError('Each pose needs a time inside the duration, a bounded hold, and a timeline blend');
      return {...raw,hold:raw.hold??0,blend:raw.blend??'smooth',changes:readChanges(raw.changes)};
    }

    function book(raw) {
      if (!fields(raw,['format','version','id','scene','duration','keys'])||raw.format!==format||
          raw.version!==1||raw.scene!==source.id||!name(raw.id)||!range(raw.duration,.001,3600)||
          !Array.isArray(raw.keys)||raw.keys.length>120)
        throw new TypeError('Use a sparse pose sequence for this scene with a duration and up to 120 keys');
      const keys=Array.from(raw.keys,row=>key(row,raw.duration));
      for (const [i,row] of keys.entries()) {
        const next=keys[i+1]?.time??raw.duration;
        if (next<=row.time||row.hold>next-row.time+1e-9)
          throw new RangeError('Pose keys must increase and holds must fit before the next key');
      }
      return {...raw,keys};
    }

    function apply(raw) {
      const document=book(raw);
      const base=source.timeline??{}, sequences={...base.sequences}, clips=(base.clips??[]).slice(), ranges=[];
      let total=0;
      for (const [i,row] of document.keys.entries()) {
        const next=document.keys[i+1], end=next?.time??document.duration, span=end-row.time;
        const incoming=new Map(next?.changes.map(item=>[idOf(item.target),item.value]));
        const tracks=row.changes.map(({target,value})=>{
          const animate=row.blend!=='step'&&row.hold<span&&incoming.has(idOf(target))&&channel(target).mode!=='step';
          const keys=[{time:0,value,ease:animate&&!row.hold?row.blend:'step'}];
          if (animate) {
            if (row.hold) keys.push({time:row.hold,value,ease:row.blend});
            keys.push({time:span,value:incoming.get(idOf(target))});
          }
          return {target,keys};
        });
        const receipt={from:row.time,to:end,hold:row.hold,blend:row.blend,targets:tracks.map(track=>track.target)};
        ranges.push(receipt);
        if (!tracks.length) continue;
        total+=tracks.reduce((sum,track)=>sum+track.keys.length,0);
        if (total>8192) throw new RangeError('Sparse pose sequence exceeds the timeline key budget');
        const id='pose-'+document.id+'-'+(i+1);
        if (Object.hasOwn(sequences,id)||clips.some(row=>row.id===id)||Object.hasOwn(base.cueTracks??{},id))
          throw new RangeError('Pose sequence ID is already in use: '+document.id);
        sequences[id]={duration:span,tracks};
        clips.push({id,sequence:id,time:row.time,until:end,endExclusive:true});
      }
      const duration=timeline?.duration??0;
      const composed={...base,...(clips.length&&{clips,sequences}),
        ...(document.duration>duration&&{duration:document.duration})};
      K.timeline.compile(composed,{channel});
      return {scene:{...source,timeline:composed},ranges};
    }

    function capture(input,{sequence,id,duration,hold=0,blend='smooth'}={}) {
      const previous=sequence&&book(sequence);
      if (previous&&id!==undefined&&previous.id!==id)
        throw new RangeError('Use the existing pose sequence ID when appending');
      const candidates=typeof input?.current==='function'?snapshot(input):readChanges(input?.changes);
      const changes=candidates.filter(({target,value})=>!same(current(target),value)).map(copy);
      const keys=[...(previous?.keys??[]).filter(row=>row.time!==time),{time,hold,blend,changes}].sort((a,b)=>a.time-b.time);
      const next=book({format,version:1,id:id??previous?.id??'poses',scene:source.id,
        duration:duration??previous?.duration??Math.max(time+1,timeline?.duration??0),keys});
      apply(next);
      return {sequence:next,key:next.keys.find(row=>row.time===time)};
    }

    return {id:source.id,capture,apply,current,authored,keyed:()=>lookup,
      cameraFields:()=>Object.keys(scene.camera??{}),effect:index=>scene.effects?.[index]};
  }

  K.scenePoses=Object.freeze({format,bind});
})(KIT);
