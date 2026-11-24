const Footprints=require('../src/splat-footprints.js');
const Fit=require('./splat-fit-asset.js');

const EPS=1e-5;
const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
const plain=o=>o && Object.getPrototypeOf(o)===Object.prototype;
const rgb=packed=>[packed>>16,packed>>8&255,packed&255];
const pack=([r,g,b])=>(r<<16)|(g<<8)|b;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const defaults={silhouette:4,interior:1,depth:1,normal:1,pigment:4,protected:8};
const passes=['splatId','depth','normal','pigment','objectId'];

function settings(raw={}, world) {
  if (!plain(raw) || Object.keys(raw).some(key=>!['footprints','rotations','pigment','swatches','trials',
    'maxRows','weights','depthTolerance'].includes(key)))
    throw new TypeError('Invalid channel-based splat fit search settings');
  const {footprints=['square','wedge','circle'],rotations=[0,Math.PI/4,-Math.PI/4],pigment=true,
    swatches=[],trials=48,maxRows=12,weights={},depthTolerance=.3}=raw;
  const bounded=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
  if (!Array.isArray(footprints)||footprints.length>8 || !Array.isArray(rotations)||rotations.length<1||
      rotations.length>8 || !Array.from(rotations).every(n=>Number.isFinite(n)&&Math.abs(n)<=Math.PI*2) ||
      typeof pigment!=='boolean' || !Array.isArray(swatches)||swatches.length>32||
      !Array.from(swatches).every(Fit.rgb24) || !bounded(trials,1,192) || !bounded(maxRows,1,64) ||
      !Number.isFinite(depthTolerance)||depthTolerance<=0 || !plain(weights) ||
      Object.entries(weights).some(([key,n])=>!Object.hasOwn(defaults,key)||!Number.isFinite(n)||n<0||n>64))
    throw new RangeError('Invalid splat fit channels, footprint palette, or search budget');
  const authored=world.splatFootprints?.styles??[];
  const shapes=Array.from(footprints,shape=>shape===false ? false : Footprints.prepare(shape));
  if (shapes.some(shape=>shape===null) || authored.length+
      shapes.filter(Boolean).length*new Set(rotations).size>Footprints.maxStyles)
    throw new RangeError('Splat fit search exceeds the footprint style budget');
  return {shapes,rotations:[...new Set(rotations)],pigment,swatches:[...new Set(swatches)],trials,maxRows,
    weights:{...defaults,...weights},depthTolerance};
}

function referenceChannels(entry,w,h) {
  const count=w*h;
  function pixels(image,label) {
    if (image.w!==w || image.h!==h || !(image.max>0) || image.data?.length!==count*4)
      throw new RangeError('Splat fit '+label+' reference must match the native grid');
    return image.data;
  }
  const {depth,normal,pigment,pins}=entry;
  if (depth!==undefined && (!(depth instanceof Float32Array) || depth.length!==count ||
      !depth.every(n=>n===Infinity||Number.isFinite(n)&&n>0)))
    throw new RangeError('Splat fit depth needs one positive axial value or +Infinity per art pixel');
  let normals=normal, pigments=pigment;
  if (normal && !(normal instanceof Float32Array)) {
    const data=pixels(normal,'normal');
    normals=new Float32Array(count*3);
    for (let p=0;p<count;p++) {
      const i=p*4;
      if (!data[i+3] || !(data[i]||data[i+1]||data[i+2])) continue;
      const n=[0,1,2].map(k=>2*data[i+k]/normal.max-1), length=Math.hypot(...n);
      if (length>.02) normals.set(n.map(v=>v/length),p*3);
    }
  }
  if (normal!==undefined && (!(normals instanceof Float32Array)||normals.length!==count*3||
      !normals.every(n=>Number.isFinite(n)&&Math.abs(n)<=1)))
    throw new RangeError('Splat fit normal needs finite world XYZ at each art pixel');
  if (pigment && !(pigment instanceof Uint32Array)) {
    const data=pixels(pigment,'pigment');
    pigments=Uint32Array.from({length:count},(_,p)=>data[p*4+3]>=pigment.max/2 ?
      pack([0,1,2].map(c=>Math.round(data[p*4+c]*255/pigment.max)))+1 : 0);
  }
  if (pigment!==undefined && (!(pigments instanceof Uint32Array)||pigments.length!==count||
      !pigments.every(n=>n<=0x1000000))) throw new RangeError('Splat fit pigment needs RGB24 plus one per art pixel');
  const locked=[];
  if (pins!==undefined) {
    const data=pixels(pins,'pin');
    for (let p=0;p<count;p++) if (data[p*4]>=pins.max/2&&data[p*4+3]>=pins.max/2) locked.push(p);
  }
  return {depth,normal:normals,pigment:pigments,locked};
}

function pinSample(frame,source,p) {
  const {depth,normal,pigment}=frame.passes;
  return [source[p],depth[p],pigment[p],...normal.subarray(p*3,p*3+3),...frame.rgb.subarray(p*3,p*3+3)];
}

function measure(frame, source, shot, options, rank) {
  const {wanted,channels,carrier,objects}=shot;
  const {coverage,edge,protection,image}=wanted;
  const {depth,normal,pigment,locked}=channels;
  const {depth:actualDepth,normal:actualNormal,pigment:actualPigment,splatId,objectId}=frame.passes;
  const accepted=objects && new Set(frame.passes.objects.flatMap((id,i)=>objects.includes(id)?[i]:[]));
  const stats={silhouette:0,interiorCoverage:0,outsideCoverage:0,depth:0,normal:0,pigment:0,protected:0,
    covered:0,samples:{depth:0,normal:0,pigment:0},edgeLoss:0,interiorLoss:0,pinChanges:0};
  const weights=options.weights;
  for (let p=0;p<coverage.length;p++) {
    const amount=coverage[p], boundary=edge[p], inside=amount>.5;
    const difference=amount-source[p], error=Math.abs(difference);
    stats[boundary?'silhouette':inside?'interiorCoverage':'outsideCoverage']+=error;
    const i=p*3, q=p*4, id=splatId[p]-1;
    const live=source[p]>.5 && (!accepted || accepted.has(objectId[p]));
    let geometry=0, paint=0;
    if (inside) {
      stats.covered++;
      if (Number.isFinite(depth?.[p])) {
        const err=live && Number.isFinite(actualDepth[p]) ? Math.min(1,Math.abs(actualDepth[p]-depth[p])/options.depthTolerance) : 1;
        stats.depth+=err; stats.samples.depth++; geometry+=weights.depth*err;
      }
      if (normal && (normal[i]||normal[i+1]||normal[i+2])) {
        const a=actualNormal.subarray(i,i+3), n=normal.subarray(i,i+3);
        const scale=Math.hypot(...a)*Math.hypot(...n);
        const err=live&&scale>0 ? clamp((1-dot(a,n)/scale)*.5,0,1) : 1;
        stats.normal+=err; stats.samples.normal++; geometry+=weights.normal*err;
      }
      if (!boundary && pigment?.[p]) {
        const expected=rgb(pigment[p]-1);
        const err=live&&actualPigment[p] ?
          rgb(actualPigment[p]-1).reduce((sum,n,c)=>sum+Math.abs(n-expected[c]),0)/765 : 1;
        stats.pigment+=err; stats.samples.pigment++; paint=weights.pigment*err;
        if (rank && id>=0 && live) {
          const hit=rank.colors.get(id)??[0,0,0,0,0];
          for(let c=0;c<3;c++) hit[c]+=expected[c];
          hit[3]++; hit[4]+=paint;
          rank.colors.set(id,hit);
        }
      }
    }
    let approved=0;
    if (protection[p]) {
      for(let c=0;c<3;c++) approved+=Math.abs(frame.rgb[i+c]/255-image.data[q+c]/image.max)/3;
      approved*=protection[p];
      stats.protected+=approved;
    }
    const pixelLoss=(boundary?weights.silhouette:weights.interior)*error+geometry;
    if (boundary || !inside) stats.edgeLoss+=pixelLoss;
    else stats.interiorLoss+=pixelLoss;
    stats.interiorLoss+=paint+weights.protected*approved;
    if (!rank) continue;
    if (id>=0) rank.seen[id]++;
    const lane=boundary||!inside ? rank.edge : rank.interior;
    let target=carrier[p]-1;
    if (target<0 && difference>.025) {
      const x=p%frame.w, y=Math.floor(p/frame.w);
      const neighbors=[x>0?p-1:p,x+1<frame.w?p+1:p,y>0?p-frame.w:p,y+1<frame.h?p+frame.w:p];
      for (const q of neighbors) if (splatId[q] && (!accepted||accepted.has(objectId[q]))) {
        target=splatId[q]-1;
        break;
      }
    }
    if (difference<-.025 && id>=0) lane[id]-=pixelLoss;
    if (difference>.025 && target>=0) lane[target]+=pixelLoss;
    if (geometry>.015 && id>=0 && live && (target!==id || error<=.025)) {
      lane[id]-=geometry;
      if (target>=0 && target!==id) lane[target]+=geometry;
    }
  }
  for(const [i,p] of locked.entries()) {
    const values=pinSample(frame,source,p);
    if (!shot.pinBaseline) continue;
    if (values.some((value,c)=>value!==shot.pinBaseline[i][c])) stats.pinChanges++;
  }
  if (!shot.pinBaseline && locked.length) shot.pinBaseline=locked.map(p=>pinSample(frame,source,p));
  stats.loss=stats.edgeLoss+stats.interiorLoss;
  return stats;
}

function fitChannels({world,views,asset,eligible,w,h,draw,coverageOf,target,rounds,prune,tolerance,minimumScale,
  maximumScale,sdfAssist,objects,search}) {
  const options=settings(search,world);
  const shots=views.map(entry=>({entry,objects,wanted:target(entry.reference,entry.mask,w,h),
    channels:referenceChannels(entry,w,h)}));
  const training=shots.filter(shot=>!shot.entry.holdout);
  const held=shots.filter(shot=>shot.entry.holdout);
  if (!training.length) throw new RangeError('Splat fit needs at least one fitting view');
  function spec(state) {
    const edits=[],attributes=[];
    for (const [i,change] of [...state].sort((a,b)=>a[0]-b[0])) {
      const {scale,...fields}=change;
      if (scale!==undefined && scale!==1) edits.push([i,scale]);
      if (Object.keys(fields).length) attributes.push([i,fields]);
    }
    return {...asset,edits,...(attributes.length&&{attributes})};
  }
  function evaluate(state,group,scoreRows=false) {
    const rank=scoreRows && {edge:new Float32Array(world.count),interior:new Float32Array(world.count),
      seen:new Uint32Array(world.count),colors:new Map()};
    const fit=state.size ? spec(state) : false;
    const metrics=group.map(shot=>{
      const frame=draw(shot.entry,{sdfAssist:false,splatFit:fit,passes});
      return measure(frame,coverageOf(frame),shot,options,rank);
    });
    const sum=key=>metrics.reduce((n,row)=>n+row[key],0);
    return {rank,metrics,loss:sum('loss'),edgeLoss:sum('edgeLoss'),interiorLoss:sum('interiorLoss')};
  }
  for (const shot of training) shot.carrier=draw(shot.entry,{sdfAssist,splatFit:false,passes:['splatId']}).passes.splatId;
  let state=new Map(), baseline=evaluate(state,training,true), current=baseline, trials=0;
  const stages={edge:0,interior:0,prune:0};
  const key=(phase)=>phase==='edge'?'edgeLoss':'interiorLoss';
  const safe=(a,b,slack=.05)=>a.metrics.every((row,i)=>!row.pinChanges &&
    row.loss<=b.metrics[i].loss+slack && row.protected<=b.metrics[i].protected+EPS);
  function propose(changes) {
    const next=new Map(state);
    for(const [row,change] of changes) next.set(row,{...next.get(row),...change});
    return next;
  }
  function rotation(value) { return Math.atan2(Math.sin(value),Math.cos(value)); }
  function* geometry(ranked) {
    if (!ranked.length) return;
    const scale=(i,priority)=>clamp((state.get(i)?.scale??1)*(priority>0?1.18:.82),minimumScale,maximumScale);
    for (const count of new Set([ranked.length,Math.min(3,ranked.length),1])) {
      yield propose(ranked.slice(0,count).map(([i,priority])=>[i,{scale:scale(i,priority)}]));
    }
    for (const [i,priority] of ranked) {
      const layout=world.splatFootprints;
      const authored=layout?.styles[(layout.indices[i]??0)-1];
      const starting=state.get(i)?.footprint??authored;
      const shapes=options.shapes.slice();
      if (starting && !shapes.some(shape=>shape&&shape.shape===starting.shape)) shapes.push(starting);
      for(const offset of options.rotations) for(const shape of shapes) {
        if (!shape && (offset || authored?.depth==='plane')) continue;
        const footprint=shape && {...shape,rotation:rotation(shape.rotation+offset)};
        if (JSON.stringify(footprint)===JSON.stringify(starting)) continue;
        yield propose([[i,{footprint}]]);
        yield propose([[i,{footprint,scale:scale(i,priority)}]]);
      }
    }
  }
  function* paints() {
    if (!options.pigment) return;
    const ranked=eligible.filter(i=>current.rank.colors.get(i)?.[4]>EPS)
      .sort((a,b)=>current.rank.colors.get(b)[4]-current.rank.colors.get(a)[4]||a-b).slice(0,options.maxRows);
    const averages=ranked.map(i=>{
      const [r,g,b,n]=current.rank.colors.get(i);
      return [i,[r,g,b].map(value=>Math.round(value/n))];
    });
    const distance=(a,b)=>rgb(a).reduce((sum,n,c)=>sum+(n-b[c])**2,0);
    function candidates(color) {
      return options.swatches.length ? options.swatches.slice().sort((a,b)=>distance(a,color)-distance(b,color)||a-b) :
        [pack(color)];
    }
    if (averages.length) yield propose(averages.map(([i,color])=>[i,{pigment:candidates(color)[0]}]));
    for (const [i,color] of averages)
      for (const pigment of candidates(color).slice(0,3)) yield propose([[i,{pigment}]]);
  }
  function* alternating(a,b) {
    for (;;) {
      const x=a.next(), y=b.next();
      if (x.done&&y.done) return;
      if (!x.done) yield x.value;
      if (!y.done) yield y.value;
    }
  }
  const visited=new Set([JSON.stringify(spec(state))]);
  for (let round=0;round<rounds;round++) {
    let progressed=false;
    for (const [index,phase] of ['edge','interior'].entries()) {
      const remaining=2*(rounds-round)-index;
      const allowance=Math.ceil((options.trials-trials)/remaining), end=trials+allowance;
      if (!allowance) break;
      const ranked=eligible.map(i=>[i,current.rank[phase][i]]).filter(([,score])=>Math.abs(score)>EPS)
        .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])||a[0]-b[0]).slice(0,options.maxRows);
      const candidates=phase==='edge' ? geometry(ranked) : alternating(paints(),geometry(ranked));
      let best;
      for (const next of candidates) {
        const fingerprint=JSON.stringify(spec(next));
        if (visited.has(fingerprint)) continue;
        visited.add(fingerprint);
        let trial;
        try { trial=evaluate(next,training); }
        catch (error) {
          if (!/exceeds the footprint style budget/.test(error.message)) throw error;
          continue;
        }
        trials++;
        if (safe(trial,current) && trial.loss<=current.loss+EPS &&
            trial[key(phase)]+EPS<(best?.trial??current)[key(phase)]) best={next,trial};
        if (trials>=end) break;
      }
      if (best) {
        state=best.next;
        current=evaluate(state,training,true);
        stages[phase]++;
        progressed=true;
      }
    }
    if (!progressed || trials>=options.trials) break;
  }
  if (prune && trials<options.trials) {
    const rows=eligible.filter(i=>!state.has(i)&&!current.rank.seen[i]).slice(0,Math.floor(eligible.length*prune));
    if (rows.length) {
      const next=propose(rows.map(i=>[i,{scale:0}]));
      const trial=evaluate(next,training);
      trials++;
      if (trial.loss<=current.loss+EPS&&safe(trial,current,0)) {
        state=next;
        current=trial;
        stages.prune++;
      }
    }
  }
  const beforeHeld=evaluate(new Map(),held), afterHeld=evaluate(state,held);
  const metrics=new Map();
  for (const [group,before,after] of [[training,baseline,current],[held,beforeHeld,afterHeld]]) {
    group.forEach(({entry},i)=>metrics.set(entry,{time:entry.time,camera:entry.camera,holdout:!!entry.holdout,
      before:before.metrics[i],after:after.metrics[i]}));
  }
  const result=spec(state);
  return {...result,report:{mode:'channels',eligible:eligible.length,trials,stages,
    resized:result.edits.filter(([,scale])=>scale!==0).length,omitted:result.edits.filter(([,scale])=>scale===0).length,
    reshaped:result.attributes?.filter(([,change])=>change.footprint!==undefined).length??0,
    repainted:result.attributes?.filter(([,change])=>change.pigment!==undefined).length??0,
    lossBefore:baseline.loss,lossAfter:current.loss,
    validation:held.length ? {views:held.length,passed:afterHeld.metrics.every((row,i)=>!row.pinChanges &&
      row.loss<=beforeHeld.metrics[i].loss+Math.max(.05,tolerance*beforeHeld.metrics[i].covered))} : null,
    frames:views.map(entry=>metrics.get(entry))}};
}

module.exports={fitChannels};
