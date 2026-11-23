/* Trace a bounded signed field to a reusable native-pixel surface. */
(function (K) {
  const P = K.procedural;
  const { dimensions, raster, vector, range, integer, sampleField, unit, color } = P.generatorSupport;
  const tau = Math.PI * 2;

  function fieldSprite(source, { bounds = source?.bounds, center, orbit = [0,.18], roll = 0, scale,
    steps = 64, epsilon = .007, safety = .75, light = [-.6,.8,.6], ambient = .24,
    bands = 6, ink = '#b7c7d1', paint, materials = [], time = 0, ...options } = {}) {
    const { width,height } = dimensions(options), area=width*height;
    if (area>262144 || !P.graphTypes.validator('field')(source) ||
        !vector(bounds?.min,3) || !vector(bounds?.max,3) ||
        !bounds.min.every((v,i)=>v<bounds.max[i]) || !vector(orbit,2) || !Number.isFinite(roll) ||
        !range(epsilon,1e-6,1) || !range(safety,.1,1) || !integer(steps,8,128) ||
        !vector(light,3) || !range(Math.hypot(...light),1e-8,1e9) || !range(ambient,0,1) ||
        !integer(bands,1,64) || !Number.isFinite(time) || paint!==undefined&&typeof paint!=='function' ||
        !Array.isArray(materials) || materials.length>16 ||
        !Array.from(materials).every(P.graphTypes.validator('fieldSpriteMaterial')))
      throw new RangeError('A field sprite needs bounded geometry, a finite view and limited steps');
    const pivot=bounds.min.map((n,i)=>(n+bounds.max[i])*.5), radius=K.V.dist(bounds.max,pivot);
    const tint=parseInt(color(ink).slice(1),16), rgb=[tint>>16,tint>>8&255,tint&255];
    center??=[width/2,height/2];
    scale??=Math.min(width,height)*.43/radius;
    if(!vector(center,2)||!range(scale,1e-5,1e6)||!(radius>epsilon&&Number.isFinite(radius)))
      throw new RangeError('Field sprite scale and center must be finite');
    const yaw=orbit[0]%tau,pitch=orbit[1],cp=Math.cos(pitch),sp=Math.sin(pitch);
    const cy=Math.cos(yaw),sy=Math.sin(yaw),view=[cp*sy,sp,cp*cy];
    const across=[cy,0,-sy],vertical=K.V.cross(view,across),sun=K.V.norm(light);
    const cr=Math.cos(roll),sr=Math.sin(roll);
    const right=across.map((n,i)=>n*cr+vertical[i]*sr);
    const up=vertical.map((n,i)=>n*cr-across[i]*sr);
    const rgba=new Uint8Array(area*4),normal=new Float32Array(area*3),depth=new Float32Array(area);
    const position=new Float64Array(area*3),lightMap=new Float64Array(area),coverage=new Float32Array(area);
    const materialId=new Int16Array(area).fill(-1);
    const value=(x,y,z)=>sampleField(source,x,y,z,time);
    for(let row=0,i=0;row<height;row++)for(let col=0;col<width;col++,i++){
      const u=(col+.5-center[0])/scale,v=(center[1]-row-.5)/scale;
      const q=radius*radius-u*u-v*v;
      if(q<=0)continue;
      const limit=Math.sqrt(q)+epsilon,base=K.V.mad(K.V.mad(pivot,right,u),up,v);
      let distance=limit, hit;
      for(let n=0;n<steps&&distance>=-limit;n++){
        const [x,y,z]=K.V.mad(base,view,distance),d=value(x,y,z);
        if(d<=epsilon){hit=[x,y,z];break;}
        distance-=Math.max(epsilon,d*safety);
      }
      if(!hit)continue;
      const [x,y,z]=hit,e=2*epsilon;
      const n=K.V.norm([value(x+e,y,z)-value(x-e,y,z),value(x,y+e,z)-value(x,y-e,z),
        value(x,y,z+e)-value(x,y,z-e)]);
      const lambert=unit(K.V.dot(n,sun)), illumination=ambient+(1-ambient)*
        (bands===1?lambert:Math.round(lambert*(bands-1))/(bands-1));
      const shaded=paint?paint(hit,n,illumination,time):rgb.map(c=>Math.round(c*illumination));
      if(!vector(shaded,3)||!shaded.every(c=>range(c,0,255)))throw new RangeError('Field sprite paint needs RGB8 channels');
      depth[i]=(distance/radius+1)*.5;
      normal.set(n,i*3);
      position.set([x,y,z],i*3);
      lightMap[i]=illumination;
      coverage[i]=1;
      materialId[i]=0;
      rgba.set(shaded,i*4);
      rgba[i*4+3]=255;
    }
    const surface=Object.freeze({
      format:'ink-studio/field-sprite-surface',time,
      bounds:Object.freeze({min:Object.freeze(bounds.min.slice()),max:Object.freeze(bounds.max.slice())}),
      value:raster(width,height,rgba,4),position:raster(width,height,position,3),normal:raster(width,height,normal,3),
      illumination:raster(width,height,lightMap),coverage:raster(width,height,coverage)
    });
    const painted=materials.length ? P.generator.shadeFieldSprite(surface,materials,{time}) :
      {value:surface.value,materialId:raster(width,height,materialId)};
    return {...painted,depth:raster(width,height,depth),position:surface.position,normal:surface.normal,
      illumination:surface.illumination,coverage:surface.coverage,surface};
  }
  P.generator.fieldSprite=fieldSprite;
})(KIT);
