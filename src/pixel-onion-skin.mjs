const frameLimit = 8;

const controls = `
  <details class="pixel-onion">
    <summary>Onion skin</summary>
    <div class="pixel-onion-controls">
      <label><input type="checkbox" data-onion-enabled> Show onion skin</label>
      <label><input type="checkbox" data-onion-changes> Changes only</label>
    </div>
    <div class="pixel-onion-sides">
      ${[['previous','Previous frames','#ff7495'],['next','Next frames','#78dcc6']].map(([side,label,tint])=>`
        <fieldset data-onion-side="${side}">
          <legend>${label}</legend>
          <label>Count <input type="number" min="0" max="${frameLimit}" step="1" value="1" data-onion-count></label>
          <label>Tint <input type="color" value="${tint}" data-onion-tint></label>
          <label>Opacity <input type="number" min="0" max="100" step="1" value="35" data-onion-opacity>%</label>
        </fieldset>`).join('')}
    </div>
    <output aria-live="polite"></output>
  </details>`;

const boundedInteger = (value,max)=>Math.min(max,Math.max(0,Math.round(value) || 0));

function samePixel(active,neighbor,p) {
  return active[p+3] === neighbor[p+3] && (!active[p+3] ||
    active[p] === neighbor[p] && active[p+1] === neighbor[p+1] && active[p+2] === neighbor[p+2]);
}

/** Tint neighboring cels without changing the active frame's RGBA. */
export function composeOnionSkin(active,ghosts,changesOnly = false) {
  const result = new Uint8ClampedArray(active.length);
  for (let p = 0; p < result.length; p += 4) {
    let opacity = 0, weight = 0, red = 0, green = 0, blue = 0;
    for (const { rgba,tint,amount } of ghosts) {
      if (changesOnly && samePixel(active,rgba,p)) continue;
      const visible = rgba[p+3] || (changesOnly ? active[p+3] : 0);
      const alpha = visible*amount;
      if (!alpha) continue;
      opacity = Math.max(opacity,alpha);
      weight += alpha;
      red += tint[0]*alpha;
      green += tint[1]*alpha;
      blue += tint[2]*alpha;
    }
    if (!weight) continue;
    result[p] = red/weight;
    result[p+1] = green/weight;
    result[p+2] = blue/weight;
    result[p+3] = Math.round(opacity);
  }
  return result;
}

export function mountPixelOnionSkin(host,view) {
  host.innerHTML = controls;
  const enabled = host.querySelector('[data-onion-enabled]');
  const changes = host.querySelector('[data-onion-changes]');
  const status = host.querySelector('output');
  const sides = [...host.querySelectorAll('[data-onion-side]')].map((row,i)=>({
    direction:i === 0 ? -1 : 1,
    count:row.querySelector('[data-onion-count]'),
    opacity:row.querySelector('[data-onion-opacity]'),
    tint:row.querySelector('[data-onion-tint]')
  }));
  let source, cacheKey, playing = false, epoch = 0, drawn;
  const cache = new Map();

  function frameBytes(index) {
    if (!cache.has(index)) {
      const { readFrame,rgba } = source;
      const pending = Promise.resolve().then(()=>readFrame(index)).then(bytes=>{
        if (!ArrayBuffer.isView(bytes) || bytes.length !== rgba.length)
          throw new RangeError('Neighboring cels must use the active native grid');
        return bytes;
      });
      cache.set(index,pending);
    }
    return cache.get(index);
  }

  async function refresh() {
    const serial = ++epoch;
    enabled.disabled = !source || source.count < 2;
    if (enabled.disabled || !enabled.checked || playing) {
      drawn = undefined;
      view.setOnionSkin(null);
      status.value = playing && enabled.checked ? 'Onion skin paused during playback.' : '';
      return;
    }
    const onlyChanges = changes.checked, { index,count,rgba } = source;
    const neighbors = sides.flatMap(side=>{
      const countLimit = boundedInteger(side.count.valueAsNumber,frameLimit);
      const opacity = boundedInteger(side.opacity.valueAsNumber,100)/100;
      const tint = side.tint.value.slice(1).match(/../g).map(part=>parseInt(part,16));
      return Array.from({ length:countLimit },(_,i)=>{
        const distance = i+1;
        return { frame:index+distance*side.direction,amount:opacity/distance,tint };
      }).filter(row=>row.frame >= 0 && row.frame < count && row.amount > 0);
    });
    const signature = JSON.stringify([onlyChanges,index,neighbors]);
    if (!onlyChanges && drawn === signature) return;

    const activeFrames = new Set(neighbors.map(row=>row.frame));
    for (const frame of cache.keys()) if (!activeFrames.has(frame)) cache.delete(frame);
    try {
      const ghosts = await Promise.all(neighbors.map(async row=>({ ...row,rgba:await frameBytes(row.frame) })));
      if (serial !== epoch) return;
      drawn = signature;
      view.setOnionSkin(ghosts.length ? composeOnionSkin(rgba,ghosts,onlyChanges) : null);
      status.value = '';
    } catch {
      if (serial !== epoch) return;
      drawn = undefined;
      cache.clear();
      view.setOnionSkin(null);
      status.value = 'Onion skin could not read the neighboring frames.';
    }
  }

  host.addEventListener('input',refresh);
  for (const side of sides) for (const [input,max] of [[side.count,frameLimit],[side.opacity,100]]) {
    input.addEventListener('change',()=>{
      input.value = boundedInteger(input.valueAsNumber,max);
      refresh();
    });
  }
  enabled.disabled = true;
  return {
    setSource(next) {
      if (next?.key !== undefined && next.key !== cacheKey) {
        cacheKey = next.key;
        cache.clear();
        drawn = undefined;
      }
      if (next?.index !== source?.index || next?.rgba.length !== source?.rgba.length) view.setOnionSkin(null);
      source = next;
      refresh();
    },
    setPlaying(value) {
      playing = value;
      refresh();
    }
  };
}
