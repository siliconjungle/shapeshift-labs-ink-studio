/* Shared layout for exact screen ownership and source texels in a portable preview. */
const MaterialPreviewAOV = (() => {
  const maps = Object.freeze({
    baseColor:'Base color', normal:'Tangent normal', roughness:'Roughness', ao:'Ambient occlusion',
    height:'Height', opacity:'Opacity', emission:'Emission', metalness:'Metalness'
  });
  const diagnostics = Object.freeze({
    'material-id':'Material ID', 'surface-uv':'Surface UV', 'surface-depth':'Surface depth',
    'surface-coverage':'Surface coverage', 'map-bindings':'Map bindings'
  });
  const encodings = Object.freeze({
    unorm8:['getUint8',1], unorm16:['getUint16',2], float32:['getFloat32',4], float64:['getFloat64',8]
  });
  const stride = 17;
  const clamp = n => Math.max(0,Math.min(1,n));
  const byte = n => Math.round(clamp(n)*255);
  const address = (u, size) => Math.min(size - 1,Math.floor(clamp(u)*size));
  const label = key => key === 'beauty' ? 'Beauty' : maps[key] ?? diagnostics[key] ?? key;
  function texel(map, u, v) {
    return [address(u,map.width),address(v,map.height)];
  }
  function screen(data, pixel) {
    const at = pixel * stride, index = data.getUint8(at) - 1;
    if (index < 0) return null;
    return { index, uv:[data.getFloat32(at+1,true),data.getFloat32(at+5,true)],
      depth:data.getFloat32(at+9,true), coverage:data.getFloat32(at+13,true) };
  }
  function sample(data, map, u, v) {
    const [x,y] = texel(map,u,v), names = map.descriptor.layout;
    const [read, size] = encodings[map.descriptor.precision];
    const offset = (y * map.width + x) * names.length * size;
    return { x,y, lanes:Array.from(names, (name,i)=>({ name:name.toUpperCase(), value:data[read](offset+i*size,true) })) };
  }
  function diagnostic(key, row, region, range) {
    switch (key) {
      case 'material-id': {
        const value = Math.imul(row.index+1,0x9e3779b1);
        return [value>>>16&255,value>>>8&255,value&255];
      }
      case 'surface-uv': return [byte(row.uv[0]),byte(row.uv[1]),112];
      case 'surface-depth': {
        const level=byte(1-.85*(row.depth-range[0])/(range[1]-range[0]||1));
        return [level,level,level];
      }
      case 'surface-coverage': {
        const level=byte(row.coverage);
        return [level,level,level];
      }
      case 'map-bindings': return region.maps.length ? [90,174,157] : [246,151,72];
    }
  }
  const absent = Object.freeze([78,68,91,255]);
  function render(pass, width, height, data, regions, projected, range) {
    const rgba = new Uint8ClampedArray(width*height*4);
    for (let p=0; p<width*height; p++) {
      const row = screen(data,p);
      if (!row) continue;
      const r = regions[row.index], i = p*4;
      if (Object.hasOwn(diagnostics,pass)) {
        rgba.set(diagnostic(pass,row,r,range),i);
        rgba[i+3]=255;
      } else {
        const cell = projected[row.index];
        if (!cell) { rgba.set(absent,i); continue; }
        const [x,y] = texel(cell,row.uv[0],row.uv[1]), offset = (y*cell.width+x)*4;
        rgba.set(cell.rgba.subarray(offset,offset+4),i);
        rgba[i+3]=255;
      }
    }
    return rgba;
  }
  return Object.freeze({ maps, diagnostics, encodings, stride, address, label, texel, screen, sample, render });
})();
if (typeof module !== 'undefined') module.exports = MaterialPreviewAOV;
