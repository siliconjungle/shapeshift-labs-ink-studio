const Selectors = require('../src/target-selectors.js');
const RowAssets = require('./render-row-assets.js');
const Fit = require('./splat-fit-asset.js');
const {fitChannels} = require('./splat-fit-channels.js');
const {render} = require('./render.js');

const clamp = (n,lo,hi)=>Math.min(hi,Math.max(lo,n));

function target(image, mask, w, h) {
  if (image.w!==w || image.h!==h || image.data?.length!==w*h*4 || !(image.max>0) ||
      mask && (mask.w!==w || mask.h!==h || mask.data?.length!==w*h*4 || !(mask.max>0)))
    throw new RangeError('Splat fit reference and protection mask must match the native grid');
  const coverage=new Float32Array(w*h), protection=new Float32Array(w*h), edge=new Uint8Array(w*h);
  for (let p=0;p<coverage.length;p++) {
    coverage[p]=image.data[p*4+3]/image.max;
    if (mask) protection[p]=mask.data[p*4]/mask.max*mask.data[p*4+3]/mask.max;
  }
  for (let y=0,p=0;y<h;y++) for (let x=0;x<w;x++,p++) {
    const adjacent=[x>0?p-1:p,x+1<w?p+1:p,y>0?p-w:p,y+1<h?p+w:p];
    if (adjacent.some(q=>Math.abs(coverage[q]-coverage[p])>.075) || coverage[p]>.075 && coverage[p]<.925)
      edge[p]=1;
  }
  return {coverage,protection,edge,image};
}

function coverageOf(frame) {
  const mattes=frame.objectMattes;
  if (!mattes) return Float32Array.from(frame.alpha,n=>n/255);
  const count=mattes.objects.length;
  return Float32Array.from({length:frame.w*frame.h},(_,p)=>{
    let sum=0;
    for (let i=0;i<count;i++) sum+=mattes.camera[p*count+i];
    return Math.min(1,sum);
  });
}

function measure(frame, wanted, rank, carrier) {
  const {coverage,protection,edge,image}=wanted;
  const source=coverageOf(frame);
  let silhouette=0, protectedError=0, flat=0, covered=0, protectedPixels=0;
  for (let p=0;p<coverage.length;p++) {
    const difference=coverage[p]-source[p];
    if (edge[p]) silhouette+=Math.abs(difference);
    else flat+=Math.abs(difference);
    if (coverage[p]>.5) covered++;
    let colorError=0;
    if (protection[p]) {
      for (let c=0;c<3;c++) colorError+=Math.abs(frame.rgb[p*3+c]/255-image.data[p*4+c]/image.max)/3;
      protectedError+=colorError*protection[p];
      protectedPixels+=protection[p];
    }
    if (!rank || Math.abs(difference)<.025 && colorError<.04) continue;
    const value=Math.abs(difference)*(edge[p]?4:1)+8*colorError*protection[p];
    const ids=frame.passes.splatId, owner=ids[p]-1, behind=carrier[p]-1;
    if (difference<-.025 && owner>=0) rank.shrink[owner]+=value;
    else if (difference>.025 && behind>=0) rank.grow[behind]+=value;
    if (colorError>.04 && owner>=0 && behind>=0 && owner!==behind) {
      rank.shrink[owner]+=value;
      rank.grow[behind]+=value;
    }
  }
  return {silhouette,flat,protected:protectedError,covered,protectedPixels,
    loss:4*silhouette+flat+8*protectedError};
}

function fit(world, {views,pose,view,width:w,height:h,sdfAssist={posed:true},select,rounds=3,
  prune=.08,tolerance=.0025,minimumScale=.4,maximumScale=1.6,objects,search,pins}={}) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || Math.min(w,h)<8 || Math.max(w,h)>512 ||
      !Array.isArray(views) || !views.length || views.length>12 || w*h*views.length>1e6 ||
      !Number.isSafeInteger(rounds) || rounds<1 || rounds>8 || !Number.isFinite(prune) || prune<0 || prune>.4 ||
      !Number.isFinite(tolerance) || tolerance<0 || tolerance>.03 ||
      !Number.isFinite(minimumScale) || minimumScale<.4 || minimumScale>=1 ||
      !Number.isFinite(maximumScale) || maximumScale>2 || maximumScale<=1)
    throw new RangeError('Invalid native grid or search budget for splat fit');
  if (world.anim?.stateful) throw new RangeError('Splat fit requires a seekable scene for repeated renders');
  const labels=Selectors.index(world), selectors=select===undefined ? [] : (Array.isArray(select) ? select : [select]).map(Selectors.prepare);
  const pinsList=pins===undefined ? [] : Array.isArray(pins) ? pins : [pins];
  if (pinsList.length>32) throw new RangeError('Splat fit accepts at most 32 pin selectors');
  const pinSelectors=pinsList.map(Selectors.prepare);
  const asset={format:Fit.format,version:1,rows:world.count,signature:RowAssets.signature(world)};
  const eligible=[];
  for (let i=0;i<world.count;i++)
    if (Fit.eligible(world,i) && (!selectors.length || selectors.some(selector=>Selectors.matches(selector,labels.row(i)))) &&
        !pinSelectors.some(selector=>Selectors.matches(selector,labels.row(i)))) eligible.push(i);
  if (!eligible.length) throw new RangeError('Splat fit selection contains no eligible opaque splats');
  function draw(entry, settings) {
    pose(world,entry.time);
    return render(world,{...view({w,h,t:entry.time}),...entry.camera,...settings,w,h,px:1,
      transparent:!objects,objectMattes:objects ?? false,passes:settings.passes??['splatId'],shutter:false,renderGrid:false,renderGraph:false,inspection:false,
      composite:false,depthOfField:false,motionalCoverage:false,cameraGuides:false});
  }
  for (const entry of views) {
    const {time,camera={},reference,mask,holdout=false}=entry;
    if (!Number.isFinite(time) || time<0 || time>3600 || typeof holdout!=='boolean' ||
        !Object.keys(camera).every(key=>['yaw','pitch','zoom','target','orbit','pan','dist','ortho'].includes(key)))
      throw new RangeError('Invalid native splat approval view');
    if (!reference) throw new TypeError('Splat fit needs an approved RGBA reference for every view');
  }
  if (search!==undefined || pins!==undefined || views.some(entry=>
    ['depth','normal','pigment','pins'].some(key=>entry[key]!==undefined)))
    return fitChannels({world,views,asset,eligible,w,h,draw,coverageOf,target,rounds,prune,tolerance,minimumScale,
      maximumScale,sdfAssist,objects,search});
  const frames=views.map(entry=>{
    const {reference,mask}=entry;
    const wanted=target(reference,mask,w,h);
    const surface=draw(entry,{sdfAssist,splatFit:false});
    return {entry,wanted,carrier:surface.passes.splatId};
  });
  if (frames.every(frame=>frame.entry.holdout)) throw new RangeError('Splat fit needs at least one fitting view');
  function evaluate(edits, scoreRows=false) {
    const rank=scoreRows && {grow:new Float32Array(world.count),shrink:new Float32Array(world.count)};
    const seen=scoreRows && new Uint32Array(world.count);
    const splatFit=edits.size ? {...asset,edits:[...edits]} : false;
    const metrics=frames.map(({entry,wanted,carrier})=>{
      const frame=draw(entry,{sdfAssist:false,splatFit});
      if (seen && !entry.holdout) for (const id of frame.passes.splatId) if (id) seen[id-1]++;
      return measure(frame,wanted,entry.holdout ? null : rank,carrier);
    });
    return {rank,seen,metrics,loss:metrics.reduce((sum,m,i)=>sum+(frames[i].entry.holdout?0:m.loss),0)};
  }
  const edits=new Map(), baseline=evaluate(edits,true);
  let current=baseline, trials=1;
  const guard=(candidate, previous, slack)=>candidate.metrics.every((m,i)=>m.loss<=previous.metrics[i].loss+slack(i) &&
    m.protected<=previous.metrics[i].protected+slack(i)/8);
  for (let round=0;round<rounds;round++) {
    const {rank}=current;
    const ranked=eligible.map(i=>[i,rank.grow[i]-rank.shrink[i]]).filter(([,n])=>n!==0)
      .sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]) || a[0]-b[0]);
    if (!ranked.length) break;
    let best;
    for (const fraction of [1,.35,.10]) {
      const changes=new Map(edits);
      for (const [i,priority] of ranked.slice(0,Math.max(1,Math.ceil(ranked.length*fraction)))) {
        const scale=(changes.get(i) ?? 1)*(priority>0?1.18:.82);
        changes.set(i,clamp(scale,minimumScale,maximumScale));
      }
      const candidate=evaluate(changes);
      trials++;
      if (candidate.loss+1e-5<(best?.candidate.loss ?? current.loss) && guard(candidate,current,()=>.05))
        best={changes,candidate};
    }
    if (!best) break;
    edits.clear();
    for (const edit of best.changes) edits.set(...edit);
    current=evaluate(edits,true);
    trials++;
  }
  if (prune) {
    const limit=Math.floor(eligible.length*prune);
    // Fully occluded rows rank first. Then favor rows with no boundary or protected error.
    const ranked=eligible.filter(i=>!edits.has(i)).sort((a,b)=>
      (current.seen[a]+8*(current.rank.grow[a]+current.rank.shrink[a]))-
      (current.seen[b]+8*(current.rank.grow[b]+current.rank.shrink[b])) || a-b);
    for (const fraction of [1,.5,.25,.125]) {
      const count=Math.floor(limit*fraction);
      if (!count) break;
      const changes=new Map(edits);
      for (const i of ranked.slice(0,count)) changes.set(i,0);
      const candidate=evaluate(changes);
      trials++;
      const slack=i=>frames[i].entry.holdout ? 0 : tolerance*current.metrics[i].covered;
      if (candidate.loss<=Math.max(baseline.loss,current.loss)+1e-5 && guard(candidate,current,slack)) {
        for (const i of ranked.slice(0,count)) edits.set(i,0);
        current=candidate;
        break;
      }
    }
  }
  const ordered=[...edits].sort((a,b)=>a[0]-b[0]);
  return {...asset,edits:ordered,report:{eligible:eligible.length,trials,
    resized:ordered.filter(([,scale])=>scale!==0).length,omitted:ordered.filter(([,scale])=>scale===0).length,
    lossBefore:baseline.loss,lossAfter:current.loss,
    frames:frames.map(({entry},i)=>({time:entry.time,camera:entry.camera,holdout:!!entry.holdout,
      before:baseline.metrics[i],after:current.metrics[i]}))}};
}

module.exports={fit,coverageOf};
