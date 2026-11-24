// Paint is evaluated on a surface hit in the solid's rest frame.
(function (K) {
  const { V } = K;
  const maxCells = 4096, maxStrokes = 256, maxMasks = 32;
  const named = name=>typeof name==='string' && /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,95}$/.test(name) &&
    !['__proto__','constructor','prototype'].includes(name);
  const record = value=>value && Object.getPrototypeOf(value)===Object.prototype;
  const fields = (value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key));
  const finite = (value,min,max)=>Number.isFinite(value) && value>=min && value<=max;
  const vector = (value,length,check)=>Array.isArray(value) && value.length===length && Array.from(value).every(check);
  const xyz = value=>vector(value,3,Number.isFinite);

  function values({ material,masks },roles) {
    if (material!==undefined && material!==null && (typeof material!=='string' || !Object.hasOwn(roles,material)))
      throw new RangeError('SDF paint needs a known palette role or null to clear it');
    if (masks!==undefined && (!record(masks) || !Object.keys(masks).length || Object.keys(masks).length>maxMasks ||
        Object.entries(masks).some(([name,value])=>!named(name) || value!==null && !finite(value,0,1))))
      throw new RangeError('SDF paint masks need 1–'+maxMasks+' named values from 0 to 1 or null to clear a value');
    if (material===undefined && masks===undefined) throw new TypeError('SDF paint needs a material role or named masks');
  }

  function basis(projection) {
    if (!fields(projection,['origin','right','down','forward','perspective']) ||
        !['origin','right','down','forward'].every(key=>xyz(projection[key])) || typeof projection.perspective!=='boolean')
      throw new TypeError('SDF paint needs a local camera projection');
    const { right,down,forward } = projection, u=V.cross(down,forward), v=V.cross(forward,right), z=V.cross(right,down);
    const determinant=V.dot(right,u);
    if (!Number.isFinite(determinant) || Math.abs(determinant)<1e-24)
      throw new RangeError('SDF paint projection needs three independent directions');
    return [u,v,z].map(axis=>V.mul(axis,1/determinant));
  }

  function prepare(definition,roles,palette) {
    if (!fields(definition,['version','strokes']) || definition.version!==1 || !Array.isArray(definition.strokes) ||
        !definition.strokes.length || definition.strokes.length>maxStrokes)
      throw new TypeError('SDF paint version 1 needs 1–'+maxStrokes+' strokes');
    const ids = new Set();
    const strokes = Array.from(definition.strokes,stroke=>{
      if (!fields(stroke,['id','grid','projection','cells','material','masks']) || !TargetSelectors.name(stroke.id) ||
          ids.has(stroke.id) || !vector(stroke.grid,2,n=>Number.isSafeInteger(n)&&n>0&&n<=16384) ||
          !Array.isArray(stroke.cells) || !stroke.cells.length || stroke.cells.length>maxCells)
        throw new TypeError('SDF paint strokes need unique IDs, a native grid and 1–'+maxCells+' cells');
      ids.add(stroke.id);
      values(stroke,roles);
      const axes=basis(stroke.projection), cells=new Map(), [width,height]=stroke.grid;
      for (const cell of stroke.cells) {
        if (!vector(cell,5,()=>true)) throw new TypeError('Invalid SDF paint cell');
        const [x,y,point,normal,band]=cell, key=y*width+x;
        if (!Number.isSafeInteger(x) || x<0 || x>=width || !Number.isSafeInteger(y) || y<0 || y>=height ||
            !xyz(point) || !xyz(normal) || Math.abs(V.len(normal)-1)>.001 || !Number.isFinite(band) || band<=0 || cells.has(key))
          throw new TypeError('SDF paint cells need distinct pixels, local contacts, unit normals and positive thickness');
        cells.set(key,{point,normal,band});
      }
      return { ...stroke,axes,cells };
    });
    if (!palette) return;
    const tones = new Map();
    function locate(point,normal,epsilon=0) {
      let material, masks;
      for (const stroke of strokes) {
        const { grid:[w,h],projection,axes,cells }=stroke;
        const { origin,perspective }=projection, ray=V.sub(point,origin);
        const depth=V.dot(axes[2],ray), div=perspective ? depth : 1;
        if (depth<=0) continue;
        const x=Math.floor(w*.5+V.dot(axes[0],ray)/div), y=Math.floor(h*.5+V.dot(axes[1],ray)/div);
        if (x<0 || x>=w || y<0 || y>=h) continue;
        const cell=cells.get(y*w+x);
        if (!cell || V.dot(cell.normal,normal)<.6 ||
            Math.abs(V.dot(cell.normal,V.sub(point,cell.point)))>cell.band+epsilon) continue;
        if (stroke.material!==undefined) material=stroke.material;
        if (stroke.masks) Object.assign(masks??={},stroke.masks);
      }
      if (material===undefined && !masks) return;
      return { material,masks, ...(material && { tint:tones.get(material) ?? register(material) }) };
    }
    function register(role) {
      const ramp=roles[role].map(index=>[palette[index]>>16&255,palette[index]>>8&255,palette[index]&255].map(n=>n/255));
      const tint = rgb=>{
        const shade=Math.max(0,Math.min(1,.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]))*(ramp.length-1);
        const i=Math.floor(shade);
        return V.lerp(ramp[i],ramp[Math.min(i+1,ramp.length-1)],shade-i);
      };
      tones.set(role,tint);
      return tint;
    }
    return { locate };
  }

  K.procedural.sdfMaterialPaint = { prepare,values,maxCells,maxStrokes };
})(KIT);
