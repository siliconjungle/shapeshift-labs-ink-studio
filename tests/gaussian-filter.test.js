const test = require('node:test');
const assert = require('node:assert/strict');
const ink = require('..');
const { prepare, opacity } = require('../src/gaussian-filter.js');

const w = 95, h = 71, fov = 38 * Math.PI / 180, focal = h / (2 * Math.tan(fov / 2));
function world(center, covariance, dist) {
  const data = new Float32Array(16), [xx,xy,xz,yy,yz,zz] = covariance;
  data.set([...center,.55,xx,xy,xz,0xffffff,yy,yz,zz]);
  return { count:1,data,gaussianCloud:true,seed:1,detail:14,radius:6,
    moving:new Int32Array(),back:new Int32Array(),bg:[0,0,0],pal:[0,0xffffff],dither:0,
    fog:{c:0,start:1,max:0},outline:{c:0,edge:0},cam:{target:[0,0,0],yaw:0,pitch:0,dist,fov,sway:0} };
}
const draw = (scene, frame) => ink.render(scene, { w, h, px:1, raw:true, ...frame });
function energy({ rgb }) {
  let sum = 0;
  for (let i=0;i<rgb.length;i+=3) sum += rgb[i];
  return sum;
}

test('the native pixel-grid filter preserves the mass of subpixel Gaussians across camera phases', () => {
  assert.throws(() => prepare({ footprint:'bad' }), /Gaussian filter/);
  assert.throws(() => prepare({ variance:Infinity }), /variance/);
  assert(Math.abs(opacity(.04,0,.04,.3)-.04/.34) < 1e-12);
  const dist = 11.5, sigma = .03, cov = sigma**2;
  const scene = world([.19,-.14,0], [cov,0,0,cov,0,cov], dist);
  const expected = Math.PI*2*.55*(focal*sigma/dist)**2*255;
  const samples = [];
  for (const phase of [0,.22,.49,.73]) {
    const target = [phase*dist/focal,phase*dist/focal,0];
    const compensated = energy(draw(scene,{target,gaussianFilter:{footprint:'compensated'}}));
    const legacy = energy(draw(scene,{target}));
    assert(Math.abs(compensated-expected) < 5, String(compensated));
    assert(legacy > expected*2.8, String(legacy));
    samples.push(compensated);
  }
  assert(Math.max(...samples)-Math.min(...samples) <= 5);
  const scaled = ink.render(scene,{w:w*2,h:h*2,px:2,raw:true,gaussianFilter:{footprint:'compensated'}});
  assert.deepEqual(scaled.rgb,draw(scene,{gaussianFilter:{footprint:'compensated'}}).rgb);
});

test('the close oblique footprint matches independent principal-axis ray evaluation on the art grid', () => {
  const dist = 3.25, sx = .58, sz = Math.sqrt(1-sx*sx), major = 1.1, minor = .095, vertical = .235;
  const center = [.80,.20,0], cov = [
    (major*sx)**2+(minor*sz)**2,0, -(major**2-minor**2)*sx*sz, vertical**2,0,
    (major*sz)**2+(minor*sx)**2
  ];
  const scene = world(center,cov,dist), affine = draw(scene);
  const exact = draw(scene,{gaussianFilter:{projection:'ray',variance:0}});
  const whiten = ([x,y,z]) => [(sx*x+sz*z)/major,y/vertical,(-sz*x+sx*z)/minor];
  const P = whiten([center[0],center[1],dist]);
  const dot = (a,b) => a.reduce((sum,n,i)=>sum+n*b[i],0);
  let approximate = 0, accurate = 0, covered = 0;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const D = whiten([(x+.5-w/2)/focal,(h/2-y-.5)/focal,1]);
    const t = Math.max(.15*dist,dot(P,D)/dot(D,D));
    const q = P.reduce((sum,n,i)=>sum+(n-t*D[i])**2,0);
    const reference = q <= 9 ? Math.round(.55*255*Math.exp(-.5*q)) : 0;
    const at = (y*w+x)*3;
    approximate += Math.abs(affine.rgb[at]-reference);
    accurate += Math.abs(exact.rgb[at]-reference);
    covered += reference > 0;
  }
  assert(covered > 700);
  assert(accurate < 200, String({ accurate }));
  assert(approximate > 10_000, String({ approximate }));
});

test('WebGL renders the compensated ray footprint on its native grid', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const run = require('../cli/look-webgl.js');
  const result = run({ asyncFixture:true }, ({ makeBuilder }) => {
    const B=makeBuilder(11,[0,0xffffff]);
    B.iso(.8,.2,0,.25,B.P[1],.55);
    const w=B.finish({cam:{target:[0,0,0],yaw:0,pitch:0,dist:3.25},radius:6});
    w.data.set([.251,.021,-.387,0xffffff,.104,-.044,.699],4);
    return {...w,gaussianCloud:true};
  }, (kit, build, render) => {
    const w=build(kit), surface=render(95,71,{raw:true,dither:0,reflection:false});
    try {
      const pixel={left:[21,35],center:[71,40]};
      surface.draw(w);
      const affine=surface.sample(pixel);
      surface.draw(w,{gaussianFilter:{footprint:'compensated',projection:'ray',variance:.3}});
      return {affine,ray:surface.sample(pixel)};
    } finally { surface.close(); }
  });
  assert(result.ray.left[0]>result.affine.left[0]+6, JSON.stringify(result));
  assert(result.ray.center[0]>70, JSON.stringify(result));
});
