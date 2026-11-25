const { measureFrame } = require('./curve-quality-review.js');

const strandThresholds = { coverage: .45, joinLuma: .09, flickerLuma: .075 };
const silhouetteThreshold = .5;

function subjectPixel(passes, id, part, p, opaque, asset) {
  return id > 0 && passes.objectId[p] === id &&
    (!opaque || passes.surfaceCoverage[p] > silhouetteThreshold) &&
    (asset === undefined || passes.surfaceSources?.[passes.sourceSurface[p]]?.asset === asset) &&
    (part === undefined || (passes.parts?.[passes.partId[p]]?.part ?? null) === part);
}

function measure(reference, candidate, fixture, previous, hold) {
  const { w, h } = reference;
  const a = reference.passes, b = candidate.passes, subject = fixture.silhouette;
  const aSubject = a.objects?.indexOf(subject), bSubject = b.objects?.indexOf(subject);
  const aPaint = a.objects?.indexOf('sluice-screen'), bPaint = b.objects?.indexOf('sluice-screen');
  const residual = new Int16Array(reference.rgb.length), scope=fixture.subjectOnly && new Uint8Array(w*h);
  const evidence = new Uint8Array(residual.length);
  const silhouette = { referencePixels: 0, candidatePixels: 0, lostPixels: 0, addedPixels: 0 };
  let squareError = 0, rgbPixels=0, paintError = 0, paintPixels = 0, deltaSquare = 0, deltaPixels = 0;
  function covered(passes, id, p) {
    if (fixture.strands) return passes.strandCoverage[p] >= strandThresholds.coverage;
    if (subject) return subjectPixel(passes,id,fixture.part,p,fixture.opaque,fixture.asset);
    return passes.coverage[p] >= silhouetteThreshold;
  }
  for (let p = 0; p < w*h; p++) {
    const hasA = covered(a, aSubject, p), hasB = covered(b, bSubject, p), i = 3*p;
    silhouette.referencePixels += Number(hasA);
    silhouette.candidatePixels += Number(hasB);
    silhouette.lostPixels += Number(hasA && !hasB);
    silhouette.addedPixels += Number(hasB && !hasA);
    const inScope=!scope||hasA||hasB;
    if (scope) scope[p]=Number(inScope);
    const tracked=previous && (!scope||inScope||previous.scope[p]);
    if (inScope) rgbPixels++;
    const painted = fixture.paint && aPaint > 0 && bPaint > 0 && a.objectId[p] === aPaint && b.objectId[p] === bPaint;
    if (painted) paintPixels++;
    let peak = 0;
    for (let c = i; c < i+3; c++) {
      const error = candidate.rgb[c] - reference.rgb[c];
      residual[c] = error;
      if(inScope) squareError += error*error;
      if (painted) paintError += error*error;
      if (tracked) deltaSquare += (error - previous.residual[c]) ** 2;
      peak = Math.max(peak, Math.abs(error));
    }
    if (tracked) deltaPixels++;
    if (hasA !== hasB) evidence.set(hasA ? [251,156,70] : [88,225,240], i);
    else {
      const gray = reference.rgb[i+1] * .3;
      evidence.set([Math.min(255, gray + peak*4), Math.min(255, gray + peak), gray], i);
    }
  }
  const union = silhouette.referencePixels + silhouette.addedPixels;
  silhouette.errorFraction = union ? (silhouette.lostPixels + silhouette.addedPixels) / union : 0;
  const curve = fixture.strands && measureFrame(reference, candidate, previous?.strand, new Map(), strandThresholds);
  if (curve) for (const mark of curve.evidence) if (mark.kind === 'break' || mark.kind === 'missing-strand') {
    const [x,y] = mark.at;
    evidence.set([244,104,208], 3*(y*w+x));
  }
  const strand = curve && curve.metrics;
  const fluctuation = deltaPixels ? Math.sqrt(deltaSquare / (3*deltaPixels)) : null;
  return {
    metrics: {
      rgbRmse8Bit: rgbPixels ? Math.sqrt(squareError / (3*rgbPixels)) : null,
      silhouette,
      paint: fixture.paint ? { matchedPixels: paintPixels, rgbRmse8Bit: paintPixels ? Math.sqrt(paintError/(3*paintPixels)) : null } : null,
      strands: strand ? {
        referenceSamples: strand.referenceSamples, missingSamples: strand.missingSamples,
        missingStrands: strand.missingStrands, breaks: strand.breaks,
        trackedPixels: strand.trackedPixels, flickerPixels: strand.flickerPixels
      } : null,
      flicker: { residualDeltaRmse8Bit: fluctuation, holdRmse8Bit: hold ? fluctuation : null, pixels: deltaPixels }
    },
    evidence: { w, h, rgb: evidence },
    state: { residual, ...(scope&&{scope}), strand: curve ? curve.state : undefined }
  };
}

function lightResponse(previous, next, previousReference, reference, {id,objectId,partId}) {
  if (!previous) return null;
  const frames=[previous,next,previousReference,reference];
  const ids=frames.map(frame=>frame.passes.objects.indexOf(objectId));
  let pixels=0, candidate=0, baseline=0, error=0;
  for(let p=0;p<next.w*next.h;p++){
    if (!frames.every((frame,i)=>subjectPixel(frame.passes,ids[i],partId,p,true,id))) continue;
    pixels++;
    for(let c=p*3;c<p*3+3;c++){
      const a=next.rgb[c]-previous.rgb[c],b=reference.rgb[c]-previousReference.rgb[c];
      candidate+=a*a;
      baseline+=b*b;
      error+=(a-b)**2;
    }
  }
  return {pixels,reference: pixels?Math.sqrt(baseline/(3*pixels)):null,
    candidate:pixels?Math.sqrt(candidate/(3*pixels)):null,error:pixels?Math.sqrt(error/(3*pixels)):null};
}

module.exports = { measure, lightResponse, strandThresholds, silhouetteThreshold };
