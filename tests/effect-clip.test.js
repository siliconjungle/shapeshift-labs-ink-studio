const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ink = require('..');
const {startEffectClipEditor} = require('../cli/effect-clip-command.js');
const rocket = path.resolve(__dirname,'../examples/rose-engine.effect.json');
const cli = path.resolve(__dirname,'../cli/ink-studio.js');

function scratch(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ink-effect-clip-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  return folder;
}

test('Moving ignition drives every pinned pass on one playhead and an invalid edit is atomic', async t=>{
  const clip=ink.readEffectClip(rocket);
  t.after(clip.clear);
  const before=await clip.preview(.97);
  assert.deepEqual(before.report.pins,['beauty','pressure','core','nozzle']);
  assert(before.report.lanes.core>.9 && before.report.lanes.nozzle>.9);
  const prior=clip.snapshot();
  assert.throws(()=>clip.edit({cues:{ignition:2.35}}),/lane pressure.*(out|increase)/);
  assert.equal(clip.snapshot(),prior);
  clip.edit({cues:{ignition:1.20}});
  const delayed=await clip.preview(.97);
  assert.equal(delayed.report.time,before.report.time);
  assert.equal(delayed.report.revision,1);
  assert.equal(delayed.report.lanes.core,0);
  for(const pass of before.report.pins)
    assert.notEqual(delayed.report.previews[pass].sha256,before.report.previews[pass].sha256,pass);
  const atFire=await clip.preview(1.20,{pins:['core','heat','coreLevel']});
  assert.equal(atFire.report.lanes.core,1);
  assert.equal(atFire.values.coreLevel,1);
  assert.equal(atFire.values.heat.channels,1);
  assert(atFire.artifacts.some(asset=>asset.file==='previews/heat.png'));
  const keys=clip.snapshot().lanes.core.keys.map(row=>row.cue==='ignition'&&row.offset===undefined?{...row,value:.51}:row);
  clip.edit({lanes:{core:keys},parameters:{power:.8},pins:['beauty','core']});
  const changed=await clip.preview(1.20);
  assert.equal(changed.report.lanes.core,.51);
  assert.deepEqual(changed.report.pins,['beauty','core']);
  assert.notEqual(changed.report.previews.core.sha256,atFire.report.previews.core.sha256);
});

test('CLI export saves edited lanes and a normal group with overridable cue sockets', async t=>{
  const folder=scratch(t), edits=path.join(folder,'edits.json');
  fs.writeFileSync(edits,JSON.stringify({cues:{ignition:1.2},parameters:{power:.8},pins:['beauty','heat']}));
  const out=path.join(folder,'share');
  const files=JSON.parse(execFileSync(process.execPath,[cli,'effect-clip','export',rocket,'--edits',edits,'--out',out],
    {encoding:'utf8'})).files;
  const exported=ink.readEffectClip(path.join(out,files.clip));
  t.after(exported.clear);
  const group=JSON.parse(fs.readFileSync(path.join(out,files.group),'utf8'));
  assert.equal(group.format,'ink-studio/graph-group');
  assert.equal(group.inputs['cue-ignition'].default,1.2);
  assert.equal(group.inputs.power.default,.8);
  const project=ink.readGraphProject(path.join(out,files.project));
  t.after(project.clear);
  const live=await exported.preview(1.2);
  const used=await project.previewFrame({beauty:{output:'beauty'}},{time:1.2});
  assert.equal(live.report.previews.beauty.sha256,used.report.previews.beauty.sha256);
  const overridden=await project.previewFrame({core:{output:'coreLevel'}},{time:.95,inputs:{'cue-ignition':.95}});
  assert.equal(overridden.values.core,1);
  const retimed=ink.createGraphProject({
    format:'ink-studio/graph-project',version:1,groups:{Rocket:files.group},
    nodes:{delayed:{op:'anim.retime',group:'Rocket',inputs:{timing:{delay:.75,range:[0,2.4]}}}},
    outputs:{core:{node:'delayed',port:'coreLevel'}}
  },{baseDir:out});
  t.after(retimed.clear);
  assert((await retimed.previewFrame({core:{output:'core'}},{time:1.95})).values.core > .999);
  assert.deepEqual(exported.snapshot().pins,['beauty','heat']);
  const report=JSON.parse(execFileSync(process.execPath,[cli,'effect-clip','preview',path.join(out,files.clip),
    '--at','1.2','--out',path.join(folder,'frame')],{encoding:'utf8'}));
  assert.equal(report.previews.beauty.sha256,live.report.previews.beauty.sha256);
  assert(fs.existsSync(path.join(folder,'frame','previews','beauty.png')));
});

test('Relocating an effect preserves group dependencies and named graph assets', async t=>{
  const folder=scratch(t), input=path.join(folder,'origin'),output=path.join(folder,'dist');
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input,'source.json'),'0.75\n');
  fs.writeFileSync(path.join(input,'reader.json'),JSON.stringify({
    format:'ink-studio/graph-group',version:1,revision:2,inputs:{lane:'number'},
    nodes:{gain:{op:'multiply',inputs:{a:{input:'lane'},b:{node:'asset'}}},
      asset:{op:'jsonAsset',inputs:{name:'gain'}}},
    outputs:{value:{node:'gain'}}
  }));
  const session=ink.createEffectClip({
    format:'ink-studio/effect-clip',version:1,id:'asset-clip',duration:1,
    cues:{peak:{at:.5}},lanes:{gain:{keys:[{at:0,value:0},{cue:'peak',value:1}]}},
    graph:{assets:{gain:{format:'json',file:'source.json'}},groups:{Read:{file:'reader.json',revision:2}},
      nodes:{value:{op:'Read',inputs:{lane:{node:'lane-gain'}}}},outputs:{value:{node:'value'}}}
  },{baseDir:input});
  t.after(session.clear);
  session.edit({cues:{peak:.75}});
  const {files}=session.export(output);
  const live=ink.readGraphProject(path.join(output,files.project));
  t.after(live.clear);
  assert.equal((await live.previewFrame({value:{output:'value'}},{time:.75})).values.value,.75);
});

test('Loopback editor previews a validated edit and downloads a reusable group', async t=>{
  const clip=ink.readEffectClip(rocket);
  const {server,url}=await startEffectClipEditor(clip);
  t.after(()=>{server.close();server.closeAllConnections();clip.clear();});
  const page=await fetch(url);
  assert.equal(page.status,200);
  assert.match(await page.text(),/Parameter lanes/);
  const {key,state}=await (await fetch(url+'/session')).json();
  assert.equal(state.cues.ignition.at,.95);
  const headers={'Content-Type':'application/json','X-Ink-Session':key};
  const body=JSON.stringify({time:.97,edit:{cues:{ignition:1.2}}});
  assert.equal((await fetch(url+'/preview',{method:'POST',body})).status,403);
  const patched=await (await fetch(url+'/preview',{method:'POST',headers,body})).json();
  assert.equal(patched.report.lanes.core,0);
  assert.equal(patched.artifacts.length,4);
  const saved=await (await fetch(url+'/download',{method:'POST',headers,body:JSON.stringify({kind:'group'})})).json();
  assert.equal(saved.document.inputs['cue-ignition'].default,1.2);
  assert.equal(saved.filename,'rose-engine.group.json');
});
