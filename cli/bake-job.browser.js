(() => {
  const el=id=>document.getElementById(id), title=s=>s.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
  const names={pigment:'Pigment',normal:'Normal','world-normal':'World normal',height:'Height',roughness:'Roughness',metalness:'Metalness',emission:'Emission',
    opacity:'Opacity',coverage:'Coverage',slope:'Slope',cavity:'Cavity',exposure:'Exposure',thickness:'Thickness',
    'thickness-valid':'Thickness validity','cage-hit':'Projection hits','cage-miss':'Projection misses',
    'cage-backface':'Projection backfaces','cage-distance':'Projection distance','cage-relief':'Signed projection relief'};
  const geometry=['slope','cavity','exposure','thickness','thickness-valid'];
  const encodings=[['png8','8-bit PNG'],['png16','16-bit PNG'],['exr','32-bit OpenEXR']];
  const {label,catalog,token}=bakeJob;
  function withAvailableMaps(value) {
    const chosen=new Set(value.maps.map(row=>row.id));
    return {...value,maps:[...value.maps,...Object.keys(names).filter(id=>!chosen.has(id)).map(id=>({id,enabled:false,overrides:{}}))]};
  }
  let preset=withAvailableMaps(structuredClone(bakeJob.preset)), targets=structuredClone(bakeJob.targets), report=bakeJob.report;
  let base='', revision;
  el('title').textContent=label;
  document.title=label+' · Ink Studio';
  if(targets.some(row=>row.projection))
    el('target-card').parentElement.prepend(el('target-card'));
  function node(type,value) {
    const item=document.createElement(type);
    if(value!==undefined)item.textContent=value;
    return item;
  }
  function button(value,action,label=value) {
    const item=node('button',value);item.type='button';item.onclick=action;item.setAttribute('aria-label',label);
    return item;
  }
  function numeric(label,value,oninput,settings={}) {
    const item=node('input');
    item.type='number';item.value=value??'';item.placeholder=settings.placeholder??'Inherit';
    for(const key of ['min','max','step']) if(settings[key]!==undefined)item[key]=settings[key];
    item.oninput=()=>oninput(item.value===''?undefined:Number(item.value));
    item.setAttribute('aria-label',label);
    return item;
  }
  function field(label,input) {
    const item=node('label',label);item.append(input);return item;
  }
  function selected(values,value,change) {
    const item=node('select');
    item.replaceChildren(...values.map(([k,l])=>new Option(l,k)));
    item.value=value;
    item.onchange=()=>change(item.value);
    return item;
  }
  function put(row,key,value) {
    if(value===undefined||value==='')delete row[key];else row[key]=value;
  }
  function projectionControls(row) {
    const pane=node('div');
    const known=bakeJob.projectionCatalog??{sources:[{id:'$receiver',meshes:catalog}],skewMaps:[]};
    const sourceChoices=known.sources.map(source=>[source.id,source.id==='$receiver'?'Receiver scene':source.id]);
    const meshChoices=id=>known.sources.find(source=>source.id===id).meshes.map(mesh=>[mesh.index,mesh.name]);
    const index=(id,value)=>known.sources.find(source=>source.id===id).meshes
      .find(mesh=>mesh.index===value||mesh.name===value)?.index;
    const projection=node('details');
    const summary=node('summary','Projection');
    projection.open=Boolean(row.projection);
    projection.append(summary,pane);
    function draw() {
      const options=row.projection??{mode:'self'};
      const high=options.high??known.sources.find(source=>source.id!=='$receiver')?.id??'$receiver';
      const layout=node('div');layout.className='form';
      pane.replaceChildren(layout);
      layout.append(field('Bake from',selected([['self','Low mesh · self-bake'],['project','High mesh · project']],
        options.mode,value=>{
          row.projection=value==='self'?{mode:'self'}:{mode:'project',high,match:'all',front:.1,back:.05,
            units:'scene',normals:'authored',backfaces:'ignore'};
          draw();
        })));
      summary.textContent=options.mode==='project'?'Projection · High to low':'Projection · Self-bake';
      if(options.mode==='self')return;
      layout.append(field('High source',selected(sourceChoices,high,value=>{
        options.high=value;
        if(options.match==='selection')options.mesh=meshChoices(value)[0][0];
        draw();
      })));
      layout.append(field('Match meshes',selected([['all','All high meshes'],['selection','One high mesh'],['name','By mesh name']],
        options.match,value=>{
          options.match=value;
          delete options.lowSuffix;delete options.highSuffix;delete options.mesh;
          if(value==='selection')options.mesh=meshChoices(high)[0][0];
          draw();
        })));
      if(options.match==='selection')
        layout.append(field('High mesh',selected(meshChoices(high),index(high,options.mesh),value=>{options.mesh=+value;})));
      if(options.match==='name') {
        for(const [key,label] of [['lowSuffix','Low suffix'],['highSuffix','High suffix']]) {
          const input=node('input');input.value=options[key]??'';input.maxLength=140;
          input.oninput=()=>put(options,key,input.value);
          layout.append(field(label,input));
        }
      }
      layout.append(field('Backfaces',selected([['ignore','Ignore and continue'],['block','Stop the ray'],['accept','Accept hit']],
        options.backfaces??'ignore',value=>{options.backfaces=value;})));
      layout.append(field('Cage',selected([['distance','Distance based'],['mesh','Explicit cage mesh']],options.cage?'mesh':'distance',value=>{
        if(value==='mesh') {
          options.cage={source:high,mesh:meshChoices(high)[0][0]};
          delete options.skew;delete options.invertSkew;
        } else {
          delete options.cage;
          options.front??=.1;options.back??=.05;options.units??='scene';options.normals??='authored';
        }
        draw();
      })));
      if(options.cage) {
        const cage=options.cage;
        layout.append(field('Cage source',selected(sourceChoices,cage.source,value=>{
          cage.source=value;cage.mesh=meshChoices(value)[0][0];draw();
        })));
        layout.append(field('Cage mesh',selected([['','Match low mesh'],...meshChoices(cage.source)],
          cage.mesh===undefined?'':index(cage.source,cage.mesh),value=>put(cage,'mesh',value===''?undefined:+value))));
        return;
      }
      layout.append(field('Distance units',selected([['scene','Scene units'],['bounds','Low bounding box']],
        options.units,value=>{options.units=value;})));
      layout.append(field('Frontal distance',numeric('Frontal distance',options.front,n=>put(options,'front',n),
        {placeholder:.1,min:0,max:1e5,step:'any'})));
      layout.append(field('Rear distance',numeric('Rear distance',options.back,n=>put(options,'back',n),
        {placeholder:.05,min:0,max:1e5,step:'any'})));
      const direction=selected([['authored','Authored normals'],['average','Average normals'],['face','Face normals']],
        options.normals,value=>{options.normals=value;});
      direction.disabled=Boolean(options.skew);
      layout.append(field('Ray direction',direction));
      if(known.skewMaps.length) {
        layout.append(field('Skew map',selected([['','None'],...known.skewMaps.map(id=>[id,id])],options.skew??'',value=>{
          put(options,'skew',value);
          if(!value)delete options.invertSkew;
          draw();
        })));
        if(options.skew) {
          const invert=node('input');invert.type='checkbox';invert.checked=options.invertSkew??false;
          invert.onchange=()=>{options.invertSkew=invert.checked;};
          layout.append(field('Invert skew',invert));
        }
      }
    }
    draw();
    return projection;
  }
  function fillDefaults() {
    el('preset-name').value=preset.label;
    for(const key of ['size','padding']) {
      el(key).value=preset.defaults[key]??'';
      el(key).oninput=()=>put(preset.defaults,key,el(key).value===''?undefined:+el(key).value);
    }
  }
  function surfaceControls(row,extra) {
    const options=row.overrides, controls=node('div');
    controls.className='map-controls';
    extra.append(controls);
    function draw() {
      const encoding=options.encoding??(row.id==='normal'?'png8':'png16');
      controls.replaceChildren(field('Encoding',selected(encodings,encoding,value=>{
        options.encoding=value;
        if(value!=='exr'&&options.normalization==='none')delete options.normalization;
        draw();
      })));
      if(row.id==='height') {
        const normalization=options.normalization??(encoding==='exr'?'none':'symmetric');
        const modes=[['symmetric','Symmetric about zero'],['minmax','Fit extrema and zero'],['manual','Manual range']];
        if(encoding==='exr')modes.push(['none','Raw signed height']);
        controls.append(field('Height normalization',selected(modes,normalization,value=>{
          options.normalization=value;
          if(value==='manual')options.range??=[-.1,.1];else delete options.range;
          draw();
        })));
        if(normalization==='manual') {
          for(const [i,label] of ['Minimum height','Maximum height'].entries())
            controls.append(field(label,numeric(label,options.range?.[i],value=>{options.range[i]=value;},{step:'any'})));
        }
      } else if(row.id==='normal') {
        const space=options.space??'tangent';
        controls.append(field('Normal space',selected([['tangent','Tangent'],['world','World XYZ']],space,value=>{
          options.space=value;
          if(value==='world')delete options.orientation;
          draw();
        })));
        if(space==='tangent')controls.append(field('Tangent orientation',
          selected([['opengl','OpenGL'],['directx','DirectX']],options.orientation??'opengl',value=>{options.orientation=value;})));
      }
    }
    draw();
  }
  function maps() {
    const list=preset.maps, rows=el('rows');rows.replaceChildren();
    for(const [i,row] of list.entries()) {
      const line=node('div');line.className='map-row';
      const head=node('div');head.className='map-main';
      const box=node('input');box.type='checkbox';box.checked=row.enabled??true;
      box.setAttribute('aria-label','Enable '+names[row.id]);
      box.onchange=()=>{row.enabled=box.checked;};
      const size=numeric(names[row.id]+' size',row.overrides?.size,n=>put(row.overrides,'size',n),
        {placeholder:preset.defaults.size??128,min:8,max:1024,step:1});
      const move=delta=>{
        [list[i],list[i+delta]]=[list[i+delta],list[i]];maps();
      };
      const up=button('↑',()=>move(-1),'Move '+names[row.id]+' up');
      const down=button('↓',()=>move(1),'Move '+names[row.id]+' down');
      up.disabled=i===0;down.disabled=i===list.length-1;
      const extra=node('div');extra.className='form';extra.hidden=true;
      const more=button('⋯',()=>{extra.hidden=!extra.hidden;more.setAttribute('aria-expanded',String(!extra.hidden));},'Overrides for '+names[row.id]);
      more.setAttribute('aria-expanded','false');
      extra.append(field('Padding',numeric('Map padding',row.overrides?.padding,n=>put(row.overrides,'padding',n),{min:0,max:32,step:1})));
      if(['normal','world-normal','height'].includes(row.id))surfaceControls(row,extra);
      if(geometry.includes(row.id)) {
        const tuning={slope:[],cavity:['samples','cavityRadius','rayBias'],exposure:['samples','exposureDistance','rayBias'],
          thickness:['thicknessScale','rayBias'],'thickness-valid':['rayBias']};
        if(row.id==='slope') {
          const up=node('input');
          up.value=row.overrides.up?.join(', ')??'';
          up.placeholder=(preset.defaults.up??[0,1,0]).join(', ');
          up.oninput=()=>put(row.overrides,'up',up.value.trim()?up.value.split(',').map(Number):undefined);
          extra.append(field('Up vector',up));
        }
        for(const key of tuning[row.id])extra.append(field(({samples:'Samples',cavityRadius:'Cavity radius',exposureDistance:'Exposure distance',
          thicknessScale:'Thickness scale',rayBias:'Ray bias'})[key],numeric(key,row.overrides?.[key],n=>put(row.overrides,key,n),
            key==='samples'?{min:4,max:64,step:1}:{min:.000001,step:'any'})));
      }
      const name=node('label',names[row.id]??row.id);box.id='enabled-'+row.id;name.htmlFor=box.id;
      head.append(box,name,size,up,down,more);line.append(head,extra);rows.append(line);
    }
  }
  function targetControls() {
    const pane=el('targets');pane.replaceChildren();
    for(const [i,row] of targets.entries()) {
      const mesh=catalog.find(m=>m.index===row.mesh||m.name===row.mesh)??catalog[0];
      const detail=node('details'), summary=node('summary',row.id+' · '+mesh.name);
      detail.open=i===0;detail.append(summary);
      const grid=node('div');grid.className='form';
      grid.append(field('Mesh',selected(catalog.map(m=>[m.index,m.name]),mesh.index,value=>{
        row.mesh=+value;delete row.submeshes;delete row.slots;row.uvSet=0;targetControls();
      })));
      const sets=[...new Set(mesh.submeshes.flatMap(p=>p.uvSets))].sort((a,b)=>a-b);
      grid.append(field('UV set',selected(sets.map(set=>[set,'TEXCOORD_'+set]),row.uvSet,value=>{row.uvSet=+value;})));
      detail.append(grid);
      function checks(label,all,key) {
        detail.append(node('p',label));const list=node('div');list.className='partlist';
        for(const [id,name] of all) {
          const box=node('input');box.type='checkbox';box.checked=!row[key]||row[key].includes(id);
          box.onchange=()=>{
            const enabled=new Set(row[key]??all.map(pair=>pair[0]));
            if(box.checked)enabled.add(id);else enabled.delete(id);
            row[key]=[...enabled];
          };
          list.append(field(name,box));
        }
        detail.append(list);
      }
      checks('Submeshes',mesh.submeshes.map(p=>[p.index,p.index+' '+p.slot]),'submeshes');
      checks('Material slots',[...new Set(mesh.submeshes.map(p=>p.slot))].map(key=>[key,key]),'slots');
      const tile=node('input');
      tile.value=row.tiles.map(value=>{
        if(!Array.isArray(value))return value;
        const [u,v]=value;return u>=0&&u<10&&v>=0?1001+u+10*v:u+':'+v;
      }).join(', ');
      tile.oninput=()=>{row.tiles=tile.value.split(',').map(s=>s.trim()).filter(Boolean).map(s=>s.includes(':')?s.split(':').map(Number):Number(s));};
      detail.append(field('Tiles · UDIM or u:v',tile));
      detail.append(projectionControls(row));
      pane.append(detail);
    }
  }
  function currentPreset() {
    return {...preset,label:el('preset-name').value.trim()};
  }
  function notify(message='') {el('notice').textContent=message;}
  el('open-preset').onclick=()=>el('preset-file').click();
  el('preset-file').onchange=async()=>{
    const input=el('preset-file'), file=input.files[0];input.value='';
    if(!file)return;
    try {
      if(file.size>65536)throw Error('Preset exceeds the byte budget');
      const item=JSON.parse(await file.text());
      if(item.format!=='ink-studio/bake-preset'||item.version!==1||!Array.isArray(item.maps)||!item.maps.length||
        item.maps.some(row=>!Object.hasOwn(names,row.id)))throw Error('Choose a version 1 Ink bake preset');
      item.defaults??={};for(const row of item.maps)row.overrides??={};
      preset=withAvailableMaps(item);fillDefaults();maps();notify();
    } catch(error) {notify(error.message);}
  };
  el('save-preset').onclick=()=>{
    const value=currentPreset();
    if(!value.label) {notify('Name the preset before saving.');return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
    const link=node('a');link.href=url;link.download='bake-preset.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),800);
    notify();
  };
  function properties(box,fields) {
    box.replaceChildren();
    for(const [key,value] of Object.entries(fields))box.append(node('dt',key),node('dd',String(value)));
  }
  function showMap() {
    const row=report?.maps[+el('result').value];
    el('image').hidden=!row;el('empty').hidden=!!row;el('download-map').hidden=!row;
    if(!row)return;
    el('image').src=base+(row.previewFile??row.file);
    el('image').alt=(names[row.map]??row.map)+' on '+row.target+' tile '+row.tileLabel;
    el('download-map').href=base+row.file;
    const output=row.output, number=n=>Number(n.toPrecision(6)).toString();
    const span=([lo,hi])=>number(lo)+' to '+number(hi);
    properties(el('details'),{'UV set':row.uvSet,'Grid':row.settings.size+' × '+row.settings.size,
      'Padding':row.settings.padding+' px','Surface coverage':(row.coverage*100).toFixed(1)+'%',
      ...(output&&{'Encoding':encodings.find(([key])=>key===output.encoding)?.[1]}),
      ...(output?.kind==='normal'&&{'Normal space':title(output.space)}),
      ...(output?.kind==='height'&&{'Height range':output.range?span(output.range):'Raw signed scene units',
        ...(output.measured&&{'Measured on tile':span([output.measured.min,output.measured.max])}),
        ...(output.range&&{'Clipped samples':output.clippedLow+output.clippedHigh})}),
      ...(row.settings.orientation&&{'Orientation':title(row.settings.orientation)}),
      ...(row.geometry&&{'Probe rays':row.geometry.rayCount.toLocaleString()}),
      ...(row.projection&&{'Projection':row.projection.mode==='self'?'Self-bake':row.projection.highMeshes.join(', '),
        'Hits':row.projection.hits.toLocaleString(),'Misses':row.projection.misses.toLocaleString(),
        'Backfaces':row.projection.backfaces.toLocaleString(),
        ...(row.projection.cageMesh&&{'Cage':row.projection.cageMesh})})});
  }
  function results() {
    const select=el('result');
    select.replaceChildren(...(report?.maps??[]).map((row,i)=>new Option((names[row.map]??row.map)+' · '+row.target+' · '+row.tileLabel,i)));
    select.disabled=!(report?.maps.length);
    showMap();
    el('report-link').hidden=!report;
    el('report-link').href=base+'report.json';
    el('refresh-wrap').hidden=!report?.refresh?.length;
    el('material').hidden=!report?.material;
    el('material').href=base+(report?.material??'material.material.json');
    const refresh=el('refresh');refresh.replaceChildren();
    for(const row of report?.refresh??[]) {
      const entry=node('div');entry.append(node('span',row.resource),node('span',title(row.storage)+' · '+title(row.status)));refresh.append(entry);
    }
  }
  function status(event,active,error) {
    const {completed=0,total=0}=event, progress=el('progress');
    progress.max=Math.max(1,total);progress.value=completed;
    const step=event.target?' · '+event.target+' · '+event.tile+' · '+(names[event.map]??event.map):'';
    el('status').textContent=title(event.event)+(total?' · '+completed+' / '+total:'')+step;
    el('run').disabled=active;el('cancel').disabled=!active;
    if(error)notify(error);
  }
  function update(state) {
    if(state.latest?.revision&&state.latest.revision!==revision) {
      revision=state.latest.revision;
      base='revisions/'+revision+'/';report=state.latest.report;results();
    }
    status(state.event,state.active,state.error);
  }
  async function command(body) {
    try {
      notify();
      const response=await fetch('/api/control',{method:'POST',headers:{'content-type':'application/json','x-ink-bake':token},body:JSON.stringify(body)});
      const state=await response.json();
      if(!response.ok)throw Error(state.error);
      update(state);
    } catch(error) {notify(error.message);}
  }
  el('result').onchange=showMap;
  fillDefaults();maps();targetControls();results();
  status(report?{event:'completed',completed:report.maps.length,total:report.maps.length}:{event:'idle'},false);
  if(token) {
    el('job-controls').hidden=false;
    el('run').onclick=()=>command({action:'run',preset:currentPreset(),targets});
    el('cancel').onclick=()=>command({action:'cancel'});
    const tick=async()=>{
      try {const result=await fetch('/api/state');update(await result.json());}catch{}
      setTimeout(tick,300);
    };
    tick();
  }
})();
