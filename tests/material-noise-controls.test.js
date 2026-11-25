const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { namedNoise, graphImages } = Ink.load().KIT.procedural;
const pixels = image => image.value.raster.data;
function close(a,b,tolerance=1e-10) { assert.ok(Math.abs(a-b)<tolerance,a+' differs from '+b); }

test('scale and expansion retain feature proportions on rectangular images', () => {
  const base = graphImages.noise('simplex',48,24,{seed:27,extent:4,precision:'float64'});
  const opts = {seed:27,extent:4,scale:1.25,nonSquareExpansion:true,precision:'float64'};
  const expanded = graphImages.noise('simplex',48,24,opts);
  assert.deepEqual(base.info.extent,[4,4]);
  assert.deepEqual(expanded.info.baseExtent,[4,4]);
  assert.deepEqual(expanded.info.extent,[10,5]);
  assert.equal(expanded.info.extent[0]/48,expanded.info.extent[1]/24);
  assert.notDeepEqual(pixels(base),pixels(expanded));
  const exact = graphImages.noise('simplex',48,24,{...opts,extent:[10,5],scale:1,nonSquareExpansion:false});
  assert.deepEqual(pixels(expanded),pixels(exact));
  const vertical = graphImages.noise('simplex',24,48,opts);
  assert.deepEqual(vertical.info.extent,[5,10]);
  const discrete = graphImages.noise('white',48,24,{nonSquareExpansion:true});
  assert.deepEqual(discrete.info.extent,[48,24]);
});

test('scaling steps wrapped lattice and rank periods while open axes follow the requested span', () => {
  const perlin = graphImages.noise('perlin',32,20,{
    extent:4,scale:1.15,nonSquareExpansion:true,tiling:{u:'wrap',v:'clamp'}
  });
  close(perlin.info.requestedExtent[0],7.36);
  close(perlin.info.requestedExtent[1],4.6);
  assert.deepEqual(perlin.info.periods,[7,null]);
  close(perlin.info.extent[1],4.6);
  const blue = graphImages.noise('blue',32,20,{rankSize:[8,5],scale:.55});
  assert.deepEqual(blue.info.extent,[16,10]);
  assert.deepEqual(blue.info.periods,[16,10]);
  const simplex = graphImages.noise('simplex',32,20,{extent:4,scale:1.15});
  assert.deepEqual(simplex.info.extent,[4.6,4.6]);
  assert.throws(()=>graphImages.noise('perlin',32,20,{extent:4.6}),/periods/);
});

test('tile offsets use effective spans and wrap by whole tiles without disturbing a higher slice', () => {
  const opts = {seed:23,extent:[8,4],dimension:3,offset:[-.5,1,2.25],precision:'float64'};
  const shifted = graphImages.noise('perlin',32,24,{...opts,tileOffset:[.25,-.5]});
  const manual = graphImages.noise('perlin',32,24,{...opts,offset:[1.5,3,2.25]});
  const repeat = graphImages.noise('perlin',32,24,{...opts,tileOffset:[3.25,.5]});
  assert.deepEqual(shifted.info.offset,[1.5,3,2.25]);
  assert.deepEqual(pixels(shifted),pixels(manual));
  assert.deepEqual(pixels(shifted),pixels(repeat));
  const open = graphImages.noise('perlin',32,24,{...opts,tileOffset:[0,-.5],tiling:{v:'mirror'}});
  assert.deepEqual(open.info.offset,[-.5,-1,2.25]);
  assert.notDeepEqual(pixels(open),pixels(shifted));
});

test('octave bounds preserve band frequencies, relative gain and the legacy octave count', () => {
  const options = {seed:56,output:'native',lacunarity:2.45};
  for (const family of ['fractal','ridged']) {
    const make = optionsForBand => namedNoise.create(family,{...options,...optionsForBand});
    const low = make({octaveRange:[1,1]}), high = make({octaveRange:[2,2]});
    const mix = make({octaveRange:[1,2],gain:.25}), zero = make({octaveRange:[1,2],gain:0});
    const count = make({octaves:4}), sameCount = make({octaveRange:[0,3]});
    assert.deepEqual(mix.spec.octaveRange,[1,2]);
    assert.equal(mix.spec.octaves,2);
    for (const point of [[.12,.62],[1.4,2.9],[-4.31,.7]]) {
      close(mix.value(...point),(low.value(...point)+.25*high.value(...point))/1.25);
      assert.equal(zero.value(...point),low.value(...point));
      assert.equal(count.value(...point),sameCount.value(...point));
    }
    assert.notEqual(high.value(.77,.22),make({octaveRange:[2,2],lacunarity:3}).value(.77,.22));
  }
});

test('structural disorder preserves spatial periods and produces a reversible temporal loop', () => {
  for (const family of namedNoise.families.filter(n=>!['white','blue','gaussian'].includes(n))) {
    const config = {seed:57,periods:[7,5],animationSpeed:.25};
    const make = seconds => namedNoise.create(family,config,seconds);
    const points = [[.33,1.76],[3.5,4.25],[-2.4,-3.25],[4.125,1.15]];
    const base = make(0), next = make(1.125), loop = make(5.125), reverse = namedNoise.create(family,
      {...config,animationSpeed:-.25},-1.125);
    assert.notDeepEqual(points.map(p=>base.value(...p)),points.map(p=>next.value(...p)),family);
    assert.equal(next.spec.loopSeconds,4);
    assert.equal(next.spec.phase,.28125);
    assert.equal(base.cost,next.cost,family+' playback budget');
    for (const [x,y] of points) {
      close(next.value(x,y),next.value(x+7,y-5));
      close(next.value(x,y),loop.value(x,y));
      close(next.value(x,y),reverse.value(x,y));
      const original = namedNoise.create(family,{seed:57,periods:[7,5]});
      assert.equal(original.value(x,y),base.value(x,y));
      assert.equal(namedNoise.create(family,{...config,disorder:.28125,animationSpeed:0},20).value(x,y),next.value(x,y));
    }
  }
});

test('cell disorder moves stable labels while zero jitter holds sites in place', () => {
  const config = {seed:19,extent:4,precision:'float64'};
  const image = disorder => pixels(graphImages.noise('voronoi',64,64,{...config,disorder}));
  assert.notDeepEqual(image(0),image(.47));
  assert.deepEqual(new Set(image(0)),new Set(image(.47)));
  const centered = disorder => pixels(graphImages.noise('cellular',16,16,{...config,jitter:0,disorder}));
  assert.deepEqual(centered(0),centered(.47));
});

test('editable image and procedural field nodes follow the graph clock and survive seeks', () => {
  const link = (node,port='value') => ({node,port});
  const options = { seed:83,disorder:.25,animationSpeed:.5 };
  const source = {format:'ink-studio/graph-project',version:1,nodes:{
    clock:{op:'anim.clock',inputs:{options:{range:[0,4]}}},
    dynamic:{op:'image.noise',inputs:{family:'ridged',time:link('clock'),width:16,height:12,options}},
    still:{op:'image.noise',inputs:{family:'ridged',width:16,height:12,options}},
    field:{op:'proc.noiseFamily',inputs:{family:'simplex',options,time:link('clock')}},
    samples:{op:'proc.sample',inputs:{source:link('field'),options:{width:16,height:12}}}
  },outputs:{dynamic:link('dynamic'),still:link('still'),info:link('dynamic','info'),samples:link('samples')}};
  const graph = JSON.parse(JSON.stringify(Ink.openMaterialGraph(source,{id:'animated-noise-test'})));
  const session = Ink.createGraphProject(graph), now = time => session.run({time}).outputs;
  const a = now(0), b = now(.25), c = now(2), rewind = now(0);
  assert.deepEqual(a.dynamic.raster.data,a.still.raster.data);
  assert.equal(a.still,b.still);
  assert.equal(b.info.phase,.375);
  assert.notDeepEqual(a.dynamic.raster.data,b.dynamic.raster.data);
  assert.notDeepEqual(a.samples.data,b.samples.data);
  assert.deepEqual(a.samples.data,c.samples.data);
  assert.deepEqual(a.dynamic.raster.data,c.dynamic.raster.data);
  assert.deepEqual(a.dynamic.raster.data,rewind.dynamic.raster.data);
});

test('inapplicable or ambiguous controls fail explicitly', () => {
  assert.throws(()=>namedNoise.create('blue',{animationSpeed:.5}),/family or option/);
  assert.throws(()=>namedNoise.create('gaussian',{disorder:.25}),/family or option/);
  assert.throws(()=>namedNoise.create('fractal',{octaves:3,octaveRange:[1,3]}),/Choose octaveRange/);
  assert.throws(()=>namedNoise.create('fractal',{octaveRange:[4,2]}),/inclusive bounds/);
  assert.throws(()=>namedNoise.create('perlin',{animationSpeed:1e-320}),/animation speed/);
  assert.throws(()=>graphImages.noise('perlin',12,12,{scale:0}),/scale/);
  assert.throws(()=>graphImages.noise('perlin',12,12,{tileOffset:[0,0,0]}),/tile offset/);
  assert.throws(()=>graphImages.noise('perlin',12,12,{nonSquareExpansion:1}),/non-square/);
  for (const time of [0,.5]) {
    assert.throws(()=>graphImages.noise('cellular',420,420,{dimension:3,animationSpeed:.5},0,time),/work budget/);
  }
});
