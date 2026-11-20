const assert = require('node:assert/strict');
const {test} = require('node:test');
const {execFileSync} = require('node:child_process');
const {mkdtempSync,readFileSync,writeFileSync,rmSync} = require('node:fs');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {load} = require('..');
const {KIT:K,SurfaceLook,ColorSpace} = load();
const api = K.palette.lightingRamps;
const source = require('../examples/lighting-ramp-palette.json');

test('suggestions choose ordered source swatches and keep the base anchor fixed',()=>{
  const draft = api.suggest(source);
  assert.deepEqual(draft,api.suggest(source));
  assert.deepEqual(draft.palette,source.palette);
  const lab = hex=>ColorSpace.toOKLab([1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));
  for (const [role,row] of Object.entries(draft.ramps)) {
    const {base,candidates} = source.materials[role];
    assert.equal(row.swatches.base,base);
    assert.deepEqual(Object.keys(row.swatches),api.tones);
    const slots = Object.values(row.swatches);
    assert(slots.every(i=>candidates.includes(i)));
    const lightness = slots.slice(0,5).map(i=>lab(draft.palette[i])[0]);
    assert(lightness.every((n,i)=>!i || n>=lightness[i-1]));
    assert(new Set(slots.slice(0,5)).size>=4);
  }
  const sparse = api.suggest({palette:['#222222'],materials:{cloth:{base:0}}});
  assert(Object.values(sparse.ramps.cloth.swatches).every(slot=>slot===0));
  assert.throws(()=>api.suggest({palette:source.palette,materials:{iron:{base:0,candidates:[2,3]}}}),/base must be/);
});

test('approval keeps authored overrides and exports directly consumable material roles',()=>{
  const draft = api.suggest(source);
  const suggested = draft.ramps.stone.swatches.highlight;
  draft.ramps.stone.swatches.highlight = 26;
  draft.ramps.stone.positions[1] = .24;
  assert.notEqual(suggested,26);
  const approved = api.approve(draft);
  assert.deepEqual(approved.roles['stone.highlight'],[26]);
  assert.deepEqual(approved.roles.studio,source.roles.studio);
  assert.equal(approved.roles.stone.at(-1),26);
  assert.deepEqual(approved.roles['stone.bounce'],[draft.ramps.stone.swatches.bounce]);
  assert.deepEqual(approved.roles['stone.neutralizer'],[draft.ramps.stone.swatches.neutralizer]);
  const lights = {layers:{test:{type:'diffuse',lightingRamp:approved.ramps.stone}}};
  const prepared = SurfaceLook.prepare(lights,approved.palette,[0,0,1],undefined,{paletteRoles:approved.roles});
  const rgb = SurfaceLook.shade(prepared,{position:[0,0,0],normal:[0,0,1],view:[0,0,1]},[0,0,0]);
  assert.deepEqual(rgb.slice(0,3),[217/255,175/255,122/255]);
  approved.roles.stone[0] = 0;
  assert.notEqual(draft.ramps.stone.swatches.shadow,0);

  draft.ramps.stone.positions[1] = 1;
  assert.throws(()=>api.approve(draft),/increasing positions/);
  draft.ramps.stone.swatches.highlight = draft.palette.length;
  assert.throws(()=>api.approve(draft),/six named/);
});

test('the CLI writes an editable draft and reads edits before saving named roles',()=>{
  const dir = mkdtempSync(join(tmpdir(),'ink-lighting-roles-'));
  try {
    const cli = join(__dirname,'../cli/ink-studio.js'), input = join(__dirname,'../examples/lighting-ramp-palette.json');
    const draftPath = join(dir,'draft.json'), approvedPath = join(dir,'roles.json');
    const run = (...args)=>execFileSync(process.execPath,[cli,'palette','lighting',...args],{encoding:'utf8'});
    run(input,'--out',draftPath);
    const draft = JSON.parse(readFileSync(draftPath,'utf8'));
    draft.ramps.skin.swatches.bounce = 28;
    draft.ramps.skin.interpolation = 'step';
    writeFileSync(draftPath,JSON.stringify(draft));
    run(draftPath,'--approve','--out',approvedPath);
    const approved = JSON.parse(readFileSync(approvedPath,'utf8'));
    assert.deepEqual(approved,api.approve(draft));
    assert.equal(approved.roles.skin[1],28);
    assert.equal(approved.ramps.skin.interpolation,'step');
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
