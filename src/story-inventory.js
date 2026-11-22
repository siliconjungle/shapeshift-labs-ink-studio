/* Static inventory of story declarations, bindings, and runtime interfaces. */
const StoryInventory = (() => {
  const compare = (a,b)=>a<b?-1:a>b?1:0;
  const entries = table=>Object.entries(table??{}).sort(([a],[b])=>compare(a,b));
  const qualified = (document,name)=>typeof name==='string'&&(name.includes('/')?name:document+'/'+name);
  const concrete = value=>typeof value==='string'&&value.length>0;

  const list = value=>Array.isArray(value)?value:[];

  function collect(documents,{schema,resolved=documents,bindings,story:selected,declaredOnly=false,eventActions,callbacks,templates}={}) {
    const rows = {capabilities:new Map(),assets:new Map(),dependencies:new Map()};
    const definitions = [], sourceDocuments = [];
    function add(table,identity,use) {
      const key = JSON.stringify(identity), group = rows[table];
      if (!group.has(key)) group.set(key,{...identity,usedBy:[]});
      group.get(key).usedBy.push(use);
    }
    function scoped(document,story) {
      const use = (path,source='inferred')=>({...(document&&{document}),...(story&&{story}),path,source});
      const capability = (kind,id,path)=>{if (concrete(id)) add('capabilities',{kind,id},use(path));};
      const dependency = (kind,id,path,extra={})=>{if (concrete(id)) add('dependencies',{kind,id,...extra},use(path));};
      function declared(required,path) {
        for (const [i,{kind,id}] of (required?.capabilities??[]).entries())
          add('capabilities',{kind,id},use(path+'.capabilities['+i+']','declared'));
        for (const [i,{pack,revision,kind,id}] of (required?.assets??[]).entries())
          add('assets',{pack,...(revision!==undefined&&{revision}),...(kind&&{kind,id})},use(path+'.assets['+i+']','declared'));
        for (const [i,id] of (required?.documents??[]).entries())
          add('dependencies',{kind:'document',id},use(path+'.documents['+i+']','declared'));
      }
      return {capability,dependency,declared};
    }
    if (!declaredOnly) {
      const scope = scoped();
      for (const [id,rule] of entries(eventActions)) {
        const path = 'world.eventActions.'+id;
        scope.dependency('event',rule.on?.kind,path+'.on',rule.on?.system?{system:rule.on.system}:{});
        if (rule.on?.system!=='world') scope.capability('system',rule.on?.system,path+'.on.system');
        for (const [i,action] of list(rule.actions).entries())
          scope.capability('action',action.action,path+'.actions['+i+']');
      }
      for (const [id,rule] of entries(callbacks))
        scope.capability('query',rule.field,'world.storyCallbacks.'+id+'.field');
      for (const [id,instance] of entries(templates))
        scope.dependency('template',instance.template.id,'world.storyTemplates.'+id,
          {instance:id,revision:instance.template.revision});
    }
    const byDocument = new Map(resolved.map(document=>[document.id,document]));
    for (const document of documents.slice().sort((a,b)=>compare(a.id,b.id))) {
      const {id,version,title,references = {}} = document, base = scoped(id);
      base.declared(document.requirements,'story.requirements');
      if (!declaredOnly) {
        sourceDocuments.push({id,version,...(title&&{title}),references});
        for (const [name,reference] of entries(references))
          base.dependency('reference',reference.id,'story.references.'+name,{referenceKind:reference.kind});
      }
      for (const [name,authored] of entries(document.stories)) {
        if (selected!==undefined&&name!==selected) continue;
        const key = id+'/'+name, path = 'story.stories.'+name, scope = scoped(id,key);
        scope.declared(authored.requirements,path+'.requirements');
        if (declaredOnly) continue;
        const story = byDocument.get(id)?.stories[name]??authored;
        const {kind,title,entry} = story, roleUses = new Map();
        schema.mapRoleValues(authored,path,(token,location)=>{
          const sites = roleUses.get(token.$role)??[];
          sites.push(location);
          roleUses.set(token.$role,sites);
          return token;
        });
        const roles = Object.fromEntries(entries(authored.roles).map(([role,{kind,ref,required}])=>{
          const uses = (roleUses.get(role)??[]).sort(), binding = bindings?.[key]?.[role];
          return [role,{kind,required:required===true||uses.length>0,usedAt:uses,
            ...(ref!==undefined&&{reference:ref}),...(binding&&{binding:binding.source})}];
        }));
        definitions.push({id:key,kind,title,entry,stages:entries(story.stages).map(([id])=>id),
          outcomes:entries(story.outcomes).map(([id,row])=>({id,status:row.status??'completed'})),roles});
        collectStory(story,document,scope,path,schema,story===authored?[...roleUses.values()].flat():[]);
      }
    }
    return {documents:sourceDocuments,definitions,...Object.fromEntries(Object.entries(rows).map(([key,group])=>
      [key,[...group.entries()].sort(([a],[b])=>compare(a,b)).map(([,value])=>value)]))};
  }

  function collectStory(story,document,{capability:cap,dependency:dep},path,schema,unbound) {
    const child = (name,where)=>dep('story',qualified(document.id,name),where);
    const query = (field,where)=>cap('query',field,where);
    const event = (row,where)=>{
      if (!row) return;
      dep('event',row.kind,where,concrete(row.system)?{system:row.system}:{});
      if (row.system&&row.system!=='world') cap('system',row.system,where+'.system');
    };
    const evidence = (row,where)=>{
      event(row?.event,where+'.event');
      if (row?.state) {
        query(row.state.field,where+'.state.field');
        if (row.state.field==='world/account') cap('account',row.state.args?.account,where+'.state.args.account');
      }
    };
    const transfer = (spec,where)=>{
      cap('account',spec.from,where+'.from');
      cap('account',spec.to,where+'.to');
    };
    const commitment = (spec,where)=>{
      if (!spec) return;
      const system = spec.actor?.system;
      if (concrete(system)) {
        cap('action',system+'/issue-order',where+'.order');
        query(system+'/commitment-terms',where+'.actor');
      }
      const board = spec.order?.reservation?.board;
      if (concrete(board)) query(board+'/claim',where+'.order.reservation');
      for (const [name,term] of entries(spec.consider))
        dep('callback',term.callback?.id,where+'.consider.'+name+'.callback');
    };
    for (const [name,trigger] of entries(story.triggers)) evidence(trigger,path+'.triggers.'+name);
    for (const [stage,spec] of entries(story.stages)) {
      const where = path+'.stages.'+stage;
      child(spec.story,where+'.story');
      for (const [name,objective] of entries(spec.objectives)) {
        const place = where+'.objectives.'+name;
        if (objective.type==='deliver'&&objective.params) transfer(objective.params,place+'.params');
        if (!unbound.some(token=>token===place||token.startsWith(place+'.')||token.startsWith(place+'['))&&
          (!objective.type||schema.isBuiltinObjective(objective.type)||document.objectiveTypes?.[objective.type]))
          evidence(schema.objectiveRule(objective,document.objectiveTypes??{}),place);
      }
      for (const id of list(spec.children?.open)) child(id,where+'.children.open');
      for (const id of list(spec.children?.wait?.any??spec.children?.wait?.all)) child(id,where+'.children.wait');
      for (const [branch,next] of entries(spec.next))
        for (const [id] of entries(next.requiresChildren)) child(id,where+'.next.'+branch+'.requiresChildren');
    }
    for (const [outcome,spec] of entries(story.outcomes)) for (const [name,row] of entries(spec.consequences))
      for (const [index,rule] of list(row.cases).entries()) {
        const where = path+'.outcomes.'+outcome+'.consequences.'+name+'.cases['+index+']';
        evidence(rule,where);
        child(rule.child?.story,where+'.child');
      }
    const lifecycle = story.lifecycle, life = path+'.lifecycle';
    if (!lifecycle) return;
    if (lifecycle.candidate?.onExpire) child(lifecycle.candidate.onExpire,life+'.candidate.onExpire');
    commitment(lifecycle.commitment,life+'.commitment');
    for (const [name,handoff] of entries(lifecycle.handoffs)) commitment(handoff.commitment,life+'.handoffs.'+name+'.commitment');
    for (const [name,check] of entries(lifecycle.feasibility)) {
      const where = life+'.feasibility.'+name;
      evidence(check,where);
      if (concrete(check.route?.system)) query(check.route.system+'/route-feasibility',where+'.route');
      if (check.transfer) {
        transfer(check.transfer,where+'.transfer');
        query('world/transfer-feasibility',where+'.transfer');
      }
      if (concrete(check.work?.site)) {
        dep('worksite',check.work.site,where+'.work.site');
        query(check.work.site.split('/')[0]+'/work-feasibility',where+'.work');
      }
      for (const worker of list(check.work?.workers)) if (concrete(worker?.system)) {
        query(worker.system+'/order-tasks',where+'.work.workers');
        query(worker.system+'/route-feasibility',where+'.work.workers');
      }
    }
    for (const [name,reference] of entries(lifecycle.liveReferences)) {
      const where = life+'.liveReferences.'+name;
      if (concrete(reference.target?.agent?.system)) query(reference.target.agent.system+'/agent',where+'.target');
      if (concrete(reference.target?.entity)) query('world/entity',where+'.target');
      if (concrete(reference.access?.routeFrom?.system))
        query(reference.access.routeFrom.system+'/route-feasibility',where+'.access.routeFrom');
      if (reference.access?.state) evidence({state:reference.access.state},where+'.access');
      event(reference.death?.event,where+'.death.event');
    }
    for (const [name,rule] of entries(lifecycle.cleanup))
      for (const kind of ['claim','offer','site']) if (rule[kind])
        cap('system',rule[kind].system,life+'.cleanup.'+name+'.'+kind);
    const settlement = lifecycle.settlement;
    const groups = [...(settlement?.costs?[['costs',settlement.costs]]:[]),
      ...entries(settlement?.outcomes).map(([name,rows])=>['outcomes.'+name,rows])];
    for (const [phase,rows] of groups) for (const [name,effect] of entries(rows)) {
      const where = life+'.settlement.'+phase+'.'+name;
      if (effect.transfer) {
        transfer(effect.transfer,where+'.transfer');
        cap('action','world/transfer',where+'.transfer');
      }
      if (concrete(effect.work?.site)) dep('worksite',effect.work.site,where+'.work.site');
      if (concrete(effect.claim?.board)) query(effect.claim.board+'/claim',where+'.claim');
      if (concrete(effect.access?.board)) cap('action',effect.access.board+'/post-job',where+'.access');
      if (concrete(effect.reputation?.ledger)) cap('action',effect.reputation.ledger+'/adjust-reputation',where+'.reputation');
      if (concrete(effect.obligation?.ledger)) cap('action',effect.obligation.ledger+'/open-obligation',where+'.obligation');
    }
  }

  return Object.freeze({collect});
})();
if (typeof module !== 'undefined') module.exports = StoryInventory;
