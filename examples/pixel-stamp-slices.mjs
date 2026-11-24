export function mountSliceEditor(host,{ PixelSlices,view,commit,preparePick,notify }) {
  const field = name=>host.querySelector('#slice-'+name), form = field('form'), menu = field('list');
  const canvas = view.canvas, viewport = canvas.closest('.ink-grid-viewport');
  const names = { bounds:['x','y','width','height'],pivot:['pivot-x','pivot-y'],
    nineSlice:['left','top','right','bottom'] };
  const modes = { bounds:field('draw'),pivot:field('pick-pivot'),nineSlice:field('draw-stretch') };
  let source, selected, active = [], dirty = false, mode, gesture;

  function read(name) { return names[name].map(key=>field(key).valueAsNumber); }
  function write(name,values) { names[name].forEach((key,i)=>{ field(key).value = values[i]; }); }
  function key() {
    return { bounds:read('bounds'),...(field('use-pivot').checked && { pivot:read('pivot') }),
      ...(field('use-nine').checked && { nineSlice:read('nineSlice') }) };
  }

  function pickMode(next) {
    mode = next;
    for (const [name,button] of Object.entries(modes)) button.setAttribute('aria-pressed',name === mode);
    canvas.closest('.ink-grid-canvas').toggleAttribute('data-slice-pick',!!mode);
  }

  function setFields(row) {
    write('bounds',row?.bounds ?? [0,0,source.width,source.height]);
    write('pivot',row?.pivot ?? [0,0]);
    write('nineSlice',row?.nineSlice ?? [0,0,0,0]);
    field('use-pivot').checked = !!row?.pivot;
    field('use-nine').checked = !!row?.nineSlice;
  }

  function draw() {
    if (!source) return;
    field('pivot-fields').hidden = !field('use-pivot').checked;
    field('nine-fields').hidden = !field('use-nine').checked;
    const frame = source.ids[source.index], current = active.find(row=>row.id === selected?.id);
    const explicit = selected?.keys.some(row=>row.frame === frame);
    field('remove-key').disabled = !explicit;
    field('remove').disabled = !selected;
    let status = explicit ? 'Key on '+frame : current ? 'Inherited from '+current.keyFrame : '';
    let rows = active, highlight = host.open ? current?.id : undefined;
    if (host.open && dirty) {
      const id = selected?.id ?? 'slice-draft', provisional = 'draft-frame';
      const draft = [{ id,keys:[{ frame:provisional,...key() }] }];
      try {
        PixelSlices.prepare(draft,[provisional],source.width,source.height);
        const [preview] = PixelSlices.active(draft,[provisional],0), label = field('label').value.trim();
        rows = [...active.filter(row=>row.id !== id),{ ...preview,label:label || field('id').value.trim() || 'New slice' }];
        highlight = id;
        status = 'Unsaved frame key';
      } catch (error) { status = error.message; }
    }
    field('key-status').value = mode ? ({bounds:'Drag the slice bounds',pivot:'Click the pivot',nineSlice:'Drag the stretch area'})[mode] : status;
    view.setSlices(rows,highlight);
  }

  function cancelPick() {
    if (gesture) {
      setFields(gesture.before);
      dirty = gesture.wasDirty;
      gesture = undefined;
    }
    if (mode) {
      pickMode();
      draw();
    }
  }

  function select(id) {
    cancelPick();
    selected = source.rows?.find(row=>row.id === id);
    menu.value = selected?.id ?? '';
    field('id').value = selected?.id ?? '';
    field('id').readOnly = !!selected;
    field('label').value = selected?.label ?? '';
    setFields(active.find(row=>row.id === selected?.id));
    dirty = false;
    draw();
  }

  for (const [kind,button] of Object.entries(modes)) button.addEventListener('click',()=>{
    if (mode === kind) { cancelPick(); return; }
    if (!preparePick()) return;
    cancelPick();
    const [x,y,w,h] = read('bounds');
    if (kind !== 'bounds' && (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 ||
        w < 1 || h < 1 || x+w > source.width || y+h > source.height)) {
      notify('Set valid slice bounds first');
      return;
    }
    pickMode(kind);
    viewport.focus();
    draw();
  });

  function applyPoint(point) {
    const { start,before } = gesture, [x,y,w,h] = before.bounds;
    if (mode === 'pivot') {
      field('use-pivot').checked = true;
      write('pivot',[point[0]-x,point[1]-y]);
    } else {
      const inside = xy=>xy.map((n,i)=>Math.max([x,y][i],Math.min(n,[x+w-1,y+h-1][i])));
      const [a,b] = mode === 'nineSlice' ? [inside(start),inside(point)] : [start,point];
      const l = Math.min(a[0],b[0]), t = Math.min(a[1],b[1]), r = Math.max(a[0],b[0])+1, d = Math.max(a[1],b[1])+1;
      if (mode === 'bounds') write('bounds',[l,t,r-l,d-t]);
      else {
        field('use-nine').checked = true;
        write('nineSlice',[l-x,t-y,x+w-r,y+h-d]);
      }
    }
    dirty = true;
    draw();
  }

  function position(event) { return view.pixelAt(event.clientX,event.clientY,{ clamp:!!gesture,snap:false }); }

  canvas.addEventListener('pointerdown',event=>{
    if (!mode || !host.open || gesture || event.button !== 0) return;
    const start = position(event);
    if (!start) return;
    event.stopImmediatePropagation();
    canvas.setPointerCapture(event.pointerId);
    gesture = { pointer:event.pointerId,start,before:key(),wasDirty:dirty };
    applyPoint(start);
  });
  canvas.addEventListener('pointermove',event=>{
    if (gesture?.pointer === event.pointerId) {
      const point = position(event);
      if (point) applyPoint(point);
    }
  });
  canvas.addEventListener('pointerup',event=>{
    if (gesture?.pointer !== event.pointerId) return;
    const point = position(event);
    if (point) applyPoint(point);
    gesture = undefined;
    pickMode();
    draw();
  });
  canvas.addEventListener('lostpointercapture',event=>{
    if (gesture?.pointer === event.pointerId) cancelPick();
  });
  viewport.addEventListener('keydown',event=>{
    if (mode && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelPick();
    }
  },{ capture:true });
  host.addEventListener('toggle',()=>{
    if (!host.open) cancelPick();
    draw();
  });
  menu.addEventListener('change',()=>select(menu.value));
  form.addEventListener('input',event=>{
    if (event.target !== menu) { dirty = true; draw(); }
  });
  function apply(operation,next) {
    try {
      cancelPick();
      commit(operation);
      select(next);
    } catch (error) { notify(error.message); }
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    const id = field('id').value.trim(), label = field('label').value.trim() || null;
    if (!selected && source.rows?.some(row=>row.id === id)) { notify('Choose an unused slice ID'); return; }
    apply({ type:'set-slice-key',id,label,key:key() },id);
  });
  field('remove-key').addEventListener('click',()=>apply({ type:'remove-slice-key',id:selected.id },selected.id));
  field('remove').addEventListener('click',()=>apply({ type:'remove-slice',id:selected.id },''));

  return {
    cancelPick,
    reset() {
      cancelPick();
      source = selected = undefined;
      active = [];
      dirty = false;
      view.setSlices();
    },
    hasKey:()=>!!source?.keyed,
    setSource(doc,index) {
      const { slices:rows,width,height,frames } = doc, frame = frames[index]?.id;
      if (source && source.rows === rows && source.index === index && source.ids.length === frames.length &&
          source.ids[index] === frame && source.width === width && source.height === height) return;
      source = { rows,width,height,ids:frames.map(row=>row.id),index,
        keyed:rows?.some(row=>row.keys.some(key=>key.frame === frame)) };
      active = PixelSlices.active(rows,source.ids,index);
      const id = selected?.id;
      menu.replaceChildren(new Option('New slice',''),...(rows ?? []).map(({id,label})=>new Option(label ? label+' · '+id : id,id)));
      select(id);
    }
  };
}
