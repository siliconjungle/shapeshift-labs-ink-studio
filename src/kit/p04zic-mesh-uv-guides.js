/* Raster UV guides into Ink's editable pixel layer runs. */
const meshUVGuides = (() => {
  const {fields,tuple,integer,sorted,name} = meshUVRegions;
  const stock = {'uv-ink':'#f4dbac','uv-paint':'#456878','uv-check-light':'#618e92','uv-check-dark':'#31535d'};
  const swatchId = id=>typeof id==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
  const color = value=>typeof value==='string' && /^#[\da-f]{6}$/i.test(value);

  function style({outline={},fill=false,palette={}}) {
    if (outline!==false && !fields(outline,['mode','swatch']) ||
        fill!==false && !fields(fill,fill?.mode==='checker' ? ['mode','swatches','size'] : ['mode','swatch']) ||
        !palette || Object.getPrototypeOf(palette)!==Object.prototype ||
        Object.entries(palette).some(([id,value])=>!swatchId(id) || !color(value)))
      throw new TypeError('Use UV outline and fill settings with named RGB swatches');
    const stroke = outline!==false && {mode:outline.mode ?? 'charts',swatch:outline.swatch ?? 'uv-ink'};
    const pigment = fill!==false && (fill.mode==='checker' ? {mode:fill.mode,
      swatches:fill.swatches ?? ['uv-check-light','uv-check-dark'],size:fill.size ?? 8} :
      {mode:fill.mode,swatch:fill.swatch ?? 'uv-paint'});
    if ((!stroke && !pigment) || stroke && !['charts','faces'].includes(stroke.mode) ||
        pigment && (!['solid','checker'].includes(pigment.mode) ||
          pigment.mode==='checker' && (!tuple(pigment.swatches,2,swatchId) ||
            pigment.swatches[0]===pigment.swatches[1] || !integer(pigment.size,1,512))))
      throw new RangeError('Choose chart or face outlines, a solid fill, or a two-swatch checker with a positive size');
    const references = [...(pigment ? pigment.swatches ?? [pigment.swatch] : []),...(stroke ? [stroke.swatch] : [])];
    const entries = [...new Set(references)].map(id=>{
      const value = Object.hasOwn(palette,id) ? palette[id] : Object.hasOwn(stock,id) ? stock[id] : undefined;
      if (!swatchId(id) || !color(value)) throw new RangeError('Unknown UV guide swatch '+id);
      return [id,value];
    });
    return {outline:stroke,fill:pigment,palette:Object.fromEntries(entries)};
  }

  function trace(g, selected, atlas, [left,top,width,height], mode) {
    const mask = new Uint8Array(width*height), segments = new Set();
    let work = 0;
    const emit = (x,y)=>{
      if (x>=0 && y>=0 && x<width && y<height) mask[y*width+x] = 1;
    };
    for (const {kind,sides} of g.edges.values()) {
      if (mode==='charts' && kind==='continuous' && sides.every(side=>selected.has(side.face))) continue;
      for (const {face,uv} of sides) {
        if (!selected.has(face)) continue;
        const pixels = uv.map(pair=>MaterialUV.texel(pair,...atlas).map(Math.round));
        if (pixels[0][1]*atlas[0]+pixels[0][0]>pixels[1][1]*atlas[0]+pixels[1][0]) pixels.reverse();
        const [a,b] = pixels.map(([x,y])=>[x-left,y-top]);
        if ([0,1].some((i)=>Math.max(a[i],b[i])<0 || Math.min(a[i],b[i])>=[width,height][i])) continue;
        const key = pixels.join('/');
        if (segments.has(key)) continue;
        work += 1+Math.max(Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));
        if (work>4000000) throw new RangeError('UV guide outlines exceed their drawing budget. Choose fewer charts.');
        segments.add(key);
        emit(...a);
        PixelPaintTools.segment(a,b,emit);
      }
    }
    return {mask,segments:segments.size};
  }

  function layer(id,label,mask,width,paint) {
    const slots = new Map();
    let pixels = 0;
    for (let p=0;p<mask.length;p++) if (mask[p]) {
      const swatch = paint(p%width,Math.floor(p/width));
      if (!slots.has(swatch)) slots.set(swatch,[]);
      slots.get(swatch).push(p);
      pixels++;
    }
    return {definition:{id,label},evidence:{id,pixels},cel:{marks:[...slots].map(([swatch,indices])=>
      ({swatch,runs:PixelPaintTools.runs(width,indices)}))}};
  }

  function create(g, request, faceIds, atlasFor) {
    if (!fields(request,['revision','atlas','crop','material','uvSet','ids','domain','selection','outline','fill','palette']) ||
        request.material!==undefined && !name(request.material))
      throw new TypeError('Use UV guide settings with an optional atlas, material, and face or island selection');
    const faces = faceIds.filter(id=>request.material===undefined || request.material===g.faces.get(id).material);
    if (!faces.length) throw new RangeError('Choose at least one UV guide face on the requested material');
    const selected = new Set(faces), islands = sorted(faces.map(id=>g.atIsland.get(id)));
    const materials = sorted(faces.map(id=>g.faces.get(id).material));
    let size = request.atlas;
    if (size===undefined) {
      const inferred = materials.map(id=>atlasFor?.(id)?.size);
      size = inferred[0];
      if (!size || inferred.some(value=>!value || !value.every((n,i)=>n===size[i])))
        throw new RangeError('Specify atlas dimensions or choose faces with matching registered atlas sizes');
    }
    if (!tuple(size,2,n=>integer(n,1,4096))) throw new RangeError('UV guides need valid atlas dimensions');
    const crop = request.crop ?? [0,0,...size];
    if (!tuple(crop,4,n=>integer(n,0,4096)) ||
        !crop.slice(2).every((n,i)=>integer(n,1,512) && crop[i]+n<=size[i]))
      throw new RangeError('Editable UV guides need an in-bounds crop from 1 to 512 pixels on each axis');
    const [left,top,width,height] = crop, {outline,fill,palette} = style(request);
    const layers = [];
    let scanlines = 0, segments = 0;
    if (fill) {
      const triangles = g.triangles().filter(row=>selected.has(row.face)).map(({corners})=>
        corners.map(id=>MaterialUV.texel(g.corners.get(id).uv,...size).map((n,i)=>n-crop[i])));
      const raster = MeshUV.texelMask(triangles,width,height);
      scanlines = raster.scanlines;
      const paint = fill.mode==='checker' ? (x,y)=>fill.swatches[(Math.floor((x+left)/fill.size)+Math.floor((y+top)/fill.size))%2] :
        ()=>fill.swatch;
      layers.push(layer('uv-fill','UV chart fill',raster.mask,width,paint));
    }
    if (outline) {
      const raster = trace(g,selected,size,crop,outline.mode);
      segments = raster.segments;
      layers.push(layer('uv-outline','UV outlines',raster.mask,width,()=>outline.swatch));
    }
    const document = {format:'ink-studio/pixel-art',version:2,width,height,pixelAspect:[1,1],palette,
      layers:layers.map(row=>row.definition),frames:[{id:'guide',durationMs:100,
        cels:Object.fromEntries(layers.map(row=>[row.definition.id,row.cel]))}]};
    return {document,report:{atlas:[...size],...(request.crop!==undefined && {crop:[...crop]}),coordinates:{origin:'top-left',units:'texel-centers'},
      faces,islands,materials,outline,fill,segments,scanlines,layers:layers.map(row=>row.evidence)}};
  }

  return Object.freeze({create});
})();
