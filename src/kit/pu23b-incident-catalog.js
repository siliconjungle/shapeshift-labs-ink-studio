/* Discover authored incidents and read their status on a published world revision. */
(function(K) {
  const W = K.world, {check,copy,own,record} = W.data, {freeze} = K.procedural.data;
  const format = 'ink-studio/incident-catalog', {incidentCategories:categories,isStoryId:id} = StoryDocument;
  const intensityOK = value => Number.isSafeInteger(value)&&value>=0&&value<=5;
  const statuses = ['registered','waiting','pending','started','available','active','suspended','completed','failed','withdrawn','expired'];

  function compile(documents,templates) {
    check(Array.isArray(documents)&&documents.length<=32,'Expected up to 32 incident source documents');
    const seen = new Set(), entries = [];
    for (const document of documents) {
      StoryDocument.validateStoryDocument(document);
      check(!seen.has(document.id),'Duplicate story document ID '+document.id);
      seen.add(document.id);
      for (const [story,definition] of Object.entries(document.stories)) {
        if (definition.kind!=='incident') continue;
        check(entries.length<4096,'Incident catalog exceeds 4096 entries');
        const {title,summary,entry,incident,refs=[],roles={},triggers={},lifecycle} = definition;
        const template = own(templates,document.id)&&templates[document.id].template;
        entries.push({id:document.id+'/'+story,document:document.id,story,title,...(summary!==undefined&&{summary}),
          category:incident?.category??null,intensity:incident?.intensity??null,tags:[...(incident?.tags??[])].sort(),entry,
          roles:Object.keys(roles).sort(),references:refs.map(id=>({...document.references[id],slot:id})),
          triggers,lifecycle:lifecycle?{activation:lifecycle.activation??'automatic',progression:lifecycle.progression===true}:null,
          ...(lifecycle?.candidate&&{candidatePolicy:lifecycle.candidate}),...(template&&{template})});
      }
    }
    entries.sort((left,right)=>left.id<right.id?-1:left.id>right.id?1:0);
    return freeze(copy(entries));
  }

  function withStatus(entry,{lifecycle,triggers,candidates}) {
    const row = lifecycle?.[entry.id], start = triggers?.[entry.id]?.start;
    const change = row?.transitions.at(-1), candidate = candidates?.[entry.id];
    const status = change?.to??(candidate?candidate.status==='expired'?'expired':'pending':
      start?entry.lifecycle?'pending':'started':entry.lifecycle||Object.keys(entry.triggers).length?'waiting':'registered');
    return {...entry,status,...(start&&{start}),...(change&&{transition:change}),
      ...(candidate&&{candidate:{status:candidate.status,queuedAt:candidate.queuedAt,expiresAt:candidate.expiresAt}})};
  }

  function find(entries,filters={},snapshot) {
    check(record(filters)&&Object.keys(filters).every(key=>['incident','category','tags','minIntensity','maxIntensity','text','status'].includes(key)),
      'Invalid incident catalog filters');
    const {incident,category,tags=[],minIntensity,maxIntensity,text,status} = filters;
    check(incident===undefined||typeof incident==='string'&&incident.split('/').length===2&&incident.split('/').every(id),
      'Incident filter needs a document/story ID');
    check(category===undefined||categories.includes(category)||category==='unclassified','Unknown incident category '+category);
    check(Array.isArray(tags)&&tags.length<=16&&Array.from(tags).every(id)&&new Set(tags).size===tags.length,
      'Incident tag filter needs up to 16 unique tag IDs');
    check((minIntensity===undefined||intensityOK(minIntensity))&&(maxIntensity===undefined||intensityOK(maxIntensity))&&
      (minIntensity===undefined||maxIntensity===undefined||minIntensity<=maxIntensity),'Invalid incident intensity range');
    check(text===undefined||typeof text==='string'&&text.trim()&&text.length<=128,'Invalid incident text filter');
    check(status===undefined||snapshot&&statuses.includes(status),'Invalid incident status filter');
    const needle = text?.trim().toLowerCase();
    const catalog = entries??[], incidents = [], counts = {};
    for (const entry of catalog) {
      const label = entry.category??'unclassified';
      if (incident!==undefined&&entry.id!==incident||category!==undefined&&label!==category||
          tags.some(tag=>!entry.tags.includes(tag))) continue;
      if ((minIntensity!==undefined||maxIntensity!==undefined)&&
          (entry.intensity===null||entry.intensity<(minIntensity??0)||entry.intensity>(maxIntensity??5))) continue;
      if (needle&&![entry.id,entry.title,entry.summary,label,...entry.tags].some(value=>value?.toLowerCase().includes(needle))) continue;
      const row = snapshot?withStatus(entry,snapshot):entry;
      if (status!==undefined&&row.status!==status) continue;
      incidents.push(row);
      counts[label] = (counts[label]??0)+1;
    }
    return freeze({format,version:1,categories,total:catalog.length,counts,incidents});
  }

  W.incidentCatalog = Object.freeze({compile,find});
})(KIT);
