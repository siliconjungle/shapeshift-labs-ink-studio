const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('..');
const { shapeLibrary, graphImages } = Ink.load().KIT.procedural;
const sample = (definition,x,y) => shapeLibrary.compile(definition).field(x,y);
function close(a,b) { assert.ok(Math.abs(a-b)<1e-10,a+' differs from '+b); }

test('signed rectangle, rounded corners, disc, regular polygon and star retain editable geometry', () => {
  const rect = {type:'rectangle',center:[0,0],size:[4,2]};
  close(sample(rect,0,0),-1);
  close(sample(rect,3,2),Math.SQRT2);
  close(sample({...rect,radius:.5},2,1),(Math.SQRT2-1)*.5);
  close(sample({...rect,angle:90},0,1.5),-.5);
  const disc = {type:'disc',center:[0,0],radius:2};
  close(sample(disc,3,4),3);
  const diamond = {type:'polygon',sides:4,center:[0,0],radius:1};
  close(sample(diamond,0,0),-Math.SQRT1_2);
  close(sample(diamond,0,-1),0);
  const star = {type:'star',center:[0,0],tips:4,radius:1,innerRadius:.25};
  assert.ok(sample(star,.4,.4)>0);
  assert.ok(sample(star,0,-.8)<0);
  close(sample({...star,angle:45},Math.SQRT1_2,-Math.SQRT1_2),0);
});

test('custom polygons, round strokes and composite symbols preserve holes and signed outside samples', () => {
  const triangle = {type:'polygon',points:[[0,0],[.8,0],[0,.8]]};
  close(sample(triangle,.2,.2),-.2);
  assert.ok(sample(triangle,.7,.7)>0);
  const stroke = {type:'stroke',points:[[0,0],[1,0],[1,1]],width:.2};
  close(sample(stroke,-.05,0),-.05);
  close(sample(stroke,.92,.08),-.02);
  close(sample({...stroke,closed:true},.5,.5),-.1);
  const outer = {type:'disc',center:[0,0],radius:1};
  const ring = {type:'symbol',parts:[{shape:outer},{op:'subtract',shape:{...outer,radius:.4}}]};
  close(sample(ring,0,0),.4);
  close(sample(ring,0,.7),-.3);
  const half = {type:'symbol',parts:[{shape:ring},{op:'intersect',shape:{type:'rectangle',center:[.5,0],size:[1,2]}}]};
  assert.ok(sample(half,.7,0)<0);
  assert.ok(sample(half,-.7,0)>0);
});

test('linear and radial profiles address analytically and gradients reuse the curve contract', () => {
  const linear = {type:'linear',from:[0,0],to:[.4,0]};
  const y = .55;
  close(shapeLibrary.compile(linear).scalar(.2,y),.5);
  close(shapeLibrary.compile({...linear,address:'repeat'}).scalar(.5,y),.25);
  close(shapeLibrary.compile({...linear,address:'mirror'}).scalar(.5,y),.75);
  close(shapeLibrary.compile(linear).scalar(-.2,y),0);
  const radial = {type:'radial',center:[0,0],innerRadius:.2,radius:1};
  close(shapeLibrary.compile(radial).scalar(.2,0),0);
  close(shapeLibrary.compile(radial).scalar(.6,0),.5);
  const spot = {type:'spot',center:[0,0],radius:1,core:.2,falloff:'linear'};
  close(shapeLibrary.compile(spot).scalar(.4,0),.75);
  const ramp = {type:'gradient',source:linear,curve:{stops:[[0,.25],[.5,.75],[1,0]]}};
  close(shapeLibrary.compile(ramp).scalar(.2,y),.75);
  close(shapeLibrary.compile(ramp).scalar(-.2,y),0);
});

test('analytic bevel controls produce distinct height variants with unchanged signed contour', () => {
  const shape = {type:'rectangle',center:[0,0],size:[2,2]}, base = {type:'bevel',shape,width:.25,height:.4};
  const at = (parts,x) => shapeLibrary.compile({...base,...parts}).height(x,0);
  close(at({profile:'linear'},.875),.2);
  close(at({profile:'round'},.875),.4*Math.sqrt(.75));
  close(at({profile:'smooth'},.95),.4*.104);
  close(at({profile:'linear',side:'outside'},1.125),.2);
  close(at({profile:'linear',side:'both',height:-.4},1),-.2);
  close(sample(base,1.125,0),.125);
  close(at({profile:'linear'},1.125),0);
});

test('a shared recipe retains exact center distances at corresponding sample positions across resolutions', () => {
  const definition = shapeLibrary.define({type:'disc',radius:.37});
  const bake = n => graphImages.shape(definition,n,n,{precision:'float64'});
  const a = bake(7), b = bake(21);
  for (let y=0;y<7;y++) for (let x=0;x<7;x++)
    close(a.distance.raster.data[y*7+x],b.distance.raster.data[(y*3+1)*21+x*3+1]);
  assert.equal(a.distance.descriptor.units,'shape-units');
  assert.deepEqual(b.info.spacing,[1/21,1/21]);
  assert.strictEqual(a.value,a.mask);
  assert(a.height.raster.data.every(value=>value===0));
  const antialiased = graphImages.shape(definition,7,7,{samples:4});
  assert(antialiased.mask.raster.data.some(n=>n>0 && n<1));
  const linearClip = {type:'linear',from:[0,0],to:[1,0],clip:{type:'rectangle',center:[.25,.5],size:[.5,1]}};
  const clipped = graphImages.shape(linearClip,1,1,{samples:2});
  assert.equal(clipped.mask.raster.data[0],.5);
  assert.equal(clipped.value.raster.data[0],.125);
});

test('library definitions reopen by stable ID and preserve graph links for fields and multiple output sizes', () => {
  const recipe = {type:'disc',radius:.24}, rows = {seal:{label:'Pilot seal',definition:recipe}};
  const library = shapeLibrary.open(rows);
  recipe.radius = .12;
  assert.equal(shapeLibrary.pick(library,'seal').radius,.24);
  const restored = shapeLibrary.open(JSON.parse(JSON.stringify(library)));
  assert.deepEqual(restored,library);
  assert(Object.isFrozen(restored.entries.seal.definition));
  const ref = (node,port='value') => ({node,port});
  const graph = {format:'ink-studio/graph-project',version:1,
    inputs:{library:{type:'record',default:library}},
    nodes:{book:{op:'shape.library',inputs:{source:{input:'library'}}},
      seal:{op:'shape.pick',inputs:{source:ref('book'),id:'seal'}},
      small:{op:'image.shape',inputs:{source:ref('seal'),width:5,height:5}},
      large:{op:'image.shape',inputs:{source:ref('seal'),width:15,height:15}},
      field:{op:'shape.field',inputs:{source:ref('seal')}},
      probe:{op:'proc.sample',inputs:{source:ref('field'),options:{width:5,height:5}}}},
    outputs:{small:ref('small','distance'),large:ref('large','distance'),probe:ref('probe'),book:ref('book')}};
  const editable = JSON.parse(JSON.stringify(Ink.openMaterialGraph(graph,{id:'shape-fixture'})));
  const project = Ink.createGraphProject(editable), {outputs} = project.run();
  assert.equal(outputs.small.raster.data[12],outputs.large.raster.data[112]);
  close(outputs.probe.data[12],-.24);
  assert.deepEqual(outputs.book,library);
  const existing = structuredClone(library);
  existing.entries.seal.label = 'Updated name';
  existing.entries.seal.definition.radius = .33;
  const edited = project.run({inputs:{library:existing}}).outputs;
  close(edited.probe.data[12],-.33);
  assert.equal(edited.book.entries.seal.label,'Updated name');
  assert.notDeepEqual(edited.small.raster.data,outputs.small.raster.data);
});

test('library and render limits reject malformed recipes before sampling', () => {
  const cyclic = {type:'bevel'};
  cyclic.shape = cyclic;
  assert.throws(()=>shapeLibrary.define(cyclic),/nesting/);
  assert.throws(()=>shapeLibrary.open({format:'ink-studio/shape-library',version:2,entries:{}}),/format or version/);
  assert.throws(()=>shapeLibrary.pick(shapeLibrary.presets,'missing'),/Unknown shape library entry/);
  assert.throws(()=>sample({type:'stroke',points:[[0,0],[0,0]]},0,0),/adjacent/);
  assert.throws(()=>sample({type:'polygon',points:[[0,0],[0,1],[1,0]],sides:3},0,0),/polygon points/);
  assert.throws(()=>graphImages.shape({type:'disc'},4,4,{bounds:[1,0,0,1]}),/increasing/);
  assert.throws(()=>graphImages.shape({type:'star',tips:32},1024,1024,{samples:4}),/sample budget/);
});
