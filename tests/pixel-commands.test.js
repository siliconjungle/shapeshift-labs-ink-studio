'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const ink = require('..');
const PNG = require('../cli/png.js');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const command = (action,fields) => ({ format:'ink-studio/pixel-command',version:1,action,...fields });
const json = value=>JSON.parse(JSON.stringify(value));
const design = {
  format:'ink-studio/pixel-art',version:2,width:6,height:5,pixelAspect:[1,1],
  palette:{ brick:'#a04829',copper:'#ad7738',glass:'#47ae96' },layers:[{id:'ink'}],
  frames:[{id:'front',durationMs:90,cels:{ink:{marks:[]}}}]
};

function workspace(t,source,scene) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'ink-pixel-commands-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file = name=>path.join(root,name), save = (name,value)=>fs.writeFileSync(file(name),JSON.stringify(value));
  const read = name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
  const session = file('session');
  function call(args,status=0) {
    const run = spawnSync(process.execPath,[cli,'pixel-art','session',...args],{cwd:root,encoding:'utf8'});
    assert.equal(run.status,status,run.stderr || run.stdout);
    return run.stdout ? JSON.parse(run.stdout) : undefined;
  }
  function initialize() {
    save('document.json',source);
    if (scene) save('scene.json',scene);
    call(['init',session,file('document.json'),...(scene ? ['--scene',file('scene.json')] : [])]);
  }
  function run(raw,{status=0,extra=[]}={}) {
    save('command.json',raw);
    return call(['run',session,file('command.json'),...extra],status);
  }
  return { root,file,save,read,session,call,initialize,run };
}

test('portable edit commands produce the same revision, preview, receipt, history and export in the CLI and SDK',t=>{
  const w = workspace(t,design);
  w.initialize();
  const editor = ink.createPixelEditor(design);
  const both = (raw,options)=>{
    const expected = editor.execute(raw,{directory:w.root});
    assert.deepEqual(w.run(raw,options),json(expected));
    return expected;
  };
  let revision = both(command('validate')).revision;
  assert.equal(both(command('inspect',{at:[1,1],options:{frame:'front'}})).swatch,null);
  const selection = {type:'rectangle',rect:[1,1,2,1]};
  assert.deepEqual(both(command('select',{query:selection,options:{frame:'front'}})).pixels,[[1,1],[2,1]]);

  both(command('begin',{label:'Paint and move a badge'}));
  const draw = command('draw',{patch:{
    id:'draw-badge',revision,frame:'front',operation:{tool:'pencil',layer:'ink',swatch:'brick',points:[[1,1],[2,1]]}
  }});
  const predicted = both(command('preview',{edit:draw}));
  assert.equal(predicted.valid,true);
  assert.equal(predicted.pixelCount,2);
  assert.equal(editor.describe().revision,revision);
  assert.equal(both(command('validate')).revision,revision);

  const first = both(draw);
  assert.equal(first.status,'applied');
  const mask = command('mask',{patch:{
    id:'pick-badge',revision:first.outputs.documentRevision,frame:'front',operation:{id:'badge',query:selection}
  }});
  const picked = both(mask);
  assert.equal(picked.affectedTargets[0].selection,'badge');
  const recolor = command('recolor',{patch:{
    id:'color-badge',revision:picked.outputs.documentRevision,frame:'front',
    operation:{layer:'ink',selection:'badge',from:'brick',to:'glass'}
  }});
  const colored = both(recolor);
  assert.equal(colored.command.patch.operation.tool,'replace-swatch');
  const move = command('transform',{patch:{
    id:'move-badge',revision:colored.outputs.documentRevision,frame:'front',
    operation:{layer:'ink',selection:'badge',transform:{offset:[2,1]},resultSelection:'moved'}
  }});
  const moved = both(move);
  revision = moved.outputs.documentRevision;
  const wrong = both(command('preview',{edit:{...move,patch:{...move.patch,revision:first.inputs.documentRevision}}}),{status:2});
  assert.equal(wrong.conflicts[0].code,'stale-document');
  const draft = both(command('preview',{options:{limit:1}}));
  assert.equal(draft.pixelCount,2);
  assert.equal(draft.pixels.length,1);
  assert.deepEqual(draft.targets.map(row=>row.tool),['pencil','rectangle','replace-swatch','transform']);
  assert.equal(both(command('inspect',{at:[3,2]})).swatch,'glass');
  assert.equal(both(command('commit')).changed,true);
  assert.equal(both(command('validate')).revision,revision);
  const exported = both(command('export'));
  assert.deepEqual(exported.data.selections.find(row=>row.id==='moved').pixels,[[3,2],[4,2]]);
  assert.deepEqual(both(command('export',{artifact:'layer-deck'})).data.frames[0].id,'front');
  assert.deepEqual(both(command('export',{artifact:'stamp',options:{layer:'ink'}})).data.swatchIds,
    ['brick','copper','glass']);

  const png = both(command('export',{artifact:'png',options:{layer:'ink',colorMode:'indexed'}}));
  const pngBytes = Buffer.from(png.data,png.encoding), raster = PNG.paintRaster(pngBytes);
  assert.equal(raster.swatchIds[raster.slots[2*design.width+3]],'glass');
  assert.equal(raster.slots[design.width+1],null);
  w.call(['export',w.session,'--artifact','png','--layer','ink','--color-mode','indexed','--out',w.file('art.png')]);
  assert.deepEqual(fs.readFileSync(w.file('art.png')),pngBytes);
  const preset = {format:'ink-studio/pixel-export-preset',version:1,id:'art',outputs:['png','document']};
  const packed = both(command('export',{artifact:'preset',options:{preset,out:'asset'}}));
  assert.ok(fs.existsSync(packed.data.file));

  assert.equal(both(command('undo')).changed,true);
  assert.deepEqual(both(command('export')).data,design);
  assert.equal(both(command('redo')).changed,true);
  assert.deepEqual(both(command('export')).data,exported.data);
  assert.equal(both(command('undo')).changed,true);
  assert.deepEqual(both(command('replay',{receipt:first})),first);
  assert.equal(both(command('inspect',{at:[1,1]})).swatch,'brick');
});

test('session shortcuts and the shared SDK commands apply the same bound paint and can undo it',t=>{
  const scene = {id:'plate',style:'slate',solids:[
    {id:'plate',kind:'box',at:[0,0,0],half:[1,1,.2],mat:'stone',
      surfaceState:{charts:{face:{origin:[-1,-1,.2],u:[2,0,0],v:[0,2,0],stamps:[]}}}}
  ]};
  const source = structuredClone(design), w = workspace(t,source,scene);
  source.layers.push({id:'coat',kind:'surface',destination:'pigment'});
  source.sceneBindings = [{id:'plate',scene:w.file('scene.json'),object:'plate',layer:'coat',frame:'front'}];
  source.destinations = [{id:'pigment',kind:'surface-channel',binding:'plate',chart:'face',channel:'pigment'}];
  w.initialize();

  const editor = ink.createPixelEditor(source,{sceneEditor:ink.createSceneEditor(scene),sceneRef:w.file('scene.json')});
  const {documentRevision,sourceRevision} = editor.targets('layer:coat');
  const draw = command('draw',{patch:{id:'draw-coat',revision:documentRevision,sourceRevision,frame:'front',destination:'layer:coat',
    operation:{pixel:[3,2],value:'copper'}}});
  editor.execute(command('begin',{label:'Paint the plate'}));
  w.call(['begin',w.session,'--label','Paint the plate']);
  w.save('draw.json',draw.patch);
  const fromCli = w.call(['draw',w.session,w.file('draw.json')]);
  assert.deepEqual(fromCli,editor.execute(draw));
  const preview = editor.execute(command('preview'));
  assert.deepEqual(w.call(['preview',w.session]),preview);
  assert.deepEqual(preview.sources.map(row=>row.object),['plate']);
  editor.execute(command('commit'));
  w.call(['commit',w.session]);
  assert.deepEqual(w.run(command('export',{artifact:'scene'})),editor.execute(command('export',{artifact:'scene'})));
  w.call(['export',w.session,'--artifact','scene','--out',w.file('painted.json')]);
  assert.deepEqual(w.read('painted.json'),editor.sceneEditor.snapshot());
  editor.execute(command('undo'));
  w.call(['undo',w.session]);
  assert.deepEqual(w.run(command('export',{artifact:'scene'})),editor.execute(command('export',{artifact:'scene'})));
});

test('command validation and output guards reject unsafe writes before staging an edit',t=>{
  const w = workspace(t,design);
  w.initialize();
  const editor = ink.createPixelEditor(design);
  const draw = command('draw',{patch:{id:'put-pixel',revision:editor.describe().revision,frame:'front',
    operation:{tool:'pencil',layer:'ink',swatch:'brick',points:[[1,1]]}}});
  assert.throws(()=>editor.execute({...draw,version:2}),/version 1/);
  assert.throws(()=>editor.execute(command('preview',{edit:command('undo')})),/needs a pixel edit/);
  w.run({...draw,version:2},{status:1});
  const stale = {...draw,patch:{...draw.patch,revision:'0'.repeat(64)}};
  let rejected;
  assert.throws(()=>editor.execute(stale),error=>{
    rejected = error.receipt;
    return rejected?.conflicts[0].code === 'stale-document';
  });
  assert.deepEqual(w.run(stale,{status:2}),rejected);
  w.run(draw,{extra:['--out',w.file('command.json')],status:1});
  fs.symlinkSync(w.session,w.file('alias'),'dir');
  w.run(draw,{extra:['--out',w.file('alias/checkpoint-1.json')],status:1});
  assert.equal(w.run(command('validate')).revision,editor.describe().revision);
  const report = w.file('report.json');
  const result = w.run(command('validate'),{extra:['--out',report]});
  assert.equal(result,undefined);
  assert.equal(w.read('report.json').revision,editor.describe().revision);
});
