const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { namedNoise, graphImages } = Ink.load().KIT.procedural;

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance,
  actual + ' differs from ' + expected);
const pixels = result => result.value.raster.data;

test('the twelve named generators produce distinct, reproducible typed maps', () => {
  const fingerprints = new Set();
  for (const family of namedNoise.families) {
    const a = graphImages.noise(family,16,12,{ seed:17 });
    const b = graphImages.noise(family,16,12,{ seed:17 });
    const c = graphImages.noise(family,16,12,{ seed:17 + 2 ** 32 });
    assert.deepEqual(pixels(a),pixels(b),family);
    assert.notDeepEqual(pixels(a),pixels(c),family + ' full integer seed');
    assert(pixels(a).every(x => x >= 0 && x <= 1),family);
    assert.equal(a.value.descriptor.intent,'data');
    assert.equal(a.value.descriptor.precision,'float32');
    assert.equal(a.value.descriptor.materialSeed,17);
    assert.equal(a.value.descriptor.sampling,['white','gaussian','blue','voronoi'].includes(family) ? 'nearest' : 'linear');
    fingerprints.add(pixels(a).join(','));
  }
  assert.equal(fingerprints.size,12);
});

test('all families repeat on rectangular periods across positive and negative coordinates', () => {
  for (const family of namedNoise.families) {
    const periods = family === 'blue' ? [8,12] : [5,7];
    const blue = family === 'blue' ? {rankSize:[8,6]} : {};
    const f = namedNoise.create(family,{ seed:-19,periods,...blue });
    for (const [x,y] of [[.125,1.375],[-2.25,-5.75],[0,0],[4.875,6.875]]) {
      close(f.value(x,y),f.value(x+periods[0],y));
      close(f.value(x,y),f.value(x,y-periods[1]));
    }
  }
  const strip = namedNoise.create('perlin',{seed:7,periods:[5,null]});
  close(strip.value(.25,1.125),strip.value(5.25,1.125));
  assert.notEqual(strip.value(.25,1.125),strip.value(.25,6.125));
});

test('smooth periodic noise retains seam derivatives in both simplex modes', () => {
  for (const [family,periods,p,tiling] of [
    ['perlin',[5,7],[0,1.43],'gradient-lattice'],
    ['simplex',[5.25,7],[0,1.43],'circular-embedding'],
    ['simplex',[5,7,null,3],[0,1.43,.82,1.2],'smooth-periodic-blend'],
    ['anisotropic',[5,7],[0,1.43],'smooth-periodic-blend'],
    ['directional',[5,7],[0,1.43],'smooth-periodic-blend']
  ]) {
    const f = namedNoise.create(family,{seed:23,dimension:p.length,periods});
    assert.equal(f.spec.tiling,tiling);
    const at = x => f.value(x,...p.slice(1));
    const step = 1e-5, period = periods[0];
    close(at(0),at(period));
    close((at(step)-at(0))/step,(at(period)-at(period-step))/step,.001);
  }
});

test('3D and 4D slices use the declared offset and only wrap the enabled axes', () => {
  const settings = { dimension:4, extent:[5,7], offset:[0,0,1.5,2], slicePeriods:[null,6],
    tiling:{u:'wrap',v:'mirror'}, seed:34, precision:'float64' };
  const a = graphImages.noise('simplex',12,8,settings);
  const repeat = graphImages.noise('simplex',12,8,{...settings,offset:[5,0,1.5,8]});
  assert.deepEqual(a.info.periods,[5,null,null,6]);
  assert.deepEqual(a.value.descriptor.tiling,{u:'wrap',v:'mirror'});
  for (let i=0;i<pixels(a).length;i++) close(pixels(a)[i],pixels(repeat)[i]);
  const shifted = graphImages.noise('simplex',12,8,{...settings,offset:[0,0,2.5,2]});
  assert.notDeepEqual(pixels(a),pixels(shifted));
  const field = namedNoise.create('simplex',{dimension:4,seed:34,periods:a.info.periods});
  close(pixels(a)[0],field.value(2.5/12,3.5/8,1.5,2));
  const cells = namedNoise.create('worley',{dimension:3,jitter:0,periods:[3,null,2],output:'native'});
  assert.equal(cells.value(.5,.5,.5),0);
  close(cells.value(.1,.1,.1),cells.value(3.1,.1,-1.9));
});

test('cell maps distinguish nearest-site distances, region identity, and boundary gaps', () => {
  const opts = { jitter:0, output:'native' };
  const voronoi = namedNoise.create('voronoi',opts);
  const gap = namedNoise.create('cellular',opts);
  for (const [metric,expected] of [['euclidean',.5],['manhattan',.7],['chebyshev',.4]]) {
    const f = namedNoise.create('worley',{...opts,metric});
    close(f.value(.1,.2),expected);
  }
  assert.equal(voronoi.value(.1,.2),voronoi.value(.9,.8));
  assert.notEqual(voronoi.value(.1,.2),voronoi.value(1.1,.2));
  assert.equal(gap.value(.5,.5),1);
  assert.equal(gap.value(1,.5),0);
  assert.equal(graphImages.noise('worley',4,4,opts).value.descriptor.units,'noise-cells');
});

test('native Gaussian preserves its distribution and blue tiles retain exactly one of each rank', () => {
  const raw = pixels(graphImages.noise('gaussian',96,96,{ output:'native',precision:'float64',seed:8 }));
  const unit = pixels(graphImages.noise('gaussian',96,96,{ precision:'float64',seed:8 }));
  let mean = 0, sumSquares = 0;
  for (let i=0;i<raw.length;i++) {
    mean += raw[i]; sumSquares += raw[i]*raw[i];
    close(unit[i],Math.max(0,Math.min(1,.5+raw[i]/6)));
  }
  close(mean/raw.length,0,.04);
  close(Math.sqrt(sumSquares/raw.length),1,.04);
  const tile = graphImages.noise('blue',16,12,{precision:'float64',seed:45});
  const ranks = [...pixels(tile)].sort((a,b)=>a-b);
  for (let i=0;i<ranks.length;i++) close(ranks[i],(i+.5)/ranks.length);
  assert.deepEqual(tile.info.rankSize,[16,12]);
  const f = namedNoise.create('blue',{rankSize:[16,12]});
  close(f.value(.125,.125),f.value(16.125,-11.875));
});

test('oriented and octave variants respond to the family-specific controls', () => {
  const bands = namedNoise.create('directional',{angle:90,wander:0,seed:34});
  close(bands.value(.78,.1),bands.value(.78,5.5));
  assert.notEqual(bands.value(.78,.1),bands.value(1.78,.1));
  const stretch = namedNoise.create('anisotropic',{angle:30,aspect:6,seed:3});
  const base = namedNoise.create('anisotropic',{angle:0,aspect:1,seed:3});
  const a = Math.PI/6;
  close(stretch.value(6*Math.cos(a)*.75-Math.sin(a)*.4,6*Math.sin(a)*.75+Math.cos(a)*.4),base.value(.75,.4));
  const octaves = { carrier:'simplex',lacunarity:1.5,gain:.6,seed:54,periods:[5,7] };
  const fractal = namedNoise.create('fractal',octaves);
  const ridged = namedNoise.create('ridged',octaves);
  close(fractal.value(.5,.25),fractal.value(5.5,.25));
  assert.notEqual(fractal.value(.5,.25),ridged.value(.5,.25));
});

test('noise sources replay through the editable material graph and respect seed overrides', () => {
  const link = (node,port='value') => ({node,port});
  const source = {format:'ink-studio/graph-project',version:1,inputs:{},nodes:{
    noise:{op:'image.noise',inputs:{family:'perlin',width:16,height:12}},
    locked:{op:'image.noise',inputs:{family:'perlin',width:16,height:12,options:{seed:501,precision:'unorm16'}}},
    field:{op:'proc.noiseFamily',inputs:{family:'white',options:{seed:501}}},
    sampled:{op:'proc.sample',inputs:{source:link('field'),options:{width:7,height:5}}}
  },outputs:{noise:link('noise'),locked:link('locked'),info:link('noise','info'),sampled:link('sampled')}};
  const material = JSON.parse(JSON.stringify(Ink.openMaterialGraph(source,{id:'noise-test'})));
  const project = Ink.createGraphProject(material);
  const a = project.run({seed:2}).outputs;
  const b = project.run({seed:3}).outputs;
  const replay = Ink.createGraphProject(material).run({seed:2}).outputs;
  assert.deepEqual(a.noise.raster.data,replay.noise.raster.data);
  assert.notDeepEqual(a.noise.raster.data,b.noise.raster.data);
  assert.notEqual(a.info.seed,b.info.seed);
  assert.deepEqual(a.locked.raster.data,b.locked.raster.data);
  assert(a.locked.raster.data instanceof Uint16Array);
  assert.equal(a.locked.descriptor.materialSeed,501);
  assert.equal(a.sampled.data.length,35);
  assert(a.sampled.data.every(x=>x>=0 && x<=1));
});

test('invalid family controls and oversized requests fail explicitly', () => {
  assert.throws(()=>namedNoise.create('blue',{dimension:3}),/dimensions/);
  assert.throws(()=>namedNoise.create('perlin',{periods:[1.2,3]}),/periods/);
  assert.throws(()=>namedNoise.create('blue',{rankSize:[8,8],periods:[12,8]}),/rank tile/);
  assert.throws(()=>namedNoise.create('perlin',{jitter:.5}),/family or option/);
  assert.throws(()=>namedNoise.create('white',{seed:2**53}),/seed/);
  assert.throws(()=>namedNoise.create('white').value(1),/dimension/);
  assert.throws(()=>graphImages.noise('gaussian',8,8,{output:'native',precision:'unorm8'}),/floating precision/);
  assert.throws(()=>graphImages.noise('voronoi',4096,4096),/texel budget/);
  assert.throws(()=>graphImages.noise('voronoi',1024,1024,{dimension:3}),/work budget/);
});
