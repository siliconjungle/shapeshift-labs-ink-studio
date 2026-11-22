/* Reusable history checks with the evidence behind a casting or commitment decision. */
(function(K) {
  const W = K.world, Q = W.query;
  const {check,id,own,record,read,selector,endpoint} = W.data, {freeze} = K.procedural.data;
  const field = 'world/story-callbacks', contextKeys = ['$actor','$with'];
  const keys = (value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const holderOK = value=>W.worldKnowledge.holderOK(value);
  const actorOK = actor=>keys(actor,['system','agent','generation'])&&id(actor.system)&&id(actor.agent)&&
    Number.isSafeInteger(actor.generation)&&actor.generation>0;
  const actorHolder = ({system,agent,generation})=>({kind:'actor',id:[system,agent,generation].join('/')});
  const unavailable = (callback,reason,detail)=>({callback,status:'unavailable',reason,...(detail!==undefined&&{detail})});

  function placeholder(value) {
    if (!record(value)) return undefined;
    return contextKeys.find(key=>own(value,key));
  }

  function checkArgs(value,required,depth=0) {
    check(depth<=16,'Story callback arguments are nested too deeply');
    const symbol = placeholder(value);
    if (symbol) {
      check(keys(value,[symbol])&&value[symbol]===true,'Invalid story callback placeholder '+symbol);
      required.add(symbol);
    } else if (Array.isArray(value)) {
      for (const item of value) checkArgs(item,required,depth+1);
    } else if (record(value)) {
      for (const item of Object.values(value)) checkArgs(item,required,depth+1);
    }
  }

  function bind(value,context) {
    const symbol = placeholder(value);
    if (symbol) return context[symbol];
    if (Array.isArray(value)) return value.map(item=>bind(item,context));
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bind(item,context)]));
    return value;
  }

  function compile(world,systems) {
    const raw = world.storyCallbacks;
    if (raw===undefined) return null;
    check(record(raw)&&Object.keys(raw).length>0&&Object.keys(raw).length<=128,'Expected 1–128 named story callbacks');
    const registry = Q.create({world,storyLifecycle:{}},systems);
    const rules = Object.fromEntries(Object.keys(raw).sort().map(name=>{
      const spec = raw[name];
      check(id(name)&&keys(spec,['field','args','select','when','evidence'])&&record(spec.when)&&
        (spec.args===undefined||record(spec.args))&&JSON.stringify(spec).length<=8192,'Invalid story callback '+name);
      endpoint(spec.field);
      check(![field,'world/story-candidates'].includes(spec.field)&&registry.field(spec.field),
        'Unavailable source field for story callback '+name);
      Q.condition(spec.when,undefined);
      const required = new Set();
      if (spec.args!==undefined) checkArgs(spec.args,required);
      return [name,{spec,required:[...required],...(spec.select!==undefined&&{select:selector(spec.select)}),
        ...(spec.evidence!==undefined&&{evidence:selector(spec.evidence)})}];
    }));
    return freeze({definitions:raw,rules});
  }

  function checkUse(use,plan,at) {
    check(keys(use,['id','with','on'])&&id(use.id)&&(use.with===undefined||holderOK(use.with))&&
      (use.on===undefined||['matched','missed'].includes(use.on)),
      'Invalid story callback reference in '+at);
    if (plan!==undefined) {
      const rule = own(plan?.rules,use.id)?plan.rules[use.id]:undefined;
      check(rule,'Unknown story callback '+use.id+' in '+at);
      check(!rule.required.includes('$with')||use.with!==undefined,'Story callback '+use.id+' needs a counterpart in '+at);
    }
  }

  function evaluate(rule,query,{callback,actor,with:counterpart}) {
    const {spec,required,select,evidence} = rule;
    const context = {$actor:actor&&actorHolder(actor),$with:counterpart};
    const missing = required.find(symbol=>context[symbol]===undefined);
    if (missing) return unavailable(callback,missing==='$actor'?'actor-required':'counterpart-required');
    const args = required.length?bind(spec.args,context):spec.args;
    const sample = query.probe(spec.field,undefined,args);
    if (sample.status!=='ok') return unavailable(callback,'source-unavailable',sample.reason??sample.status);
    const value = select?read(sample.value,select):sample.value;
    if (value===undefined) return unavailable(callback,'value-unavailable');
    const proof = evidence?read(sample.value,evidence):undefined, matched = Q.condition(spec.when,value);
    const bounded = (key,sample)=>{
      const text = JSON.stringify(sample);
      return text!==undefined&&text.length<=4096?{[key]:sample}:{[key+'Omitted']:true};
    };
    return {callback,status:matched?'matched':'missed',field:spec.field,
      ...bounded('value',value),...(proof!==undefined&&bounded('evidence',proof))};
  }

  function inspect(plan,args,query) {
    check(keys(args,['callback','actor','with'])&&(args.callback===undefined||id(args.callback))&&
      (args.actor===undefined||actorOK(args.actor))&&(args.with===undefined||holderOK(args.with)),
      'Invalid story callback query');
    if (args.callback===undefined) return Q.ok(plan.definitions);
    if (!own(plan.rules,args.callback)) return Q.missing('Unknown story callback','missing');
    return Q.ok(evaluate(plan.rules[args.callback],query,args));
  }

  function run(query,use,actor) {
    const sample = query.probe(field,undefined,{callback:use.id,actor,...(use.with!==undefined&&{with:use.with})});
    return sample.status==='ok'?sample.value:unavailable(use.id,'callback-unavailable',sample.reason??sample.status);
  }

  W.storyCallbacks = Object.freeze({field,compile,checkUse,inspect,run});
})(KIT);
