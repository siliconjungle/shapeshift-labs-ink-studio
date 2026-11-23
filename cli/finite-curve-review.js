const fs = require('node:fs');
const path = require('node:path');
const ink = require('../index.js');
const png = require('./png.js');
const fixture = require('../examples/finite-curves-webgl.js');
const runWebGL = require('./look-webgl.js');

function browserReview(kit, make, backend, { yaw, orbit }) {
  const { width, height } = make(kit);
  const painter = backend(width,height,{ width,height,raw:true,edges:false,dither:0,damp:false });
  try {
    const frames = yaw.map(angle => {
      const { world } = make(kit,angle);
      let curves;
      painter.draw(world,{ curveFrame:value=>{curves=value;} });
      const image = painter.image();
      painter.draw(world,{ curveMode:'splats' });
      return { image, carrier: painter.image(), curves };
    });
    const motion = [];
    if (orbit) {
      const { world } = make(kit);
      for (let i=0; i<36; i++) {
        const yaw = .47*Math.sin(i*Math.PI/18);
        painter.draw(world,{ camera:{ ...world.cam,yaw } });
        motion.push(painter.image());
      }
    }
    return { frames, motion, driver:painter.driver };
  } finally { painter.close(); }
}

function difference(reference, image) {
  const pixels = new Uint8Array(image.length);
  let sum = 0, maximum = 0, changed = 0;
  for (let i=0; i<image.length; i+=3) {
    const r = Math.abs(image[i]-reference[i]), g = Math.abs(image[i+1]-reference[i+1]),
      b = Math.abs(image[i+2]-reference[i+2]);
    const error = Math.max(r,g,b);
    if (error > 2) changed++;
    maximum = Math.max(error,maximum);
    sum += r+g+b;
    pixels[i] = Math.min(255,error*4);
    pixels[i+1] = Math.min(255,error*2);
    pixels[i+2] = Math.min(255,error);
  }
  return { pixels, mean:sum/image.length, maximum, changed };
}

function run(directory, options = {}) {
  const yaw = [0,-.35,.35], kit = ink.load(), { width,height } = fixture(kit);
  const result = runWebGL(options,fixture,browserReview,{ yaw,orbit:!!options.orbit });
  const report = { width,height, driver:result.driver, browser:result.browser, frames:[] };
  fs.mkdirSync(directory,{ recursive:true });
  for (const [i,angle] of yaw.entries()) {
    const { world } = fixture(kit,angle);
    const cpu = ink.render(world,{ w:width,h:height,px:1,raw:true,edges:false,dither:0 }).rgb;
    const { image,carrier,curves } = result.frames[i];
    const gpu = Buffer.from(image,'base64'), gaussian = Buffer.from(carrier,'base64');
    const { pixels, ...error } = difference(cpu,gpu);
    const data = { webgl:gpu, headless:cpu, carrier:gaussian, difference:pixels };
    const files = Object.fromEntries(Object.entries(data).map(([kind,rgb])=>{
      const file = `view-${i}-${kind}.png`;
      png.write(path.join(directory,file),width,height,rgb);
      return [kind,file];
    }));
    report.frames.push({ yaw:angle, curves, error, files });
  }
  if (result.motion.length) {
    const target = path.join(directory,'orbit');
    fs.mkdirSync(target,{ recursive:true });
    for (const [i, frame] of result.motion.entries())
      png.write(path.join(target,`frame-${String(i).padStart(2,'0')}.png`),width,height,Buffer.from(frame,'base64'));
    report.orbit = { directory:'orbit', frames:result.motion.length, fps:12 };
  }
  fs.writeFileSync(path.join(directory,'review.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

module.exports = { run };
