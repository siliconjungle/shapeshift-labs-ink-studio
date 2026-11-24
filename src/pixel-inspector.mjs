/** Cursor panel shared by the Workshop and self-contained pixel review. */
export function mountPixelInspector(root,view,read) {
  const make = (tag,text)=>Object.assign(document.createElement(tag),text === undefined ? {} : { textContent:text });
  const panel = make('details'), summary = make('summary','Inspect pixel');
  panel.className = 'pixel-inspection';
  const head = make('div'), output = make('output','Move over the native canvas');
  const pin = make('button','Pin pixel'), body = make('div');
  head.className = 'pixel-inspection-head';
  pin.type = 'button';
  pin.disabled = true;
  pin.setAttribute('aria-pressed','false');
  output.dataset.inspectionResult = '';
  body.className = 'pixel-inspection-body';
  head.append(output,pin);
  panel.append(summary,head,body);
  root.append(panel);
  let at, fixed = false;

  const showValue = value=>Array.isArray(value) ? value.map(showValue).join(', ') :
    typeof value === 'number' ? Number(value.toFixed(4)).toString() : String(value ?? '—');
  const percent = value=>Number.isFinite(value) ? Math.round(value*100)+'%' : '—';
  function group(title,rows) {
    if (!rows.length) return;
    const block = make('section'), heading = make('h3',title), list = make('ul');
    for (const row of rows) {
      const item = make('li',row.text);
      if (row.depth) item.style.marginInlineStart = Math.min(row.depth,8)*.8+'em';
      if (row.inactive) item.dataset.inactive = '';
      list.append(item);
    }
    block.append(heading,list);
    body.append(block);
  }

  function layerRows(layers,depth = 0) {
    return layers.slice().reverse().flatMap(row=>{
      const badge = row.contributes ? '' : row.status === 'paint' ? 'covered' : row.status.replaceAll('-',' ');
      const fields = [row.label,row.kind,row.cel,row.swatch && row.swatch.id+' '+row.swatch.color,
        row.sourceAlpha > 0 && 'source alpha '+row.sourceAlpha,
        row.effectiveAlpha !== undefined && 'effective alpha '+row.effectiveAlpha,
        row.clip && 'clip '+row.clip.layer+' '+row.clip.alpha,
        row.blend !== 'normal' && row.blend,row.destination && 'bound '+row.destination,row.locked && 'locked',badge].filter(Boolean);
      return [{ text:fields.join(' · '),depth,inactive:!row.contributes },...layerRows(row.children ?? [],depth+1)];
    });
  }

  function materialRows(materials,scene) {
    const rows = materials.map(channel=>{
      const value = channel.uv === null ? 'Outside source' : channel.value && typeof channel.value === 'object' ?
        'RGB '+showValue(channel.value.color)+' · '+percent(channel.value.coverage)+' coverage' :
        showValue(channel.value)+(channel.units && channel.value != null ? ' '+channel.units : '');
      return { text:[channel.requestedDestination ?? channel.destination,channel.object+'/'+channel.chart+'/'+channel.channel,
        channel.uv && 'UV '+showValue(channel.uv),value].filter(Boolean).join(' · ') };
    });
    for (const [key,value] of Object.entries(scene?.channels ?? {}))
      if (value !== null) rows.push({ text:key+' · '+showValue(value) });
    return rows;
  }

  function sceneRows(scene) {
    if (!scene) return [];
    const rows = [];
    if (scene.surface) {
      const hit = scene.surface;
      rows.push({ text:['Opaque hit',hit.kind,hit.object,hit.part,hit.material,
        'depth '+showValue(hit.depth),percent(hit.coverage)+' surface coverage',hit.uv && 'UV '+showValue(hit.uv),hit.splatId && 'splat '+hit.splatId].filter(Boolean).join(' · ') });
      for (const [label,value] of [['World position',hit.position],['Rest position',hit.restPosition],
        ['Geometric normal',hit.geometricNormal],['Shading normal',hit.shadingNormal]]) {
        if (value) rows.push({ text:label+' '+showValue(value),depth:1 });
      }
    }
    const geometry = scene.sources?.geometry;
    if (geometry?.kind === 'mesh') rows.push({ text:['Mesh source',geometry.asset,geometry.chart,
      geometry.triangle !== undefined && 'triangle '+geometry.triangle,
      geometry.barycentric && 'barycentric '+showValue(geometry.barycentric)].filter(Boolean).join(' · ') });
    if (geometry?.kind === 'sdf') rows.push({ text:['SDF source',geometry.entity ?? geometry.object,
      'local '+showValue(geometry.local)].filter(Boolean).join(' · ') });
    if (geometry?.kind === 'sprite') rows.push({ text:['Baked card source','frame '+geometry.frame,
      'local '+showValue(geometry.local)].join(' · ') });
    if (scene.frontStrand) rows.push({ text:['Front strand',scene.frontStrand.strand?.name ?? scene.frontStrand.id,
      'depth '+showValue(scene.frontStrand.depth),'coverage '+percent(scene.frontStrand.coverage)].join(' · ') });
    for (const hit of scene.fragments?.hits ?? []) rows.push({ text:[hit.kind,hit.object,hit.part,hit.material,
      hit.splatId && 'splat '+hit.splatId,'depth '+showValue(hit.depth),percent(hit.visibleCoverage)+' visible coverage'].filter(Boolean).join(' · ') });
    if (scene.fragments?.truncated) rows.push({ text:'Additional raster fragments omitted' });
    return rows.length ? rows : [{ text:'No captured surface or strand at this pixel' }];
  }

  function splatRows(sources) {
    if (!sources) return [];
    const { frontSplat,splats,truncated,omittedCoverage } = sources;
    const percentage = value => !Number.isFinite(value) ? '—' :
      value > 0 && value < .0001 ? '<0.01%' : showValue(Math.round(value*10_000)/100)+'%';
    const rows = splats.map(hit=>({ text:[
      hit === frontSplat && 'Frontmost',hit === splats[0] && 'Strongest contribution',
      hit.id ?? 'Unidentified splat',hit.object,hit.part,'depth '+showValue(hit.depth),
      percentage(hit.alpha)+' alpha',percentage(hit.visibleCoverage)+' visible coverage'
    ].filter(Boolean).join(' · ') }));
    if (truncated) rows.push({ text:omittedCoverage === null ? 'Additional splat contributions omitted' :
      percentage(omittedCoverage)+' additional splat coverage omitted' });
    return rows;
  }

  function issueRows(scene) {
    const rows = [];
    const problems = [...(scene?.diagnostics ?? []),...(scene?.bindings ?? []).flatMap(binding=>
      (binding.diagnostics ?? []).map(issue=>({ ...issue,binding:binding.id })))];
    const descriptions = {
      'unstable-splat-id':'A contributing splat has no stable source ID',
      'surface-address-unavailable':'The visible surface has no usable source address',
      'splat-contributors-unavailable':'The capture has no source IDs for the visible splat',
      'covered-pixel-without-source':'The pixel has coverage without a captured source',
      'hidden-source-without-confirmed-blocker':'The target projects here but the foreground blocker could not be confirmed',
      'binding-address-unavailable':'The bound target is visible here but has no usable source address'
    };
    for (const issue of problems) {
      let text = descriptions[issue.code];
      if (issue.kind === 'blocker') {
        const { blocker,targetDepth,partial } = issue;
        text = [partial ? 'Partly occluded' : 'Occluded',issue.binding,blocker.object ?? blocker.kind ?? 'Unidentified foreground',
          blocker.part,'depth '+showValue(blocker.depth),'target depth '+showValue(targetDepth)].filter(Boolean).join(' · ');
      }
      if (issue.kind === 'overlap') text = issue.count+' sources overlap';
      if (issue.code === 'contributors-omitted') text = 'Contributor coverage was omitted';
      if (text) rows.push({text});
    }
    return rows;
  }

  function refresh() {
    if (!panel.open) return;
    let result;
    try { result = at && read(at); }
    catch (error) {
      pin.disabled = true;
      output.value = error.message;
      body.replaceChildren();
      return;
    }
    body.replaceChildren();
    pin.disabled = !result;
    if (!result) { output.value = 'Move over the native canvas'; return; }
    const { composite,palette,layers = [],scene,materials = [],display,protection = [] } = result;
    const shown = display ?? composite;
    output.value = [at.join(', '),shown.layer,shown.color ?? 'Transparent','alpha '+shown.alpha].filter(Boolean).join(' · ');
    group('Layers',layerRows(layers));
    group('Protected details',protection.map(row=>({ text:[row.id,row.kind,
      row.frame ?? row.frames?.join(' to ') ?? 'All frames'].join(' · ') })));
    const colors = palette ? [{ text:[palette.method.replaceAll('-',' '),palette.swatch?.id,palette.swatch?.color,
      palette.color && 'output '+palette.color].filter(Boolean).join(' · ') }] : [];
    if (scene?.sourceView) {
      const { id,frame,camera,grid } = scene.sourceView;
      group('Source view',[
        { text:[scene.id,id,grid.join('×'),'time '+showValue(frame.time)+' s'].join(' · ') },
        { text:[camera.orthographic ? 'Orthographic' : 'Perspective','yaw '+showValue(camera.yaw),
          'pitch '+showValue(camera.pitch),'eye '+showValue(camera.eye)].join(' · ') }
      ]);
    }
    if (scene?.palette) colors.push({ text:['Scene',scene.palette.domain,scene.palette.stage,scene.palette.asset,
      scene.color && 'output '+scene.color].filter(Boolean).join(' · ') });
    for (const choice of scene?.paletteTrace?.decisions ?? []) {
      const dither = choice.dither;
      colors.push({ text:[choice.rule.stage ?? choice.rule.domain,choice.method,choice.inputColor,
        choice.swatch && '→ '+choice.swatch,dither && ('dither '+(dither.pattern ?? dither.mode ?? 'on'))].filter(Boolean).join(' · ') });
    }
    group('Palette',colors);
    group('Material channels',materialRows(materials,scene));
    group('Hit diagnostics',issueRows(scene));
    group('Scene hits',sceneRows(scene));
    group('Splat contributors',splatRows(scene?.sources));
    group('Scene bindings',(scene?.bindings ?? []).flatMap(row=>[
      { text:[row.id,row.status.replaceAll('-',' '),row.sourceAt && 'pixel '+showValue(row.sourceAt),
        ...(row.hits ?? []).map(hit=>hit.id ?? hit.entity ?? hit.object)].filter(Boolean).join(' · ') },
      ...(row.mapping?.points.map(hit=>({ text:[row.mapping.id,hit.kind,showValue(hit.point)].join(' · '),depth:1 })) ?? [])
    ]));
  }

  function setPinned(value) {
    fixed = value;
    pin.setAttribute('aria-pressed',String(fixed));
    pin.textContent = fixed ? 'Follow cursor' : 'Pin pixel';
  }
  pin.addEventListener('click',()=>setPinned(!fixed));
  panel.addEventListener('toggle',refresh);
  view.canvas.addEventListener('pointermove',event=>{
    if (!panel.open || fixed) return;
    const next = view.pixelAt(event.clientX,event.clientY,{ snap:false });
    if (!next || at && next[0] === at[0] && next[1] === at[1]) return;
    at = next;
    refresh();
  });
  return { get open() { return panel.open; },refresh,
    focus(coordinate) {
      at = coordinate;
      setPinned(true);
      panel.open = true;
      refresh();
    } };
}
