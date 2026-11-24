/** Review an entire native animation or view sequence and jump to sampled evidence. */
export function mountPixelMotionPanel(host,{ showSample,clear }) {
  const make = (tag,text)=>Object.assign(document.createElement(tag),text === undefined ? {} : { textContent:text });
  const panel = make('details'), controls = make('div');
  panel.className = 'pixel-craft';
  controls.className = 'pixel-craft-controls';
  const filter = make('select'), label = make('label','Finding ');
  filter.dataset.motionKind = '';
  label.append(filter);
  const button = (value,key)=>{
    const control = make('button',value);
    control.type = 'button';
    control.dataset[key] = '';
    return control;
  };
  const previous = button('Previous finding','motionPrevious'), next = button('Next finding','motionNext');
  const jump = button('Show finding','motionJump');
  const evidence = make('select'), sampleLabel = make('label','Compare sample ');
  evidence.dataset.motionSample = '';
  sampleLabel.append(evidence);
  const status = make('output'), summary = make('p');
  status.dataset.motionResult = '';
  status.setAttribute('aria-live','polite');
  controls.append(label,previous,next,jump,sampleLabel);
  panel.append(make('summary','Motion checks'),controls,status,summary);
  host.append(panel);
  let report, source, sourceKey, stale = true, rows = [], index = 0, error;
  const titles = { highlight:'Highlight drift',cluster:'Unstable clusters',gap:'Lost gaps',flicker:'Flicker' };
  const current = ()=>rows[index];
  function refresh() {
    if (!panel.open || !stale || !source) return;
    const kind = filter.value;
    stale = false;
    error = undefined;
    try { report = source(); }
    catch (cause) { report = undefined; error = cause.message; }
    filter.replaceChildren(new Option('All findings',''),...Object.entries(titles).map(([key,text])=>
      new Option(text+' ('+(report?.counts[key]?.regions ?? 0)+')',key)));
    filter.value = kind;
    rebuild();
    const transitions = report?.transitions ?? [];
    const paired = transitions.filter(row=>!row.skipped).length;
    const skipped = new Map();
    for (const row of transitions) if (row.skipped) skipped.set(row.skipped,(skipped.get(row.skipped) ?? 0)+1);
    const accepted = Object.values(report?.counts ?? {}).reduce((n,row)=>n+row.acceptedPixels,0);
    summary.textContent = report ? [
      paired+' of '+transitions.length+' transitions compared',
      ...[...skipped].map(([reason,count])=>count+' '+reason.replaceAll('-',' ')),
      accepted && accepted+' accepted pixel observations',
      report.truncated && 'First 512 findings shown'
    ].filter(Boolean).join(' · ') : '';
  }

  function rebuild() {
    rows = (report?.findings ?? []).filter(row=>!filter.value || filter.value === row.kind);
    index = 0;
    show();
  }

  function show() {
    const finding = current();
    previous.disabled = index === 0;
    next.disabled = index+1 >= rows.length;
    jump.disabled = evidence.disabled = !finding;
    status.dataset.finding = finding?.id ?? '';
    status.value = error ?? (finding ? [
      (index+1)+' / '+rows.length,titles[finding.kind],finding.sample,
      finding.at.join(', '),finding.pixelCount+' px',finding.layers.join(', '),
      finding.drift && finding.drift.distance.toFixed(2)+' px drift'
    ].filter(Boolean).join(' · ') : 'No motion findings in this view');
    evidence.replaceChildren(...(finding?.evidence ?? []).map((row,i)=>new Option(
      row.sample+(row.at ? ' · '+row.at.join(', ')+' · '+row.rgba.join('/') : ''),String(i))));
    if (finding) evidence.selectedIndex = finding.evidence.findIndex(row=>row.sample === finding.sample);
  }

  function display() {
    const finding = current(), sample = finding?.evidence[evidence.selectedIndex];
    if (!sample?.at) return;
    const index = report.samples.findIndex(row=>row.id === sample.sample);
    const [x,y] = sample.at;
    showSample(index,sample.at,sample.sample === finding.sample ? finding : { bounds:[x,y,1,1],runs:[[y,x,1]] });
  }

  panel.addEventListener('toggle',()=>{ if (panel.open) refresh(); else clear?.(); });
  filter.addEventListener('change',()=>{ clear?.(); rebuild(); });
  previous.addEventListener('click',()=>{ index--; show(); display(); });
  next.addEventListener('click',()=>{ index++; show(); display(); });
  jump.addEventListener('click',display);
  evidence.addEventListener('change',display);
  return {
    setSource(key,read) {
      if (key === sourceKey) return;
      sourceKey = key;
      source = read;
      stale = true;
      clear?.();
      refresh();
    }
  };
}
