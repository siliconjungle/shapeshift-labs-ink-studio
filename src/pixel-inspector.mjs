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
        'depth '+showValue(hit.depth),hit.uv && 'UV '+showValue(hit.uv),hit.splatId && 'splat '+hit.splatId].filter(Boolean).join(' · ') });
    }
    if (scene.frontStrand) rows.push({ text:['Front strand',scene.frontStrand.strand?.name ?? scene.frontStrand.id,
      'depth '+showValue(scene.frontStrand.depth),'coverage '+percent(scene.frontStrand.coverage)].join(' · ') });
    for (const hit of scene.fragments?.hits ?? []) rows.push({ text:[hit.kind,hit.object,hit.part,hit.material,
      hit.splatId && 'splat '+hit.splatId,'depth '+showValue(hit.depth),percent(hit.visibleCoverage)+' visible coverage'].filter(Boolean).join(' · ') });
    if (scene.fragments?.truncated) rows.push({ text:'Additional raster fragments omitted' });
    return rows.length ? rows : [{ text:'No captured surface or strand at this pixel' }];
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
    const { composite,palette,layers,scene,materials = [],display,protection = [] } = result;
    const shown = display ?? composite;
    output.value = [at.join(', '),shown.layer,shown.color ?? 'Transparent','alpha '+shown.alpha].filter(Boolean).join(' · ');
    group('Layers',layerRows(layers));
    group('Protected details',protection.map(row=>({ text:[row.id,row.kind,
      row.frame ?? row.frames?.join(' to ') ?? 'All frames'].join(' · ') })));
    const colors = [{ text:[palette.method.replaceAll('-',' '),palette.swatch?.id,palette.swatch?.color,
      palette.color && 'output '+palette.color].filter(Boolean).join(' · ') }];
    if (scene?.palette) colors.push({ text:['Scene',scene.palette.domain,scene.palette.stage,scene.palette.asset,
      scene.color && 'output '+scene.color].filter(Boolean).join(' · ') });
    for (const choice of scene?.paletteTrace?.decisions ?? []) {
      const dither = choice.dither;
      colors.push({ text:[choice.rule.stage ?? choice.rule.domain,choice.method,choice.inputColor,
        choice.swatch && '→ '+choice.swatch,dither && ('dither '+(dither.pattern ?? dither.mode ?? 'on'))].filter(Boolean).join(' · ') });
    }
    group('Palette',colors);
    group('Material channels',materialRows(materials,scene));
    group('Scene hits',sceneRows(scene));
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
