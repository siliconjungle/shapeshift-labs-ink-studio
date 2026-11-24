const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const design = {
  format:'ink-studio/pixel-art',version:2,width:2,height:1,pixelAspect:[1,1],
  palette:{ blue:'#0000ff',red:'#ff0000',alias:'#ff0000',white:'#ffffff' },
  layers:[{ id:'bottom' },{ id:'group',kind:'group',opacity:.5 },
    { id:'under',parent:'group' },{ id:'mask',kind:'mask',parent:'group' },
    { id:'color',parent:'group',clip:'mask' },{ id:'hidden',visible:false },{ id:'ref',kind:'reference' }],
  frames:[{ id:'front',durationMs:100,cels:{
    bottom:{ slots:['blue','blue'],marks:[] },under:{ slots:['white',null],marks:[] },
    mask:{ slots:['white',null],marks:[] },color:{ id:'coat',slots:['alias','red'],marks:[] },
    hidden:{ slots:['red',null],marks:[] },ref:{ slots:['white',null],marks:[] }
  } }]
};

test('inspection follows actual layer compositing, clips, isolated groups, and swatch aliases', () => {
  const editor = ink.createPixelEditor(design), report = editor.inspect([0,0]);
  assert.deepEqual(report.composite,{ layer:'color',cel:'coat',color:'#80007f',alpha:255 });
  assert.deepEqual(report.palette,{ swatch:{ index:2,id:'alias',color:'#ff0000' },color:'#80007f',method:'layer-blend' });
  const rows = new Map(report.layers.map(row=>[row.id,row]));
  const group = rows.get('group');
  assert.equal(group.effectiveAlpha,128);
  assert.equal(group.contributes,true);
  assert.equal(group.children.find(row=>row.id === 'under').contributes,false);
  assert.equal(group.children.find(row=>row.id === 'mask').contributes,true);
  assert.equal(group.children.find(row=>row.id === 'color').sourceAlpha,255);
  assert.deepEqual(group.children.find(row=>row.id === 'color').clip,{ layer:'mask',alpha:255 });
  assert.equal(rows.get('bottom').contributes,true);
  assert.equal(rows.get('hidden').status,'hidden');
  assert.equal(rows.get('ref').status,'reference-disabled');
  const clipped = editor.inspect([1,0]);
  assert.equal(clipped.layers.find(row=>row.id === 'group').children.at(-1).status,'clipped');
  assert.equal(clipped.composite.color,'#0000ff');
  const working = editor.inspect([0,0],{ references:true });
  assert.equal(working.composite.layer,'ref');
  assert.equal(working.layers[0].contributes,false);
  assert.equal(working.layers.at(-1).locked,true);
});

test('full-opacity blend keeps its backdrop in the inspection and uses the blended output', () => {
  const editor = ink.createPixelEditor({ ...design,layers:[{ id:'a' },{ id:'b',blend:'multiply' }],
    frames:[{ id:'front',durationMs:100,cels:{ a:{ slots:['blue',null],marks:[] },b:{ slots:['red','red'],marks:[] } } }] });
  const overlap = editor.inspect([0,0]);
  assert.equal(overlap.composite.color,'#000000');
  assert.equal(editor.sample([0,0]).color,overlap.composite.color);
  assert.deepEqual(overlap.layers.map(row=>row.contributes),[true,true]);
  assert.equal(editor.inspect([1,0]).composite.color,'#ff0000');
});

const source = {
  id:'inspection-panel',style:'slate',
  camera:{ target:[0,0,0], dist:4, pitch:0, yaw:0, projection:'orthographic', sway:0 },
  solids:[{ id:'panel',kind:'box',at:[0,0,0],half:[1,1,.25],res:.14,mat:'stone',
    surfaceState:{ charts:{ front:{ origin:[-1,-1,.25],u:[2,0,0],v:[0,2,0],stamps:[
      { channel:'wear',value:.625,brush:{ kind:'rect',min:[0,0],max:[1,1] } },
      { channel:'paint',value:'#cca844',brush:{ kind:'rect',min:[0,0],max:[1,1] } }
    ] } } } }]
};

test('CLI inspection uses aligned render hits, scene palette decisions and bound chart values', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-inspect-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const file = name=>path.join(directory,name+'.json'), scene = file('scene'), document = file('document');
  const data = {
    ...design,width:20,height:16,layers:[{ id:'paint',kind:'surface',destination:'glaze' }],
    frames:[{ id:'front',durationMs:100,cels:{} }],sceneBindings:[{ id:'panel',scene,object:'panel' }],
    destinations:[
      { id:'wear',kind:'surface-channel',binding:'panel',chart:'front',channel:'wear' },
      { id:'glaze',kind:'surface-channel',binding:'panel',chart:'front',channel:'paint' }
    ]
  };
  fs.writeFileSync(scene,JSON.stringify(source));
  fs.writeFileSync(document,JSON.stringify(data));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js','pixel-art',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  cli('inspect',document,'--scene',scene,'--destination','wear,layer:paint','--at','10,8','--out',file('report'));
  const report = JSON.parse(fs.readFileSync(file('report'),'utf8'));
  assert.deepEqual(report.at,[10,8]);
  assert.equal(report.composite.alpha,0);
  assert.deepEqual(report.materials.map(row=>row.requestedDestination),['wear','layer:paint']);
  assert.equal(report.materials[0].value,.625);
  assert.equal(report.materials[1].value.coverage,1);
  assert.equal(report.scene.id,source.id);
  assert.equal(report.scene.surface.object,'panel');
  assert.equal(report.scene.paletteTrace.width,20);
  assert.ok(report.scene.paletteTrace.decisions.length > 0);
  assert.ok(report.scene.fragments.hits.some(hit=>hit.object === 'panel' && hit.visibleCoverage > 0));
  assert.ok(report.scene.channels.coverage > 0);

  const editor = ink.createPixelEditor(data,{ sceneEditor:ink.createSceneEditor(source),sceneRef:scene });
  const sdk = editor.inspect([10,8],{ captureSelection:settings=>{
    assert.deepEqual(settings.palettePixel,[10,8]);
    return { w:20,h:16,rgb:new Uint8Array(20*16*3) };
  } });
  assert.equal(sdk.materials.length,2);
  assert.equal(sdk.scene.color,'#000000');
  assert.throws(()=>editor.inspect([10,8],{ renderFrame:{ w:2,h:2 } }),/native grid/);
});
