(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('chart'), ctx = canvas.getContext('2d');
  const backdrop = document.createElement('canvas');
  backdrop.width = canvas.width; backdrop.height = canvas.height;
  const bg = backdrop.getContext('2d');
  const previews = flowPreviews(KIT,makeBuilder,Object.fromEntries(Array.from(
    document.querySelectorAll('[data-simulation]'),node => [node.dataset.simulation,node])));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let map = KIT.flowMap.open(flowMapAsset), focus, drawing, load = 0;
  let run = !reduced, last = 0;
  const cap = (n,a,b) => Math.max(a,Math.min(b,n));
  const number = (n,digits=3) => Number(n.toPrecision(digits)).toString();
  const transform = () => {
    const [u,v,U,V] = map.bounds, sx = canvas.width/(U-u), sy = canvas.height/(V-v);
    return { u,v,sx,sy,x:a => (a-u)*sx,y:b => (b-v)*sy };
  };

  function arrow(context,x,y,dx,dy,length) {
    const len = Math.hypot(dx,dy);
    if (!len) return;
    const a = dx/len, b = dy/len, tipX = x+a*length*.61, tipY = y+b*length*.61;
    context.moveTo(x-a*length*.39,y-b*length*.39);
    context.lineTo(tipX,tipY);
    const head = Math.min(6,length*.36);
    context.lineTo(tipX-head*(a+b*.65),tipY-head*(b-a*.65));
    context.moveTo(tipX,tipY);
    context.lineTo(tipX-head*(a-b*.65),tipY-head*(b+a*.65));
  }

  function background() {
    const { width,height } = map, W = canvas.width, H = canvas.height;
    const stride = Math.ceil(Math.max(width/26,height/18)), dw = W/width, dh = H/height;
    const vectors = Array.from({ length:width*height },(_,p) => map.cell(p%width,Math.floor(p/width)));
    const speeds = vectors.map(v => Math.hypot(...v));
    const peak = Math.max(1e-4,speeds.reduce((value,speed) => Math.max(value,speed),0));
    for (let p=0; p<speeds.length; p++) {
      const strength = Math.sqrt(speeds[p]/peak);
      const hot = Math.max(0,(strength-.60)/.40);
      bg.fillStyle = 'rgb('+[24+28*strength+76*hot,37+92*strength+27*hot,42+66*strength-4*hot].map(Math.round).join(',')+')';
      bg.fillRect(Math.floor(p%width*dw),Math.floor(Math.floor(p/width)*dh),Math.ceil(dw)+1,Math.ceil(dh)+1);
    }
    bg.lineWidth = 1;
    bg.strokeStyle = '#12272d48';
    bg.beginPath();
    for (let x=0; x<=width; x+=stride) { bg.moveTo(x*dw,0); bg.lineTo(x*dw,H); }
    for (let y=0; y<=height; y+=stride) { bg.moveTo(0,y*dh); bg.lineTo(W,y*dh); }
    bg.stroke();
    bg.strokeStyle = '#c7f5df';
    bg.lineWidth = 1.65;
    const { sx,sy } = transform();
    bg.beginPath();
    for (let y=Math.floor(stride/2); y<height; y+=stride) for (let x=Math.floor(stride/2); x<width; x+=stride) {
      const i = y*width+x, speed = speeds[i], [u,v] = vectors[i];
      if (speed <= 1e-8) continue;
      const length = Math.min(dw,dh)*stride*(.33+.44*Math.sqrt(speed/peak));
      arrow(bg,(x+.5)*dw,(y+.5)*dh,u*sx,v*sy,length);
    }
    bg.stroke();
    $('grid').textContent = width+' × '+height+' cells · ↑ −V · +U →';
  }

  function paintOverlay() {
    ctx.drawImage(backdrop,0,0);
    const { u,v,sx,sy,x,y } = transform();
    if (drawing) {
      ctx.save();
      ctx.setTransform(sx,0,0,sy,-u*sx,-v*sy);
      ctx.fillStyle = '#f0ba7d6d'; ctx.strokeStyle = ctx.fillStyle;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.lineWidth = 2*drawing.options.radius;
      const points = drawing.points;
      ctx.beginPath();
      if (points.length === 1) {
        ctx.arc(...points[0],drawing.options.radius,0,2*Math.PI); ctx.fill();
      } else {
        ctx.moveTo(...points[0]); points.slice(1).forEach(point => ctx.lineTo(...point)); ctx.stroke();
      }
      ctx.restore();
    }
    if (focus && map.sample(...focus)) {
      const px = x(focus[0]), py = y(focus[1]);
      ctx.strokeStyle = '#ffdda8';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(px-6,py-6,12,12); ctx.stroke();
    }
  }

  function probe(at) {
    focus = at;
    const result = map.inspect(...at);
    $('u').value = number(at[0],7); $('v').value = number(at[1],7);
    $('velocity').textContent = result ? result.velocity.map(n => number(n)).join(', ') : 'Outside the chart';
    $('magnitude').textContent = result ? number(result.speed)+' units/s' : '—';
    $('bearing').textContent = result?.direction == null ? '—' : number(result.direction)+'°';
    $('cell').textContent = result ? result.cell.join(', ')+' · '+result.cellVelocity.map(n => number(n)).join(', ') : '—';
    paintOverlay();
  }

  const notice = message => { $('notice').textContent = message; };
  function history() {
    const state = map.history();
    $('undo').disabled = !state.undo;
    $('redo').disabled = !state.redo;
  }
  function restart() {
    previews.reset(map);
    $('time').value = '0.00 s';
  }
  function refresh(message) {
    background();
    const [u,v,U,V] = map.bounds;
    probe(focus ?? [(u+U)/2,(v+V)/2]);
    history();
    restart();
    notice(message);
  }

  function tools() {
    const mode = $('mode').value, paint = mode === 'paint';
    $('heading').disabled = !paint;
    $('speed').disabled = mode === 'inspect' || mode === 'erase';
    $('radius').disabled = $('opacity').disabled = mode === 'inspect';
    $('angle-row').hidden = !(paint && $('heading').value === 'fixed');
  }
  $('mode').addEventListener('change',tools);
  $('heading').addEventListener('change',tools);
  document.querySelector('.probe').addEventListener('submit',event => {
    event.preventDefault();
    probe([$('u').valueAsNumber,$('v').valueAsNumber]);
  });

  function point(event) {
    const field = canvas.getBoundingClientRect(), [u,v,U,V] = map.bounds;
    const x = cap((event.clientX-field.left)/field.width,0,1), y = cap((event.clientY-field.top)/field.height,0,1);
    return [u+(U-u)*x,v+(V-v)*y];
  }
  canvas.addEventListener('pointerdown',event => {
    if (event.button !== 0 || drawing) return;
    const at = point(event), mode = $('mode').value;
    if (mode === 'inspect') { probe(at); return; }
    if ([$('radius'),$('speed'),$('angle')].some(node => !node.disabled && !node.closest('[hidden]') &&
        (!node.value.trim() || !node.checkValidity()))) {
      notice('Enter a valid brush speed, radius and angle.'); return;
    }
    const angle = $('angle').valueAsNumber * Math.PI/180;
    const direction = mode === 'paint' && $('heading').value === 'fixed' ? [Math.cos(angle),Math.sin(angle)] : 'stroke';
    drawing = { pointer:event.pointerId,points:[at],options:{ mode,direction,radius:$('radius').valueAsNumber,
      speed:mode === 'erase' ? 0 : $('speed').valueAsNumber,opacity:$('opacity').valueAsNumber } };
    canvas.setPointerCapture(event.pointerId);
    paintOverlay();
  });
  function append(event) {
    if (drawing?.pointer !== event.pointerId) return;
    const at = point(event), path = drawing.points, prior = path.at(-1), [u,v,U,V] = map.bounds;
    if (Math.hypot((at[0]-prior[0])/(U-u),(at[1]-prior[1])/(V-v)) < .001) return;
    if (path.length === 1024) path.splice(1,1);
    path.push(at);
  }
  canvas.addEventListener('pointermove',event => {
    if (!drawing) return;
    append(event);
    paintOverlay();
  });
  canvas.addEventListener('pointerup',event => {
    if (drawing?.pointer !== event.pointerId) return;
    append(event);
    const { points,options } = drawing;
    drawing = null;
    focus = points.at(-1);
    try {
      const result = map.stroke({ points,...options });
      if (result.changed) refresh(result.changed+' cells updated');
      else {
        probe(focus);
        notice(points.length === 1 && options.mode === 'paint' && options.direction === 'stroke' ?
          'Drag to set a direction, or choose Fixed angle.' : 'No cells changed');
      }
    } catch (error) { paintOverlay(); notice(error.message); }
  });
  function cancel(event) {
    if (drawing?.pointer !== event.pointerId) return;
    drawing = null;
    paintOverlay();
  }
  canvas.addEventListener('lostpointercapture',cancel);
  canvas.addEventListener('pointercancel',cancel);

  function replace(next,message) {
    map = next; focus = drawing = null;
    const [u,v,U,V] = map.bounds;
    $('radius').value = Math.max(.000001,Math.min(1e6,Math.min(U-u,V-v)*.12));
    refresh(message);
  }
  $('new').onclick = () => {
    load++;
    const { width,height,bounds } = map;
    replace(KIT.flowMap.create({ width,height,bounds }),'Empty map');
  };
  $('open').onchange = async event => {
    const selected = event.target.files[0], request = ++load;
    if (!selected) return;
    try {
      const next = KIT.flowMap.open(JSON.parse(await selected.text()));
      if (request === load) replace(next,'Opened '+selected.name);
    } catch (error) { if (request === load) notice(error.message); }
    event.target.value = '';
  };
  $('export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(map.asset())+'\n'],{ type:'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'ink-flow-map.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    notice('Exported flow map JSON');
  };
  $('undo').onclick = () => { if (map.undo()) refresh('Stroke undone'); };
  $('redo').onclick = () => { if (map.redo()) refresh('Stroke restored'); };
  $('restart').onclick = restart;
  function play() { $('toggle').textContent = run ? 'Pause' : 'Play'; }
  $('toggle').onclick = () => { run = !run; play(); };
  function loop(time) {
    if (run && !drawing && time-last >= 1000/30) {
      last = time;
      $('time').value = previews.advance().toFixed(2)+' s';
    }
    requestAnimationFrame(loop);
  }
  tools(); play(); refresh('');
  requestAnimationFrame(loop);
})();
