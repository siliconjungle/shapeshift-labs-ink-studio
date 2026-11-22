/* Typed entries for portable story definitions and recorded runs. */
(function(K) {
  const A=K.authoring, packFormat='ink-studio/story-pack', runFormat='ink-studio/story-run';
  const record=value=>value!==null&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
  const fields=(value,keys)=>record(value)&&Object.keys(value).every(key=>keys.includes(key));
  const id=StoryDocument.isStoryId;
  const assert=(ok,message)=>{if(!ok)throw new TypeError(message);};
  const pathOK=ref=>typeof ref==='string'&&ref.trim().length>0&&ref.length<=4096;
  const jsonOK=ref=>pathOK(ref)&&/\.json$/i.test(ref);
  const entries=(value,valid,section)=>{
    assert(record(value)&&Object.keys(value).length<=256&&Object.entries(value).every(([name,ref])=>id(name)&&valid(ref)),
      'Invalid story exchange '+section);
    return Object.entries(value);
  };
  const kindOf=format=>format===packFormat?'story-pack':format===runFormat?'story-run':undefined;

  function validate(manifest) {
    const kind=kindOf(manifest?.format), pack=kind==='story-pack', refs=A.assetReferences;
    assert(kind&&fields(manifest,['format','version','id','revision','inputs','media',...(pack?
      ['documents','templates','assetRegistry','assets','assetPacks']:['pack','events','recording'])])&&
      manifest.version===1&&id(manifest.id)&&Number.isSafeInteger(manifest.revision??1)&&(manifest.revision??1)>0,
    'Expected a version 1 story pack or run recipe with an ID and positive revision');
    const {inputs={},media={}}=manifest;
    entries(inputs,pathOK,'inputs');
    entries(media,pathOK,'media');
    if(pack){
      const {documents=[],templates={},assets={},assetPacks=[],assetRegistry}=manifest;
      assert(Array.isArray(documents)&&documents.length<=32&&documents.every(jsonOK)&&
        new Set(documents).size===documents.length,'Story pack needs up to 32 distinct story document files');
      const sources=entries(templates,jsonOK,'templates');
      assert(documents.length+sources.length>0&&sources.length<=32,'Story pack needs story documents or templates');
      entries(assets,refs.validRef,'pinned assets');
      assert((assetRegistry===undefined||jsonOK(assetRegistry))&&(!Object.keys(assets).length||assetRegistry!==undefined)&&
        Array.isArray(assetPacks)&&assetPacks.length<=128&&assetPacks.every(jsonOK)&&new Set(assetPacks).size===assetPacks.length,
      'Story pack assets need a locked registry or distinct native asset-pack files');
    }else{
      assert(jsonOK(manifest.events)&&(manifest.pack===undefined||jsonOK(manifest.pack))&&
        (manifest.recording===undefined||jsonOK(manifest.recording)),
      'Story run needs an event log and optional story pack and native recording files');
    }
    return manifest;
  }

  function open(entry,resolvePath,io) {
    const W=K.world, refs=A.assetReferences, json=file=>JSON.parse(io.text(file));
    const manifest=validate(json(entry)), run=manifest.format===runFormat;
    const path=(owner,ref)=>resolvePath(owner,ref);
    const owner=run?(manifest.pack===undefined?undefined:path(entry,manifest.pack)):entry;
    const pack=owner===undefined?{}:validate(json(owner));
    assert(owner===undefined||pack.format===packFormat,'A story run needs an authored story pack recipe');
    const documents=(pack.documents??[]).map(ref=>StoryDocument.validateStoryDocument(json(path(owner,ref))));
    assert(new Set(documents.map(row=>row.id)).size===documents.length,'Story pack contains duplicate story document IDs');
    const templates=new Map(Object.entries(pack.templates??{}).map(([name,ref])=>{
      const template=json(path(owner,ref));
      assert(template?.format==='ink-studio/story-template'&&template.version===1&&id(template.id)&&
        Number.isSafeInteger(template.revision)&&template.revision>0,'Invalid story template '+name);
      return [name,template];
    }));
    let nativePacks=[];
    for(const ref of pack.assetPacks??[])nativePacks=A.assetPacks.merge(nativePacks,json(path(owner,ref))).packs;
    const registryFile=pack.assetRegistry===undefined?undefined:path(owner,pack.assetRegistry);
    const registry=registryFile===undefined?undefined:refs.compile(json(registryFile));
    function pinned(ref,kind){
      assert(registry,'Story bundle has no asset registry');
      const asset=registry.bind(ref,kind), file=path(registryFile,asset.file), saved=io.file(file);
      assert(saved.sha256===asset.sha256,'Pinned story asset SHA-256 mismatch for '+refs.key(ref));
      return {...asset,path:file};
    }
    const assets=Object.fromEntries(Object.entries(pack.assets??{}).map(([name,ref])=>[name,pinned(ref)]));
    function resources(category){
      const base=Object.entries(pack[category]??{}).map(([name,ref])=>[name,path(owner,ref)]);
      const extra=run?Object.entries(manifest[category]??{}).map(([name,ref])=>[name,path(entry,ref)]):[];
      assert(!extra.some(([name])=>Object.hasOwn(pack[category]??{},name)),'Duplicate pack and run '+category+' ID');
      return Object.fromEntries([...base,...extra].map(([name,file])=>[name,{path:file,sha256:io.file(file).sha256}]));
    }
    const inventory=StoryInventory.collect(documents,{schema:StoryDocument});
    const table={assets,inputs:resources('inputs'),media:resources('media')};
    const recordingPath=run&&manifest.recording!==undefined?path(entry,manifest.recording):undefined;
    if(recordingPath!==undefined)io.file(recordingPath);
    const eventsPath=run?path(entry,manifest.events):undefined;
    const sourceEvents=run?json(eventsPath):undefined;
    if(run)assert([W.storyEvents.format,W.storyEvents.envelopeFormat].includes(sourceEvents?.format),'Story run needs a portable event log');
    const eventLog=run?W.storyEvents.readEnvelopes(W.storyEvents.envelopes(sourceEvents)):undefined;
    return {
      storyManifest:()=>structuredClone(manifest),
      storyDocuments:()=>structuredClone(documents),
      storyAssetPacks:()=>structuredClone(nativePacks),
      storyInventory:()=>structuredClone(inventory),
      storyTemplates:()=>[...templates].map(([name,{id,revision}])=>({name,id,revision})),
      storyTemplate(name){
        assert(templates.has(name),'Unknown story template '+name);
        return structuredClone(templates.get(name));
      },
      storyResources:()=>structuredClone(table),
      storyResource(category,name){
        const group=Object.hasOwn(table,category)&&table[category];
        assert(group&&Object.hasOwn(group,name),'Unknown story resource '+category+'/'+name);
        return {...group[name],bytes:io.bytes(group[name].path)};
      },
      resolveStoryAsset:pinned,
      ...(run&&{storyEvents:()=>eventLog,storyRecordingPath:()=>recordingPath})
    };
  }
  A.storyExchange=Object.freeze({packFormat,runFormat,kindOf,validate,open});
})(KIT);
