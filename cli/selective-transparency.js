const SelectiveTransparency = require('../src/selective-transparency.js');

// Painter-ordered inputs arrive once. Overflow replays that pixel in input
// order and switches it to immediate compositing for the rest of the draw.
function create(settings, width, height, fragmentBudget, opaqueDepth, composite) {
  const [left,top,w,h] = SelectiveTransparency.bounds(settings.region,width,height);
  const bottom = height-top-h, right = left+w;
  const stacks = new Map(), full = new Uint8Array(width*height);
  const receipt = SelectiveTransparency.report(settings,width,height,{fragmentBudget});
  const { layers, maxPixels, colorDelta, depthBias } = settings;
  let retained = 0, peakFragments = 0;
  const xyz = p => [p%width,height-1-Math.floor(p/width)];
  const note = (p,key) => receipt.record(...xyz(p),key);

  function occluded(p, depth) {
    if (!opaqueDepth || !(depth > opaqueDepth[p]+depthBias)) return false;
    note(p,'culledFragments');
    return true;
  }

  function add(p, depth, sample) {
    const x = p%width, y = Math.floor(p/width);
    if (full[p] || x < left || x >= right || y < bottom || y >= bottom+h) {
      composite(p,...sample);
      return;
    }
    const stack = stacks.get(p);
    if (stack?.length === 1) note(p,'overlapPixels');
    if (stack?.length >= layers || retained >= fragmentBudget) {
      note(p,stack?.length >= layers ? 'layerBudgetPixels' : 'fragmentBudgetPixels');
      full[p] = 1;
      if (stack) {
        for (const row of stack) composite(p,...row.sample);
        retained -= stack.length;
        stacks.delete(p);
      }
      composite(p,...sample);
      return;
    }
    const row = { depth, sample };
    if (stack) stack.push(row);
    else stacks.set(p,[row]);
    peakFragments = Math.max(peakFragments,++retained);
  }

  // Every inverted adjacent swap changes source-over by alphaA*alphaB*(colorA-colorB).
  // Summing those differences bounds the effect before nearer layers attenuate it.
  function impact(stack) {
    let bound = 0;
    for (let i=0; i<stack.length; i++) {
      const a = stack[i];
      for (let j=i+1; j<stack.length; j++) {
        const b = stack[j];
        if (a.depth >= b.depth) continue;
        const A = a.sample, B = b.sample;
        bound += A[3]*B[3]*Math.max(Math.abs(A[4]-B[4]),Math.abs(A[5]-B[5]),Math.abs(A[6]-B[6]));
      }
    }
    return bound;
  }

  function color(stack) {
    const rgb = [0,0,0];
    for (const { sample:s } of stack) {
      const a = s[3];
      for (let c=0;c<3;c++) rgb[c] = s[4+c]*a + rgb[c]*(1-a);
    }
    return rgb;
  }

  function finish() {
    let attempted = 0;
    // Consume the pixel budget in top-left grid order, independent of which splat touched a pixel first.
    for (let y=bottom+h-1; y>=bottom; y--) for (let x=left; x<right; x++) {
      const p = y*width+x;
      let stack = stacks.get(p);
      if (!stack) continue;
      const bound = impact(stack);
      if (bound > 0 && bound >= colorDelta) {
        note(p,'crossingPixels');
        if (attempted >= maxPixels) note(p,'pixelBudgetPixels');
        else {
          attempted++;
          const sorted = stack.slice().sort((a,b)=>b.depth-a.depth);
          const before = color(stack), after = color(sorted);
          if (Math.max(...before.map((value,c)=>Math.abs(value-after[c]))) > colorDelta) {
            stack = sorted;
            note(p,'sortedPixels');
          }
        }
      }
      for (const { sample } of stack) composite(p,...sample);
    }
    stacks.clear();
    return receipt.finish({peakFragments,sortAttempts:attempted});
  }
  return { add, occluded, finish };
}

module.exports = { create };
