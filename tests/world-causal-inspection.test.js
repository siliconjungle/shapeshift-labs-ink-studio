const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const studio=require('..');
const {KIT:{world:W}}=studio.load();
const select=(run,at,options)=>run.query().trace('world/causal-inspection',at,options).value;
const copy=value=>JSON.parse(JSON.stringify(value));
const box=(min,max)=>({min,max});
const stock=(initial,at,max)=>({kind:'store',config:{accounts:{water:{initial,at,max,resource:'water',units:'world^3'}}}});
const transfer=(tick,amount,id)=>({tick,id,action:'world/transfer',args:{
  from:'supply/water',to:'tank/water',amount,mode:'exact'
}});
function scene(causality={inspection:true}) {
  return {format:'ink-studio/world',id:'cistern',dt:.1,causality,history:{enabled:false},
    entities:{cistern:{position:[2,1,0],sockets:{intake:[0,0,0]}},pump:{position:[-2,1,0]}},
    systems:{supply:stock(14,{entity:'pump'},20),tank:stock(2,{entity:'cistern',socket:'intake'},10)},
    commands:[transfer(1,3,'fill-1'),transfer(3,4,'fill-2'),transfer(4,5,'blocked-attempt')]};
}

test('object inspection finds recorded decisions without specifying a root ID and reads the current signal',()=>{
  const run=W.runtime.create(require('../examples/world-causal-mill.json'));
  run.advance(8);
  const report=select(run,{entity:'mill-wheel'},{ports:['mill/speed.shaft']});
  assert.equal(report.target.entity,'mill-wheel');
  assert.equal(report.conditions.find(row=>row.kind==='port').sample.value,0);
  assert.equal(report.status,'complete');
  const stop=report.nodes.find(row=>row.kind==='machine-stop');
  assert(report.roots.some(root=>root.id===stop.id&&root.match==='entity'));
  assert(report.nodes.some(row=>row.data.commandId==='pump-overload'));
  assert(report.nodes.some(row=>row.type==='input'&&row.data.delay===1));
  assert(report.edges.every(({cause,effect})=>report.nodes.find(row=>row.id===effect).parents.includes(cause)));
});

test('located transfers explain account transitions and prior values without claiming a blocked attempt changed the balance',()=>{
  const run=W.runtime.create(scene());
  run.advance(4);
  const report=select(run,{entity:'cistern',socket:'intake'});
  const latest=report.nodes.find(row=>row.kind==='account-balance'&&row.data.balance===9);
  const parents=latest.parents.map(ref=>report.nodes.find(row=>row.id===ref));
  assert.equal(report.conditions.find(row=>row.kind==='account').sample.value.balance,9);
  assert.deepEqual(parents.map(row=>[row.kind,row.tick]),[['account-balance',1],['transfer',3]]);
  assert.equal(latest.data.previous,5);
  assert(report.nodes.some(row=>row.kind==='balance-before-transfer'&&row.data.balance===2));
  assert(report.nodes.some(row=>row.kind==='transfer'&&row.data.status==='blocked'));
  assert.deepEqual(report.nodes.filter(node=>node.type==='command').map(node=>node.data.commandId).sort(),
    ['blocked-attempt','fill-1','fill-2']);
  assert.equal(run.history.length,0);
  assert.deepEqual(select(run.fork(),{entity:'cistern',socket:'intake'}),report);
  const replay=W.runtime.replay(copy(run.recording()));
  assert.deepEqual(select(replay,{entity:'cistern',socket:'intake'}),report);
});

test('area selection uses recorded transfer positions and spatial field axes',()=>{
  const world=scene();
  world.systems.weather={kind:'fields',config:{fields:{heat:{axes:'xy',units:'degC',default:19}}}};
  world.commands.push({tick:2,action:'weather/set',args:{field:'heat',region:{bounds:box([1,0],[3,2]),value:30}}});
  const run=W.runtime.create(world);
  run.advance(4);
  const where={bounds:{axes:'xyz',...box([1.5,0,-.4],[2.5,2,.4])}};
  const old=select(run,where,{fields:['weather/heat']});
  assert.equal(old.conditions[0].sample.value,30);
  assert(old.roots.some(root=>root.match==='overlap'));
  assert(old.nodes.some(row=>row.kind==='field-edit'));
  run.schedule([{tick:5,action:'world/patch',args:{edits:[{op:'set',path:'/entities/cistern/position',value:[8,1,0]}]}}]);
  run.step();
  const originalArea=select(run,where);
  const newArea=select(run,{point:[8,1,0],radius:.4});
  assert(!originalArea.conditions.some(row=>row.kind==='account'));
  assert(originalArea.nodes.some(row=>row.kind==='account-balance'&&row.data.balance===9));
  assert.equal(newArea.conditions.find(row=>row.kind==='account').sample.value.balance,9);
  assert(newArea.roots.some(root=>root.match==='account'));
  assert(!newArea.roots.some(root=>root.match==='overlap'&&newArea.nodes.find(row=>row.id===root.id).type==='state'));
  assert(select(run,{point:[2,1,100]}).nodes.some(row=>row.kind==='field-edit'));
  assert.equal(select(run,{point:[2,6,100]}).status,'unrecorded');
});

test('missing ancestry and disabled recording remain visible alongside current conditions',()=>{
  const run=W.runtime.create(scene({limit:3,inspection:true}));
  run.advance(3);
  const report=select(run,{entity:'cistern'});
  assert.equal(report.status,'partial');
  assert(report.gaps.some(row=>row.reason==='retention'));
  assert.equal(report.conditions.find(row=>row.kind==='account').sample.value.balance,9);
  const noTrace=W.runtime.create(scene(false));
  noTrace.advance(3);
  const current=select(noTrace,{entity:'cistern'});
  assert.equal(current.status,'disabled');
  assert.equal(current.nodes.length,0);
  assert.equal(current.conditions.find(row=>row.kind==='account').sample.value.balance,9);
  const all=W.runtime.create(scene());
  all.advance(4);
  const recent=select(all,{entity:'cistern'},{since:4,maxRoots:1,limit:5});
  assert.equal(recent.roots.length,1);
  assert.equal(recent.nodes[0].tick,4);
});

test('the CLI queries recorded causes with a region selector',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-causal-region-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'world.json');
  fs.writeFileSync(file,JSON.stringify(scene()));
  const cli=path.resolve(__dirname,'../cli/ink-studio.js');
  const report=JSON.parse(execFileSync(process.execPath,[cli,'trace',file,'world/causal-inspection','--ticks','3',
    '--select','{"bounds":{"axes":"xz","min":[1,-1],"max":[3,1]}}','--json'],{encoding:'utf8'}));
  assert.equal(report.value.conditions[0].sample.value.balance,9);
  assert.equal(report.value.nodes.find(row=>row.kind==='account-balance').data.previous,5);
});

test('styleable browser inspection selects scene targets and navigates recorded links',
  {skip:!process.env.INK_TEST_CHROME},t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ink-causal-mount-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'kit.js'),studio.bundle());
  const url=pathToFileURL(path.join(__dirname,'../webgl.mjs')).href, file=path.join(dir,'index.html');
  fs.writeFileSync(file,`<!doctype html><div id="host"><canvas id="scene"></canvas></div><pre id="result">pending</pre>
<script src="kit.js"></script><script type="module">
import {mountCausalInspection} from ${JSON.stringify(url)};
const output=document.querySelector('#result');
try{
 const run=KIT.world.runtime.create(${JSON.stringify(scene())});
 run.advance(3);
 const host=document.querySelector('#host');
 const ui=mountCausalInspection(host,{query:()=>run.query(),
   targets:[{id:'source',at:{entity:'pump'}},{id:'cistern',at:{entity:'cistern'}}],
   labels:{title:'Trace the water'},defaultStyles:false,stylesheet:'h2{color:rgb(12, 54, 62)}'});
 const root=host.shadowRoot, part=name=>root.querySelector('[part="'+name+'"]');
 const dropdown=part('selection');
 dropdown.value='cistern';dropdown.dispatchEvent(new Event('change'));
 const value=ui.report().conditions.find(row=>row.kind==='account').sample.value.balance;
 const parent=root.querySelector('li button');
 parent.click();
 const active=root.activeElement?.tagName;
 const types=[...root.querySelectorAll('li')].map(node=>node.dataset.type);
 const result={value,active,types,title:part('title').textContent,color:getComputedStyle(part('title')).color,
   preview:root.querySelector('slot').assignedElements()[0].id};
 ui.select({point:[-2,1,0],radius:.1});
 result.target=ui.report().target.kind;
 run.step();ui.refresh();result.tick=ui.report().tick;
 ui.destroy();result.destroyed=!root.childElementCount;
 output.textContent=encodeURIComponent(JSON.stringify(result));
}catch(error){output.textContent=encodeURIComponent(JSON.stringify({error:error.stack}));}
</script>`);
  const html=execFileSync(process.env.INK_TEST_CHROME,['--headless=new','--no-first-run','--allow-file-access-from-files',
    '--user-data-dir='+path.join(dir,'profile'),'--dump-dom',pathToFileURL(file).href],
  {encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000,stdio:['ignore','pipe','ignore']});
  const result=JSON.parse(decodeURIComponent(/<pre id="result">([^<]+)<\/pre>/.exec(html)[1]));
  assert.equal(result.error,undefined);
  assert.equal(result.value,9);
  assert.equal(result.active,'SUMMARY');
  assert(result.types.includes('state')&&result.types.includes('transfer')&&result.types.includes('command'));
  assert.equal(result.preview,'scene');
  assert.equal(result.title,'Trace the water');
  assert.equal(result.color,'rgb(12, 54, 62)');
  assert.equal(result.target,'region');
  assert.equal(result.tick,4);
  assert(result.destroyed);
});
