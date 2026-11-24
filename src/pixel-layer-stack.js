/* Native indexed layer stacks. Groups resolve in isolation before compositing. */
const PixelLayerStack = (() => {
  const kinds = Object.freeze(['paint','mask','reference','group','surface']);
  const blends = Object.freeze(['normal','multiply','screen','overlay','add']);
  const keys = ['id','label','kind','parent','clip','visible','locked','opacity','blend','protect','destination'];
  const id = value=>typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const record = value=>value && Object.getPrototypeOf(value) === Object.prototype;
  const unit = value=>Number.isFinite(value) && value >= 0 && value <= 1;

  function prepare(layers) {
    if (!Array.isArray(layers) || !layers.length || layers.length > 64)
      throw new RangeError('A pixel stack needs 1–64 layers');
    const rows = new Map(), children = new Map([[undefined,[]]]);
    for (const layer of layers) {
      if (!record(layer) || Object.keys(layer).some(key=>!keys.includes(key)) || !id(layer.id) ||
          rows.has(layer.id) || (layer.kind !== undefined && !kinds.includes(layer.kind)) ||
          layer.label !== undefined && (typeof layer.label !== 'string' || !layer.label.trim()) ||
          ['visible','locked','protect'].some(key=>layer[key] !== undefined && typeof layer[key] !== 'boolean') ||
          layer.opacity !== undefined && !unit(layer.opacity) ||
          layer.blend !== undefined && !blends.includes(layer.blend))
        throw new TypeError('Pixel layers need unique IDs, known kinds and valid visibility, opacity and blend settings');
      const parent = rows.get(layer.parent);
      if (layer.parent !== undefined && parent?.kind !== 'group')
        throw new RangeError('Layer '+layer.id+' needs an earlier parent group');
      const clip = rows.get(layer.clip);
      if (layer.clip !== undefined && (!clip || clip.parent !== layer.parent ||
          clip.kind === 'reference' && layer.kind !== 'reference'))
        throw new RangeError('Layer '+layer.id+' must clip to an earlier compatible sibling');
      if (layer.kind === 'surface' ? !id(layer.destination) : layer.destination !== undefined)
        throw new TypeError('A surface layer needs a named scene destination');
      const row = { ...layer,kind:layer.kind ?? 'paint',index:rows.size+1,
        effectiveLock:layer.locked || parent?.effectiveLock || false };
      rows.set(row.id,row);
      children.get(layer.parent).push(row);
      if (row.kind === 'group') children.set(row.id,[]);
    }
    return { rows,children };
  }

  function mix(front,rear,weight,behind,blend,overlap) {
    let packed = 0;
    for (const shift of [16,8,0]) {
      const a = front>>>shift&255, b = rear>>>shift&255;
      let combined = a;
      if (blend === 'multiply') combined = a*b/255;
      if (blend === 'screen') combined = 255-(255-a)*(255-b)/255;
      if (blend === 'overlay') combined = b <= 127.5 ? 2*a*b/255 : 255-2*(255-a)*(255-b)/255;
      if (blend === 'add') combined = Math.min(255,a+b);
      const value = (a*weight+(combined-a)*overlap+b*behind)/(weight+behind);
      packed |= Math.round(value)<<shift;
    }
    return packed;
  }

  function compose(width,height,colors,stack,read,{ capture,references = false,trace } = {}) {
    const size = width*height, layerIds = [null,...stack.rows.keys()], layerSources = capture ? new Map() : undefined;
    const empty = ()=>({
      slots:new Int16Array(size).fill(-1), owners:new Uint8Array(size), locks:new Uint8Array(size),
      underSlots:new Int16Array(size).fill(-1), underOwners:new Uint8Array(size),
      opacity:new Uint8Array(size), mixedColors:new Uint32Array(size), usesAlpha:false
    });
    function branch(parent,shown,steps) {
      const buffer = empty(), masks = new Map();
      const { slots,owners,locks,underSlots,underOwners,opacity,mixedColors } = buffer;
      for (const row of stack.children.get(parent)) {
        const { kind,blend = 'normal',opacity:layerAlpha = 1 } = row;
        const visible = shown && row.visible !== false && layerAlpha > 0 && (references || kind !== 'reference');
        const clip = masks.get(row.clip), mask = new Uint8Array(size);
        masks.set(row.id,mask);
        const group = kind === 'group';
        const step = steps && { id:row.id,label:row.label ?? row.id,kind,blend,opacity:layerAlpha,visible,
          locked:row.effectiveLock || kind === 'reference',...(row.parent !== undefined && { parent:row.parent }),
          ...(row.clip !== undefined && { clip:{ layer:row.clip,alpha:clip[0] } }),
          ...(row.destination !== undefined && { destination:row.destination }),
          ...(group && { children:[] }),contributes:false };
        if (step) steps.push(step);
        const source = group ? branch(row.id,visible,step?.children) : read(row.id);
        if (step) {
          const raw = source.slots[0], drawn = raw !== null && raw >= 0;
          step.slot = drawn ? raw : null;
          step.color = drawn ? group ? source.mixedColors[0] : colors[raw] : null;
          step.sourceAlpha = drawn ? (group ? source.opacity[0] : source.alpha?.[0] ?? 255) : 0;
          step.knockout = raw === -2;
          step.status = !shown ? 'parent-hidden' : row.visible === false ? 'hidden' : !layerAlpha ? 'zero-opacity' :
            kind === 'reference' && !references ? 'reference-disabled' :
            !drawn && !step.knockout ? 'empty' : clip && !clip[0] ? 'clipped' : 'transparent';
        }
        if (!group && (capture === true || capture === row.id)) layerSources.set(row.id,{
          ...source,clipping:clip,locked:row.effectiveLock || kind === 'reference'
        });
        buffer.usesAlpha ||= visible && (group ? source.usesAlpha || layerAlpha !== 1 || blend !== 'normal' :
          !!source.alpha || layerAlpha !== 1 || blend !== 'normal' || stack.rows.get(row.clip)?.kind === 'mask');
        if (!visible) continue;
        for (let p = 0; p < size; p++) {
          const raw = source.slots[p];
          if (raw === -1 || raw === null || clip && !clip[p]) continue;
          const strength = layerAlpha*(clip ? clip[p]/255 : 1), erase = raw === -2;
          const amount = erase ? 0 : Math.round(strength*((group ? source.opacity[p] : source.alpha?.[p]) ?? 255));
          if (!erase && !amount) continue;
          if (step) {
            step.effectiveAlpha = erase ? Math.round(255*strength) : amount;
            step.status = kind === 'mask' ? 'mask' : erase ? 'knockout' : 'paint';
            step.before = { alpha:opacity[p],color:opacity[p] ? mixedColors[p] : null };
          }
          mask[p] = kind === 'mask' || group ? amount : amount > 0 ? 255 : 0;
          if (kind === 'mask') continue;
          const slot = erase ? -1 : raw;
          if (locks[p] && kind !== 'reference') {
            if (slot !== slots[p])
              throw new RangeError(row.id+' changes a protected pixel at '+[p%width,Math.floor(p/width)].join(','));
            if (step) step.status = 'protected';
            continue;
          }
          if (erase && strength < 1) {
            opacity[p] = Math.round(opacity[p]*(1-strength));
            if (opacity[p]) {
              if (step) step.after = { alpha:opacity[p],color:mixedColors[p] };
              continue;
            }
          }
          const behind = opacity[p]*(255-amount)/255, front = group ? source.mixedColors[p] : colors[slot];
          const overlap = amount*opacity[p]/255;
          mixedColors[p] = !amount ? 0 : !behind && (blend === 'normal' || !overlap) ? front :
            mix(front,mixedColors[p],amount,behind,blend,overlap);
          opacity[p] = amount ? Math.round(amount+behind) : 0;
          if (step) step.after = { alpha:opacity[p],color:opacity[p] ? mixedColors[p] : null };
          underSlots[p] = group && source.underOwners[p] ? source.underSlots[p] : slots[p];
          underOwners[p] = group && source.underOwners[p] ? source.underOwners[p] : owners[p];
          slots[p] = slot;
          owners[p] = group ? source.owners[p] : row.index;
          locks[p] = Number(row.protect === true || group && !!source.locks[p]);
        }
      }
      return buffer;
    }
    const { usesAlpha,opacity,mixedColors,...raster } = branch(undefined,true,trace);
    return { width,height,...raster,layerIds,...(layerSources && { layerSources }),
      ...(usesAlpha && { opacity,mixedColors }) };
  }

  function inspect(stack,colors,read,{ references = false } = {}) {
    const layers = [];
    const result = compose(1,1,colors,stack,id=>{
      const { slot,alpha } = read(id);
      return { slots:[slot ?? -1],...(alpha !== undefined && { alpha:[alpha] }) };
    },{ references,trace:layers });

    function contributors(steps,visible) {
      const masks = new Set();
      for (let i = steps.length-1; i >= 0; i--) {
        const row = steps[i], paints = row.status === 'paint' || row.status === 'knockout';
        row.contributes = visible && paints || masks.has(row.id);
        if (row.contributes && row.clip) masks.add(row.clip.layer);
        if (row.children) contributors(row.children,row.contributes);
        if (row.contributes && row.effectiveAlpha === 255 &&
            (row.status === 'knockout' || row.blend === 'normal') && paints) visible = false;
      }
    }
    contributors(layers,true);
    const slot = result.slots[0], alpha = result.opacity?.[0] ?? (slot < 0 ? 0 : 255);
    return { layers,alpha,slot:slot < 0 ? null : slot,color:alpha ? result.mixedColors?.[0] ?? colors[slot] : null,
      layer:result.layerIds[result.owners[0]] };
  }

  function descendants(stack,layer) {
    const ids = [layer];
    for (const child of stack.children.get(layer) ?? []) ids.push(...descendants(stack,child.id));
    return ids;
  }

  function mergePlan(layers,operation) {
    const stack = prepare(layers), { type,layer } = operation;
    const original = new Map(layers.map(row=>[row.id,row]));
    const row = stack.rows.get(layer);
    let target, inputs, removed, whole = false;
    if (type === 'merge-down') {
      const siblings = row && stack.children.get(row.parent), at = siblings?.indexOf(row) ?? -1;
      const lower = at > 0 ? siblings[at-1] : undefined;
      if (row?.kind !== 'paint' || lower?.kind !== 'paint' || row.visible === false || lower.visible === false ||
          lower.clip !== undefined || row.clip !== undefined && row.clip !== lower.id)
        throw new RangeError('Merge down needs two visible paint siblings with clipping contained in the pair');
      const { opacity,blend,parent,clip,...base } = original.get(lower.id);
      target = { ...base,...(parent !== undefined && { parent }) };
      inputs = [lower.id,row.id].map(id=>({ ...original.get(id),parent:undefined }));
      removed = [row.id];
    } else if (type === 'flatten-group' && row?.kind === 'group') {
      const ids = new Set(descendants(stack,layer).slice(1));
      inputs = layers.filter(value=>ids.has(value.id)).map(value=>value.parent === layer ? { ...value,parent:undefined } : value);
      if (!inputs.length) throw new RangeError('Flatten needs a group with children');
      target = { ...original.get(layer),kind:'paint' };
      removed = [...ids];
    } else if (type === 'flatten' && id(layer)) {
      if (original.has(layer)) throw new RangeError('Flatten needs a new layer ID');
      whole = true;
      target = { id:layer,kind:'paint' };
      inputs = layers;
      removed = layers.map(value=>value.id);
    } else {
      throw new RangeError('Choose a paint layer, group, or new ID for the requested merge');
    }
    for (const input of inputs) {
      const { effectiveLock,kind,protect } = stack.rows.get(input.id);
      if (effectiveLock || protect || kind === 'surface')
        throw new RangeError('Merge cannot consume locked, protected or bound surface layer '+input.id);
    }
    if (row?.effectiveLock) throw new RangeError('Layer '+layer+' is locked');
    const consumed = new Set(inputs.map(value=>value.id));
    if (type === 'flatten-group') consumed.add(layer);
    for (const value of layers) if (!consumed.has(value.id) && value.clip !== undefined && consumed.has(value.clip))
      throw new RangeError('Merge would change the clipping source for '+value.id);
    const next = whole ? [target] : layers.filter(value=>!removed.includes(value.id))
      .map(value=>value.id === target.id ? target : value);
    return { layers:next,target:target.id,inputs,removed,knockouts:type === 'merge-down' };
  }

  function bake(raster,colors,resolve,keepKnockouts = false) {
    const slots = Array(raster.slots.length).fill(null), alpha = Array(slots.length).fill(255), knockouts = [];
    let partial = false;
    for (let p = 0; p < slots.length; p++) {
      const slot = raster.slots[p];
      if (slot < 0) {
        if (keepKnockouts && raster.owners[p]) knockouts.push(p);
        continue;
      }
      const rgb = raster.mixedColors?.[p] ?? colors[slot];
      slots[p] = resolve('#'+rgb.toString(16).padStart(6,'0'),undefined,slot);
      partial ||= (alpha[p] = raster.opacity?.[p] ?? 255) !== 255;
    }
    return { slots,...(partial && { alpha }),...(knockouts.length && { knockouts }) };
  }

  function image(raster,colors) {
    const rgba = new Uint8Array(raster.slots.length*4);
    for (let p = 0; p < raster.slots.length; p++) {
      if (raster.slots[p] < 0) continue;
      const color = raster.mixedColors?.[p] ?? colors[raster.slots[p]], i = p*4;
      rgba[i] = color>>>16;
      rgba[i+1] = color>>>8&255;
      rgba[i+2] = color&255;
      rgba[i+3] = raster.opacity?.[p] ?? 255;
    }
    return { width:raster.width,height:raster.height,rgba };
  }

  return Object.freeze({ prepare,compose,inspect,image,bake,descendants,mergePlan,kinds,blends });
})();
if (typeof module !== 'undefined') module.exports = PixelLayerStack;
