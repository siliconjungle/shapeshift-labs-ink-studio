/* Typed local bindings and structured calls in function graphs. */
(function (K) {
  const P=K.procedural, {literal}=GraphControlReferences, own=Object.hasOwn;
  const format='ink-studio/function-locals', maxDepth=16, maxBindings=32, maxSteps=1024, maxWork=100000;
  const valueType=type=>P.graphFunctions.validType(type);
  const validator=type=>P.graphTypes.validator(type);
  const record=value=>validator('record')(value);
  const id=name=>typeof name==='string' && /^[a-z][\w.-]{0,63}$/i.test(name) &&
    !['__proto__','constructor','prototype'].includes(name);
  const valid=(type,value)=>valueType(type) && validator(type)(value);
  const freezeValue=value=>Array.isArray(value)?Object.freeze(value.slice()):value;
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const isLocal=new WeakSet();

  function validScope(scope) {
    let depth=0;
    for (let frame=scope;frame!==null;frame=frame.parent) {
      if (++depth>maxDepth||!fields(frame,['format','version','bindings','parent'])||
          frame.format!==format||frame.version!==1||!own(frame,'parent')||!record(frame.bindings)) return false;
      if (isLocal.has(frame)) return depth-1+depthOf(frame)<=maxDepth;
      const rows=Object.entries(frame.bindings);
      if (rows.length>maxBindings||rows.some(([name,binding])=>!id(name)||!fields(binding,['type','value'])||
          !valid(binding.type,binding.value))) return false;
    }
    return depth>0;
  }

  function depthOf(scope) {
    let depth=0;
    for(let frame=scope;frame!==null;frame=frame.parent) depth++;
    return depth;
  }

  function frame(bindings,parent) {
    const result=Object.freeze({format,version:1,bindings:Object.freeze(bindings),parent});
    isLocal.add(result);
    return result;
  }

  function adopt(scope) {
    if(scope===null||isLocal.has(scope))return scope;
    return frame(Object.fromEntries(Object.entries(scope.bindings).map(([name,{type,value}])=>
      [name,Object.freeze({type,value:freezeValue(value)})])),adopt(scope.parent));
  }

  function lookup(scope,name,type) {
    for(let current=scope;current!==null;current=current.parent) {
      if(!own(current.bindings,name))continue;
      const row=current.bindings[name];
      if(row.type!==type)throw new TypeError('Function variable '+name+' is '+row.type+', expected '+type);
      return row;
    }
    throw new RangeError('Unknown function variable '+name);
  }

  function replace(scope,name,type,value) {
    if(own(scope.bindings,name))
      return frame({...scope.bindings,[name]:Object.freeze({type,value:freezeValue(value)})},scope.parent);
    return frame(scope.bindings,replace(scope.parent,name,type,value));
  }

  const scope={
    description:'Open a typed local variable scope with an optional parent scope.',
    specialize(node) {
      const definitions=literal(node,'variables',{}), inherited=own(node.inputs??{},'parent')||own(node.params??{},'parent');
      if(!record(definitions)||Object.keys(definitions).length>maxBindings||
          Object.entries(definitions).some(([name,type])=>!id(name)||['variables','parent'].includes(name)||!valueType(type)))
        throw new TypeError('Function scope needs up to '+maxBindings+' named value types');
      return {inputs:{variables:{type:'record',default:{}},...definitions,...(inherited&&{parent:'functionLocals'})},
        outputs:{value:'functionLocals'},run({parent=null,...values}) {
          if(depthOf(parent)>=maxDepth)throw new RangeError('Function local scopes exceed their nesting limit');
          return {value:frame(Object.fromEntries(Object.entries(definitions).map(([name,type])=>
            [name,Object.freeze({type,value:freezeValue(values[name])})])),adopt(parent))};
        }};
    }
  };

  function variable(write) {
    return {
      description:write?'Set a typed variable and return the next scope value.':'Read a typed variable from a local scope.',
      specialize(node) {
        const name=literal(node,'name'), type=node.type;
        if(!id(name)||!valueType(type))throw new TypeError('Function variable needs a literal name and declared value type');
        const inputs={scope:'functionLocals',name:'string',...(write&&{value:type})};
        return {inputs,outputs:{value:write?'functionLocals':type},run({scope,value}) {
          const row=lookup(scope,name,type);
          return {value:write?replace(adopt(scope),name,type,value):freezeValue(row.value)};
        }};
      }
    };
  }

  const defaultPosition=Object.freeze([0,0]), defaultSize=Object.freeze([1,1]), empty=Object.freeze({});
  const environmentTypes={position:'vec2',size:'vec2',time:'number',seed:'integer'};
  function execution(time,seed,size=defaultSize) {
    return {system:Object.freeze({position:defaultPosition,size:freezeValue(size),time,seed,context:empty}),
      work:{remaining:maxWork}};
  }

  const equal=(a,b)=>Object.is(a,b)||Array.isArray(a)&&Array.isArray(b)&&
    a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  function sameSystem(a,b) {
    return a===b||Boolean(a&&b&&a.time===b.time&&a.seed===b.seed&&equal(a.position,b.position)&&equal(a.size,b.size)&&
      Object.keys(a.context).length===Object.keys(b.context).length&&
      Object.keys(a.context).every(key=>own(b.context,key)&&equal(a.context[key],b.context[key])));
  }

  function withSystem(flow,position,size,context) {
    if(!size.every(n=>Number.isSafeInteger(n)&&n>0))throw new RangeError('Function system size needs positive integer pixels');
    const combined={...flow.system.context,...context};
    if(Object.keys(combined).length>64||Object.entries(combined).some(([key,value])=>
      !id(key)||!P.graphFunctions.types.some(type=>valid(type,value))))
      throw new TypeError('Function context needs up to 64 named typed values');
    return {...flow,system:Object.freeze({...flow.system,position:freezeValue(position),size:freezeValue(size),
      context:Object.freeze(Object.fromEntries(Object.entries(combined).map(([key,value])=>[key,freezeValue(value)])))})};
  }

  const system={
    description:'Read the active position, size, time, seed, or typed context value.',
    specialize(node) {
      const name=literal(node,'name'), custom=name==='context';
      const type=custom?node.type:environmentTypes[name];
      if(!valueType(type)||!custom&&!own(environmentTypes,name)||!custom&&node.type!==undefined&&node.type!==type)
        throw new TypeError('Function system read needs a literal variable name and a type for context');
      return {inputs:{name:'string',...(custom&&{key:'string'})},outputs:{value:type},system:true,
        run({key},context) {
          const {system}=context.functionExecution;
          const table=custom?system.context:system, slot=custom?key:name;
          if(!own(table,slot)||!valid(type,table[slot]))throw new TypeError('Function context '+slot+' needs a '+type+' value');
          return {value:table[slot]};
        }};
    }
  };

  function requiredFunction(groups,name,label) {
    const group=typeof name==='string'&&own(groups,name)&&groups[name];
    if(typeof group?.instantiate!=='function'||!P.graphFunctions.validResultType(group.functionResult))
      throw new TypeError(label+' needs a declared function for '+String(name));
    return group;
  }

  function reserved(inputs, names, label) {
    if(names.some(name=>own(inputs,name)))throw new TypeError(label+' function inputs conflict with control sockets');
  }

  const contractValue=value=>JSON.stringify(value,(_,entry)=>record(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a<b?-1:a>b?1:0)) : entry);
  function sameInputs(a,b) {
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length&&keys.every(key=>{
      if(!own(b,key))return false;
      const left=a[key],right=b[key];
      return left.type===right.type&&contractValue(left.quantity)===contractValue(right.quantity)&&
        contractValue(left.default)===contractValue(right.default);
    });
  }

  function carrier(group,label) {
    if(group.inputs.state?.type!==group.functionResult)
      throw new TypeError(label+' needs a state input matching the function result');
    const {state,...extra}=group.inputs;
    return {type:state.type,extra};
  }

  function dispatch(group,run,inputs,context,workers,flow=context.functionExecution) {
    flow.work.remaining-=Math.max(1,group.expandedNodes??1);
    if(flow.work.remaining<0)throw new RangeError('Function control exceeds the evaluation work budget');
    return run(inputs,{...context,textureCache:context.textureCache,functionExecution:flow},workers).result;
  }

  const branch={
    description:'Run only the chosen declared function and return its result.',
    specialize(node,groups) {
      const yes=requiredFunction(groups,literal(node,'whenTrue'),'fn.branch');
      const no=requiredFunction(groups,literal(node,'whenFalse'),'fn.branch');
      if(yes.functionResult!==no.functionResult||!sameInputs(yes.inputs,no.inputs))
        throw new TypeError('Function branches need the same input and result contracts');
      reserved(yes.inputs,['whenTrue','whenFalse','condition'],'fn.branch');
      return {inputs:{whenTrue:'string',whenFalse:'string',condition:'boolean',...yes.inputs},
        outputs:{value:yes.functionResult,taken:'boolean'},system:yes.system||no.system,workerGroup:true,instantiate(){
          const runs=new Map();
          let latest;
          function run({condition,whenTrue,whenFalse,...args},context,workers) {
            const selected=condition?yes:no;
            if(!runs.has(selected))runs.set(selected,selected.instantiate());
            latest=runs.get(selected);
            return {value:dispatch(selected,latest,args,context,workers),taken:condition};
          }
          run.inspect=()=>latest?.inspect?.();
          run.clear=()=>{runs.clear();latest=undefined;};
          return run;
        }};
    }
  };

  const sequence={
    description:'Run declared functions in order, passing the result of each as the next state.',
    specialize(node,groups) {
      const steps=literal(node,'steps');
      if(!Array.isArray(steps)||!steps.length||steps.length>64)
        throw new RangeError('Function sequence needs one to 64 literal function names');
      const stages=Array.from(steps,name=>requiredFunction(groups,name,'fn.sequence'));
      const {type,extra}=carrier(stages[0],'fn.sequence');
      if(stages.some(stage=>stage.functionResult!==type||!sameInputs(stage.inputs,stages[0].inputs)))
        throw new TypeError('Function sequence stages need the same state and input contracts');
      reserved(extra,['steps','initial'],'fn.sequence');
      return {inputs:{steps:'array<string>',initial:type,...extra},outputs:{value:type},
        system:stages.some(stage=>stage.system),workerGroup:true,instantiate(){
          const calls=stages.map(stage=>stage.instantiate());
          function run({steps,initial,...args},context,workers) {
            let state=initial;
            for(let i=0;i<calls.length;i++)state=dispatch(stages[i],calls[i],{...args,state},context,workers);
            return {value:state};
          }
          run.inspect=()=>calls.at(-1).inspect?.();
          run.clear=()=>calls.forEach(call=>call.clear?.());
          return run;
        }};
    }
  };

  const loop={
    description:'Repeat a declared state function within a literal bound, with an optional continuation test.',
    specialize(node,groups) {
      const body=requiredFunction(groups,node.group,'fn.loop'), {type,extra}=carrier(body,'fn.loop');
      const limit=literal(node,'limit',64), predicateName=literal(node,'while','');
      if(!Number.isSafeInteger(limit)||limit<1||limit>maxSteps)
        throw new RangeError('Function loop limit must be a literal integer from 1 to '+maxSteps);
      const test=predicateName===''?null:requiredFunction(groups,predicateName,'fn.loop while');
      if(test&&(test.functionResult!=='boolean'||!sameInputs(body.inputs,test.inputs)))
        throw new TypeError('Function loop continuation needs the body inputs and a Boolean result');
      const {index,...args}=extra;
      if(index&&index.type!=='integer')throw new TypeError('Function loop index must be an integer');
      reserved(args,['initial','count','limit','while'],'fn.loop');
      return {inputs:{initial:type,count:'integer',limit:{type:'integer',default:64},while:{type:'string',default:''},...args},
        outputs:{value:type,iterations:'integer'},system:body.system||test?.system,workerGroup:true,instantiate(){
          const next=body.instantiate(), take=test?.instantiate();
          let visited=false;
          function run({initial,count,limit:unused,while:continuation,...args},context,workers) {
            if(count<0||count>limit)throw new RangeError('Function loop count exceeds its authored bound');
            let state=initial, iterations=0;
            visited=false;
            while(iterations<count) {
              const parameters={...args,state,...(index&&{index:iterations})};
              if(test&&!dispatch(test,take,parameters,context,workers))break;
              state=dispatch(body,next,parameters,context,workers);
              visited=true;
              iterations++;
            }
            return {value:state,iterations};
          }
          run.inspect=()=>visited?next.inspect?.():undefined;
          run.clear=()=>{next.clear?.();take?.clear?.();visited=false;};
          return run;
        }};
    }
  };

  const scopedSystem={
    description:'Call a function with an explicit position, size and additional context values.',
    specialize(node,groups) {
      const body=requiredFunction(groups,node.group,'fn.withSystem');
      reserved(body.inputs,['position','size','context'],'fn.withSystem');
      return {inputs:{position:'vec2',size:'vec2',context:{type:'record',default:{}},...body.inputs},
        outputs:{value:body.functionResult},system:body.system,workerGroup:true,instantiate(){
          const next=body.instantiate();
          function run({position,size,context:patch,...args},context,workers) {
            const flow=withSystem(context.functionExecution,position,size,patch);
            return {value:dispatch(body,next,args,context,workers,flow)};
          }
          run.inspect=()=>next.inspect?.();
          run.clear=()=>next.clear?.();
          return run;
        }};
    }
  };

  const operations=Object.freeze({'fn.scope':scope,'fn.get':variable(false),'fn.set':variable(true),'fn.system':system,
    'fn.branch':branch,'fn.sequence':sequence,'fn.loop':loop,'fn.withSystem':scopedSystem});
  P.graphControl=Object.freeze({validScope,execution,sameSystem,operations,
    groupOperators:Object.freeze(['fn.loop','fn.withSystem']),
    typedOperators:Object.freeze(['fn.get','fn.set','fn.system'])});
})(KIT);
