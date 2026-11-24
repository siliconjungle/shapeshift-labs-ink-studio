/* Lossless, top-left native-grid source view. IDs are slots into the accompanying tables. */
const PixelViewSource = (() => {
  const format = 'ink-studio/pixel-view-source', version = 1;
  const channels = Object.freeze({
    coverage:1, surfaceCoverage:1, objectId:1, partId:1, materialId:1, splatId:1,
    surfaceKind:1, depth:1, geometricNormal:3, shadingNormal:3, position:3, objectPosition:3,
    surfaceUV:2, surfaceUVValid:1
  });
  const optional = {
    pigment:1, foregroundCoverage:1, fogTransmittance:1, inkMask:1, inkShadow:1, emission:3,
    paletteOwner:1, sourceSurface:1, sourceTriangle:1, sourceCoordinates:3,
    sourceSplat:4, sourceSplatAlpha:4, sourceSplatDepth:4, sourceSplatWeight:4, sourceSplatOmitted:1,
    sourceSplatFrontRank:1, sourceSplatFront:1, sourceSplatFrontMetrics:3,
    strandId:1, strandDepth:1, strandCoverage:1, strandU:1, strandTangent:3
  };
  const tables = ['objects','parts','materials','surfaceKinds'];
  const optionalTables = ['paletteOwners','strands','surfaceSources','splatSources'];
  const bindingGroups = [
    ['surfaceSources','sourceSurface','sourceTriangle','sourceCoordinates'],
    ['splatSources','sourceSplat','sourceSplatAlpha','sourceSplatDepth','sourceSplatWeight','sourceSplatOmitted']
  ];
  const types = { Uint8Array, Uint8ClampedArray, Uint32Array, Float32Array };
  const ids = new Set(['pigment','objectId','partId','materialId','splatId','paletteOwner','strandId','sourceSurface','sourceTriangle','sourceSplat','sourceSplatFront']);
  const masks = new Set(['surfaceKind','surfaceUVValid','inkMask','sourceSplatFrontRank']);
  const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
  const finite = Number.isFinite;
  const name = value => typeof value === 'string' && !!value.trim();
  const vector = (value,n) => Array.isArray(value) && value.length === n && Array.from(value).every(finite);
  const node = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

  function grid(w,h) {
    if (![w,h].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 512))
      throw new RangeError('A pixel source view needs a native grid up to 512 × 512');
  }

  function metadata(view,w,h) {
    const { id,source,frame,camera } = view ?? {};
    if (!name(id) || !name(source) || !vector(view.grid,2) || view.grid[0] !== w || view.grid[1] !== h ||
        view.origin !== 'top-left' || !frame || ![frame.time,frame.poseTime,frame.cameraTime,frame.skyTime].every(finite) ||
        !Number.isSafeInteger(frame.index) || frame.index < 0 ||
        !camera || !vector(camera.matrix,16) || !vector(camera.eye,3) || !vector(camera.target,3) ||
        ![camera.fov,camera.focal,camera.near,camera.far,camera.yaw,camera.pitch,camera.distance,camera.lensScale].every(finite) ||
        camera.focal <= 0 || camera.near <= 0 || camera.far <= camera.near ||
        typeof camera.orthographic !== 'boolean')
      throw new TypeError('Invalid pixel source view camera, frame, or grid');
  }

  function encode(data) {
    const type = data.constructor.name;
    let bytes = new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    if (!littleEndian && data.BYTES_PER_ELEMENT > 1) bytes = endian(bytes.slice());
    return { type,bytes:node ? Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64') :
      btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')) };
  }

  // All supported multi-byte planes use four-byte words. Preserve their exact bits.
  function endian(bytes) {
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const a = bytes[offset], b = bytes[offset+1];
      bytes[offset] = bytes[offset+3];
      bytes[offset+1] = bytes[offset+2];
      bytes[offset+2] = b;
      bytes[offset+3] = a;
    }
    return bytes;
  }

  function decode(data,count,expected,key) {
    const { type,bytes } = data ?? {};
    const Type = Object.hasOwn(types,type) && types[type];
    if (!Type || !expected.includes(type) || typeof bytes !== 'string' ||
        bytes.length !== 4*Math.ceil(count*Type.BYTES_PER_ELEMENT/3))
      throw new TypeError('Invalid pixel source view plane '+key);
    const raw = node ? Uint8Array.from(Buffer.from(bytes,'base64')) : Uint8Array.from(atob(bytes),b=>b.charCodeAt(0));
    if (raw.length !== count*Type.BYTES_PER_ELEMENT)
      throw new TypeError('Invalid pixel source view plane '+key);
    return new Type((!littleEndian && Type.BYTES_PER_ELEMENT > 1 ? endian(raw) : raw).buffer);
  }

  function transform(frame,convert) {
    const { w,h,scene,time,sourceView,rgb,alpha,passes,palettePixel,pixelFragments,strandPixel,bindingEvidence } = frame;
    grid(w,h);
    metadata(sourceView,w,h);
    if (!name(scene) || time !== sourceView.frame.time || !passes || passes.w !== w || passes.h !== h)
      throw new TypeError('Pixel source passes must match the captured native grid and frame');
    const plane = (data,components,expected,key) => convert(data,w*h*components,expected,key);
    const result = { w,h };
    for (const [key,components] of Object.entries({ ...channels,...optional })) {
      if (passes[key] === undefined && !Object.hasOwn(channels,key)) continue;
      const expected = ids.has(key) ? ['Uint32Array'] : masks.has(key) ? ['Uint8Array'] : ['Float32Array'];
      result[key] = plane(passes[key],components,expected,key);
    }
    for (const key of [...tables,...optionalTables.filter(key=>passes[key] !== undefined)]) {
      if (!Array.isArray(passes[key])) throw new TypeError('Invalid pixel source view table '+key);
      result[key] = passes[key];
    }
    for (const [table,...names] of bindingGroups) {
      const captured = [table,...names].some(key=>result[key] !== undefined);
      if (captured && (result[table]?.[0] !== null || names.some(key=>!result[key])))
        throw new TypeError('Incomplete pixel source view binding planes for '+table);
    }
    if (result.sourceSplatFrontRank && !result.sourceSplat ||
        (result.sourceSplatFront || result.sourceSplatFrontMetrics) &&
          !(result.sourceSplatFrontRank && result.sourceSplatFront && result.sourceSplatFrontMetrics))
      throw new TypeError('Incomplete pixel source view frontmost splat planes');
    let paired;
    if (bindingEvidence !== undefined) {
      const { object,part,visible,projected,depth } = bindingEvidence ?? {};
      if (!name(object) || part !== undefined && !name(part))
        throw new TypeError('Invalid pixel source view binding evidence');
      paired = { object,...(part !== undefined && {part}),
        visible:plane(visible,1,['Float32Array'],'binding visible coverage'),
        projected:plane(projected,1,['Float32Array'],'binding projected coverage'),
        depth:plane(depth,1,['Float32Array'],'binding projected depth') };
    }
    const colorBytes = ['Uint8Array','Uint8ClampedArray'];
    return { w,h,scene,time,sourceView,passes:result,
      ...(rgb !== undefined && { rgb:plane(rgb,3,colorBytes,'rgb') }),
      ...(alpha !== undefined && { alpha:plane(alpha,1,colorBytes,'alpha') }),
      palettePixel,pixelFragments,strandPixel,...(paired && { bindingEvidence:paired }) };
  }

  function pack(frame,{ color = true } = {}) {
    const input = color ? frame : { ...frame,rgb:undefined,alpha:undefined };
    return { format,version,...transform(input,(data,count,expected,key)=>{
      if (!ArrayBuffer.isView(data) || data.length !== count || !expected.includes(data.constructor.name))
        throw new TypeError('Invalid pixel source view plane '+key);
      return encode(data);
    }) };
  }

  function unpack(frame) {
    if (frame?.format !== format || frame.version !== version)
      throw new TypeError('Pixel source views need format '+format+' version '+version);
    return transform(frame,decode);
  }

  return Object.freeze({ grid,pack,unpack,channels:Object.freeze(Object.keys(channels)) });
})();
if (typeof module !== 'undefined') module.exports = PixelViewSource;
