const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const steps = 3600, dt = 0.05, jobs = 120, incidentCount = 120;
const account = initial => ({resource:'stock',units:'crate',type:'integer',initial});
const transfer = (destination,amount) => ({from:'workshop/input',to:'workshop/'+destination,amount});
const quiet = {
  format:'ink-studio/world',version:1,id:'quiet-workshop',seed:19,dt,history:{limit:64},
  systems:{workshop:{kind:'store',config:{accounts:{input:account(jobs),output:account(0),diverted:account(0)}}}},
  commands:Array.from({length:jobs}, (_,i)=>({tick:(i+1)*30,action:'world/transfer',args:transfer('output',1)}))
};

function workload(divertStock) {
  const id = divertStock?'diverted':'bounded';
  const story = {format:'ink-studio/story',version:1,id,title:'Workshop incidents',stories:{}};
  const world = {...quiet,id:'workshop-'+id,storyDocuments:[{file:id+'.story.json'}],commands:[...quiet.commands]};
  for(let i=0;i<incidentCount;i++){
    const name = 'request-'+(i+1), tick = 5+i*24;
    const lifecycle = {progression:true,candidate:{for:40*dt,release:'manual'},deadlines:{world:{at:(tick+52)*dt}}};
    if(divertStock&&i===0)lifecycle.settlement={outcomes:{closed:{stock:{transfer:transfer('diverted',60)}}}};
    story.stories[name] = {
      kind:'incident',title:'Workshop request '+(i+1),incident:{category:'opportunity',intensity:1},
      triggers:{request:{event:{kind:name,system:'world'}}},lifecycle,entry:'review',
      stages:{review:{title:'Review request',decision:{mode:'autonomous'},next:{close:{outcome:'closed',auto:true}}}},
      outcomes:{closed:{title:'Request closed'}}
    };
    world.commands.push({tick,action:'world/event',args:{kind:name}});
    if(i%2===0)world.commands.push({
      tick:tick+1,action:'world/dispatch-candidate',args:{incident:id+'/'+name,reason:'workshop-review'}
    });
  }
  world.commands.sort((a,b)=>a.tick-b.tick);
  return {story,world};
}

function run(output,cli) {
  fs.mkdirSync(output,{recursive:true});
  const file = name => path.join(output,name);
  const save = (name,value) => fs.writeFileSync(file(name),JSON.stringify(value,null,2)+'\n');
  save('quiet.world.json',quiet);
  for(const [id,divertStock,exit] of [['bounded',false,0],['diverted',true,2]]){
    const {story,world} = workload(divertStock);
    save(id+'.story.json',story);
    save(id+'.world.json',world);
    const spec = {
      mode:'world',source:id+'.world.json',steps,
      stories:{sampleEvery:100,baseline:'quiet.world.json',systems:['workshop'],
        probes:{'completed-crates':{field:'world/account',args:{account:'workshop/output'},select:'/balance'}}},
      limits:{maxPendingStoryCandidates:2,maxPendingStoryRequests:0,maxRetainedStoryRecords:480,
        maxRetainedHistoryEvents:64,maxStoryDeadlineMisses:60,maxCandidateExpirations:60,
        maxUnrelatedCallLoss:0,maxUnrelatedChangedProbes:0}
    };
    const plan = file(id+'.plan.json'), report = file(id+'.report.json');
    save(id+'.plan.json',{format:'ink-studio/simulation-performance-plan',version:1,id,cases:{workshop:spec}});
    const result = spawnSync(process.execPath,[cli,'sim','budget',plan,'--out',report,'--require-budget'],{encoding:'utf8'});
    assert.equal(result.status,exit,result.stderr||result.stdout);
    const {stories,limits} = JSON.parse(fs.readFileSync(report,'utf8')).cases.workshop;
    const {ending} = stories.unrelated.probes['completed-crates'];
    assert.equal(ending.primary.value,divertStock?60:120);
    assert.equal(ending.baseline.value,120);
    assert.equal(stories.deadlines.stories.count,60);
    assert.equal(stories.deadlines.candidates.count,60);
    assert.deepEqual(Object.keys(limits).filter(key=>!limits[key].passed),divertStock?['maxUnrelatedChangedProbes']:[]);
    console.log(`${id}: ${steps} ticks, peak candidate queue ${stories.queues.candidates.peak}, ${ending.primary.value}/${ending.baseline.value} workshop crates, exit ${exit}`);
  }
}

if(require.main===module)run(path.resolve(process.argv[2]??'studio/out/story-budgets'),
  path.resolve(process.argv[3]??path.join(__dirname,'../../cli/ink-studio.js')));
