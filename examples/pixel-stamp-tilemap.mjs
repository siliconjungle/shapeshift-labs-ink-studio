export function mountTilemap(host,{ Tilemap,segment,read,presentation,readTile,readTileArt,create,place,edit,add,variant,reuse,undo,stop,notify }) {
  const get = id=>host.querySelector('#'+id);
  const canvas = get('tilemap-canvas'), context = canvas.getContext('2d');
  const plane = get('tilemap-plane'), choice = get('tilemap-choice'), tool = get('tilemap-tool');
  const cursor = get('tilemap-cursor'), position = get('tilemap-position'), form = get('tilemap-create');
  const selected = get('tilemap-picked'), exact = get('tilemap-exact');
  let mode = 'pixels', grid, point, picked, stroke, image;
  let tiles = new Map();
  const tileOption = ({ id,label })=>new Option(label && label !== id ? label+' · '+id : id,id);
  const countLabel = count=>count+(count === 1 ? ' placement' : ' placements');

  function raster(id) {
    if (!tiles.has(id)) {
      const { width,height,rgba } = readTile(id);
      tiles.set(id,new ImageData(new Uint8ClampedArray(rgba),width,height));
    }
    return tiles.get(id);
  }

  function positionCell(element,[x,y]) {
    const zoom = Number(get('tilemap-zoom').value);
    element.style.translate = (x*grid.tileWidth*zoom)+'px '+(y*grid.tileHeight*zoom)+'px';
  }

  function showCursor() {
    cursor.hidden = !point || !grid;
    if (cursor.hidden) { position.textContent = ''; return; }
    const [x,y] = point, key = y*grid.width+x;
    positionCell(cursor,point);
    const id = stroke?.points.has(key) ? stroke.tile : grid.placed.get(key);
    position.textContent = x+', '+y+' · '+(id ?? 'Empty');
  }

  function zoom() {
    if (!grid) return;
    const factor = Number(get('tilemap-zoom').value);
    canvas.style.width = grid.w*factor+'px';
    canvas.style.height = grid.h*factor+'px';
    plane.style.setProperty('--tile-w',grid.tileWidth*factor+'px');
    plane.style.setProperty('--tile-h',grid.tileHeight*factor+'px');
    showCursor();
    selected.hidden = !picked;
    if (picked) positionCell(selected,picked);
  }

  function showInstanceCount() {
    if (!grid) return;
    let count = 0;
    for (const id of grid.placed.values()) if (id === choice.value) count++;
    get('tilemap-instance-count').value = countLabel(count);
  }

  function showSharing() {
    const id = picked && Tilemap.pick(grid,picked), { doc } = read();
    if (!id) picked = undefined;
    const frames = new Map(doc.frames.filter(frame=>frame.id !== undefined).map(frame=>[frame.id,frame]));
    const candidates = id ? [...frames.keys()].filter(key=>Tilemap.sameBehavior(grid,id,key)) : [];
    const matches = candidates.length > 1 ? Tilemap.exactMatches(candidates,id,key=>readTileArt(frames.get(key))) : [];
    const previous = exact.value;
    exact.replaceChildren(...(matches.length ? matches.map(id=>tileOption(frames.get(id))) : [new Option('No exact matches','')]));
    if (matches.includes(previous)) exact.value = previous;
    get('tilemap-pick-label').value = id ? picked.join(', ')+' · '+id : 'Use Pick on an occupied cell';
    get('tilemap-variant').disabled = !id;
    get('tilemap-reuse').disabled = exact.disabled = !matches.length;
    showInstanceCount();
  }

  function refresh(preferred) {
    const { doc,canUndo,time } = read(), enabled = !!doc.tilemap;
    if (!enabled) { mode = 'pixels'; picked = undefined; }
    const placing = mode === 'map';
    get('tilemap-new').hidden = enabled;
    if (enabled) {
      form.hidden = true;
      get('tilemap-new').setAttribute('aria-expanded',false);
    }
    get('tilemap-modes').hidden = !enabled;
    get('tilemap-place').setAttribute('aria-pressed',placing);
    get('tilemap-pixels').setAttribute('aria-pressed',!placing);
    get('tilemap-editing').hidden = placing;
    get('tilemap-workspace').hidden = !placing;
    get('pixel-workspace').hidden = placing;
    get('export-png').textContent = placing ? 'Save map PNG' : 'Save PNG frame';
    get('png-color-mode').hidden = placing;
    get('tilemap-undo').disabled = !canUndo;
    if (!placing) { grid = image = undefined; return; }
    const selectedTile = preferred ?? choice.value, frames = doc.frames.filter(frame=>frame.id !== undefined);
    choice.replaceChildren(...frames.map(tileOption));
    if (frames.some(frame=>frame.id === selectedTile)) choice.value = selectedTile;
    get('tilemap-edit-tile').disabled = !choice.value;
    grid = Tilemap.prepare(doc.tilemap,new Set(frames.map(frame=>frame.id)),doc.width,doc.height);
    if (point && (point[0] >= grid.width || point[1] >= grid.height)) point = undefined;
    if (picked && (picked[0] >= grid.width || picked[1] >= grid.height)) picked = undefined;
    image = Tilemap.raster(grid,id=>{
      const tile = raster(id);
      return { width:tile.width,height:tile.height,rgba:tile.data };
    },presentation(doc,grid),time);
    const { w,h,rgba } = image;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
    showSharing();
    zoom();
  }

  function show(next,{ clearPick = false } = {}) {
    stroke = undefined;
    if (clearPick) picked = undefined;
    tiles = new Map();
    mode = next;
    if (next === 'map') stop();
    refresh(next === 'map' ? read().frame : undefined);
  }

  function cellAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX-rect.left)*grid.width/rect.width);
    const y = Math.floor((event.clientY-rect.top)*grid.height/rect.height);
    return x >= 0 && y >= 0 && x < grid.width && y < grid.height ? [x,y] : undefined;
  }

  function addPoint(at) {
    const { width,tileWidth,tileHeight } = grid, key = at[1]*width+at[0];
    if (stroke.points.has(key)) return;
    stroke.points.set(key,at);
    if (stroke.tile === null) context.clearRect(at[0]*tileWidth,at[1]*tileHeight,tileWidth,tileHeight);
    else context.putImageData(raster(stroke.tile),at[0]*tileWidth,at[1]*tileHeight);
  }

  function pick(at) {
    const tile = Tilemap.pick(grid,at);
    picked = tile === null ? undefined : at.slice();
    if (tile !== null) choice.value = tile;
    showSharing();
    selected.hidden = !picked;
    if (picked) positionCell(selected,picked);
    notify(tile === null ? 'Empty map cell' : 'Selected '+tile);
  }

  function apply(points,tile) {
    try { place(points,tile); }
    catch (error) { notify(error.message); refresh(); }
  }

  canvas.addEventListener('pointerdown',event=>{
    if (!grid || event.button !== 0 || stroke || !(point = cellAt(event))) return;
    canvas.focus({ preventScroll:true });
    if (tool.value === 'pick') { pick(point); showCursor(); return; }
    stroke = { pointer:event.pointerId,tile:tool.value === 'erase' ? null : choice.value,points:new Map(),last:point };
    canvas.setPointerCapture(event.pointerId);
    addPoint(point);
    showCursor();
  });
  canvas.addEventListener('pointermove',event=>{
    if (!grid || stroke && event.pointerId !== stroke.pointer) return;
    point = cellAt(event);
    if (stroke && point) {
      segment(stroke.last,point,(x,y)=>addPoint([x,y]));
      stroke.last = point;
    }
    showCursor();
  });
  canvas.addEventListener('pointerleave',()=>{ if (!stroke) { point = undefined; showCursor(); } });
  canvas.addEventListener('pointerup',event=>{
    if (stroke?.pointer !== event.pointerId) return;
    point = cellAt(event);
    if (point) segment(stroke.last,point,(x,y)=>addPoint([x,y]));
    const { points,tile } = stroke;
    stroke = undefined;
    apply([...points.values()],tile);
    showCursor();
  });
  for (const name of ['pointercancel','lostpointercapture']) canvas.addEventListener(name,event=>{
    if (stroke?.pointer !== event.pointerId) return;
    stroke = undefined;
    refresh();
  });
  const offsets = { ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1] };
  canvas.addEventListener('keydown',event=>{
    if (!grid || stroke || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' && point) {
      event.preventDefault();
      if (tool.value === 'pick') pick(point);
      else apply([point],tool.value === 'erase' ? null : choice.value);
    }
    if (!Object.hasOwn(offsets,event.key)) return;
    event.preventDefault();
    const [x,y] = point ?? [0,0], [dx,dy] = offsets[event.key];
    point = [Math.min(grid.width-1,Math.max(0,x+dx)),Math.min(grid.height-1,Math.max(0,y+dy))];
    showCursor();
    cursor.scrollIntoView({ block:'nearest',inline:'nearest' });
  });
  canvas.addEventListener('focus',()=>{ if (!point) { point = [0,0]; showCursor(); } });

  get('tilemap-new').addEventListener('click',()=>{
    form.hidden = !form.hidden;
    get('tilemap-new').setAttribute('aria-expanded',!form.hidden);
    if (!form.hidden) get('tilemap-cols').focus();
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();
    try {
      create(get('tilemap-cols').valueAsNumber,get('tilemap-rows').valueAsNumber);
      show('map');
    } catch (error) { notify(error.message); }
  });
  get('tilemap-place').addEventListener('click',()=>show('map'));
  function editSelected() {
    const id = choice.value;
    show('pixels');
    if (id) edit(id);
  }
  get('tilemap-pixels').addEventListener('click',editSelected);
  get('tilemap-edit-tile').addEventListener('click',editSelected);
  choice.addEventListener('change',showInstanceCount);
  get('tilemap-variant').addEventListener('click',()=>{
    try {
      const id = variant(picked);
      show('pixels');
      edit(id);
    } catch (error) { notify(error.message); }
  });
  get('tilemap-reuse').addEventListener('click',()=>{
    try {
      const id = exact.value;
      reuse(picked,id);
      choice.value = id;
      showInstanceCount();
    } catch (error) { notify(error.message); }
  });
  get('tilemap-add-tile').addEventListener('click',()=>{
    try {
      const id = add();
      show('pixels');
      edit(id);
    } catch (error) { notify(error.message); }
  });
  get('tilemap-zoom').addEventListener('change',zoom);
  get('tilemap-lines').addEventListener('change',event=>{ get('tilemap-grid').hidden = !event.target.checked; });
  get('tilemap-undo').addEventListener('click',()=>{ stroke = undefined; undo(); });

  return {
    show,active:()=>mode === 'map',
    selection:()=>picked?.slice(),
    refresh() { tiles = new Map(); stroke = undefined; refresh(); },
    editing(label,count) { get('tilemap-editing').value = count ? label+' · '+countLabel(count) : label; },
    image:()=>image
  };
}
