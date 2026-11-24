'use strict';

const SplatDiagnostics = require('./splat-edit-diagnostics.js');

function compare(world,before,after,{ grid, rows, limit, view, diagnostics, time=world.lookSnapshot?.time??0 }) {
  const [w,h]=grid;
  const trace = diagnostics && SplatDiagnostics.setup(w,h,{ limit,...diagnostics });
  const render = require('./render.js').render;
  const options = { ...SplatDiagnostics.viewOptions(w,h,time,view), passes:['coverage','depth','sourceSplat'],
    ...(trace && { [SplatDiagnostics.scope]:trace.capture }) };
  const beforeFrame = render(world,{ ...options,splatFit:before??false });
  const afterFrame = render(world,{ ...options,splatFit:after??false });
  const a = inspect(beforeFrame), b = inspect(afterFrame);
  const pixels=[], bounds=[w,h,-1,-1];
  let changed=0, coverageChanged=0, depthChanged=0, omittedPixels=0;
  for (let i=0; i<w*h; i++) {
    const left=sample(a,i), right=sample(b,i);
    if (a.sourceSplatOmitted[i]>0 || b.sourceSplatOmitted[i]>0) omittedPixels++;
    const coverageDiff=Math.abs(left.coverage-right.coverage)>1e-6 || Math.abs(left.sceneCoverage-right.sceneCoverage)>1e-6;
    const depthDiff=differs(left.depth,right.depth) || differs(left.sceneDepth,right.sceneDepth);
    if (!coverageDiff && !depthDiff) continue;
    changed++;
    if (coverageDiff) coverageChanged++;
    if (depthDiff) depthChanged++;
    const x=i%w, y=Math.floor(i/w);
    bounds[0]=Math.min(bounds[0],x);
    bounds[1]=Math.min(bounds[1],y);
    bounds[2]=Math.max(bounds[2],x);
    bounds[3]=Math.max(bounds[3],y);
    if (pixels.length<limit) pixels.push({at:[x,y],before:left,after:right});
  }
  return {grid:[w,h],time,changedPixels:changed,coverageChanged,depthChanged,
    bounds:changed ? bounds : null,omittedPixels,truncated:changed>pixels.length,pixels,
    ...(trace && { diagnostics:trace.compare(beforeFrame,afterFrame) }) };

  function inspect(frame) {
    const {passes}=frame;
    if (frame.w!==w || frame.h!==h || passes?.w!==w || passes.h!==h)
      throw new RangeError('Splat preview must render the bound native grid');
    return {...passes,selected:passes.splatSources.map(source=>source && rows.has(source.id??source.renderRow))};
  }
}

const differs = (a,b) => a===null || b===null ? a!==b : Math.abs(a-b)>1e-6;
function sample(passes,pixel) {
  let coverage=0, depth=Infinity;
  for (let i=pixel*4; i<pixel*4+4; i++) {
    if (!passes.selected[passes.sourceSplat[i]]) continue;
    coverage+=passes.sourceSplatWeight[i];
    depth=Math.min(depth,passes.sourceSplatDepth[i]);
  }
  if (passes.selected[passes.sourceSplatFront?.[pixel]]) {
    const i=pixel*3;
    coverage+=passes.sourceSplatFrontMetrics[i+2];
    depth=Math.min(depth,passes.sourceSplatFrontMetrics[i+1]);
  }
  const sceneDepth=passes.depth[pixel];
  return {coverage,depth:Number.isFinite(depth) ? depth : null,sceneCoverage:passes.coverage[pixel],
    sceneDepth:Number.isFinite(sceneDepth) ? sceneDepth : null};
}

module.exports={compare};
