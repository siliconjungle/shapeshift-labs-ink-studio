/* Declarative replay recipes and the local files their native runners read. */
const format='ink-studio/simulation-experiment';
const reportFormat='ink-studio/simulation-experiment-report';
const savedFile=Symbol('saved measurement input');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}$/.test(value)&&
  !['__proto__','prototype','constructor'].includes(value);
const ref=value=>typeof value==='string'&&value.trim().length>0;
const revision=value=>Number.isSafeInteger(value)&&value>=1;
const nonnegative=value=>Number.isFinite(value)&&value>=0;

const entries=Object.freeze({model:'ink-studio/simulation-model',native:'native',
  'solver-network':'ink-studio/solver-network-run',measure:'ink-studio/simulation-measurement-run',fit:'ink-studio/parameter-fit-run',modes:'ink-studio/resonant-mode-plan'});
const types=Object.freeze({
  'ink-studio/wave-run':document=>paths(document.network,document.settings?.conditions,document.checkpoint),
  'ink-studio/resonant-mode-run':document=>paths(document.asset,document.checkpoint),
  'ink-studio/contact-excitation-run':document=>paths(document.excitation,document.checkpoint),
  'ink-studio/controller-run':document=>paths(document.controller,document.checkpoint),
  'ink-studio/lumped-network-run':document=>paths(document.network,document.checkpoint),
  'ink-studio/solve-plan':document=>{
    if(document.equation?.module!==undefined)throw new TypeError('Portable experiment replay needs a declarative equation');
    return [];
  },
  'ink-studio/grid-operators-plan':document=>paths(document.domain,document.conditions),
  'ink-studio/state-remap-plan':document=>paths(document.source,document.target),
  'ink-studio/sensor-run':document=>paths(document.rig,document.checkpoint,document.source?.run,document.source?.trace,
    document.source?.world,document.source?.checkpoint,document.source?.actions),
  'ink-studio/resonant-mode-plan':document=>paths(document.source?.file,document.source?.domain),
  'ink-studio/discretization-plan':document=>paths(document.source?.file)
});
const nativeFormats=new Set(Object.keys(types).filter(key=>!['ink-studio/resonant-mode-plan','ink-studio/discretization-plan'].includes(key)));
const assetRoles=['models','geometry','inputs','references','checkpoints','solvers','notes'];

function paths(...values){return values.filter(value=>typeof value==='string'||record(value));}

function validate(document){
  if(!fields(document,['format','version','id','revision','assets','runs'])||document.format!==format||document.version!==1||
     !id(document.id)||!revision(document.revision??1)||!record(document.runs)||
     Object.keys(document.runs).length<1||Object.keys(document.runs).length>32||
     !fields(document.assets??{},assetRoles))
    throw new TypeError('Expected a version 1 simulation experiment with named replay runs');
  for(const [role,group] of Object.entries(document.assets??{}))
    if(!record(group)||Object.keys(group).length>256||!Object.entries(group).every(([key,filename])=>id(key)&&ref(filename)))
      throw new TypeError('Invalid experiment asset table '+role);
  for(const [name,row] of Object.entries(document.runs)){
    if(!id(name)||!fields(row,['kind','source','expected','select','tolerance','checkpoint','tick','commands'])||
      !Object.hasOwn(entries,row.kind)||!ref(row.source)||!ref(row.expected)||
      row.select!==undefined&&(typeof row.select!=='string'||!row.select.startsWith('/')||/~(?![01])/u.test(row.select))||
      !fields(row.tolerance??{},['absolute','relative'])||!Object.values(row.tolerance??{}).every(nonnegative)||
      (row.kind==='model'?!(Number.isSafeInteger(row.tick)&&row.tick>=0&&row.tick<=10000000&&
        (row.checkpoint===undefined||ref(row.checkpoint))&&(row.commands===undefined||ref(row.commands))):
        row.tick!==undefined||row.checkpoint!==undefined||row.commands!==undefined))
      throw new TypeError('Invalid experiment replay run '+name);
  }
  return document;
}

function inputSources(table){
  return Object.values(table??{}).flatMap(row=>row?.mode==='saved'?(typeof row.file==='string'?[{[savedFile]:row.file}]:[]):
    paths(row?.file,row?.value));
}

function dependencies(document){
  const key=document?.format;
  if(key==='ink-studio/integration-plan')
    throw new TypeError('Portable experiment replay uses declarative native solvers and cannot load integration modules');
  if(Object.hasOwn(types,key))return types[key](document);
  if(key===entries['solver-network'])return paths(document.network,...Object.values(document.branches??{}).flatMap(row=>
    [typeof row?.commands==='string'?row.commands:undefined,row?.from?.checkpoint]));
  if(key==='ink-studio/solver-stage')return document.kind==='simulation-model'?[{systems:{stage:document}}]:[];
  if(key==='ink-studio/solver-network'){
    const definitions=Object.values(document.library??{}), operators=[
      ...definitions.filter(row=>row?.kind==='simulation-model'),
      ...Object.values(document.stages??{}).filter(row=>row?.config?.model!==undefined).map(row=>({kind:'simulation-model',config:row.config}))
    ];
    return [...paths(...definitions.map(row=>row?.file)),
      {...document.world,systems:Object.fromEntries(operators.map((operator,i)=>['stage'+i,operator]))}];
  }
  if(key===entries.measure)return [...paths(document.plan),...inputSources(document.sources)];
  if(key===entries.fit)return [...paths(document.plan,...Object.values(document.candidate??{})),...inputSources(document.reference)];
  return [];
}

module.exports={format,reportFormat,savedFile,entries,nativeFormats,validate,dependencies};
