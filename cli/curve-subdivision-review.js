const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const runWebGL = require('./look-webgl.js');
const png = require('./png.js');
const { difference } = require('./finite-curve-review.js');
const fixture = require('../examples/curve-subdivision-review.js');

function browserReview(kit, make, backend, distances) {
  const { width,height } = make(kit);
  const painter = backend(width,height,{ width,height,raw:true,edges:false,dither:0,damp:false });
  try {
    const views = distances.map(distance => {
      const { world } = make(kit,distance);
      const draw = curveSubdivision => {
        let stats;
        painter.draw(world,{ curveSubdivision,curveFrame:frame=>{ stats=frame; } });
        return { rgb:painter.image(), stats };
      };
      return { dense:draw(false), adaptive:draw(true) };
    });
    return { views, driver:painter.driver };
  } finally { painter.close(); }
}

function run(directory, options = {}) {
  const kit = ink.load(), { width,height } = fixture(kit), distances = [6.6,20];
  const gpu = runWebGL(options,fixture,browserReview,distances);
  fs.mkdirSync(directory,{ recursive:true });
  const report = { width,height,driver:gpu.driver,browser:gpu.browser,views:[] };
  for (const [i,distance] of distances.entries()) {
    const { world } = fixture(kit,distance);
    const render = curveSubdivision => ink.render(world,{
      w:width,h:height,px:1,raw:true,edges:false,dither:0,curveSubdivision,renderStats:true
    });
    const dense = render(false), adaptive = render(true);
    const glDense = Buffer.from(gpu.views[i].dense.rgb,'base64'), glAdaptive = Buffer.from(gpu.views[i].adaptive.rgb,'base64');
    const cpuDelta = difference(dense.rgb,adaptive.rgb), glDelta = difference(glDense,glAdaptive);
    const backendDelta = difference(adaptive.rgb,glAdaptive);
    const images = {
      dense:glDense, adaptive:glAdaptive, difference:glDelta.pixels,
      'headless-dense':dense.rgb, 'headless-adaptive':adaptive.rgb, 'headless-difference':cpuDelta.pixels,
      'renderer-difference':backendDelta.pixels
    };
    const files = Object.fromEntries(Object.entries(images).map(([name,rgb])=>{
      const file = `view-${i}-${name}.png`;
      png.write(path.join(directory,file),width,height,rgb);
      return [name,file];
    }));
    const reportError = ({ mean, maximum, changed }) => ({ mean, maximum, changed });
    report.views.push({ distance, files, webgl:{ dense:gpu.views[i].dense.stats, adaptive:gpu.views[i].adaptive.stats,
      error:reportError(glDelta) }, headless:{ dense:dense.renderStats.curveSegments,adaptive:adaptive.renderStats.curveSegments,
      subdivision:adaptive.renderStats.curveSubdivision,error:reportError(cpuDelta) },
      rendererError:reportError(backendDelta) });
  }
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

module.exports = { run };
