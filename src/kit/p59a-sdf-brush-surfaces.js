// Surface attributes for the faces introduced by a retained SDF brush.
(function(K) {
  const { V } = K;
  const allowed = (value,keys)=>value && Object.getPrototypeOf(value)===Object.prototype &&
    Object.keys(value).length>0 && Object.keys(value).every(key=>keys.includes(key));
  const finite = (n,min,max)=>Number.isFinite(n) && n>=min && n<=max;
  const sides = ['top','right','bottom','left'];

  function check(surface,roles) {
    if (surface===undefined) return;
    if (!allowed(surface,['wall','cap'])) throw new TypeError('SDF brush surface needs wall or cap settings');
    function material(role) {
      if (!TargetSelectors.name(role) || roles && !Object.hasOwn(roles,role))
        throw new RangeError('SDF brush surfaces need a known scene palette role');
    }
    for (const style of Object.values(surface)) {
      if (!allowed(style,['material','coordinates','edge','lighting']))
        throw new TypeError('SDF brush faces accept material, coordinates, edge, and lighting');
      if (style.material!==undefined) material(style.material);
      if (style.coordinates!==undefined && !['stroke','rest'].includes(style.coordinates))
        throw new RangeError('SDF brush face coordinates need stroke or rest');
      if (style.edge!==undefined) {
        if (!allowed(style.edge,['width','material']) || !finite(style.edge.width,.001,2))
          throw new RangeError('SDF brush edge bands need a width from .001 to 2 solid-rest units');
        material(style.edge.material);
      }
      if (style.lighting!==undefined) {
        const { gain=1,flatten=0 } = style.lighting ?? {};
        if (!allowed(style.lighting,['gain','flatten']) || !finite(gain,0,2) || !finite(flatten,0,1))
          throw new RangeError('SDF brush lighting needs gain from 0 to 2 and flatten from 0 to 1');
      }
    }
    return surface;
  }

  function triangleUV(point,a,b,c) {
    const p=V.sub(point,a), x=V.sub(b,a), y=V.sub(c,a);
    const normal=V.cross(x,y), area=V.dot(normal,normal);
    return [V.dot(V.cross(p,y),normal)/area,V.dot(V.cross(x,p),normal)/area];
  }

  function faceUV(point,{a,b,c,d}) {
    // The two triangles also cover the trapezoids produced by perspective sweeps.
    const [u,v]=triangleUV(point,a,b,c);
    const other=u<0 && triangleUV(point,a,c,d);
    return (other ? [other[0],other[0]+other[1]] : [u+v,v]).map(x=>K.clamp(x,0,1));
  }

  function coordinates(point,plane,at,grid,change,mode) {
    if (mode==='rest') {
      const axes=plane.n.map(Math.abs), normal=axes.indexOf(Math.max(...axes));
      return point.filter((_,axis)=>axis!==normal);
    }
    const [u,v]=faceUV(point,plane), [x,y]=at, [w,h]=grid;
    const s=(x+u)/w, t=(y+u)/h, depth=change==='cut' ? 1-v : v;
    switch (plane.index) {
      case 2:return [s,depth];
      case 3:return [t,depth];
      case 4:return [(x+1-u)/w,depth];
      case 5:return [(y+1-u)/h,depth];
      default:return [s,(y+v)/h];
    }
  }

  function attach(surface,id,change,grid,field,before,inherited,roles,palette) {
    if (!surface && !inherited) return;
    const cutting=change==='cut', styles={};
    const ramp=role=>role && K.procedural.sdfMaterialPaint.ramp(roles[role],palette);
    for (const [face,style] of Object.entries(surface ?? {})) {
      const { material,edge,lighting,coordinates='stroke' }=style;
      const { gain=1,flatten=0 }=lighting ?? {};
      const base=ramp(material), rim=ramp(edge?.material);
      function variant(edgeBand=false) {
        const role=edgeBand ? edge.material : material, mapped=edgeBand ? rim : base;
        return {
          material:role,
          tint: mapped || gain!==1 || flatten!==0 ? (rgb,replacement)=>{
            const input=flatten ? rgb.map(n=>n*(1-flatten)+.5*flatten) : rgb;
            const tint=replacement ?? mapped, shaded=tint ? tint(input) : input;
            return gain===1 ? shaded : shaded.map(n=>Math.min(1,n*gain));
          } : null,
          details:{ stroke:id,change,face,coordinates,edge:edgeBand,lighting:{gain,flatten} }
        };
      }
      styles[face]={ coordinates,edge,base:variant(),rim:edge && variant(true) };
    }
    return { locate(point,normal) {
      const original=before(...point), distance=field.sd(...point);
      if (cutting ? -distance<original : distance>original) return inherited?.locate(point,normal);
      if (!surface) return;
      const { at,plane }=field.site(point);
      const face=plane.index<2 ? 'cap' : 'wall', style=styles[face];
      if (!style) return;
      const variant=style.edge && Math.abs(original)<=style.edge.width ? style.rim : style.base;
      const side=sides[plane.index-2];
      return { ...variant,details:side ? { ...variant.details,side } : variant.details,
        uv:coordinates(point,plane,at,grid,change,style.coordinates) };
    } };
  }

  function appearance(surface,paint) {
    if (!surface) return paint;
    return { material:paint?.material ?? surface.material,masks:paint?.masks,
      tint:surface.tint ? rgb=>surface.tint(rgb,paint?.tint) : paint?.tint };
  }

  K.procedural.sdfBrushSurfaces=Object.freeze({ check,attach,appearance });
})(KIT);
