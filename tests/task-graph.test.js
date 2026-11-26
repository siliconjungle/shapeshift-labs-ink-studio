const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');

test('native tasks resume verified artifacts, rerun stale descendants, and block only dependents', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-task-graph-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const write = (file, data) => fs.writeFileSync(path.join(root,file), typeof data === 'string' ? data : JSON.stringify(data));
  write('scene.js', `module.exports = ({ makeBuilder }) => ({
    id: 'task-test', seed: 7, build(seed, { controls } = {}) {
      const B = makeBuilder(seed, [0x202830,0x98c2a0]);
      B.iso(0,0,0,controls?.radius ?? .3,B.P[1],2.7);
      return B.finish({cam:{target:[0,0,0],dist:4,yaw:.2,pitch:.1,sway:0}});
    }
  });`);
  const sweep = radius => ({ parameters:{radius:{values:[radius]}}, visual:{width:72,height:48,pixelSize:1} });
  write('sweep.json', sweep(.3));
  const graph = { format:'ink-studio/task-graph',version:1,tasks:{
    study:{ command:'sweep',inputs:{scene:'scene.js', plan:'sweep.json'},outputs:{review:'review'},
      args:[{input:'scene'},{input:'plan'},'--out',{output:'review'}] },
    pin:{ command:'sweep',inputs:{review:{task:'study',artifact:'review'}},outputs:{pin:'pin.json'},
      args:['pin',{input:'review'},'1','--out',{output:'pin'}] },
    render:{ command:'render',inputs:{scene:'scene.js'},outputs:{frame:'frame.png'},
      args:[{input:'scene'},'--w','72','--h','48','--out',{output:'frame'}] }
  } };
  write('plan.json',graph);
  const run = (mode='run', ...flags) => spawnSync(process.execPath,[cli,'tasks',mode,'plan.json',...flags],{
    cwd:root,encoding:'utf8'
  });
  function execute(exit, ...flags) {
    const result = run('run','--out','out',...flags);
    assert.equal(result.status,exit,result.stderr);
    return JSON.parse(fs.readFileSync(path.join(root,'out/report.json'))).tasks;
  }
  const planned = run('plan');
  assert.equal(planned.status,0,planned.stderr);
  assert.deepEqual(JSON.parse(planned.stdout), [
    {id:'study',dependencies:[]}, {id:'render',dependencies:[]}, {id:'pin',dependencies:['study']}
  ]);
  const first = execute(0);
  assert.deepEqual(first.map(row=>row.status),['completed','completed','completed']);
  assert.equal(run('run','--out','out').status,1);
  assert.deepEqual(execute(0,'--resume').map(row=>row.status),['reused','reused','reused']);
  fs.unlinkSync(path.join(root,'out/report.json'));
  fs.writeFileSync(path.join(root,'out/tasks/study',first[0].key,'receipt.json'),'null');
  fs.writeFileSync(first[1].outputs.frame,'damaged');
  assert.deepEqual(execute(0,'--resume').map(row=>row.status),['completed','completed','reused']);
  write('sweep.json',sweep(.42));
  assert.deepEqual(execute(0,'--resume').map(row=>row.status),['completed','reused','completed']);
  write('sweep.json','{}');
  assert.deepEqual(execute(2,'--resume').map(row=>row.status),['failed','reused','blocked']);

  graph.tasks.study.inputs.plan = {task:'pin',artifact:'pin'};
  write('plan.json',graph);
  assert.match(run('plan').stderr,/dependency cycle/);
});

test('native tasks hand off simulation recordings and portable scene geometry', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-task-pipeline-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const example = file => path.resolve(__dirname,'../examples',file);
  fs.copyFileSync(example('world-crossing.json'),path.join(root,'world.json'));
  fs.copyFileSync(example('scene.json'),path.join(root,'scene.json'));
  const graph = {format:'ink-studio/task-graph',version:1,tasks:{
    simulate:{command:'sim',inputs:{world:'world.json'},outputs:{record:'run.json',summary:'summary.json'},
      args:['run',{input:'world'},'--ticks','3','--record',{output:'record'},'--out',{output:'summary'}]},
    verify:{command:'sim',inputs:{record:{task:'simulate',artifact:'record'}},outputs:{report:'verification.json'},
      args:['verify',{input:'record'},'--out',{output:'report'}]},
    pack:{command:'project',inputs:{scene:'scene.json'},outputs:{project:'project.json'},
      args:['pack',{input:'scene'},'--out',{output:'project'}]},
    render:{command:'render',inputs:{project:{task:'pack',artifact:'project'}},outputs:{frame:'frame.png'},
      args:[{input:'project'},'--w','72','--h','48','--out',{output:'frame'}]}
  }};
  fs.writeFileSync(path.join(root,'plan.json'),JSON.stringify(graph));
  const result = spawnSync(process.execPath,[cli,'tasks','run','plan.json','--out','out'],{cwd:root,encoding:'utf8'});
  const report = JSON.parse(fs.readFileSync(path.join(root,'out/report.json')));
  assert.equal(result.status,0,JSON.stringify(report.tasks.filter(row=>row.status==='failed')));
  const byId = Object.fromEntries(report.tasks.map(row=>[row.id,row]));
  assert.deepEqual(byId.simulate.artifacts.record,byId.verify.inputs.record);
  assert.deepEqual(byId.pack.artifacts.project,byId.render.inputs.project);
  assert.equal(fs.readFileSync(byId.render.outputs.frame).subarray(1,4).toString(),'PNG');
});
