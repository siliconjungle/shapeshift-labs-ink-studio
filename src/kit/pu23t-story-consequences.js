/* Evidence-backed per-subject outcomes captured once when a story closes. */
(function(K) {
  const W = K.world, Q = W.query, {check,equal,own,record,read,selector,endpoint} = W.data;
  const {freeze} = K.procedural.data;
  const kind = 'story-consequences';
  const keys = (value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const evidenceLimit = 4096;
  const unresolved = (subject,reason)=>({subject,result:'unresolved',reason});
  function totals(subjects) {
    const counts = new Map();
    for (const {result} of Object.values(subjects)) counts.set(result,(counts.get(result)??0)+1);
    return Object.fromEntries([...counts.keys()].sort().map(result=>[result,counts.get(result)]));
  }
  const coverage = counts=>own(counts,'unresolved')?'partial':'complete';
  const bounded = value=>value!==undefined&&JSON.stringify(value)?.length<=evidenceLimit;
  const sampleOf = (value,path)=>path===undefined?value:read(value,path);

  function compiler(world,systems) {
    let registry, budget = 0;
    return function compile(outcomes,story) {
      const selected = Object.entries(outcomes).filter(([,outcome])=>outcome.consequences);
      if (!selected.length) return undefined;
      registry ??= Q.create({world,storyLifecycle:{}},systems);
      return Object.fromEntries(selected.map(([outcome,{consequences}])=>[outcome,Object.fromEntries(
        Object.entries(consequences).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,{subject,cases}])=>{
          check(cases.length+budget<=4096,'World story consequence budget exceeds 4096 cases');
          budget += cases.length;
          return [name,{subject,cases:cases.map(spec=>{
            if (!spec.state) return spec;
            const {state,evidence} = spec;
            check(registry.field(state.field),'Unknown consequence field '+state.field+' in '+story+'/'+outcome+'/'+name);
            return {...spec,...(state.select!==undefined&&{path:selector(state.select)}),
              ...(evidence!==undefined&&{proofPath:selector(evidence)})};
          })}];
        }))]));
    };
  }

  function observe(spec,query,readChild) {
    if (spec.child) {
      const {story,status,outcome} = spec.child, child = readChild(story);
      const result = child&&Array.isArray(child.transitions)&&child.transitions.length?W.storyChildren.result(child):null;
      if (!result) return {unavailable:true};
      if ((status!==undefined&&result.status!==status)||(outcome!==undefined&&result.outcome!==outcome)) return {};
      return {proof:{kind:'child',story,...result}};
    }
    const {field,at,args,when} = spec.state, sample = query.probe(field,at,args);
    if (sample.status!=='ok') return {unavailable:true};
    const value = sampleOf(sample.value,spec.path);
    if (value===undefined) return {unavailable:true};
    if (!Q.condition(when,value)) return {};
    const evidence = spec.proofPath&&sampleOf(sample.value,spec.proofPath);
    if (spec.proofPath&&evidence===undefined) return {unavailable:true};
    return {proof:{kind:'state',field,...(bounded(value)?{value}:{valueOmitted:true}),
      ...(spec.proofPath&&(bounded(evidence)?{evidence}:{evidenceOmitted:true}))}};
  }

  function capture(definition,story,outcome,terminal,tick,query,readChild) {
    const subjects = Object.fromEntries(Object.entries(definition).map(([name,{subject,cases}])=>{
      let missing = false;
      for (const spec of cases) {
        const receipt = observe(spec,query,readChild);
        if (receipt.proof) return [name,{subject,result:spec.result,...(spec.irreversible&&{irreversible:true}),proof:receipt.proof}];
        missing ||= Boolean(receipt.unavailable);
      }
      return [name,unresolved(subject,missing?'evidence-unavailable':'no-matching-evidence')];
    }));
    const counts = totals(subjects);
    return freeze({story,outcome,terminal,tick,coverage:coverage(counts),subjects,totals:counts});
  }

  function valid(report,definitions,story,end,readChild) {
    const definition = own(definitions,end.outcome)?definitions[end.outcome]:undefined;
    if (!definition) return report===undefined;
    if (!keys(report,['story','outcome','terminal','tick','coverage','subjects','totals'])||report.story!==story||
      report.outcome!==end.outcome||report.terminal!==end.to||report.tick!==end.tick||!record(report.subjects)||
      !equal(Object.keys(report.subjects).sort(),Object.keys(definition).sort())) return false;
    if (!Object.values(report.subjects).every(row=>record(row)&&typeof row.result==='string')) return false;
    const counts = totals(report.subjects);
    if (!equal(report.totals,counts)||report.coverage!==coverage(counts)) return false;
    return Object.entries(report.subjects).every(([name,row])=>{
      const {subject,cases} = definition[name];
      if (!keys(row,['subject','result','irreversible','reason','proof'])||!equal(row.subject,subject)) return false;
      if (row.result==='unresolved') return row.proof===undefined&&row.irreversible===undefined&&
        ['evidence-unavailable','no-matching-evidence'].includes(row.reason);
      const spec = cases.find(item=>item.result===row.result), proof = row.proof;
      if (!spec||row.reason!==undefined||row.irreversible!==(spec.irreversible?true:undefined)) return false;
      if (spec.child) {
        const observed = observe(spec,undefined,readChild).proof;
        return observed?.tick<=end.tick&&equal(proof,observed);
      }
      return keys(proof,['kind','field','value','valueOmitted','evidence','evidenceOmitted'])&&proof.kind==='state'&&
        proof.field===spec.state.field&&(own(proof,'value')?bounded(proof.value)&&proof.valueOmitted===undefined&&
          Q.condition(spec.state.when,proof.value):proof.valueOmitted===true)&&
        (spec.proofPath?own(proof,'evidence')?bounded(proof.evidence)&&proof.evidenceOmitted===undefined:proof.evidenceOmitted===true:
          proof.evidence===undefined&&proof.evidenceOmitted===undefined);
    });
  }

  function inspect(state,args) {
    check(keys(args,['story']),'Invalid story consequences query');
    const {story} = args;
    if (story!==undefined) {
      endpoint(story);
      const report = own(state,story)?state[story]?.consequences:undefined;
      return report?Q.ok(report):Q.missing('No recorded consequences for '+story,'missing');
    }
    return Q.ok(Object.fromEntries(Object.entries(state??{}).filter(([,row])=>row?.consequences)
      .map(([name,row])=>[name,row.consequences])));
  }

  W.storyConsequences = Object.freeze({kind,compiler,capture,valid,inspect});
})(KIT);
