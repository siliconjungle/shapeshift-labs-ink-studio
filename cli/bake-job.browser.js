(() => {
  const el=id=>document.getElementById(id), title=s=>s.replaceAll('-',' ').replace(/^./,c=>c.toUpperCase());
  const names={pigment:'Pigment',normal:'Normal','world-normal':'World normal',height:'Height',roughness:'Roughness',metalness:'Metalness',emission:'Emission',
    opacity:'Opacity',coverage:'Coverage',slope:'Slope',cavity:'Cavity',exposure:'Exposure',thickness:'Thickness',
    'thickness-valid':'Thickness validity','cage-hit':'Projection hits','cage-miss':'Projection misses',
    'cage-backface':'Projection backfaces','cage-distance':'Projection distance','cage-relief':'Signed projection relief',
    ao:'Ambient occlusion','ao-contact':'Contact AO','ao-directional':'Directional AO',
    'bent-normal':'Bent normal','occlusion-direction':'Occlusion direction',
    curvature:'Signed curvature','curvature-convex':'Convex curvature','curvature-concave':'Concave curvature',
    'position-object':'Object position','position-world':'World position','position-normalized':'Normalized position',
    'vertex-id':'Vertex ID','material-id':'Material ID','part-id':'Part ID','texture-transfer':'Texture channel','uv-outline':'UV outlines'};
  const geometry=['slope','cavity','exposure','thickness','thickness-valid'];
  const occlusionMaps=['ao','ao-contact','ao-directional','bent-normal','occlusion-direction'];
  const curvatureMaps=['curvature','curvature-convex','curvature-concave'];
  const transferMaps=['pigment','emission','opacity','roughness','metalness','texture-transfer'];
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
  function occlusionControls(row,extra) {
    const options=row.overrides, contact=row.id==='ao-contact', directional=row.id==='ao-directional';
    const controls=node('div');controls.className='map-controls';extra.append(controls);
    const values=[
      ['rays','Ray count',{min:4,max:128,step:1,placeholder:contact?24:32}],
      ['spread','Half-cone spread (°)',{min:0,max:90,step:'any',placeholder:directional?45:contact?75:90}],
      ['range','Range (scene units)',{min:0,step:'any',placeholder:contact?'12% of bounds':'Receiver diagonal'}],
      ['bias','Ray bias',{min:0,step:'any',placeholder:'Automatic'}]
    ];
    for(const [key,label,settings] of values)
      controls.append(field(label,numeric(label,options[key],value=>put(options,key,value),settings)));
    controls.append(field('Falloff',selected([['none','None'],['linear','Linear'],['smooth','Smooth']],
      options.falloff??(contact?'smooth':'none'),value=>{options.falloff=value;})));
    controls.append(field('Self-occlusion',selected([['all','Own mesh and neighbors'],['only','Own mesh only'],['exclude','Neighbors only']],
      options.selfOcclusion??'all',value=>{options.selfOcclusion=value;})));
    const dir=node('input');
    dir.value=options.direction?.join(', ')??'';
    dir.placeholder=directional?'0, 1, 0':'Surface normal';
    dir.oninput=()=>put(options,'direction',dir.value.trim()?dir.value.split(',').map(value=>value.trim()?Number(value):NaN):undefined);
    controls.append(field('Scene direction (XYZ)',dir));
    const encoding=options.encoding??(row.id==='bent-normal'?'png16':row.id==='occlusion-direction'?'exr':'png8');
    controls.append(field('Encoding',selected(encodings,encoding,value=>{options.encoding=value;})));
  }
  function thicknessControls(row,extra) {
    const options=row.overrides, controls=node('div');
    controls.className='map-controls';
    extra.append(controls);
    function draw() {
      const direction=options.thicknessDirection??'geometric';
      controls.replaceChildren(field('Search range',numeric('Thickness search range',options.thicknessRange,
        n=>put(options,'thicknessRange',n),{min:0,step:'any',placeholder:'Mesh diagonal'})));
      controls.append(field('Ray direction',selected([
        ['geometric','Inward geometric normal'],['shading','Inward shading normal'],['axis','Fixed axis']
      ],direction,value=>{
        options.thicknessDirection=value;
        if(value==='axis')options.thicknessAxis??=[0,0,1];else delete options.thicknessAxis;
        draw();
      })));
      if(direction==='axis') {
        const axis=node('input');
        axis.value=(Array.isArray(options.thicknessAxis)?options.thicknessAxis:[0,0,1]).join(', ');
        axis.oninput=()=>{options.thicknessAxis=axis.value.split(',').map(value=>value.trim()?Number(value):NaN);};
        controls.append(field('Fixed axis (XYZ)',axis));
      }
      if(row.id==='thickness')controls.append(field('Encoding',selected(encodings,options.encoding??'png8',
        value=>{options.encoding=value;})));
    }
    draw();
  }
  function curvatureControls(row,extra) {
    const inputs=bakeJob.normalInputs??[], options=row.overrides, controls=node('div');
    controls.className='map-controls';
    extra.append(controls);
    function draw() {
      const source=options.curvatureSource??'mesh', normal=source==='normal';
      const encoding=options.encoding??'png16', normalMode=options.normalization??(encoding==='exr'?'none':'auto');
      const sources=[['mesh','Mesh geometry'],['normal','Normal input']];
      controls.replaceChildren(field('Curvature source',selected(inputs.length||normal?sources:sources.slice(0,1),source,value=>{
        options.curvatureSource=value;delete options.curvatureScale;delete options.edgePolicy;
        if(value==='normal')options.normalInput=inputs[0];else delete options.normalInput;
        draw();
      })));
      if(normal)controls.append(field('Normal input',selected(inputs.map(id=>[id,id]),options.normalInput,
        value=>{options.normalInput=value;})));
      const scaleLabel=normal?'Sample stride (texels)':'Smoothing length (mesh units)';
      controls.append(field(scaleLabel,numeric(scaleLabel,options.curvatureScale,
        value=>put(options,'curvatureScale',value),normal?{min:1,max:32,step:1,placeholder:1}:{min:0,step:'any',placeholder:0})));
      const policies=normal?[['one-sided','One-sided at chart edges'],['strict','Full stencil only']]:
        [['surface','Weld the physical surface'],['chart','Keep UV chart boundaries']];
      controls.append(field('Edge policy',selected(policies,options.edgePolicy??policies[0][0],value=>{options.edgePolicy=value;})));
      controls.append(field('Encoding',selected(encodings,encoding,value=>{
        options.encoding=value;
        if(value!=='exr'&&options.normalization==='none')delete options.normalization;
        draw();
      })));
      const modes=[['auto','Fit target magnitude'],['manual','Manual magnitude']];
      if(encoding==='exr')modes.push(['none','Raw inverse units']);
      controls.append(field('Curvature normalization',selected(modes,normalMode,value=>{
        options.normalization=value;
        if(value==='manual')options.curvatureRange??=1;else delete options.curvatureRange;
        draw();
      })));
      if(normalMode==='manual')controls.append(field('Magnitude limit',numeric('Curvature magnitude limit',options.curvatureRange,
        value=>put(options,'curvatureRange',value),{min:0,step:'any'})));
    }
    draw();
  }
  function transferControls(row,extra) {
    const inputs=bakeJob.textureInputs??[], options=row.overrides, controls=node('div');
    const color=['pigment','emission'].includes(row.id), alpha=color||row.id==='opacity', generic=row.id==='texture-transfer';
    controls.className='map-controls';
    extra.append(controls);
    function draw() {
      controls.replaceChildren();
      const linked=options.textureInput;
      if(inputs.length||linked||generic) {
        const values=[['',generic?'Choose a texture':'Authored material'],...inputs.map(id=>[id,id])];
        if(linked&&!inputs.includes(linked))values.push([linked,linked+' (missing)']);
        controls.append(field('Texture source',selected(values,linked??'',value=>{
          put(options,'textureInput',value);
          if(!value)for(const key of ['sourceUV','sourceChannel','sourcePrecision','sourceColorSpace','sourceAlpha','filter','address'])
            delete options[key];
          if(!value&&generic)delete options.encoding;
          draw();
        })));
      }
      if(generic&&!linked)return;
      function choice(label,key,values,fallback,redraw=false) {
        controls.append(field(label,selected(values,options[key]??fallback,value=>{
          put(options,key,value===fallback?undefined:value);
          if(key==='alphaPolicy'&&value!=='cutout')delete options.alphaCutoff;
          if(redraw)draw();
        })));
      }
      const outputs=linked?encodings:[['','Default PNG'],...encodings];
      choice('Encoding','encoding',outputs,linked?'png16':'');
      if(linked) {
        controls.append(field('Source UV set',numeric('Source UV set',options.sourceUV,
          n=>put(options,'sourceUV',n),{min:0,max:31,step:1,placeholder:0})));
        choice('Source precision','sourcePrecision',[['native','Detect native precision'],['unorm8','8-bit integer'],
          ['unorm16','16-bit integer'],['float16','16-bit float'],['float32','32-bit float']],'native');
        choice('Filtering','filter',[['linear','Bilinear'],['nearest','Nearest']],'linear');
        choice('Source addressing','address',[['clamp','Clamp'],['wrap','Wrap'],['mirror','Mirror']],'clamp');
        if(color) {
          choice('Source color space','sourceColorSpace',[['auto','Detect color space'],['srgb','sRGB'],['srgb-linear','Linear sRGB']],'auto');
          choice('Source alpha','sourceAlpha',[['auto','Use file setting'],['straight','Straight'],['premultiplied','Premultiplied']],'auto');
        } else choice('Source channel','sourceChannel',[['r','Red / grayscale'],['g','Green'],['b','Blue'],['a','Alpha']],
          row.id==='opacity'?'a':'r');
      }
      if(alpha) {
        choice('Alpha policy','alphaPolicy',[['preserve','Preserve'],['ignore','Ignore'],['cutout','Threshold']],'preserve',true);
        if(options.alphaPolicy==='cutout')
          controls.append(field('Alpha cutoff',numeric('Alpha cutoff',options.alphaCutoff,n=>put(options,'alphaCutoff',n),
            {min:0,max:1,step:'any',placeholder:.5})));
      }
    }
    draw();
  }
  function outputControls(row,extra) {
    const options=row.overrides, pane=node('div');
    pane.className='map-controls';
    extra.append(pane);
    const formats={png:['unorm8','unorm16'],tiff:['unorm8','unorm16','float32'],exr:['float16','float32']};
    const titles={unorm8:'8-bit integer',unorm16:'16-bit integer',float16:'16-bit float',float32:'32-bit float'};
    const outline=row.id==='uv-outline', category=row.id.endsWith('-id')||['thickness-valid','cage-hit','cage-miss','cage-backface'].includes(row.id);
    const defaultFormat=()=>options.encoding==='exr'||!options.encoding&&(/^(position-|.*-id$)/.test(row.id)||row.id==='occlusion-direction')?'exr':'png';
    function draw() {
      const size=options.size??preset.defaults.size??128;
      pane.replaceChildren(...['width','height'].map(key=>{
        const name='Output '+key;
        return field(name,numeric(name,options[key],value=>put(options,key,value),
          {min:8,max:1024,step:1,placeholder:preset.defaults[key]??size}));
      }));
      if(outline)return;
      function choice(label,key,values,value,change) {
        pane.append(field(label,selected(values,value,value=>{put(options,key,value);change?.(value);})));
      }
      choice('Output format','format',[['','Map default'],['png','PNG'],['tiff','TIFF'],['exr','OpenEXR']],options.format??'',()=>{
        if(!formats[options.format??defaultFormat()].includes(options.precision))delete options.precision;
        draw();
      });
      const compatible=formats[options.format??defaultFormat()].filter(precision=>row.id.endsWith('-id')?
        precision==='float32':/position-(object|world)$/.test(row.id)?precision.startsWith('float'):true);
      choice('Output precision','precision',[['','Map default'],...compatible.map(id=>[id,titles[id]])],options.precision??'');
      choice('Antialiasing','antialiasing',[['','Map default'],['1','1 × 1'],['2','2 × 2'],['4','4 × 4']],
        options.antialiasing??'',value=>put(options,'antialiasing',value?+value:undefined));
      choice('Gutters','gutters',[['','Map default'],['copy','Copy samples'],['transparent','Keep alpha clear'],['empty','Reserve only']],
        options.gutters??'',value=>{
          if(value==='empty'){delete options.dilation;delete options.diffusion;}
          draw();
        });
      if(options.gutters!=='empty') {
        pane.append(field('Dilation',numeric('Dilation',options.dilation,value=>put(options,'dilation',value),
          {min:0,max:32,step:1,placeholder:options.padding??preset.defaults.padding??3})));
        if(!category)pane.append(field('Diffusion passes',numeric('Diffusion passes',options.diffusion,value=>put(options,'diffusion',value),
          {min:0,max:16,step:1,placeholder:0})));
      }
      choice('Mip levels','mipmaps',[['','None'],...Array.from({length:10},(_,i)=>[i+1,String(i+1)]),['full','Full chain']],
        options.mipmaps||'',value=>put(options,'mipmaps',value&&value!=='full'?+value:value));
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
      if(occlusionMaps.includes(row.id))occlusionControls(row,extra);
      if(['thickness','thickness-valid'].includes(row.id))thicknessControls(row,extra);
      if(curvatureMaps.includes(row.id))curvatureControls(row,extra);
      if(transferMaps.includes(row.id))transferControls(row,extra);
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
      outputControls(row,extra);
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
        row.mesh=+value;delete row.submeshes;delete row.slots;delete row.thicknessParts;delete row.positionNode;row.uvSet=0;targetControls();
      })));
      const sets=[...new Set(mesh.submeshes.flatMap(p=>p.uvSets))].sort((a,b)=>a-b);
      grid.append(field('UV set',selected(sets.map(set=>[set,'TEXCOORD_'+set]),row.uvSet,value=>{row.uvSet=+value;})));
      const placements=mesh.placements??[];
      if(placements.length>1) {
        const chosen=placements.find(({index,name})=>row.positionNode===index||row.positionNode===name)?.index;
        grid.append(field('World position node',selected([['','Choose a node'],
          ...placements.map(({index,name})=>[index,index+' · '+name])],chosen??'',value=>{
          put(row,'positionNode',value===''?undefined:+value);
        })));
      }
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
      const parts=node('details'), partList=node('div');
      partList.className='form';
      for(const primitive of mesh.submeshes) {
        const input=node('input');input.placeholder='Shared shell group';input.maxLength=140;
        input.value=row.thicknessParts?.[primitive.index]??'';
        input.oninput=()=>put(row.thicknessParts??={},primitive.index,input.value.trim());
        partList.append(field(primitive.index+' · '+primitive.slot,input));
      }
      parts.append(node('summary','Thickness part labels'),partList);
      detail.append(parts);
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
  function uvOverlays(row,debug) {
    el('map-frame').hidden=!row;
    el('uv-controls').hidden=!row;
    el('uv-downloads').hidden=!debug;
    el('uv-border').hidden=!row||!el('show-uv-bounds').checked;
    const ownership=el('show-uv-ownership'), outlines=el('show-uv-outlines');
    ownership.disabled=outlines.disabled=!debug;
    el('uv-ownership').hidden=!debug||!ownership.checked;
    el('uv-outlines').hidden=!debug||!outlines.checked;
    el('uv-legend').hidden=!debug||!ownership.checked;
    const tiles=el('uv-tiles');
    tiles.replaceChildren();
    const related=row?report.maps.flatMap((other,index)=>other.map===row.map&&other.target===row.target?[[other,index]]:[]):[];
    tiles.hidden=related.length<2;
    if(related.length>1)for(const [other,index] of related) {
      const item=button('Tile '+other.tileLabel,()=>{el('result').value=String(index);showMap();});
      item.setAttribute('aria-pressed',String(other===row));
      tiles.append(item);
    }
    if(row) {
      const [u,v]=row.tile;
      el('uv-tile-name').textContent='Tile '+row.tileLabel;
      el('uv-tile-axes').textContent='U '+u+' to '+(u+1)+' · V '+v+' to '+(v+1);
    }
    if(!debug)return;
    const {files}=debug;
    for(const [id,file] of [['uv-ownership',files.ownership],['uv-outlines',files.outline]]) {
      const image=el(id), src=base+file;
      if(image.getAttribute('src')!==src)image.src=src;
    }
    for(const [id,file] of [['uv-outline-png',files.outline],['uv-outline-svg',files.outlineSvg],
      ['uv-coverage-png',files.coverage],['uv-coverage-svg',files.coverageSvg],['uv-ownership-png',files.ownership]])
      el(id).href=base+file;
    const swatches=el('uv-swatches');
    swatches.replaceChildren();
    if(ownership.checked) {
      function swatch(color,text) {
        const item=node('li'), chip=node('span');
        chip.style.backgroundColor=color;
        item.append(chip,node('span',text));swatches.append(item);
      }
      for(const {id,color,texels,gutter} of debug.palette)
        swatch(color,'Chart '+id+' · '+texels.toLocaleString()+' surface · '+gutter.toLocaleString()+' gutter');
      if(debug.overlaps)swatch('#ff4d75','Overlapping interiors · '+debug.overlaps.toLocaleString()+' texels');
    }
  }
  function showMap() {
    const row=report?.maps[+el('result').value], mip=el('mip-level'), key=row&&base+row.file;
    if(mip.dataset.map!==String(key)) {
      mip.dataset.map=String(key);
      mip.replaceChildren(new Option('Base level','0'),...(row?.mips??[]).map(item=>
        new Option('Mip '+item.level+' · '+item.width+' × '+item.height,item.level)));
      mip.value='0';
    }
    el('mip-control').hidden=!row?.mips?.length;
    const level=Number(mip.value), shown=level?row.mips[level-1]:row;
    el('image').hidden=!row;el('empty').hidden=!!row;el('download-map').hidden=!row;
    el('download-validity').hidden=!shown?.validityFile;
    const debug=level?undefined:report?.uvDebug?.[row?.uvDebug];
    uvOverlays(row,debug);
    if(!row)return;
    el('map-frame').style.setProperty('--map-aspect',(shown.width??row.settings.size)/(shown.height??row.settings.size));
    el('image').src=base+(shown.previewFile??shown.file);
    el('image').alt=(names[row.map]??row.map)+' on '+row.target+' tile '+row.tileLabel;
    el('download-map').href=base+shown.file;
    el('download-validity').href=base+(shown.validityFile??'');
    const delivery=row.settings.delivery;
    const output=row.output, number=n=>Number(n.toPrecision(6)).toString();
    const span=([lo,hi])=>number(lo)+' to '+number(hi);
    if(output?.kind==='id') {
      for(const row of output.palette) {
        const chip=node('span');chip.style.backgroundColor=row.color;
        const label=row.label??('Vertex '+row.vertex+' · primitive '+row.part);
        const item=node('li');item.append(chip,node('span',row.id+' · '+label));el('id-swatches').append(item);
      }
      legend.hidden=!output.palette.length;
    }
    const thickness=row.settings.thickness&&row.geometry?.thickness;
    const reasons={open:'Open',nonManifold:'Non-manifold',winding:'Winding',degenerate:'Zero volume',
      grazing:'Grazing ray',rangeMiss:'Out of range',bias:'Within bias',part:'Other part',shell:'Other shell',
      ambiguous:'Coincident exits',orientation:'Wrong exit orientation'};
    const rejected=thickness&&Object.entries(thickness.rejected).filter(([,n])=>n)
      .map(([key,n])=>reasons[key]+' '+n.toLocaleString()).join(' · ');
    properties(el('details'),{'UV set':row.uvSet,'Grid':(shown.width??row.settings.size)+' × '+(shown.height??row.settings.size),
      'Padding':row.settings.padding+' px','Surface coverage':(row.coverage*100).toFixed(1)+'%',
      ...(debug&&{'UV charts':debug.charts,'Gutter texels':debug.gutters.toLocaleString(),
        'Overlap texels':debug.overlaps.toLocaleString()}),
      ...(output&&{'Encoding':delivery?delivery.format.toUpperCase()+' · '+output.bitDepth+'-bit':
        encodings.find(([key])=>key===output.encoding)?.[1]}),
      ...(delivery&&{'Antialiasing':delivery.antialiasing+' × '+delivery.antialiasing,
        'Dilation':delivery.dilation+' px','Diffusion':delivery.diffusion,'Gutters':title(delivery.gutters),
        ...(row.mips?.length&&{'Mip levels':row.mips.length})}),
      ...(output?.kind==='normal'&&{'Normal space':title(output.space)}),
      ...(output?.kind==='direction'&&{'Direction space':'World XYZ'}),
      ...(output?.kind==='position'&&{'Position space':title(output.space)+' XYZ',
        ...(output.node&&{'Placed at':output.node.name+' · node '+output.node.index}),
        'Bounds min':output.bounds.min.map(number).join(', '),'Bounds max':output.bounds.max.map(number).join(', ')}),
      ...(output?.kind==='id'&&{'Identity':title(output.identity),'IDs on tile':output.distinct.toLocaleString(),
        ...(output.distinct>output.palette.length&&{'Swatches shown':output.palette.length})}),
      ...(output?.kind==='height'&&{'Height range':output.range?span(output.range):'Raw signed scene units',
        ...(output.measured&&{'Measured on tile':span([output.measured.min,output.measured.max])}),
        ...(output.range&&{'Clipped samples':output.clippedLow+output.clippedHigh})}),
      ...(thickness&&{'Search range':number(thickness.range),'Thickness rays':title(thickness.direction),
        'Valid samples':thickness.valid.toLocaleString(),'Unknown samples':thickness.unknown.toLocaleString(),
        ...(rejected&&{'Unknown reasons':rejected}),
        ...(thickness.valid&&{'Measured thickness':span([thickness.min,thickness.max])}),
        ...(output?.kind==='thickness'&&{'Encoding range':output.range?span(output.range):'Raw physical distance',
          'Clipped samples':output.clipped})}),
      ...(row.settings.orientation&&{'Orientation':title(row.settings.orientation)}),
      ...(row.geometry&&{'Probe rays':row.geometry.rayCount.toLocaleString()}),
      ...(row.occlusion&&{'Occlusion rays':row.occlusion.rayCount.toLocaleString(),
        'Blocked rays':row.occlusion.blockedRays.toLocaleString(),
        'Spread':row.occlusion.spread+'°','Range':number(row.occlusion.range),'Falloff':title(row.occlusion.falloff),
        'Occluders':({all:'Own mesh and neighbors',only:'Own mesh only',exclude:'Neighbors only'})[row.occlusion.selfOcclusion],
        ...(row.occlusion.direction&&{'Scene direction':row.occlusion.direction.map(number).join(', ')})}),
      ...(row.curvature&&{'Source':row.curvature.normalInput??'Mesh geometry','Edge policy':title(row.curvature.edgePolicy),
        'Measured samples':row.curvature.measured.toLocaleString(),'Unknown samples':row.curvature.unknown.toLocaleString(),
        'Encoding range':output.range?span(output.range):'Raw inverse units','Clipped samples':output.clipped,
        ...(row.curvature.measured&&{'Signed extrema':span([row.curvature.signedMin,row.curvature.signedMax])})}),
      ...(row.textureTransfer&&{'Texture source':row.textureTransfer.input==='material'?'Authored material':row.textureTransfer.input,
        ...(row.textureTransfer.uvSet!==undefined&&{'Source UV set':'TEXCOORD_'+row.textureTransfer.uvSet}),
        ...(row.textureTransfer.sources.length&&{'Source precision':[...new Set(row.textureTransfer.sources.map(row=>row.precision))].join(' · ')}),
        ...(row.textureTransfer.sources.some(row=>row.alpha)&&{'Source alpha':[
          ...new Set(row.textureTransfer.sources.filter(row=>row.alpha).map(row=>title(row.alpha)))].join(' · ')}),
        ...(row.textureTransfer.channel&&{'Source channel':row.textureTransfer.channel.toUpperCase()}),
        ...(row.textureTransfer.range&&{'Sample range':span(row.textureTransfer.range)}),
        ...(row.textureTransfer.alphaPolicy&&{'Alpha policy':title(row.textureTransfer.alphaPolicy),
          ...(row.textureTransfer.alphaCutoff!==undefined&&{'Alpha cutoff':number(row.textureTransfer.alphaCutoff)})}),
        ...(row.textureTransfer.clipped&&{'Clipped samples':row.textureTransfer.clipped.toLocaleString()})}),
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
  el('result').onchange=showMap;el('mip-level').onchange=showMap;
  for(const id of ['show-uv-outlines','show-uv-ownership','show-uv-bounds'])el(id).onchange=showMap;
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
