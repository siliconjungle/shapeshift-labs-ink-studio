const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { document } = require('../cli/glb-file.js');
const { runBakeJob, latestBakeJob } = require('../cli/bake-jobs.js');
const { readTexture } = require('../cli/texture-files.js');
const { createGraphProject } = require('../cli/graph-project.js');
const { openMaterialGraph, readMaterialGraph, writeMaterialGraph } = require('../cli/material-graph.js');
const PNG = require('../cli/png.js');

const positionMaps = ['position-object', 'position-world', 'position-normalized'];
const idMaps = ['vertex-id', 'material-id', 'part-id'];

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-bake-attributes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = file => path.join(dir, file);
  function mesh(file, reverse = false) {
    const doc = document(), { gltf } = doc;
    function quad(x, y, u, v, authored = {}) {
      const attributes = {
        POSITION: doc.accessor(Float32Array.from([x[0],y[0],-3,x[1],y[0],-3,x[1],y[1],-3,x[0],y[1],-3]),'VEC3',{bounds:true}),
        TEXCOORD_0: doc.accessor(Float32Array.from([u[0],v[0],u[1],v[0],u[1],v[1],u[0],v[1]]),'VEC2')
      };
      if (authored.vertices) attributes._INK_VERTEX_ID = doc.accessor(Float32Array.from(authored.vertices),'SCALAR');
      return { attributes, indices: doc.accessor(Uint16Array.of(0,1,2,0,2,3),'SCALAR'),
        ...(authored.part && { extras: { inkStudio: { partId: authored.part, partLabel: authored.label } }, material: 0 }) };
    }
    const first = quad([-2,2],[-4,0],[.25,1.25],[.125,.625],
      { vertices: [501,502,503,504], part: 101, label: 'Blue plate' });
    const second = quad([2,6],[0,1],[.25,.75],[.75,.875]);
    gltf.meshes = [{ name: 'Plate', primitives: reverse ? [second,first] : [first,second] }];
    gltf.materials = [{ name: 'Enamel', extras: { inkStudio: { materialId: 301 } } }];
    gltf.nodes = [
      { name: 'Turntable', translation: [10,20,30], rotation: [0,0,Math.SQRT1_2,Math.SQRT1_2], children: [1] },
      { name: 'Mounted', mesh: 0, translation: [2,1,-4], scale: [2,3,4] },
      { name: 'Spare', mesh: 0 }
    ];
    gltf.scenes[0].nodes = [0,2];
    fs.writeFileSync(at(file), doc.finish());
  }
  mesh('plate.glb');
  mesh('reordered.glb', true);
  const blank = PNG.encodeGray(2,2,new Uint8Array(4)).toString('base64');
  const assets = Object.fromEntries(['coord','tag'].map(name=>[name,
    { format:'bitmap', source:{encoding:'png',base64:blank}, interpretation:{intent:'data',sampling:'linear'} }]));
  const graph = { format:'ink-studio/graph-project',version:1,assets,
    nodes:Object.fromEntries(Object.keys(assets).map(name=>[name,{op:'bitmapAsset',inputs:{name}}])),
    outputs:Object.fromEntries(Object.keys(assets).map(node=>[node,{node,port:'value'}])) };
  writeMaterialGraph(at('seed.material.json'),openMaterialGraph(graph,{id:'attribute-check'}));
  const target = { id:'plate',mesh:'Plate',positionNode:'Mounted',tiles:[1001,1002] };
  function run(name, { targets=[target], maps=[...positionMaps,...idMaps,'coverage'], size=32, source='plate.glb', refresh, directory=name }={}) {
    const plan = { format:'ink-studio/bake-job',version:1,label:'Position and ID reference',source,targets,
      preset:{format:'ink-studio/bake-preset',version:1,label:'Data',defaults:{size,padding:1},maps:maps.map(id=>({id}))},
      ...(refresh && { refresh:{material:'seed.material.json',bindings:[
        {target:'plate',map:'position-world',resource:'coord',storage:'linked'},
        {target:'plate',map:'part-id',resource:'tag',storage:'embedded'}
      ]} }) };
    fs.writeFileSync(at(name+'.json'),JSON.stringify(plan));
    return runBakeJob(at(name+'.json'),{directory:at(directory)});
  }
  return { at, run, target };
}

function output(baked, map, tile=1001) {
  const row = baked.report.maps.find(r=>r.map===map&&r.tileLabel===String(tile));
  const read = file=>readTexture(path.join(path.dirname(baked.file),file));
  const image = read(row.file), preview = row.previewFile&&read(row.previewFile);
  function pixel(x,y,src=image) {
    const start = (y*src.width+x)*src.channels;
    return [...src.data.slice(start,start+src.channels)];
  }
  return { row, image, preview, pixel };
}
const close = (actual, expected) => actual.forEach((n,i)=>assert(Math.abs(n-expected[i])<2e-5,
  'Expected '+expected[i]+' but got '+n));

test('XYZ gives signed object, placed world and mesh-wide normalized positions across UV tiles', async t=>{
  const { at, run, target } = fixture(t);
  const result = await run('full',{refresh:true});
  const object = output(result,'position-object'), world = output(result,'position-world'), box = output(result,'position-normalized');
  for (const img of [object,world,box]) assert.deepEqual(img.image.names,['X','Y','Z']);
  assert.deepEqual(world.row.output.node,{index:1,name:'Mounted'});
  const [x,y,z] = [-1.9375,-3.875,-3];
  close(object.pixel(8,4),[x,y,z]);
  close(world.pixel(8,4),[9-3*y,22+2*x,26+4*z]);
  close(box.pixel(8,4),[(x+2)/8,(y+4)/5,.5]);
  assert.deepEqual(box.row.output.bounds,{min:[-2,-4,-3],max:[6,1,-3]});
  assert.deepEqual(output(result,'position-normalized',1002).row.output.bounds,box.row.output.bounds);
  assert.deepEqual(object.pixel(7,4),object.pixel(8,4));
  assert.deepEqual(object.pixel(0,0),[0,0,0]);
  const coverage = output(result,'coverage');
  assert.deepEqual(coverage.pixel(7,4),[0]);
  assert.deepEqual(coverage.pixel(8,4),[255]);

  const restricted = await run('subset',{targets:[{...target,submeshes:[0]}],maps:['position-normalized']});
  assert.deepEqual(output(restricted,'position-normalized',1002).row.sha256,output(result,'position-normalized',1002).row.sha256);
  const other = await run('spare',{targets:[{...target,positionNode:2}],maps:['position-world']});
  assert.deepEqual(output(other,'position-world').pixel(8,4),object.pixel(8,4));
  const { positionNode, ...ambiguous } = target;
  await assert.rejects(()=>run('bad',{targets:[ambiguous],maps:['position-world'],directory:'full'}),/Set positionNode/);
  assert.equal(latestBakeJob(at('full')).revision,result.revision);

  const baseDir = path.dirname(result.file), material = readMaterialGraph(path.join(baseDir,result.report.material));
  const graph = await createGraphProject(material,{baseDir}).previewFrame({coord:{output:'coord'},tag:{output:'tag'}},{},{encodeArtifacts:false});
  assert.equal(graph.values.coord.descriptor.units,'shape-units');
  assert.equal(graph.values.coord.descriptor.layout,'xyz');
  close([...graph.values.coord.raster.data.slice((4*32+8)*3,(4*32+8)*3+3)],world.pixel(8,4));
  assert.equal(graph.values.tag.descriptor.sampling,'nearest');
  assert.equal(graph.values.tag.raster.data[4*32+8],101);
});

test('categorical identities and palette colors survive reordering, masks and UV clipping', async t=>{
  const { run } = fixture(t), baked = await run('ids',{maps:idMaps});
  const part = output(baked,'part-id'), material = output(baked,'material-id'), vertex = output(baked,'vertex-id');
  for (const [img,id] of [[part,101],[material,301],[vertex,501]]) {
    assert.deepEqual(img.image.names,['Y']);
    assert.deepEqual(img.pixel(8,4),[id]);
    assert.deepEqual(img.pixel(7,4),[id]);
    assert.deepEqual(img.pixel(0,0),[0]);
    assert.deepEqual(img.pixel(0,0,img.preview),[0,0,0,0]);
    assert.deepEqual(img.pixel(8,4,img.preview),img.pixel(7,4,img.preview));
    assert(img.row.output.palette.some(row=>row.id===id&&/^#[a-f0-9]{6}$/.test(row.color)));
  }
  assert(output(baked,'vertex-id',1002).image.data.some(n=>n===502));
  assert(output(baked,'part-id').image.data.some(n=>n===0x800002));
  assert(output(baked,'material-id').image.data.some(n=>n===0x800000));
  const moved = await run('reordered',{source:'reordered.glb',maps:idMaps.slice().reverse(),size:64});
  for(const [img,id] of [[part,101],[material,301],[vertex,501]]) {
    const again = output(moved,img.row.map);
    assert.deepEqual(again.pixel(16,8),[id]);
    assert.deepEqual(again.pixel(16,8,again.preview),img.pixel(8,4,img.preview));
  }
});
