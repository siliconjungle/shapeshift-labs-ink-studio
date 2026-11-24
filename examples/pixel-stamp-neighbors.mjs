export function mountTileNeighbors(host,{ Tilemap,view,edit }) {
  const get = name=>host.querySelector('#tile-neighbor-'+name);
  const show = get('show'), seek = get('time'), play = get('play'), open = get('edit');
  const summary = get('summary'), edges = get('edges'), cells = get('cells'), resolved = get('resolved');
  let source, time = 0, request, frame;

  function stop() {
    if (request !== undefined) cancelAnimationFrame(request);
    request = undefined;
    play.textContent = 'Play tiles';
  }

  function describe(cell) {
    if (!cell.frame) return cell.outside ? 'Outside map' : 'Empty';
    const rule = cell.mask ? ' · '+cell.mask+' → '+cell.variant : '';
    const step = cell.step === undefined ? '' : ' · Cel '+(cell.step+1)+' '+cell.frame;
    return cell.tile+rule+step;
  }

  function render() {
    host.hidden = !source;
    if (!source) {
      stop();
      view.setNeighbors();
      return;
    }
    const { grid,at,resolver,read,editing } = source;
    const result = Tilemap.neighborhood(grid,at,resolver,time,read,editing), center = result.cells[4];
    view.setNeighbors(show.checked ? result.images : undefined);
    play.disabled = !resolver.animated;
    seek.disabled = !resolver.animated;
    frame = center.frame;
    const different = frame !== editing.frame;
    open.hidden = resolved.hidden = !different;
    summary.value = 'Cell '+at.join(', ')+' · '+describe(center)+(different ? ' · Editing '+editing.frame : '');
    if (different) {
      const image = result.images[4];
      if (resolved.width !== image.width) resolved.width = image.width;
      if (resolved.height !== image.height) resolved.height = image.height;
      resolved.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.rgba),image.width,image.height),0,0);
    }
    edges.value = result.seams.map(({side,coverage,color,length})=>
      side+' '+coverage+'/'+length+' alpha, '+color+' RGB').join(' · ');
    if (cells.parentElement.open) cells.replaceChildren(...result.cells.map(cell=>{
      const item = host.ownerDocument.createElement('li');
      item.textContent = cell.at.join(', ')+' · '+describe(cell);
      return item;
    }));
  }

  play.addEventListener('click',()=>{
    if (request !== undefined) { stop(); return; }
    const start = performance.now(), initial = time;
    play.textContent = 'Pause tiles';
    function tick(now) {
      time = initial+(now-start)/1000;
      seek.value = time.toFixed(3);
      render();
      request = requestAnimationFrame(tick);
    }
    request = requestAnimationFrame(tick);
  });
  seek.addEventListener('input',()=>{
    const seconds = seek.valueAsNumber;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds*1000 > Number.MAX_SAFE_INTEGER) return;
    stop();
    time = seconds;
    render();
  });
  show.addEventListener('change',render);
  cells.parentElement.addEventListener('toggle',render);
  open.addEventListener('click',()=>{ stop(); if (frame) edit(frame); });

  return {
    time:()=>time,
    setSource(next) { source = next; render(); },
    reset() { time = 0; seek.value = '0'; source = undefined; render(); }
  };
}
