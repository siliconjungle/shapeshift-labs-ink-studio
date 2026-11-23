const { measureFrame } = require('./curve-quality-review.js');

const strandThresholds = { coverage: .45, joinLuma: .09, flickerLuma: .075 };
const silhouetteThreshold = .5;

function measure(reference, candidate, fixture, previous, hold) {
  const { w, h } = reference;
  const a = reference.passes, b = candidate.passes, subject = fixture.silhouette;
  const aSubject = a.objects?.indexOf(subject), bSubject = b.objects?.indexOf(subject);
  const aPaint = a.objects?.indexOf('sluice-screen'), bPaint = b.objects?.indexOf('sluice-screen');
  const residual = new Int16Array(reference.rgb.length);
  const evidence = new Uint8Array(residual.length);
  const silhouette = { referencePixels: 0, candidatePixels: 0, lostPixels: 0, addedPixels: 0 };
  let squareError = 0, paintError = 0, paintPixels = 0, deltaSquare = 0, deltaPixels = 0;
  function covered(passes, id, p) {
    if (fixture.strands) return passes.strandCoverage[p] >= strandThresholds.coverage;
    if (subject) return id > 0 && passes.objectId[p] === id;
    return passes.coverage[p] >= silhouetteThreshold;
  }
  for (let p = 0; p < w*h; p++) {
    const hasA = covered(a, aSubject, p), hasB = covered(b, bSubject, p), i = 3*p;
    silhouette.referencePixels += Number(hasA);
    silhouette.candidatePixels += Number(hasB);
    silhouette.lostPixels += Number(hasA && !hasB);
    silhouette.addedPixels += Number(hasB && !hasA);
    const painted = fixture.paint && aPaint > 0 && bPaint > 0 && a.objectId[p] === aPaint && b.objectId[p] === bPaint;
    if (painted) paintPixels++;
    let peak = 0;
    for (let c = i; c < i+3; c++) {
      const error = candidate.rgb[c] - reference.rgb[c];
      residual[c] = error;
      squareError += error*error;
      if (painted) paintError += error*error;
      if (previous) deltaSquare += (error - previous.residual[c]) ** 2;
      peak = Math.max(peak, Math.abs(error));
    }
    if (previous) deltaPixels++;
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
      rgbRmse8Bit: Math.sqrt(squareError / residual.length),
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
    state: { residual, strand: curve ? curve.state : undefined }
  };
}

module.exports = { measure, strandThresholds, silhouetteThreshold };
