/* Bind a static story inventory to compiled runtime interfaces without reading solver state. */
(function(K) {
  const W = K.world, {own,endpoint} = W.data;
  const assetTables = {family:'families',look:'looks',material:'materials',environment:'environments','environment-image':'environmentImages'};
  const hasDeclared = document=>document.requirements||Object.values(document.stories).some(story=>story.requirements);

  function create(plan,worldAction) {
    const {world,systems,storyRoles} = plan, documents = storyRoles?.authored??[];
    const resolved = storyRoles?.documents??[], storyIds = new Set(resolved.flatMap(document=>
      Object.keys(document.stories).map(story=>document.id+'/'+story)));
    const documentIds = new Set(resolved.map(document=>document.id));
    const accounts = new Set(plan.transfers.describe().map(row=>row.name));
    const packs = new Map((W.materials.catalog(world)?.packs??[]).map(pack=>[pack.id,pack]));
    let registry;
    function field(id) {
      registry ??= W.query.create({world,[W.schedulerInspector.source]:true,
        ...(plan.storyLifecycle&&{storyLifecycle:{}}),...(plan.storyTriggers&&{storyTriggers:{}}),
        ...((world.visual?.weatherTracks!==undefined&&world.visual.weatherTracks!==false||
          world.visual?.environmentPreset)&&{weatherTrackState:{}})},systems);
      return registry.field(id);
    }
    function capability(row) {
      const {kind,id} = row;
      if (kind==='system') return own(systems,id);
      if (kind==='query') return Boolean(field(id));
      if (kind==='account') return accounts.has(id);
      const [system,name] = endpoint(id);
      if (kind==='operation') return systems[system]?.storyHostOperations?.has(name)===true;
      return system==='world'?Boolean(worldAction(plan,name)):own(systems[system]?.actions,name);
    }
    function asset(row) {
      const {pack:id,revision,kind} = row, pack = packs.get(id);
      if (!pack) return {status:'missing',reason:'pack-missing'};
      if (revision!==undefined&&pack.revision!==revision)
        return {status:'missing',reason:'revision-mismatch',installedRevision:pack.revision};
      if (kind&&!pack[assetTables[kind]]?.some(asset=>asset.id===row.id))
        return {status:'missing',reason:'asset-missing',installedRevision:pack.revision};
      return {status:'available',installedRevision:pack.revision};
    }
    function dependency(row) {
      if (row.kind==='document') return documentIds.has(row.id)?'available':'missing';
      if (row.kind==='story') return storyIds.has(row.id)?'available':'missing';
      if (row.kind==='callback') return own(plan.storyCallbacks?.definitions,row.id)?'available':'missing';
      if (row.kind==='template') return 'available';
      if (row.kind==='worksite') {
        const [system,site] = endpoint(row.id);
        return own(systems[system]?.worksites?.definitions,site)?'available':'missing';
      }
      return 'reference';
    }
    function inspect({declaredOnly=false}={}) {
      const inventory = StoryInventory.collect(documents,{schema:StoryDocument,resolved,bindings:storyRoles?.roles,
        declaredOnly,eventActions:plan.storyEventActions,callbacks:plan.storyCallbacks?.definitions,templates:plan.storyTemplates});
      return {...inventory,capabilities:inventory.capabilities.map(row=>{
        const system = row.id.split('/')[0], provider = system==='world'?'world':world.systems[system]?.kind;
        return {...row,status:capability(row)?'available':'missing',...(provider&&{provider})};
      }),
        assets:inventory.assets.map(row=>({...row,...asset(row)})),
        dependencies:inventory.dependencies.map(row=>({...row,status:dependency(row)})),
        ...(!declaredOnly&&{installedAssetPacks:[...packs.values()].map(({id,revision,title})=>({id,revision,title})).sort((a,b)=>a.id<b.id?-1:1)})};
    }
    function audit() {
      if (!documents.some(hasDeclared)) return [];
      const {capabilities,assets,dependencies} = inspect({declaredOnly:true});
      function missing(rows,code,describe) {
        return rows.filter(row=>row.status==='missing').flatMap(row=>row.usedBy.map(({document,story,path})=>
          ({document,...(story&&{story}),path,code,severity:'error',message:describe(row)})));
      }
      return [...missing(capabilities,'missing-story-capability',row=>'Missing story capability '+row.kind+' '+row.id),
        ...missing(assets,'missing-story-asset',row=>'Missing required story asset '+(row.id??row.pack)+
          (row.revision===undefined?'':' at revision '+row.revision)+' ('+row.reason+')'),
        ...missing(dependencies,'missing-story-document',row=>'Missing required story document '+row.id)];
    }
    return {inspect,audit};
  }

  W.storyInventory = Object.freeze({create,hasRequirements:plan=>plan.storyRoles?.authored.some(hasDeclared)===true});
})(KIT);
