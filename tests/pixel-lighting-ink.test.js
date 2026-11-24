const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');
const ArtInk = require('../src/art-ink.js');
const { inkControls } = require('../src/art-passes.js');
const { KIT } = ink.load();

const channels = ['shadow-band','hatch','outline','light-spill'];
const brush = {kind:'rect',min:[0,0],max:[.55,1]};
const stamp = (channel,value) => ({channel,value,brush});

function scene(stamps = [], transform) {
  const surface = {layers:{key:{type:'diffuse',shadow:false,lightingRamp:{
    stops:[[0,'#30223e'],[.42,'#6e505c'],[.76,'#c09b78']],interpolation:'step'
  }}}};
  const inkRules = {light:[0,1,0],silhouette:{color:'#1b1222'},crease:false,boundary:false,
    hatch:{spacing:.28,width:.33,lightRange:[.15,.7],direction:[1,0,0],color:'#4a3249'}};
  const spill = {id:'lamp',select:{object:'lamp'},core:false,glow:false,
    spill:{color:'#e8773b',at:[0,0,1.3],normal:[0,0,-1],radius:3,intensity:6,shadows:false}};
  return {id:'ink-panel',style:'slate',
    camera:{target:[0,0,0],dist:4,yaw:0,pitch:0,sway:0,projection:'orthographic'},
    light:{surfaceDirection:[[0,.8,0,.6]]},
    finish:{look:{ink:inkRules,sdfAssist:{rules:[{select:{object:'plate'}}]}},emissiveFinishes:[spill]},
    solids:[{id:'plate',kind:'box',at:[0,0,0],half:[.86,.72,.18],res:.07,
      mat:{role:'stone',surface},...(transform && {transform}),
      surfaceState:{charts:{face:{origin:[-.86,-.72,.18],u:[1.72,0,0],v:[0,1.44,0],depth:.065,stamps}}}},
    {id:'lamp',kind:'box',at:[0,.4,.5],half:[.1,.1,.05],res:.04,mat:{role:'pale',glow:true}}]
  };
}

const passes = ['opaque-surface','inkMask','pigment','emission',...inkControls];
const draw = (source,options) => ink.render(KIT.diorama.build(source),
  {w:120,h:82,px:1,colored:true,transparent:true,passes,...options});
const key = (frame,label) => frame.passes.objects.indexOf(label);

test('each rest-chart control drives its native treatment independently', () => {
  const baseline = draw(scene());
  const paint = (channel,value,extra) => draw(scene([stamp(channel,value)]),extra);
  for (const [index,value] of [.72,0,0,0].entries()) {
    const painted = paint(channels[index],value);
    const name = inkControls[index];
    const at = painted.passes[name].findIndex((n,p)=>Math.abs(n-baseline.passes[name][p])>.5);
    assert.ok(at>=0,name);
    assert.equal(painted.passes.objectId[at],key(painted,'plate'));
    assert.ok(painted.rgb.some((n,i)=>n!==baseline.rgb[i]),name);
    for (const field of ['depth','objectId','pigment','emission',...inkControls.filter(other=>other!==name)])
      assert.deepEqual(painted.passes[field],baseline.passes[field],field);
    const labels = {hatch:'hatch',outline:'silhouette'}, label = labels[channels[index]];
    if (label) {
      const code = ArtInk.labels.indexOf(label);
      assert.ok(baseline.inkMask.some((n,p)=>n===code && painted.passes[name][p]===0 && painted.inkMask[p]!==code));
      assert.ok(painted.inkMask.some((n,p)=>n===code && painted.passes[name][p]===1));
    }
  }
  const plain = draw(scene(),{raw:true,emissiveFinishes:false});
  assert.ok(paint('shadow-band',.72,{raw:true,emissiveFinishes:false}).rgb.some((n,i)=>n!==plain.rgb[i]));
  assert.ok(paint('shadow-band',.72,{shadowBandPaint:false}).rgb.every((n,i)=>n===baseline.rgb[i]));
  const noSpill = {emissiveFinishes:false};
  const noSpillBaseline = draw(scene(),noSpill);
  assert.ok(paint('light-spill',0,noSpill).rgb.every((n,i)=>n===noSpillBaseline.rgb[i]));
});

test('the painted boundary stays in the same chart on native splats and exact SDF hits', () => {
  const transform = {translation:[.36,0,.06],rotation:[0,.39,0]};
  const runs = [[undefined,0,false],[transform,.14,false],[transform,.14,undefined]];
  for (const [pose,yaw,sdfAssist] of runs) {
    const source = scene([stamp('outline',0)],pose);
    const frame = draw(source,{yaw,sdfAssist}), p = frame.passes;
    const locate = KIT.diorama.surfaceChart(source.solids[0],ink.load().makeBuilder(0,[0]).frame);
    let checked = 0;
    for (let i=0; i<p.objectId.length; i++) {
      if (p.objectId[i]!==key(frame,'plate')) continue;
      const q=i*3;
      const hit=locate(Array.from(p.objectPosition.subarray(q,q+3)),Array.from(p.geometricNormal.subarray(q,q+3)));
      if (!hit || Math.abs(hit.uv[0]-.55)<.12 || hit.uv[1]<.12 || hit.uv[1]>.88) continue;
      assert.equal(p.outlineWeight[i],hit.uv[0]<.55 ? 0 : 1);
      checked++;
    }
    assert.ok(checked>150);
    const type = p.surfaceKinds.indexOf(sdfAssist === false ? 'splat' : 'sdf');
    assert.ok(p.surfaceKind.some((n,i)=>n===type && p.outlineWeight[i]===0));
  }
});

test('WebGL diffuse ramp preparation honors the painted bias and its bypass', async () => {
  const { applyDiffuseRamps } = await import('../src/webgl/diffuse-ramps.mjs');
  const base = KIT.diorama.build(scene());
  const painted = KIT.diorama.build(scene([stamp('shadow-band',.72)]));
  const camera = {ortho:true,view:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]};
  const data = (world,frame={})=>applyDiffuseRamps(ink.load(),world,frame,camera,0,0,world.data).data;
  const baseline = data(base);
  const active = data(painted);
  const bypass = data(painted,{shadowBandPaint:false});
  assert.ok(active.some((value,i)=>i%16===7 && value!==baseline[i]));
  assert.ok(bypass.every((value,i)=>value===baseline[i]));
});

test('pixel edits, multiview previews, and exported passes address the authored controls', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-lighting-ink-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file = name=>path.join(root,name);
  const save = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js',...args],{
    cwd:path.resolve(__dirname,'..'),encoding:'utf8',stdio:['ignore','pipe','pipe']
  });
  const pixel = (...args)=>JSON.parse(cli('pixel-art',...args));
  const doc = {format:'ink-studio/pixel-art',version:2,width:120,height:82,pixelAspect:[1,1],
    palette:{ plum:'#30223e' },layers:[{id:'ink'}],frames:[{id:'art',durationMs:100,cels:{}}],
    sceneBindings:[{id:'panel',scene:file('scene.json'),object:'plate',frame:'art'}],
    destinations:channels.map(channel=>({id:channel,channel,kind:'surface-channel',binding:'panel',chart:'face'}))};
  save('design.json',doc);
  save('scene.json',scene());
  function edit(channel,operation) {
    const observed = pixel('targets',file('design.json'),'--scene',file('scene.json'),'--destination',channel);
    save('edit.json',{id:'paint-'+channel,frame:'art',destination:channel,revision:observed.documentRevision,
      sourceRevision:observed.sourceRevision,operation});
    const receipt = pixel('edit',file('design.json'),file('edit.json'),'--scene',file('scene.json'),'--out',file('updated.json'));
    assert.equal(receipt.status,'applied');
    save('scene.json',read('updated.json'));
  }
  const sample = channel=>pixel('sample',file('design.json'),'--uv','.35,.5','--mode','source',
    '--destination',channel,'--scene',file('scene.json')).value;
  for (const [index,value] of [-.5,.25,0,.5].entries()) {
    const channel=channels[index];
    edit(channel,{stamp:{brush,value}});
    assert.equal(sample(channel),value);
  }
  edit('shadow-band',{stamp:{brush,mode:'clear'}});
  assert.equal(sample('shadow-band'),0);
  assert.equal(sample('hatch'),.25);
  save('plan.json',{format:'ink-studio/pixel-multiview',version:1,id:'spill-edge',destination:'light-spill',size:[8,8],
    views:[{id:'front',approved:true,marks:[{at:[57,43],value:0}]},{id:'check',camera:{yaw:.14}}]});
  const report = pixel('multiview',file('design.json'),file('plan.json'),'--patch',file('multi.json'));
  assert.equal(report.status,'ready');
  assert.ok(report.views[0].counts.changed>0);
  assert.equal(read('multi.json').operation.stamps[0].value,0);
  cli('passes',file('scene.json'),'--channels',inkControls.join(','),'--w','120','--h','82','--px1','--out',file('render'));
  const { files,inkControls:manifest } = read('render/passes.json');
  for (const channel of inkControls) {
    assert.ok(fs.existsSync(file('render/'+files[channel])));
    assert.equal(manifest.files[channel].format,'f32le');
    assert.equal(fs.statSync(file('render/'+manifest.files[channel].file)).size,manifest.width*manifest.height*4);
  }
});
