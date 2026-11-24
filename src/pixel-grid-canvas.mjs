const markup = `
  <div class="ink-grid-tools" role="group" aria-label="Canvas controls">
    <button type="button" data-view="out" aria-label="Zoom out">−</button>
    <output class="ink-grid-zoom" aria-label="Zoom level"></output>
    <button type="button" data-view="in" aria-label="Zoom in">+</button>
    <button type="button" data-view="fit">Fit</button>
    <button type="button" data-view="pan" aria-pressed="false">Pan</button>
    <label class="ink-grid-toggle"><input type="checkbox" checked> Grid</label>
    <div class="ink-guide-toggles" hidden>
      <label><input type="checkbox" data-view="guides" checked> Guides</label>
      <label><input type="checkbox" data-view="snap"> Snap</label>
    </div>
  </div>
  <div class="ink-grid-views">
    <div class="ink-grid-viewport" tabindex="0" role="group" aria-label="Canvas viewport">
      <div class="ink-grid-plane">
        <div class="ink-grid-repeats" aria-hidden="true"></div>
        <canvas class="ink-grid-main" aria-label="Native pixel canvas"></canvas>
        <div class="ink-grid-lines" aria-hidden="true" hidden></div>
        <div class="ink-grid-guides" aria-hidden="true" hidden></div>
        <div class="ink-grid-mirrors" aria-hidden="true">
          <div class="ink-grid-mirror-x" hidden></div><div class="ink-grid-mirror-y" hidden></div>
        </div>
        <div class="ink-grid-selection" aria-hidden="true" hidden><canvas hidden></canvas></div>
        <canvas class="ink-grid-diagnostic" aria-hidden="true" hidden></canvas>
        <canvas class="ink-grid-diagnostic ink-grid-motion" aria-hidden="true" hidden></canvas>
        <div class="ink-grid-cursor" aria-hidden="true" hidden></div>
      </div>
    </div>
    <div class="ink-grid-reference">
      <div class="ink-grid-label">1× preview</div>
      <div class="ink-grid-reference-scroll" tabindex="0" role="group" aria-label="1× preview viewport">
        <canvas aria-label="1× pixel preview"></canvas>
      </div>
      <output class="ink-grid-dimensions" aria-label="Canvas dimensions"></output>
    </div>
  </div>
  <output class="ink-grid-coordinates" aria-label="Cursor coordinates" aria-live="off">X — · Y —</output>`;

const maxZoom = 48;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function mountPixelGridCanvas(host,{ guideTool } = {}) {
  host.classList.add('ink-grid-canvas');
  host.innerHTML = markup;
  const find = selector => host.querySelector(selector);
  const viewport = find('.ink-grid-viewport'), plane = find('.ink-grid-plane');
  const canvas = find('.ink-grid-main'), preview = find('.ink-grid-reference canvas');
  const art = canvas.getContext('2d'), sample = preview.getContext('2d');
  const lines = find('.ink-grid-lines'), cursor = find('.ink-grid-cursor');
  const diagnostic = find('.ink-grid-diagnostic'), motion = find('.ink-grid-motion');
  const selection = find('.ink-grid-selection'), selectedPixels = selection.querySelector('canvas').getContext('2d');
  const repeats = find('.ink-grid-repeats');
  const mirrorLines = [find('.ink-grid-mirror-x'),find('.ink-grid-mirror-y')];
  const guidesLayer = find('.ink-grid-guides'), guideToggles = find('.ink-guide-toggles');
  const showGuides = find('[data-view="guides"]'), snapGuides = find('[data-view="snap"]');
  const zoomLabel = find('.ink-grid-zoom'), dimensions = find('.ink-grid-dimensions');
  const coordinates = find('.ink-grid-coordinates'), gridToggle = find('.ink-grid-toggle input');
  const zoomOut = find('[data-view="out"]'), zoomIn = find('[data-view="in"]'), panButton = find('[data-view="pan"]');
  const events = new AbortController();
  const listen = (target,type,fn,options) => target.addEventListener(type,fn,{ ...options,signal:events.signal });
  let width = 0, height = 0, zoom = 1, left = 0, top = 0, fitting = true;
  let drag, pan = false, point, image, guides = [], tiles = [], repeatX = false, repeatY = false;

  function showPoint(pick) {
    point = pick;
    const at = pick?.at, hits = [...new Set(Object.values(pick?.hits ?? {}))];
    cursor.hidden = !at || zoom < 2;
    coordinates.value = at ? `X ${at[0]} · Y ${at[1]}${hits.length ? ' · '+hits.join(', ') : ''}` : 'X — · Y —';
    if (at) cursor.style.translate = `${at[0] * zoom}px ${at[1] * zoom}px`;
  }

  let displayedMask, maskImage;
  function setSelection(bounds) {
    const mask = bounds instanceof Uint8Array;
    selectedPixels.canvas.hidden = !mask;
    selection.classList.toggle('ink-grid-selection-mask',mask);
    if (mask) {
      if (bounds.length !== width*height || !width || !height)
        throw new TypeError('Selection mask must match the native canvas');
      if (displayedMask === bounds && selectedPixels.canvas.width === width && selectedPixels.canvas.height === height) return;
      displayedMask = bounds;
      if (maskImage?.width !== width || maskImage?.height !== height) {
        selectedPixels.canvas.width = width;
        selectedPixels.canvas.height = height;
        maskImage = selectedPixels.createImageData(width,height);
      }
      const data = maskImage.data;
      data.fill(0);
      for (let p = 0; p < bounds.length; p++) {
        if (!bounds[p]) continue;
        const x = p%width, edge = x === 0 || x === width-1 || !bounds[p-1] || !bounds[p+1] ||
          !bounds[p-width] || !bounds[p+width];
        const offset = 4*p;
        data[offset] = 166;
        data[offset+1] = 241;
        data[offset+2] = 215;
        data[offset+3] = edge ? 184 : 58;
      }
      selectedPixels.putImageData(maskImage,0,0);
      selection.hidden = false;
      return;
    }
    displayedMask = undefined;
    selection.hidden = !bounds;
    if (!bounds) return;
    for (const [i,field] of ['x','y','width','height'].entries())
      selection.style.setProperty('--ink-selection-'+field,bounds[i]);
  }

  function setDiagnostic(finding,channel) {
    const overlay = channel === 'motion' ? motion : diagnostic;
    overlay.hidden = !finding;
    if (!finding) return;
    const [x,y,w,h] = finding.bounds;
    overlay.width = w;
    overlay.height = h;
    for (const [i,field] of ['x','y','width','height'].entries())
      overlay.style.setProperty('--ink-diagnostic-'+field,finding.bounds[i]);
    const marks = overlay.getContext('2d');
    marks.fillStyle = channel === 'motion' ? '#b195ff70' : '#f6bd4e70';
    for (const [row,col,length] of finding.runs) marks.fillRect(col-x,row-y,length,1);
  }

  function setGuides(rows = []) {
    guides = guideTool ? structuredClone(guideTool.prepare(rows)) : [];
    if (!guideTool && rows.length) throw new TypeError('Mount with a guideTool to show pixel guides');
    const document = host.ownerDocument;
    guidesLayer.replaceChildren(...guides.flatMap(guide => {
      function mark(kind,x,y) {
        const node = document.createElement('div');
        node.className = 'ink-guide-' + kind;
        node.dataset.guide = guide.id;
        node.style.setProperty('--guide-x',x);
        node.style.setProperty('--guide-y',y);
        return node;
      }
      if (guide.kind === 'axis') {
        return guide.axis === 'x' ? [mark('axis-x',guide.at+.5,0)] : [mark('axis-y',0,guide.at+.5)];
      }
      const [x,y] = guide.at;
      if (guide.kind === 'grid') {
        const grid = mark('tile-grid',x,y);
        grid.style.setProperty('--guide-step-x',guide.step[0]);
        grid.style.setProperty('--guide-step-y',guide.step[1]);
        return [grid,mark('origin',x,y)];
      }
      return [mark(guide.kind,x+.5,y+.5)];
    }));
    guideToggles.hidden = guides.length === 0;
    guidesLayer.hidden = guideToggles.hidden || !showGuides.checked;
    showPoint(null);
  }

  function setDrawing({ mirrorX,mirrorY,wrapX = false,wrapY = false } = {}) {
    [mirrorX,mirrorY].forEach((value,i) => {
      mirrorLines[i].hidden = value === undefined;
      if (value !== undefined) mirrorLines[i].style.setProperty('--mirror-at',value+.5);
    });
    if (wrapX === repeatX && wrapY === repeatY) return;
    repeatX = wrapX;
    repeatY = wrapY;
    const neighbors = [];
    for (const y of wrapY ? [-1,0,1] : [0]) for (const x of wrapX ? [-1,0,1] : [0]) {
      if (!x && !y) continue;
      const tile = host.ownerDocument.createElement('canvas');
      tile.style.setProperty('--tile-x',x);
      tile.style.setProperty('--tile-y',y);
      neighbors.push(tile);
    }
    repeats.replaceChildren(...neighbors);
    tiles = neighbors.map(tile=>tile.getContext('2d'));
    if (image) drawRepeats();
  }

  function drawRepeats() {
    for (const tile of tiles) {
      if (tile.canvas.width !== width) tile.canvas.width = width;
      if (tile.canvas.height !== height) tile.canvas.height = height;
      tile.putImageData(image,0,0);
    }
  }

  function paintView() {
    plane.style.translate = `${left}px ${top}px`;
    plane.style.setProperty('--ink-grid-cell',`${zoom}px`);
    canvas.style.width = `${width * zoom}px`;
    canvas.style.height = `${height * zoom}px`;
    lines.hidden = !gridToggle.checked || zoom < 4;
    zoomLabel.value = `${zoom}×`;
    zoomOut.disabled = zoom === 1;
    zoomIn.disabled = zoom === maxZoom;
    showPoint(point);
  }

  function fit() {
    fitting = true;
    if (!width || !height) return;
    const next = clamp(Math.floor(Math.min((viewport.clientWidth - 28) / width,
      (viewport.clientHeight - 28) / height)),1,maxZoom);
    const x = Math.round((viewport.clientWidth - width * next) / 2);
    const y = Math.round((viewport.clientHeight - height * next) / 2);
    if (next !== zoom || x !== left || y !== top) showPoint(null);
    zoom = next;
    left = x;
    top = y;
    paintView();
  }

  function move(x,y) {
    // Always keep part of the art in the viewport, even with a large trackpad move.
    const visibleX = Math.min(width * zoom,16), visibleY = Math.min(height * zoom,16);
    left = clamp(Math.round(x),visibleX - width * zoom,Math.max(0,viewport.clientWidth - visibleX));
    top = clamp(Math.round(y),visibleY - height * zoom,Math.max(0,viewport.clientHeight - visibleY));
    paintView();
  }

  function focusRegion([x,y,w,h],channel) {
    fitting = false;
    const fit = Math.floor(Math.min((viewport.clientWidth-32)/w,(viewport.clientHeight-32)/h));
    zoom = clamp(Math.min(fit,Math.max(zoom,12)),1,maxZoom);
    showPoint(null);
    move(viewport.clientWidth/2-(x+w/2)*zoom,viewport.clientHeight/2-(y+h/2)*zoom);
    (channel === 'motion' ? motion : diagnostic).scrollIntoView({ block:'nearest',inline:'nearest' });
  }

  function setZoom(value,x = viewport.clientWidth / 2,y = viewport.clientHeight / 2) {
    if (!Number.isSafeInteger(value)) throw new RangeError('Canvas zoom needs an integer');
    const next = clamp(value,1,maxZoom);
    if (next === zoom || !width) return;
    fitting = false;
    const ratio = next / zoom;
    zoom = next;
    showPoint(null);
    move(x - (x - left) * ratio,y - (y - top) * ratio);
  }

  function locate(target,clientX,clientY,{ boundary = false,snap = false,wrapX = false,wrapY = false } = {}) {
    const box = target.getBoundingClientRect();
    if (!width || !box.width || !box.height || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const x = (clientX - box.left) * width / box.width, y = (clientY - box.top) * height / box.height;
    const outside = x < 0 || y < 0 || x >= width || y >= height;
    if (!boundary && outside) return null;
    const repeated = (wrapX && (x < 0 || x >= width)) || (wrapY && (y < 0 || y >= height));
    if (!repeated && snap && guides.length && snapGuides.checked) {
      const hit = guideTool.snap(guides,[x-.5,y-.5],{ width,height,radius:Math.min(2,7/zoom) });
      hit.position = [clamp(hit.position[0],-.5,width-.5),clamp(hit.position[1],-.5,height-.5)];
      return hit;
    }
    const inside = (p,size,wrap) => wrap ? clamp(p,-size,2*size) : clamp(p,0,size);
    const pixel = (p,size,wrap) => Math.min(wrap ? 2*size-1 : size-1,Math.floor(inside(p,size,wrap)));
    return { position:[inside(x,width,wrapX)-.5,inside(y,height,wrapY)-.5],
      at:[pixel(x,width,wrapX),pixel(y,height,wrapY)] };
  }
  const locateCanvas = (x,y,options = {}) => locate(canvas,x,y,{ snap:true,...options });
  const pixelAt = (x,y,{ clamp:boundary = false,...options } = {}) =>
    locateCanvas(x,y,{ boundary,...options })?.at ?? null;
  const positionAt = (x,y,{ clamp:boundary = false,...options } = {}) =>
    locateCanvas(x,y,{ boundary,...options })?.position ?? null;

  function setFrame({ width:w,height:h,rgba }) {
    if (![w,h].every(size => Number.isSafeInteger(size) && size > 0) ||
        !(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== w * h * 4)
      throw new TypeError('The pixel canvas needs a native RGBA byte frame');
    if (w !== width || h !== height) {
      width = canvas.width = preview.width = w;
      height = canvas.height = preview.height = h;
      preview.style.width = `${w}px`;
      preview.style.height = `${h}px`;
      dimensions.value = `${w} × ${h} px`;
      image = art.createImageData(w,h);
      showPoint(null);
      fit();
    }
    image.data.set(rgba);
    art.putImageData(image,0,0);
    sample.putImageData(image,0,0);
    drawRepeats();
  }

  listen(zoomOut,'click',() => setZoom(zoom-1));
  listen(zoomIn,'click',() => setZoom(zoom+1));
  listen(find('[data-view="fit"]'),'click',fit);
  listen(gridToggle,'change',paintView);
  listen(showGuides,'change',() => { guidesLayer.hidden = !showGuides.checked; });
  listen(snapGuides,'change',() => showPoint(null));
  listen(panButton,'click',() => {
    pan = !pan;
    panButton.setAttribute('aria-pressed',String(pan));
    viewport.classList.toggle('ink-grid-hand',pan);
  });
  listen(viewport,'pointerdown',event => {
    if (!width || drag || (event.button !== 1 && !(event.button === 0 && pan))) return;
    event.preventDefault();
    event.stopPropagation();
    viewport.focus({ preventScroll:true });
    viewport.setPointerCapture(event.pointerId);
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY, left, top };
    fitting = false;
    viewport.classList.add('ink-grid-dragging');
    showPoint(null);
  },{ capture:true });
  listen(viewport,'pointermove',event => {
    if (drag?.id === event.pointerId) {
      move(drag.left + event.clientX - drag.x,drag.top + event.clientY - drag.y);
    } else if (!drag) {
      showPoint(locateCanvas(event.clientX,event.clientY));
    }
  });
  listen(viewport,'lostpointercapture',event => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    viewport.classList.remove('ink-grid-dragging');
    const at = host.ownerDocument.elementFromPoint(event.clientX,event.clientY);
    showPoint(at === canvas ? locateCanvas(event.clientX,event.clientY) : null);
  });
  listen(viewport,'pointerleave',() => showPoint(null));
  listen(preview,'pointermove',event => showPoint(locate(preview,event.clientX,event.clientY)));
  listen(preview,'pointerleave',() => showPoint(null));
  listen(viewport,'wheel',event => {
    if (!width) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const box = viewport.getBoundingClientRect();
      setZoom(zoom - Math.sign(event.deltaY),event.clientX - box.left,event.clientY - box.top);
    } else {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      fitting = false;
      move(left - event.deltaX * unit,top - event.deltaY * unit);
    }
    showPoint(locateCanvas(event.clientX,event.clientY));
  },{ passive:false });
  listen(viewport,'keydown',event => {
    if (!width || event.ctrlKey || event.metaKey || event.altKey) return;
    const vector = { ArrowLeft:[24,0], ArrowRight:[-24,0], ArrowUp:[0,24], ArrowDown:[0,-24] }[event.key];
    if (vector) {
      fitting = false;
      showPoint(null);
      move(left + vector[0],top + vector[1]);
    } else if (event.key === '+' || event.key === '=') setZoom(zoom+1);
    else if (event.key === '-') setZoom(zoom-1);
    else if (event.key === 'Home') fit();
    else return;
    event.preventDefault();
  });

  const observer = new ResizeObserver(() => { if (fitting) fit(); else move(left,top); });
  observer.observe(viewport);
  paintView();
  return Object.freeze({ canvas, setFrame, setGuides, setDrawing, setSelection, setDiagnostic, focusRegion, setZoom, fit, pixelAt, positionAt,
    dispose() { events.abort(); observer.disconnect(); host.replaceChildren(); host.classList.remove('ink-grid-canvas'); } });
}
