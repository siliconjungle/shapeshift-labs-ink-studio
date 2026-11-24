const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ink = require('..');

const palette = [0x101821,0xf39652,0x64bdbe];
const view = { raw:true, ortho:true };
const grid = { width:65,height:65,view };
const idAt = world => ink.load().KIT.procedural.splatProvenance.identities(world).idAt;

function fixture() {
  const world = { id:'scan', count:3, data:new Float32Array(48), bg:[16,24,33],
    pal:palette, dither:0, radius:4, gaussianCloud:true, fog:{ c:0,start:1,max:0 },
    cam:{ target:[0,0,0],dist:4,yaw:0,pitch:0,ortho:true },
    renderMetadata:{ objects:[null,'panel','neighbor'], objectIds:Uint32Array.of(1,1,2) } };
  world.data.set([0,0,-.1,.60,.36,0,0,0x52f396,.36,0,.01],0);
  world.data.set([0,0,.1,.60,.36,0,0,0xbebd64,.36,0,.01],16);
  world.data.set([1.8,0,.1,.75,.01,0,0,0x52f396,.01,0,.01],32);
  return world;
}

const fit = (world,attributes) => ({ format:'ink-studio/splat-fit', version:2, scene:world.id,
  target:{object:'panel'}, edits:[], attributes:attributes.map(([row,change])=>[idAt(world)(row),change]) });

test('native diagnostics pairs removed rows and distinguishes a carved interior from an open edge', () => {
  const world = fixture();
  const footprint = { shape:'mask', softness:0,
    mask:{width:3,height:3,alpha:[255,255,255,255,0,255,255,255,255]} };
  const after = fit(world,[[0,{footprint}],[1,{footprint}]]);
  const at = [32,32], rect = [27,27,11,11];
  const report = ink.reviewSplatEdit(world,{...grid,at,rect,after,limit:0});
  assert.equal(report.pairTracking,'complete');
  assert.deepEqual(report.findings,[]);
  assert(report.truncated);
  assert.equal(report.cost.before.projectedRows,2);
  assert.equal(report.cost.before.pixelTests,2*11*11);
  assert(report.cost.after.fragments < report.cost.before.fragments);
  assert(report.summary.holePixels > 0);
  assert(report.summary.removedFragments > 0);
  assert.deepEqual(report.inspected.kinds,['removed','hole']);
  assert.deepEqual(report.inspected.before.layers.map(layer=>layer.id), [idAt(world)(1),idAt(world)(0)]);
  assert(report.inspected.before.layers[0].visibleCoverage > .5);
  assert(report.inspected.before.layers[1].visibleCoverage < .3);
  assert.deepEqual(report.inspected.after.layers,[]);
  assert.equal(report.inspected.removedFragments,2);
  assert.equal(report.inspected.removed.length,2);

  const overlap = ink.reviewSplatEdit(world,{...grid,at,rect});
  assert.deepEqual(overlap.inspected.kinds,['overlap','opacity-buildup']);
  assert(overlap.inspected.after.opacity > .83);
  assert.equal(overlap.summary.removedFragments,0);

  const open = ink.reviewSplatEdit(world,{...grid,at,rect,after:fit(world,[[0,{coverage:0}],[1,{coverage:0}]])});
  assert(open.summary.uncoveredPixels > 0);
  assert.equal(open.summary.holePixels,0);
  assert.deepEqual(open.inspected.kinds,['removed','uncovered']);
  assert.throws(()=>ink.reviewSplatEdit(world,{...grid,rect:[0,0,1,1],at}),/outside the diagnostic rectangle/);
});

test('a fragment replacement is measured even when the pixel count and coverage hold', () => {
  const world = fixture();
  const before = fit(world,[[1,{coverage:0}]]);
  const after = fit(world,[[0,{coverage:0}]]);
  const report = ink.reviewSplatEdit(world,{...grid,before,after,rect:[32,32,1,1],at:[32,32]});
  assert.equal(report.inspected.before.fragments,1);
  assert.equal(report.inspected.after.fragments,1);
  assert.equal(report.summary.removedFragments,1);
  assert.equal(report.summary.addedFragments,1);
  assert.equal(report.summary.uncoveredPixels,0);
  assert.equal(report.inspected.removed[0].id,idAt(world)(0));
  assert.equal(report.inspected.added[0].id,idAt(world)(1));
});

test('the CLI and edit preview inspect an authored splat edit on the bound grid', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(),'ink-splat-diagnostics-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const scene = path.join(folder,'panel.ply'), doc = path.join(folder,'document.json'), patch = path.join(folder,'edit.json');
  const source = [
    'ply','format ascii 1.0','element vertex 2',
    ...['x','y','z','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3','opacity','f_dc_0','f_dc_1','f_dc_2']
      .map(name=>'property float '+name),
    'end_header','0 0 -.01 0 0 -3 1 0 0 0 1 .7 .1 0','0 0 .01 0 0 -3 1 0 0 0 1 -.1 -.2 .4'
  ].join('\n');
  fs.writeFileSync(scene,source);
  fs.writeFileSync(doc,JSON.stringify({format:'ink-studio/pixel-art',version:2,width:65,height:65,pixelAspect:[1,1],
    palette:{ink:'#101821'},layers:[{id:'paint'}],
    frames:[{id:'frame',durationMs:100,cels:{}}],
    sceneBindings:[{id:'cloud',scene,object:'gaussian-cloud'}],
    destinations:[{id:'splats',kind:'splat-attributes',binding:'cloud'}]}));
  const cli = path.resolve(__dirname,'../cli/ink-studio.js');
  const run = (...args) => JSON.parse(execFileSync(process.execPath,[cli,'pixel-art',...args],{cwd:folder,encoding:'utf8'}));
  const focus = ['--at','32,32','--rect','30,30,5,5'];
  const original = run('splat-diagnostics',scene,'--w','65','--h','65',...focus,'--raw');
  assert.equal(original.inspected.after.layers.length,2);
  const id = original.inspected.after.layers[0].id;
  const targets = run('targets',doc,'--scene',scene,'--destination','splats');
  fs.writeFileSync(patch,JSON.stringify({id:'hide-front',frame:'frame',destination:'splats',revision:targets.documentRevision,
    sourceRevision:targets.sourceRevision,operation:{splats:[{splat:id,coverage:0}]}}));
  const preview = run('preview',doc,patch,'--scene',scene,'--splat-diagnostics',...focus,'--raw');
  assert(preview.valid);
  assert.equal(preview.targets[0].render.diagnostics.inspected.removed[0].id,id);
  assert.equal(preview.targets[0].render.diagnostics.cost.before.projectedRows,2);
});
