/* Portable cue IDs, material mappings and content-addressed sound assets. */
(function (K) {
  const W=K.world, {check,record,own,copy}=W.data;
  const format='ink-studio/world-sound-pack', sourceFormat='ink-studio/world-sound-pack-source';
  const maxBytes=48*1024*1024, maxDocumentBytes=72*1024*1024, recipeBytes=64*1024, runBytes=8*1024*1024;
  const tables=['cues','soundFamilies','bindings','materials'];
  const settings=['processing','contactLoops'];
  const kinds=['recipe','recording','run'];
  const fields=(row,keys)=>record(row)&&Object.keys(row).every(key=>keys.includes(key));
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_][a-zA-Z0-9._/-]{0,127}$/.test(value)&&
    !value.split('/').some(part=>!part||['.','..','constructor','prototype','__proto__'].includes(part));
  const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  const count=(value,limit)=>Number.isSafeInteger(value)&&value>0&&value<=limit;
  const token=(value,limit=256)=>typeof value==='string'&&value.trim().length>0&&value.length<=limit;
  const time=value=>typeof value==='string'&&value.length<=48&&/^(?:\d+(?:\.\d+)?|\.\d+|\d+\/[1-9]\d*)$/.test(value);
  const spatialKeys=[...tables,...settings];

  function table(row,max,label) {
    check(record(row)&&Object.keys(row).length<=max&&Object.keys(row).every(id),'Invalid world-sound pack '+label);
    return Object.entries(row);
  }

  function references(raw) {
    check(Array.isArray(raw)&&raw.length<=16,'Soundtrack needs an array of up to 16 world-sound pack references');
    const ids=new Set();
    return Array.from(raw,ref=>{
      check(fields(ref,['file','id','revision','sha256'])&&K.authoring.assetReferences.localFile(ref.file)&&
        id(ref.id)&&count(ref.revision,Number.MAX_SAFE_INTEGER)&&(ref.sha256===undefined||sha(ref.sha256))&&!ids.has(ref.id),
      'World-sound imports need distinct IDs, local files and exact revisions');
      ids.add(ref.id);
      return ref;
    });
  }

  function describe(raw,{source=false}={}) {
    const keys=['format','version','id','revision','spatial','assets','examples','label',...(source?['assetRegistry']:['files'])];
    check(fields(raw,keys)&&raw.format===(source?sourceFormat:format)&&raw.version===1&&
      id(raw.id)&&count(raw.revision,Number.MAX_SAFE_INTEGER)&&(raw.label===undefined||token(raw.label))&&
      fields(raw.spatial,spatialKeys)&&record(raw.spatial.cues)&&Object.keys(raw.spatial.cues).length>0,
    'Expected a named version 1 world-sound pack with an exact revision and spatial cues');
    const assets=table(raw.assets,512,'assets'), examples=table(raw.examples??{},16,'examples');
    const api=K.authoring.assetReferences;
    const media=source ? value=>api.localFile(value)||api.validRef(value) : sha;
    const pinned=new Map();
    for(const [name,row] of assets){
      check(fields(row,['recipe','recording','playback','credit',...(!source?['refs']:[])])&&
        (row.credit===undefined||token(row.credit))&&
        (row.recipe!==undefined||row.recording!==undefined)&&
        [row.recipe,row.recording].every(ref=>ref===undefined||media(ref))&&
        (row.playback===undefined ? source : ['recipe','recording'].includes(row.playback)&&row[row.playback]!==undefined),
      'Invalid world-sound asset '+name);
      if(!source&&row.refs!==undefined){
        check(fields(row.refs,['recipe','recording']),'Invalid original asset pins for '+name);
        for(const [kind,ref] of Object.entries(row.refs)){
          check(api.validRef(ref)&&sha(ref.sha256)&&ref.sha256===row[kind],'Invalid original asset pin for '+name);
          const key=api.key(ref);
          check(!pinned.has(key)||pinned.get(key)===ref.sha256,'Conflicting original asset revision '+key);
          pinned.set(key,ref.sha256);
        }
      }
    }
    const exampleMedia=source ? api.localFile : sha;
    for(const [name,row] of examples){
      check(fields(row,['run','preview','label','listener','sampleRate','soundSeed','from','to','beat'])&&exampleMedia(row.run)&&
        (row.preview===undefined||exampleMedia(row.preview))&&(row.label===undefined||token(row.label))&&
        (row.listener===undefined||W.data.vector(row.listener)&&row.listener.every(n=>Math.abs(n)<=1e6))&&
        (row.sampleRate===undefined||count(row.sampleRate,192000)&&row.sampleRate>=8000)&&
        (row.soundSeed===undefined||Number.isSafeInteger(row.soundSeed))&&
        [row.from,row.to].every(value=>value===undefined||time(value))&&
        (row.beat===undefined||Boolean(W.inspectionLinks.parse(row.beat))),
      'Invalid world-sound audition example '+name);
    }
    for(const [cue,value] of Object.entries(raw.spatial.cues)){
      const asset=typeof value==='string'?value:value?.asset;
      check(typeof asset==='string'&&own(raw.assets,asset),'World-sound cue '+cue+' needs a packaged asset');
    }
    W.spatialAudio.create(raw.spatial);
    return {assets,examples};
  }

  function open(raw,{decode,digest}={}) {
    const {assets,examples}=describe(raw);
    check(typeof decode==='function'&&typeof digest==='function'&&record(raw.files)&&Object.keys(raw.files).length<=1056,
      'World-sound pack needs a bounded file table and verification');
    const used=new Map();
    const use=(name,kind)=>{
      if(name===undefined)return;
      check(own(raw.files,name)&&raw.files[name]?.kind===kind,'Missing '+kind+' payload '+name+' in world-sound pack');
      used.set(name,kind);
    };
    for(const [,row] of assets) for(const kind of ['recipe','recording']) use(row[kind],kind);
    for(const [,row] of examples){
      use(row.run,'run');
      use(row.preview,'recording');
    }
    check(used.size===Object.keys(raw.files).length,'World-sound pack contains unreferenced files');
    let size=0;
    const bytes=new Map();
    for(const [name,kind] of used){
      const row=raw.files[name], limit=kind==='recipe'?recipeBytes:kind==='run'?runBytes:maxBytes;
      check(fields(row,['kind','size','data'])&&kinds.includes(kind)&&count(row.size,limit)&&
        (size+=row.size)<=maxBytes&&typeof row.data==='string'&&row.data.length===4*Math.ceil(row.size/3),
      'World-sound pack exceeds its byte budget or has invalid payload metadata');
      const decoded=decode(row.data);
      check(ArrayBuffer.isView(decoded)&&decoded.BYTES_PER_ELEMENT===1&&decoded.length===row.size&&digest(decoded)===name,
        'World-sound payload SHA-256 mismatch for '+name);
      bytes.set(name,new Uint8Array(decoded));
    }
    const {files,...metadata}=raw, manifest=K.procedural.data.freeze(copy(metadata));
    return Object.freeze({manifest,size,files:Object.freeze([...used].map(([sha256,kind])=>
      Object.freeze({sha256,kind,size:raw.files[sha256].size}))),
      read:name=>bytes.get(name)?.slice()});
  }

  function compose(spatial={},packs=[],localAssets=[]) {
    check(record(spatial),'Invalid soundtrack spatial settings');
    const combined={...spatial}, owners=new Map(), ids=new Set();
    const assets=new Map(localAssets.map(name=>[name,null]));
    for(const name of settings) if(spatial[name]!==undefined) owners.set(name,'soundtrack');
    for(const {manifest} of packs){
      const {id,assets:slots,spatial:patch}=manifest;
      check(!ids.has(id),'Multiple revisions or copies of world-sound pack '+id);
      ids.add(id);
      for(const [name,row] of Object.entries(slots)){
        check(!assets.has(name),'World-sound asset ID collision for '+name+' in '+id);
        assets.set(name,{pack:id,...row});
      }
      for(const tableName of tables){
        if(patch[tableName]===undefined)continue;
        const prior=combined[tableName]??{};
        check(record(prior),'Invalid soundtrack '+tableName);
        const merged=new Map(Object.entries(prior));
        for(const [name,row] of Object.entries(patch[tableName])){
          if(tableName==='materials'&&own(prior,name)){
            check(record(prior[name]),'Invalid material audio cues '+name);
            for(const interaction of Object.keys(row))
              check(!own(prior[name],interaction)||prior[name][interaction]===row[interaction],
                'World-sound material mapping collision for '+name+'/'+interaction+' in '+id);
            merged.set(name,{...prior[name],...row});
          }else{
            check(!own(prior,name),'World-sound '+tableName+' ID collision for '+name+' in '+id);
            merged.set(name,row);
          }
        }
        combined[tableName]=Object.fromEntries(merged);
      }
      for(const name of settings){
        if(patch[name]===undefined)continue;
        check(!owners.has(name),'World-sound setting '+name+' is already defined by '+owners.get(name));
        owners.set(name,id);
        combined[name]=patch[name];
      }
    }
    return {spatial:copy(combined),assets};
  }

  W.soundPacks=Object.freeze({format,sourceFormat,maxBytes,maxDocumentBytes,recipeBytes,runBytes,describe,open,compose,references});
})(KIT);
