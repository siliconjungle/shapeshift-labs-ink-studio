const { prepareReview, captureReview, compositeMatte, labCache, markEdges, sheet, edgeLegend } = require('./readability-review.js');
const { preparePairs } = require('./palette-weather.js');

const packed = (rgb,p) => rgb[p*3]*65536 + rgb[p*3+1]*256 + rgb[p*3+2];
const hex = color => '#'+color.toString(16).padStart(6,'0');
const format = 'ink-studio/shadow-readability';

function measure(frame, pairs, groupBy, thresholds, maxLightness, matte) {
  const scene = compositeMatte(frame,matte), {w,h,rgb,alpha} = scene;
  const {readabilityMask,passes} = frame, {depth} = passes;
  const ids = passes[groupBy+'Id'], labels = passes[groupBy === 'material' ? 'materials' : 'objects'];
  const rows = new Map(), overlay = new Uint8Array(w*h), lab = labCache();
  const statistics = subjects => ({subjects,contacts:0,samples:0,sameSwatch:0,weakColor:0,weakLightness:0,
    sumColor:0,sumLightness:0,worstColor:null,worstLightness:null});
  pairs?.forEach(({subjects},i)=>rows.set(i,statistics(subjects)));

  function compare(row,p,q) {
    row.contacts++;
    const a = packed(rgb,p), b = packed(rgb,q), A = lab(a), B = lab(b);
    if (Math.max(A[0],B[0]) > maxLightness) return;
    const lightnessDistance = Math.abs(A[0]-B[0]);
    const colorDistance = Math.hypot(lightnessDistance,A[1]-B[1],A[2]-B[2]);
    const same = a === b, colorWeak = same || colorDistance < thresholds.color,
      lightWeak = same || lightnessDistance < thresholds.lightness;
    row.samples++;
    row.sameSwatch += Number(same);
    row.weakColor += Number(colorWeak);
    row.weakLightness += Number(lightWeak);
    row.sumColor += colorDistance;
    row.sumLightness += lightnessDistance;
    const worstColor = !row.worstColor || colorDistance < row.worstColor.colorDistance,
      worstLightness = !row.worstLightness || lightnessDistance < row.worstLightness.lightnessDistance;
    if (worstColor || worstLightness) {
      const example = { a:{x:p%w,y:Math.floor(p/w),swatch:hex(a),lightness:A[0]},
        b:{x:q%w,y:Math.floor(q/w),swatch:hex(b),lightness:B[0]},colorDistance,lightnessDistance };
      if (worstColor) row.worstColor = example;
      if (worstLightness) row.worstLightness = example;
    }
    const rank = 1 + Number(colorWeak) + 2*Number(lightWeak);
    overlay[p] = Math.max(overlay[p],rank);
    overlay[q] = Math.max(overlay[q],rank);
  }

  function edge(p,q) {
    if (!Number.isFinite(depth[p]) || !Number.isFinite(depth[q]) ||
        frame.alpha?.[p] === 0 || frame.alpha?.[q] === 0 || alpha && (alpha[p] !== 255 || alpha[q] !== 255)) return;
    if (pairs) {
      const P = readabilityMask[p], Q = readabilityMask[q];
      if (P && Q && P !== Q) for (const [i,{a,b}] of pairs.entries()) {
        const mask = a | b;
        if ((P&mask) === a && (Q&mask) === b) compare(rows.get(i),p,q);
        if ((P&mask) === b && (Q&mask) === a) compare(rows.get(i),q,p);
      }
      return;
    }
    const a = ids[p], b = ids[q];
    if (!a || !b || a === b) return;
    const [lo,hi] = a < b ? [a,b] : [b,a], key = lo+'/'+hi;
    if (!rows.has(key)) rows.set(key,statistics([labels[lo] ?? lo,labels[hi] ?? hi]));
    if (a < b) compare(rows.get(key),p,q);
    else compare(rows.get(key),q,p);
  }

  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const p = y*w+x;
    if (x+1 < w) edge(p,p+1);
    if (y+1 < h) edge(p,p+w);
  }
  const contacts = [...rows.values()].map(({sumColor,sumLightness,...row}) => {
    const {samples} = row, share = value => samples ? value/samples : null;
    const flags = [
      ['same-swatch',row.sameSwatch], ['weak-color',row.weakColor], ['weak-lightness',row.weakLightness]
    ].filter(([,n])=>n > 0 && n/samples >= thresholds.weakShare).map(([kind])=>kind);
    return {...row, meanColor:share(sumColor),meanLightness:share(sumLightness),
      sameSwatchShare:share(row.sameSwatch),weakColorShare:share(row.weakColor),
      weakLightnessShare:share(row.weakLightness),flags};
  });
  const findings = contacts.flatMap(row=>row.flags.map(kind=>({kind,subjects:row.subjects})));
  const samples = contacts.reduce((total,row)=>total+row.samples,0);
  return {frame:{w,h,rgb,alpha},marked:markEdges(scene,overlay),contacts,findings,shadowSamples:samples,
    ...(!samples && {status:'No dark contacts'})};
}

function reviewShadowReadability(world, options={}) {
  const {plan=world.shadowReadability ?? {}, view={}} = options;
  if (!plan || Object.getPrototypeOf(plan)!==Object.prototype) throw new TypeError('Darks review needs a plan object');
  const {maxLightness=.4,groupBy='material',pairs:requested,thresholds={},...review} = plan;
  if (!Number.isFinite(maxLightness) || maxLightness<0 || maxLightness>1 || !['material','object'].includes(groupBy))
    throw new RangeError('Darks review needs a lightness limit in 0–1 and a material or object grouping');
  if (!thresholds || Object.getPrototypeOf(thresholds)!==Object.prototype ||
      Object.keys(thresholds).some(key=>!['color','lightness','weakShare'].includes(key)))
    throw new TypeError('Invalid darks review thresholds');
  const prepared = prepareReview({...review,thresholds:{color:.06,lightness:.035,...thresholds}},
    view.time ?? view.t ?? world.lookSnapshot?.time ?? 0, {optionalSubjects:true,lookFields:['effectPalettes']});
  if (prepared.subjects.length === 1 || !prepared.subjects.length && requested !== undefined)
    throw new TypeError('Darks review needs two or more subjects to select contacts');
  const pairs = prepared.subjects.length ? preparePairs(prepared.subjects,requested) : null;
  const channels = ['depth',...(!pairs ? [groupBy+'Id'] : [])];
  const result = captureReview(world,prepared,{...options,channels},
    (frame,subjects,thresholds,matte)=>measure(frame,pairs,groupBy,thresholds,maxLightness,matte));
  const {depthBias,...limits} = prepared.thresholds;
  const {samples} = result;
  return {
    image:sheet(result.kit,result.tiles,{...result.layout,h:result.layout.h+12},result.columns,
      {title:'Shadow readability',subtitle:'Native export / dark-edge evidence'}),
    report:{format,version:1,scene:world.id??null,...result.frame,maxLightness,
      ...(pairs ? {subjects:prepared.subjects,pairs:pairs.map(row=>row.subjects)} : {groupBy}),
      thresholds:limits,...(prepared.matte && {matte:prepared.matte}),views:prepared.views,states:prepared.states,
      flagCount:samples.reduce((sum,row)=>sum+row.findings.length,0),samples,
      legend:Object.fromEntries(edgeLegend)}
  };
}

module.exports = { reviewShadowReadability, measure };
