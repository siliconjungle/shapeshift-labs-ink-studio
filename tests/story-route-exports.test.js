const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const cli = path.resolve(__dirname,'../cli/ink-studio.js');
const example = name=>path.resolve(__dirname,'../examples/story-documents/'+name+'.json');
const fixed = example('breakwater-survey'), draft = example('breakwater-draft');
const preview = (...args)=>spawnSync(process.execPath,[cli,'story','preview',...args],{encoding:'utf8'});
const read = file=>JSON.parse(fs.readFileSync(file,'utf8'));
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'ink-story-routes-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  return dir;
}

test('text exports selected stages, child and objective gates, endings and shortest witnesses', () => {
  const result = preview(fixed,'pick-channel','--format','text','--strict');
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Entry listen/);
  assert.match(result.stdout,/Opens soundings\n *Wait for all to finish \(soundings\)/);
  assert.match(result.stdout,/shallow-channel → ending hold \[possible\][\s\S]*Child soundings → failed, ending shallow/);
  assert.match(result.stdout,/launch → ending dispatched \[possible\]\n *Complete signal/);
  assert.match(result.stdout,/listen\/shallow-channel → hold \(1 step\)/);
  assert.match(result.stdout,/listen\/clear-channel → dispatch\/launch → dispatched \(2 steps\)/);
  assert.doesNotMatch(result.stdout,/soundings \[questlet\]/);
  const intervention = preview(example('breakwater-watch'),'--format','text');
  assert.equal(intervention.status,0,intervention.stderr);
  assert.match(intervention.stdout,/Decision mode intervene for 0\.3 s/);
  assert.match(intervention.stdout,/Automatic fallback/);
  assert.match(intervention.stdout,/Choose route = ridge/);
  const risk = preview(example('highwater-beacon'),'--format','text');
  assert.equal(risk.status,0,risk.stderr);
  assert.match(risk.stdout,/Fail [a-z]/);
});

test('DOT export keeps broken edges and static blockers visible, and uses distinct node IDs per story', t => {
  const directory = temp(t), out = path.join(directory,'routes.dot');
  const result = preview(draft,'--format','dot','--out',out);
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.stdout,'');
  const dot = fs.readFileSync(out,'utf8');
  assert.match(dot,/^digraph story_routes \{/);
  assert.match(dot,/"broken-links\/stage\/survey" -> "broken-links\/invalid\/survey\/unclear-target"/);
  assert.match(dot,/Unknown ending unknown-ending/);
  assert.match(dot,/"wait-before-open\/stage\/wait" -> "wait-before-open\/stage\/call" \[label="continue\\nblocked", style=dashed/);
  assert.match(dot,/unopened-child-wait/);
  assert.match(dot,/loop-without-exit/);
  assert.match(dot,/ambiguous-auto-transition/);
  assert.match(dot,/"soundings\/ending\/shallow" \[shape=doubleoctagon, label="shallow — Channel shallow\\nfailed"/);
  assert.equal(preview(draft,'--format','dot').stdout,dot);
  const warning = read(fixed);
  warning.stories['pick-channel'].stages.unused = {title:'Unused',next:{leave:{outcome:'hold'}}};
  const warningFile = path.join(directory,'warning.json');
  fs.writeFileSync(warningFile,JSON.stringify(warning));
  assert.equal(preview(warningFile,'--format','dot').status,0);
  assert.equal(preview(warningFile,'--format','dot','--strict').status,1);
});

test('exports preserve the default JSON report and escape authored labels alongside the source', t => {
  const directory = temp(t), file = path.join(directory,'source.story.json'), dotFile = path.join(directory,'source.routes.dot');
  const document = read(fixed);
  document.stories['pick-channel'].stages.listen.title = 'Read "A" \\N\nThen ring';
  const authored = JSON.stringify(document);
  fs.writeFileSync(file,authored);
  const result = preview(file,'--format','dot','--out',dotFile);
  assert.equal(result.status,0,result.stderr);
  assert(fs.readFileSync(dotFile,'utf8').includes('Read \\"A\\" \\\\N Then ring'));
  assert.equal(preview(file).stdout,preview(file,'--format','json').stdout);
  assert.equal(JSON.parse(preview(file).stdout).inventory.definitions.length,2);
  assert.equal(preview(file,'--format','csv').status,1);
  assert.equal(preview(file,'missing','--format','text').status,1);
  assert.match(preview(file,'--out',file).stderr,/Choose an output different/);
  const alias = path.join(directory,'alias');
  fs.symlinkSync(file,alias);
  assert.match(preview(file,'--out',alias).stderr,/Choose an output different/);
  assert.equal(fs.readFileSync(file,'utf8'),authored);
});
