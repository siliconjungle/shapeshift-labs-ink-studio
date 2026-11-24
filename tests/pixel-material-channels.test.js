const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const PNG = require('../cli/png.js');
const { readGlb } = require('../cli/glb-file.js');
const { KIT } = ink.load();

const channels = ['pigment','roughness','emission','normal','opacity','mask:serial'];
const box = {kind:'rect',min:[0,0],max:[1,1]};
const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js',...args],
  { cwd:path.resolve(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','pipe'] });

function scene(stamps = []) {
  return { id:'painted-plate',style:'slate',
    camera:{target:[0,0,0],dist:5,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    solids:[{ id:'plate',kind:'box',at:[0,0,0],half:[.8,.7,.23],res:.075,mat:'stone',
      surfaceState:{ masks:['serial'],charts:{ face:{ origin:[-.8,-.7,.23],u:[1.6,0,0],v:[0,1.4,0],depth:.055,stamps } } } }] };
}

function space(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-material-channels-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file = name=>path.join(root,name);
  const save = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  return { file,save,read };
}

test('the normal edit and sampling paths retain the indexed swatch and typed independent channel values',t=>{
  const { file,save,read } = space(t);
  const doc = { format:'ink-studio/pixel-art',version:2,width:80,height:56,pixelAspect:[1,1],
    palette:{ mint:'#52cbb4',rust:'#af5530' },layers:[{id:'ink'}],frames:[{id:'art',durationMs:100,cels:{}}],
    sceneBindings:[{id:'plate',scene:file('scene.json'),object:'plate',frame:'art'}],
    destinations:channels.map((channel,i)=>({id:'channel-'+i,kind:'surface-channel',binding:'plate',chart:'face',channel})) };
  const source = scene();
  save('scene.json',source);
  save('design.json',doc);
  const pixel = (...args)=>JSON.parse(cli('pixel-art',...args));
  const target = (i)=>pixel('targets',file('design.json'),'--scene',file('scene.json'),'--destination','channel-'+i);
  const apply = (i,operation)=>{
    const observed = target(i);
    save('patch.json',{id:'paint-'+i,frame:'art',destination:'channel-'+i,revision:observed.documentRevision,
      sourceRevision:observed.sourceRevision,operation});
    const receipt = pixel('edit',file('design.json'),file('patch.json'),'--scene',file('scene.json'),'--out',file('updated.json'));
    assert.equal(receipt.status,'applied');
    save('scene.json',read('updated.json'));
  };
  ['mint',.23,[.02,1.2,0],[.6,0,.8],.4,.78].forEach((value,i)=>apply(i,{stamp:{brush:box,value}}));
  const locate=i=>pixel('sample',file('design.json'),'--at','39,27','--mode','source','--destination','channel-'+i,'--scene',file('scene.json')).value;
  assert.deepEqual(locate(0),{swatch:'mint',color:'#52cbb4'});
  assert.deepEqual(locate(1),{value:.23,coverage:1});
  assert.deepEqual(locate(2),{value:[.02,1.2,0],coverage:1});
  assert.deepEqual(locate(3),{value:[.6,0,.8],coverage:1});
  assert.deepEqual(locate(4),{value:.4,coverage:1});
  assert.equal(locate(5),.78);
  apply(1,{stamp:{brush:box,mode:'clear'}});
  assert.equal(locate(1),null);
  assert.deepEqual(locate(0),{swatch:'mint',color:'#52cbb4'});
  assert.equal(locate(5),.78);

  save('plan.json',{format:'ink-studio/pixel-multiview',version:1,id:'mint-edge',destination:'channel-0',size:[8,8],
    views:[{id:'front',approved:true,marks:[{at:[39,27],swatch:'mint'}]},
      {id:'check',camera:{yaw:.2}}]});
  // Restore opaque samples for the camera projector after exercising partial opacity.
  apply(4,{stamp:{brush:box,mode:'clear'}});
  const report = pixel('multiview',file('design.json'),file('plan.json'),'--patch',file('multi.json'));
  assert.equal(report.status,'ready');
  assert.deepEqual(read('multi.json').operation.stamps[0].value,{swatch:'mint',color:'#52cbb4'});

  save('plan.json',{format:'ink-studio/pixel-multiview',version:1,id:'frosted-center',destination:'channel-4',size:[8,8],
    views:[{id:'front',approved:true,marks:[{at:[39,27],value:.3}]},{id:'check',camera:{yaw:.2}}]});
  const opacity = pixel('multiview',file('design.json'),file('plan.json'));
  assert.equal(opacity.status,'ready');
  assert.ok(opacity.views[0].counts.changed>0);
});

const materials = [
  {channel:'pigment',value:{swatch:'rust',color:'#af5530'},brush:box},
  {channel:'roughness',value:.19,brush:box},
  {channel:'normal',value:[.45,0,1],brush:{...box,min:[0,.55]}},
  {channel:'emission',value:[0,1.6,0],brush:{...box,min:[.55,0]}},
  {channel:'opacity',value:.2,brush:{...box,min:[.72,0],max:[1,.45]}},
  {channel:'mask:serial',value:.8,brush:box}
];

test('native splats keep pigment, normal, emission and opacity in independent signals',()=>{
  const painted = KIT.diorama.build(scene(materials));
  const baseline = KIT.diorama.build(scene([materials[0]]));
  const options = {w:80,h:56,px:1,raw:true,transparent:true,passes:['opaque-surface','pigment','emission','coverage']};
  const before = ink.render(baseline,options), after = ink.render(painted,options);
  const exact = 0xaf5531;
  assert.ok(after.passes.pigment.some((value,i)=>value===exact && before.passes.pigment[i]===exact && after.passes.emission[3*i+1]>.15));
  assert.ok(after.passes.shadingNormal.some((value,i)=>Math.abs(value-after.passes.geometricNormal[i])>.1));
  // The opaque back of the plate remains visible through the painted front.
  assert.ok(after.passes.depth.some((value,i)=>Number.isFinite(value) && value>before.passes.depth[i]+.1));
  assert.ok(painted.data.some((value,i)=>i%16===3 && Math.abs(value-.2)<1e-6 && baseline.data[i]===3));
  assert.ok(painted.surfaces.some(row=>row.settings.layers['painted-roughness'].roughness < .25));
  assert.equal(painted.count,baseline.count);
});

test('registered maps retain channel isolation and export baked opacity as glTF base alpha',t=>{
  const { file,save,read } = space(t);
  const bake = (name,stamps,extra=[])=>{
    save('scene.json',scene(stamps));
    cli('export-glb',file('scene.json'),'--out',file(name+'.glb'),'--texture-size','256','--res','.11',
      '--bake-dir',file(name),...extra);
    return read(name+'/material-bake.json').meshes[0];
  };
  const first = bake('first',materials);
  const second = bake('second',materials.map(row=>row.channel==='roughness'?{...row,value:.73}:row));
  for (const channel of ['pigment','normal','emission','opacity','coverage'])
    assert.equal(first.maps[channel].sha256,second.maps[channel].sha256,channel);
  assert.equal(first.masks.serial.sha256,second.masks.serial.sha256);
  assert.notEqual(first.maps.roughness.sha256,second.maps.roughness.sha256);
  const {gltf} = readGlb(fs.readFileSync(file('first.glb')));
  assert.equal(gltf.materials[0].alphaMode,'BLEND');
  assert.equal(first.emissionStrength,1.6);
  const image = name=>PNG.raster(file('first/'+name)).data;
  const opacity = image(first.maps.opacity.file), pigment = image(first.maps.pigment.file);
  const mask = image(first.masks.serial.file);
  assert.ok(opacity.some((value,i)=>i%4===0 && value===51 && pigment[i+3]===value));
  assert.ok(pigment.some((value,i)=>i%4===0 && value===0xaf && pigment[i+1]===0x55 && pigment[i+2]===0x30));
  assert.ok(mask.some((value,i)=>i%4===0 && value===204));
  const reuse = bake('reuse',materials,['--rebake-from',file('first/material-bake.json')]);
  assert.equal(reuse.chartReport.sampledTexels,0);
  assert.equal(reuse.maps.opacity.sha256,first.maps.opacity.sha256);
});
