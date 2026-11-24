/** Navigate committed pixel-art findings without changing the artwork. */
export function mountPixelCraftPanel(host,view,kinds,{ inspect,select } = {}) {
  const make = (tag,text)=>Object.assign(document.createElement(tag),text === undefined ? {} : { textContent:text });
  const panel = make('details'), summary = make('summary','Craft diagnostics');
  panel.className = 'pixel-craft';
  const controls = make('div'), filter = make('select'), include = make('input'), accept = make('input');
  const kindLabel = make('label','Finding '), protectedLabel = make('label'), output = make('output'), hint = make('p');
  controls.className = 'pixel-craft-controls';
  filter.dataset.diagnosticKind = '';
  output.dataset.diagnosticResult = '';
  output.setAttribute('aria-live','polite');
  include.type = accept.type = 'checkbox';
  const acceptedLabel = make('label');
  acceptedLabel.hidden = true;
  accept.dataset.diagnosticAccepted = '';
  acceptedLabel.append(accept,document.createTextNode(' Include accepted'));
  include.dataset.diagnosticProtected = '';
  kindLabel.append(filter);
  protectedLabel.append(include,document.createTextNode(' Include protected'));
  const button = (text,key)=>{
    const control = make('button',text);
    control.type = 'button';
    control.dataset[key] = '';
    return control;
  };
  const previous = button('Previous','diagnosticPrevious'), next = button('Next','diagnosticNext');
  const jump = button('Jump to finding','diagnosticJump');
  const selectPixels = select && button('Select unprotected pixels','diagnosticSelect');
  controls.append(kindLabel,protectedLabel,acceptedLabel,previous,next,jump);
  if (selectPixels) controls.append(selectPixels);
  panel.append(summary,controls,output,hint);
  host.append(panel);

  let source, sourceKey, diagnostics = [], visible = [], index = 0, highlighted, error;
  let stale = true;
  const current = ()=>visible[index];
  function show() {
    const finding = current();
    previous.disabled = !finding || index === 0;
    next.disabled = !finding || index+1 >= visible.length;
    jump.disabled = !finding;
    if (selectPixels) selectPixels.disabled = !finding || !!finding.exception || finding.protectedCount === finding.pixelCount;
    output.dataset.finding = finding?.id ?? '';
    output.value = error ?? (finding ? [
      (index+1)+' / '+visible.length,kinds[finding.kind].label,'X '+finding.at[0]+' · Y '+finding.at[1],
      finding.pixelCount+(finding.pixelCount === 1 ? ' pixel' : ' pixels'),
      finding.protectedCount && finding.protectedCount+' protected',finding.layers.join(', '),finding.exception && 'Accepted · '+finding.exception.id
    ].filter(Boolean).join(' · ') : 'No findings in this view');
    hint.textContent = finding ? finding.exception?.reason ?? kinds[finding.kind].hint : '';
  }

  const eligible = row=>row.exception ? accept.checked : include.checked || row.protectedCount < row.pixelCount;
  function rebuild(id) {
    acceptedLabel.hidden = !diagnostics.some(row=>row.exception);
    const counts = new Map();
    for (const row of diagnostics) if (eligible(row)) counts.set(row.kind,(counts.get(row.kind) ?? 0)+1);
    const category = filter.value;
    filter.replaceChildren(new Option('All findings',''),...Object.entries(kinds).map(([kind,{ label }])=>
      new Option(label+' ('+(counts.get(kind) ?? 0)+')',kind)));
    filter.value = category;
    visible = diagnostics.filter(row=>eligible(row) && (!category || row.kind === category));
    const match = id ? visible.findIndex(row=>row.id === id) : -1;
    index = match < 0 ? 0 : match;
    const finding = current();
    if (highlighted && finding?.id !== highlighted) highlighted = undefined;
    view.setDiagnostic(highlighted ? finding : null);
    show();
  }

  function refresh() {
    if (!panel.open || !stale || !source) return;
    const id = current()?.id;
    stale = false;
    error = undefined;
    try { diagnostics = source(); }
    catch (cause) { diagnostics = []; error = cause.message; }
    rebuild(id);
  }

  function focus() {
    const finding = current();
    if (!finding) return;
    highlighted = finding.id;
    view.setDiagnostic(finding);
    view.focusRegion(finding.bounds);
    inspect?.(finding.at);
    show();
  }

  panel.addEventListener('toggle',()=>{
    if (panel.open) {
      refresh();
      if (highlighted) view.setDiagnostic(current());
    } else {
      highlighted = undefined;
      view.setDiagnostic(null);
    }
  });
  filter.addEventListener('change',()=>rebuild());
  include.addEventListener('change',()=>rebuild(current()?.id));
  accept.addEventListener('change',()=>rebuild(current()?.id));
  previous.addEventListener('click',()=>{ index--; focus(); });
  next.addEventListener('click',()=>{ index++; focus(); });
  jump.addEventListener('click',focus);
  selectPixels?.addEventListener('click',()=>{
    focus();
    select(current());
  });

  return {
    setSource(key,read) {
      if (sourceKey === key) return;
      sourceKey = key;
      source = read;
      stale = true;
      refresh();
    }
  };
}
