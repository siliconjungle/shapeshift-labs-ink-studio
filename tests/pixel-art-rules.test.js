const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const ink = require('..');
const PixelArt = require('../cli/pixel-art.js');
const ArtInk = require('../src/art-ink.js');
const Edge = require('../src/edge-filter.js');

const palette = { shade:'#263040',light:'#b3c9c7',warm:'#ec794f',ink:'#101721',glint:'#fff2a8' };
const ramps = [{ id:'metal',swatches:['shade','light','warm'] },{ id:'sunset',swatches:['shade','warm','glint'] }];
const style = {
  version:1,
  profiles:[
    { id:'courier',ramps:['metal'],dither:{ pattern:'checker',pairs:[['shade','light']] },
      outline:{ mode:'silhouette',swatch:'ink' },edge:{ mode:'hard' },
      exceptions:[{ id:'visor-glint',check:'ramp',selection:'visor',reason:'The visor has a painted specular accent.' }] },
    { id:'prop',outline:{ mode:'off' },edge:{ mode:'area',strength:.7 } },
    { id:'late-courier',ramps:['sunset'],dither:{ pairs:[['shade','warm']] },
      outline:{ mode:'off',swatch:'ink' },edge:{ mode:'area',strength:.6 } }
  ],
  bindings:[
    { profile:'courier',layer:'actor',select:{ object:'courier' } },
    { profile:'prop',layer:'rail',select:{ object:'rail' } },
    { profile:'late-courier',layer:'actor',select:{ object:'courier' },frame:'front',shot:'dusk' }
  ]
};

function document() {
  const width = 8,height = 5;
  function marks(rows) {
    return rows.map(([x,y,swatch])=>({ at:[x,y],swatch }));
  }
  const coat = { marks:[...marks([
    [1,1,'shade'],[2,1,'warm'],[3,1,'light'],[4,1,'light'],
    [1,2,'warm'],[2,2,'shade'],[3,2,'ink'],[4,2,'light'],
    [1,3,'light'],[2,3,'light'],[3,3,'light'],[4,3,'glint'],[5,3,'glint']
  ]),{ alpha:127,runs:[[1,1,1]] }] };
  const rail = { marks:marks([[7,1,'glint'],[7,2,'warm']]) };
  return { format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],palette,ramps,
    layers:[{ id:'actor',kind:'group' },{ id:'coat',parent:'actor' },{ id:'rail' }],
    frames:[{ id:'front',durationMs:100,cels:{ coat,rail } },{ id:'side',durationMs:100,cels:{ coat,rail } }],
    selections:[{ id:'visor',frame:'front',pixels:[[4,3]] }],artRules:style };
}

test('art rules follow layer groups and report exact violations and accepted parts per shot',()=>{
  const editor = ink.createPixelEditor(document());
  const options = { frame:'front',layer:'coat' };
  const active = editor.artRules(options).active;
  assert.deepEqual(active.profiles,['courier']);
  assert.deepEqual(active.swatches,['shade','light','warm']);
  const base = editor.lint({ frame:'front' });
  const first = kind=>base.diagnostics.find(row=>row.kind === kind && !row.exception);
  assert.deepEqual(first('ramp').runs,[[3,5,1]]);
  assert.deepEqual(first('outline').at,[3,2]);
  assert.deepEqual(first('dither').runs,[[1,1,2],[2,1,2]]);
  assert.deepEqual(first('edge').at,[1,1]);
  assert.deepEqual(base.acceptedMarks,{ ramp:1 });
  const accepted = base.diagnostics.find(row=>row.exception);
  assert.equal(accepted.exception.id,'visor-glint');
  assert.deepEqual(accepted.runs,[[3,4,1]]);
  assert.deepEqual(accepted.editableRuns,[]);
  assert.ok(!base.diagnostics.some(row=>row.kind === 'ramp' && row.layers.includes('rail')));
  const dusk = editor.lint({ ...options,shot:'dusk' });
  assert.deepEqual(dusk.artRules.profiles,['courier','late-courier']);
  assert.deepEqual(dusk.artRules.ramps,['sunset']);
  assert.ok(!dusk.diagnostics.some(row=>row.kind === 'edge' || row.kind === 'dither'));
  assert.equal(editor.lint({ frame:'side',layer:'coat',shot:'dusk',kind:'ramp' }).findings.ramp.count,2);
  assert.deepEqual(PixelArt.documentFromDeck(editor.layerDeck()).artRules,style);
});

test('authoring changes participate in preview, receipts, replay, and scope validation',()=>{
  const original = document(), { artRules,...blank } = original;
  const editor = ink.createPixelEditor(blank);
  const patch = { id:'style-rules',revision:editor.describe().revision,destination:'document:art-rules',
    operation:{ artRules } };
  const preview = editor.previewEdit(patch);
  assert.equal(preview.valid,true);
  assert.equal(preview.pixelCount,0);
  assert.equal(preview.targets[0].before,null);
  assert.deepEqual(editor.apply(patch),original);
  assert.deepEqual(ink.createPixelEditor(blank).replay(editor.receipts()[0]),original);
  assert.equal(editor.undo(),true);
  assert.deepEqual(editor.snapshot(),blank);
  for (const invalid of [
    { ...style,bindings:[{ profile:'courier',layer:'absent' }] },
    { ...style,profiles:[{ id:'courier',ramps:['absent'] }] },
    { ...style,profiles:[{ id:'courier',ramps:['metal'],dither:{ pairs:[['shade','glint']] } }] }
  ]) assert.throws(()=>ink.createPixelEditor({ ...blank,artRules:invalid }),/Art rule/);

  const transformed = ink.createPixelEditor(original);
  transformed.apply({ id:'pad',revision:transformed.describe().revision,destination:'document:canvas',
    operation:{ type:'pad',margins:[1,1,0,0] } });
  assert.deepEqual(transformed.lint({ frame:'front',kind:'ramp' }).diagnostics.find(row=>row.exception).at,[5,4]);
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'ink-art-rules-'));
  t.after(()=>fs.rmSync(directory,{ recursive:true,force:true }));
  const file = name=>path.join(directory,name);
  const doc = file('design.json');
  fs.writeFileSync(doc,JSON.stringify(document()));
  const cli = (...args)=>execFileSync(process.execPath,['cli/ink-studio.js',...args],
    { cwd:path.resolve(__dirname,'..'),encoding:'utf8' });
  return { cli,doc,file };
}

test('the scene adapter applies scoped palette, outline, and edge control to real headless pixels', t=>{
  const { cli,doc,file } = fixture(t);
  const report = JSON.parse(cli('pixel-art','rules',doc,'--frame','front','--layer','coat'));
  const dusk = JSON.parse(cli('pixel-art','rules',doc,'--frame','front','--art-shot','dusk'));
  assert.deepEqual(report.scene.paletteConstraints.targets[0].dither.pairs,[{ colors:[palette.shade,palette.light] }]);
  assert.deepEqual(dusk.scene.paletteConstraints.targets.at(-1).dither.pairs,[{ colors:[palette.shade,palette.warm] }]);
  const shape = file('world.json');
  const spec = { id:'test',style:'slate',
    camera:{ target:[0,0,0],yaw:0,pitch:0,dist:4,projection:'orthographic' },
    solids:[{ id:'courier',kind:'box',half:[.4,.44,.15],at:[-.51,0,0],res:.11,mat:'stone' },
      { id:'rail',kind:'box',half:[.31,.06,.13],at:[.56,0,.05],res:.08,mat:'stone' }] };
  fs.writeFileSync(shape,JSON.stringify(spec));
  const world = ink.load().KIT.diorama.build(spec);
  const view = { w:72,h:46,px:1,passes:['inkMask','objectId','paletteOwner','coverage'] };
  const base = ink.render(world,{ ...view,assetArtRules:report.scene });
  const next = ink.render(world,{ ...view,assetArtRules:dusk.scene });
  const native = base.passes, actor = native.objects.indexOf('courier'), rail = native.objects.indexOf('rail');
  assert.ok(actor > 0 && rail > 0);
  const p = native.objectId.findIndex((owner,i)=>owner === actor && native.inkMask[i] === 1);
  assert.ok(p >= 0);
  assert.equal(next.passes.inkMask[p],0);
  assert.equal(native.paletteOwners[native.paletteOwner[p]].asset,'courier');
  assert.equal(next.passes.paletteOwners[next.passes.paletteOwner[p]].asset,'late-courier');
  const pair = [ink.render(world,{ ...view,raw:true }),ink.render(world,{ ...view,raw:true,assetArtRules:report.scene })];
  assert.ok(pair[1].passes.coverage.some((a,i)=>i%72 > 36 && Math.abs(a-pair[0].passes.coverage[i]) > .001));

  const before = file('base.png'), after = file('dusk.png'), recipe = file('dusk.json');
  cli('render',shape,'--w','72','--h','46','--px','1','--art-rules',doc,'--art-frame','front','--out',before);
  cli('render',shape,'--w','72','--h','46','--px','1','--art-rules',doc,'--art-frame','front','--art-shot','dusk',
    '--out',after,'--recipe',recipe);
  assert.notDeepEqual(fs.readFileSync(after),fs.readFileSync(before));
  const params = JSON.parse(fs.readFileSync(recipe,'utf8'));
  assert.ok(JSON.stringify(params).includes('design.json'));
  const replay = file('replay.png');
  cli('shot','replay',recipe,'--out',replay);
  assert.deepEqual(fs.readFileSync(replay),fs.readFileSync(after));
  const lint = JSON.parse(cli('pixel-art','lint',doc,'--frame','front','--layer','coat','--art-shot','dusk'));
  assert.deepEqual(lint.artRules.ramps,['sunset']);
  assert.equal(ArtInk.prepare(dusk.scene.ink,[0]).scoped.length,3);
  assert.equal(Edge.prepare(dusk.scene.edgeFilter).bind(world)(0),.6);
});
