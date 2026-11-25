const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const Ink = require('..');
const PNG = require('../cli/png.js');

const root = path.resolve(__dirname,'..');
const ids = ['brick','tile','wood','cloth','weave','fur','cracks','chips','scratches','rain-streaks','patina','organic-scatter'];
const catalog = Ink.searchMaterialLibrary();
const byId = new Map(catalog.items.map(item=>[item.id,item]));
const channels = { baseColor:'color',height:'height',normal:'normal',roughness:'mask',mask:'mask' };

test('material-library discovers twelve bundled recipes and can filter by material or category',()=>{
  assert.equal(catalog.total,ids.length);
  assert.deepEqual([...byId.keys()].sort(),ids.slice().sort());
  assert.deepEqual(Ink.searchMaterialLibrary(undefined,{ query:'verdigris' }).items.map(item=>item.id),['patina']);
  assert.deepEqual(Ink.searchMaterialLibrary(undefined,{ tag:'Textiles' }).items.map(item=>item.id).sort(),['cloth','fur','weave']);
  const cli = spawnSync(process.execPath,[path.join(root,'cli/ink-studio.js'),'graph','material-library','--tag','Masonry'],
    { cwd:__dirname, encoding:'utf8' });
  assert.equal(cli.status,0,cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).items.map(item=>item.id).sort(),['brick','tile']);
});

for (const id of ids) {
  test(id+' reopens with its native maps, controls and catalog preview',()=>{
    const item = byId.get(id), document = Ink.readMaterialGraph(item.file);
    const { outputs, artifacts } = Ink.readGraphProject(item.file).run();
    assert.equal(document.id,id);
    assert.equal(document.metadata.visibility.library,true);
    assert(Object.keys(document.graph.nodes).length>10);
    assert.equal(Object.keys(document.resources).length,0);
    for (const [key,intent] of Object.entries(channels)) {
      const { raster,descriptor } = outputs[key];
      assert.deepEqual([raster.width,raster.height],[128,128],key);
      assert.equal(descriptor.intent,intent,key);
      assert.deepEqual(descriptor.tiling,{u:'wrap',v:'wrap'},key);
      assert(raster.data.some(value=>value!==raster.data[0]),key);
    }
    assert.equal(outputs.height.descriptor.units,'art-px');
    for (const kind of ['baseColor.png','height.json','normal.png','roughness.png','mask.png'])
      assert(artifacts.some(entry=>entry.file==='artifacts/'+kind),kind);
    const preview = artifacts.find(entry=>entry.file==='artifacts/preview.png');
    assert.deepEqual(PNG.raster(preview.bytes),PNG.raster(readFileSync(item.thumbnail.file)));
  });

  test(id+' controls change the baked inputs they advertise',()=>{
    const { file } = byId.get(id);
    const document = Ink.readMaterialGraph(file), project = Ink.readGraphProject(file);
    const run = inputs => project.run({inputs:{resolution:64,...inputs}}).outputs;
    const first = run({}), appearance = ['baseColor','height','mask','roughness'];
    assert.equal(run({ resolution:80 }).height.raster.width,80);
    const flat = run({ relief:0 });
    assert(flat.height.raster.data.every(value=>value===0));
    const repeat = run({});
    assert.deepEqual(first.baseColor.raster.data,repeat.baseColor.raster.data);
    assert.deepEqual(first.height.raster.data,repeat.height.raster.data);

    for (const [key,control] of Object.entries(document.controls)) {
      if (['relief','resolution'].includes(key)) continue;
      const low = control.options?.at(0).value ?? control.min;
      const high = control.options?.at(-1).value ?? control.max;
      const minimum = run({[key]:low}), maximum = run({[key]:high});
      assert(appearance.some(name=>minimum[name].raster.data.some((sample,i)=>sample!==maximum[name].raster.data[i])),
        id+'.'+key+' should change a baked map');
    }
  });
}
