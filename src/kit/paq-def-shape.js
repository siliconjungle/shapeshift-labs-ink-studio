/* Serializable analytic material shapes, resolution-independent profiles and reusable symbols. */
(function (P) {
  const record = P.graphTypes.validator('record');
  const types = Object.freeze(['rectangle','disc','polygon','star','linear','radial','spot','stroke','gradient','symbol','bevel']);
  const format = 'ink-studio/shape-library', version = 1;
  const shapeCache = new WeakMap(), libraries = new WeakSet();
  const range = (n,lo,hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const integer = (n,lo,hi) => Number.isSafeInteger(n) && range(n,lo,hi);
  const tuple = (p,len,check) => Array.isArray(p) && p.length === len && Array.from(p).every(check);
  const coordinate = n => range(n,-1e6,1e6);
  const point = p => tuple(p,2,coordinate);
  const length = n => range(n,1e-8,1e6);
  const clamp = t => Math.max(0,Math.min(1,t));
  const angle = degrees => degrees % 360 * Math.PI / 180;
  const named = id => typeof id === 'string' && /^[A-Za-z][\w.-]{0,79}$/.test(id) && !['constructor','prototype'].includes(id);
  const fields = (source,keys) => record(source) && Object.keys(source).every(key => keys.includes(key));
  const windowShape = {type:'rectangle',size:[1,1]};
  function keys(source,allowed) {
    if (!fields(source,['type',...allowed])) throw new TypeError('Unknown '+source.type+' shape field');
  }
  const pack = (distance,cost=1) => ({distance,cost});
  const zero = () => 0;

  function radialPoints(center,count,radius,rotation,inner = radius) {
    return Array.from({length:count},(_,i)=>{
      const theta = angle(rotation-90) + 2*Math.PI*i/count, r = i%2 ? inner : radius;
      return [center[0]+r*Math.cos(theta),center[1]+r*Math.sin(theta)];
    });
  }
  function listPoints(points,lo,hi) {
    if (!Array.isArray(points) || !integer(points.length,lo,hi) || !Array.from(points).every(point))
      throw new RangeError('Shape needs '+lo+' to '+hi+' planar points');
  }

  function rectangle(source) {
    keys(source,['center','size','radius','angle']);
    const {center=[.5,.5],size=[.68,.46],radius=0,angle:rotation=0} = source;
    if (!point(center) || !tuple(size,2,length) || !range(radius,0,Math.min(...size)/2) || !Number.isFinite(rotation))
      throw new RangeError('Rectangle needs a center, positive size, bounded corner radius and angle');
    const [cx,cy] = center, [hx,hy] = size.map(n=>n/2-radius);
    const c = Math.cos(angle(rotation)), s = Math.sin(angle(rotation));
    return pack((x,y)=>{
      const u = x-cx, v = y-cy;
      const a = Math.abs(c*u+s*v)-hx, b = Math.abs(c*v-s*u)-hy;
      return Math.hypot(Math.max(0,a),Math.max(0,b)) + Math.min(0,Math.max(a,b)) - radius;
    });
  }
  function distanceCircle(center,radius) {
    if (!point(center) || !length(radius)) throw new RangeError('Circular shape needs a center and positive radius');
    const [cx,cy] = center;
    return (x,y)=>Math.hypot(x-cx,y-cy)-radius;
  }
  function disc(source) {
    keys(source,['center','radius']);
    const {center=[.5,.5],radius=.32} = source;
    return pack(distanceCircle(center,radius));
  }
  function polygon(source) {
    keys(source,['points','sides','center','radius','angle']);
    const {points,sides=6,center=[.5,.5],radius=.36,angle:rotation=0} = source;
    if (points !== undefined) {
      if (Object.keys(source).some(key=>!['type','points'].includes(key)))
        throw new TypeError('Choose polygon points or regular polygon controls');
      listPoints(points,3,128);
      return pack(P.geometry.profileDistance(points),points.length);
    }
    if (!point(center) || !integer(sides,3,64) || !length(radius) || !Number.isFinite(rotation))
      throw new RangeError('Invalid regular polygon sides, radius, center or angle');
    return pack(P.geometry.profileDistance(radialPoints(center,sides,radius,rotation)),sides);
  }
  function star(source) {
    keys(source,['tips','center','radius','innerRadius','angle']);
    const {tips=5,center=[.5,.5],radius=.38,innerRadius=radius*.5,angle:rotation=0} = source;
    if (!point(center) || !integer(tips,3,32) || !length(radius) || !length(innerRadius) ||
        innerRadius >= radius || !Number.isFinite(rotation))
      throw new RangeError('Star needs 3–32 tips and an inner radius below the outer radius');
    return pack(P.geometry.profileDistance(radialPoints(center,tips*2,radius,rotation,innerRadius)),tips*2);
  }
  function stroke(source) {
    keys(source,['points','width','closed']);
    const {points=[[.24,.65],[.5,.35],[.76,.65]],width=.075,closed=false} = source;
    if (!length(width) || typeof closed !== 'boolean') throw new RangeError('Stroke needs a positive width and a closed flag');
    listPoints(points,closed ? 3 : 2,128);
    const spans = points.slice(0,closed ? points.length : points.length-1).map(([x,y],i)=>{
      const [u,v] = points[(i+1)%points.length], dx=u-x, dy=v-y, squared=dx*dx+dy*dy;
      if (squared<1e-16) throw new RangeError('Stroke points must have distinct adjacent positions');
      return (px,py)=>{
        const a=px-x, b=py-y, t=clamp((a*dx+b*dy)/squared);
        return (a-t*dx)**2 + (b-t*dy)**2;
      };
    });
    return pack((x,y)=>{
      let distance=Infinity;
      for (const span of spans) distance=Math.min(distance,span(x,y));
      return Math.sqrt(distance)-width/2;
    },spans.length);
  }
  function addressed(mode) {
    if (mode === 'clamp') return clamp;
    if (mode === 'repeat') return x=>x-Math.floor(x);
    if (mode === 'mirror') return x=>1-Math.abs((x-2*Math.floor(x/2))-1);
    throw new RangeError('Profile addressing must be clamp, repeat or mirror');
  }
  function linear(source,child) {
    keys(source,['from','to','address','clip']);
    const {from=[.15,.5],to=[.85,.5],address='clamp',clip=windowShape} = source;
    if (!point(from) || !point(to)) throw new RangeError('Linear profile needs two planar endpoints');
    const [x,y] = from, dx=to[0]-x, dy=to[1]-y, squared=dx*dx+dy*dy;
    if (squared<1e-16) throw new RangeError('Linear profile endpoints must be distinct');
    const geometry=child(clip), apply=addressed(address);
    return { ...pack(geometry.distance,geometry.cost+1), profile:(u,v)=>apply(((u-x)*dx+(v-y)*dy)/squared) };
  }
  function radial(source,child) {
    keys(source,['center','innerRadius','radius','address','clip']);
    const {center=[.5,.5],innerRadius=0,radius=.38,address='clamp',clip} = source;
    if (!range(innerRadius,0,radius-1e-8)) throw new RangeError('Radial profile needs ordered inner and outer radii');
    const radialDistance=distanceCircle(center,radius), geometry=clip===undefined ? pack(radialDistance) : child(clip);
    const apply=addressed(address);
    return { ...pack(geometry.distance,geometry.cost+1),
      profile:(x,y)=>apply(1+radialDistance(x,y)/(radius-innerRadius)) };
  }
  function spot(source) {
    keys(source,['center','radius','core','falloff']);
    const {center=[.5,.5],radius=.36,core=radius*.18,falloff='smooth'} = source;
    if (!range(core,0,radius-1e-8) || !['linear','smooth'].includes(falloff))
      throw new RangeError('Spot needs a core below the radius and linear or smooth falloff');
    const distance=distanceCircle(center,radius);
    return { ...pack(distance,2),profile:(x,y)=>{
      const t=clamp(-distance(x,y)/(radius-core));
      return falloff === 'smooth' ? t*t*(3-2*t) : t;
    } };
  }
  function gradient(source,child) {
    keys(source,['source','curve']);
    const base = child(source.source);
    if (!base.profile) throw new TypeError('Gradient needs a linear, radial or spot profile');
    const ramp = ColorCurves.scalar(source.curve,true);
    return { ...pack(base.distance,base.cost+8), profile:(x,y)=>ramp(base.profile(x,y)) };
  }
  function symbol(source,child) {
    keys(source,['parts']);
    if (!Array.isArray(source.parts) || !integer(source.parts.length,1,32))
      throw new RangeError('Symbol needs 1–32 signed parts');
    const parts = Array.from(source.parts,(part,i)=>{
      if (!fields(part,['op','shape'])) throw new TypeError('Symbol part needs an operation and shape');
      const {op='union',shape} = part;
      if (!['union','subtract','intersect'].includes(op) || i===0 && op!=='union')
        throw new RangeError('Symbol starts with a union part, then supports union, subtract and intersect');
      return {op,...child(shape)};
    });
    return pack((x,y)=>{
      let d=Infinity;
      for (const {op,distance} of parts) {
        const next=distance(x,y);
        d=op==='union' ? Math.min(d,next) : op==='subtract' ? Math.max(d,-next) : Math.max(d,next);
      }
      return d;
    },parts.reduce((sum,part)=>sum+part.cost,0));
  }
  function bevel(source,child) {
    keys(source,['shape','width','height','profile','side']);
    const {shape,width=.04,height=.11,profile='round',side='inside'} = source;
    if (!length(width) || !coordinate(height) || !['linear','round','smooth'].includes(profile) ||
        !['inside','outside','both'].includes(side))
      throw new RangeError('Invalid shape bevel width, height, profile or side');
    const base=child(shape), sample=ShapeBevelProfile(width,height,profile,side);
    return {...base,relief:sample};
  }
  const builders = {rectangle,disc,polygon,star,stroke,linear,radial,spot,gradient,symbol,bevel};
  function compile(source) {
    if (shapeCache.has(source)) return shapeCache.get(source);
    let remaining=256;
    function visit(shape,depth) {
      if (depth>8 || --remaining<0) throw new RangeError('Shape definition exceeds its nesting or part budget');
      if (!record(shape) || !Object.hasOwn(builders,shape.type)) throw new TypeError('Unknown signed shape type');
      return builders[shape.type](shape,value=>visit(value,depth+1));
    }
    const samples=visit(source,0), {distance,profile,relief} = samples;
    return Object.freeze({...samples,field:distance,scalar:profile ? (x,y)=>distance(x,y)<=0 ? profile(x,y) : 0 :
      (x,y)=>Number(distance(x,y)<=0),height:relief ? (x,y)=>relief(distance(x,y)) : zero});
  }
  function define(source) {
    if (shapeCache.has(source)) return source;
    // Compile before cloning so malformed nested definitions hit the part and depth limits first.
    const kernel=compile(source), editable=P.data.freeze(P.data.clone(source));
    shapeCache.set(editable,kernel);
    return editable;
  }
  function open(source) {
    if (libraries.has(source)) return source;
    if (!record(source)) throw new TypeError('Shape library needs a versioned packet or record of entries');
    const versioned = typeof source.format==='string' || typeof source.version==='number';
    if (versioned && (!fields(source,['format','version','entries']) || source.format!==format || source.version!==version))
      throw new RangeError('Unsupported shape library format or version');
    const entries=versioned ? source.entries : source;
    if (!record(entries) || Object.keys(entries).length>128) throw new RangeError('Shape library supports up to 128 entries');
    const normalized=Object.fromEntries(Object.entries(entries).map(([id,row])=>{
      if (!named(id) || !fields(row,['label','definition']) ||
          row.label!==undefined && (typeof row.label!=='string' || !row.label.trim() || row.label.length>100))
        throw new TypeError('Invalid shape library entry '+id);
      return [id,{label:row.label??id,definition:define(row.definition)}];
    }));
    const library=P.data.freeze({format,version,entries:normalized});
    libraries.add(library);
    return library;
  }
  function pick(source,id) {
    const library=open(source);
    if (!named(id) || !Object.hasOwn(library.entries,id)) throw new RangeError('Unknown shape library entry '+id);
    return library.entries[id].definition;
  }
  function valid(check,value) {
    try { check(value); return true; }
    catch { return false; }
  }
  function preset(label,definition) { return {label,definition}; }
  const crescent={type:'symbol',parts:[
    {shape:{type:'disc',center:[.46,.51],radius:.34}},
    {op:'subtract',shape:{type:'disc',center:[.61,.42],radius:.29}}
  ]};
  const presets=open({
    rectangle:preset('Rounded rectangle',{type:'rectangle',radius:.1}),
    polygon:preset('Hexagon',{type:'polygon'}),
    star:preset('Compass star',{type:'star',tips:4,innerRadius:.14}),
    disc:preset('Disc',{type:'disc'}),
    linear:preset('Linear profile',{type:'linear'}),
    radial:preset('Radial profile',{type:'radial'}),
    spot:preset('Soft spot',{type:'spot'}),
    stroke:preset('Round stroke',{type:'stroke'}),
    gradient:preset('Gradient bands',{type:'gradient',source:{type:'linear',from:[.19,.84],to:[.84,.18]},
      curve:{stops:[[0,0],[.32,.9],[.6,.24],[1,1]]}}),
    crescent:preset('Crescent symbol',crescent),
    keyhole:preset('Keyhole symbol',{type:'symbol',parts:[
      {shape:{type:'rectangle',size:[.54,.67],radius:.08}},
      {op:'subtract',shape:{type:'disc',center:[.5,.40],radius:.13}},
      {op:'subtract',shape:{type:'polygon',points:[[.48,.43],[.52,.43],[.58,.68],[.42,.68]]}}
    ]}),
    bevel:preset('Round beveled crescent',{type:'bevel',shape:crescent,width:.05,height:.06}),
    'bevel-linear':preset('Linear raised hexagon',{type:'bevel',shape:{type:'polygon'},width:.055,height:.06,profile:'linear'}),
    'bevel-smooth':preset('Smooth recessed disc',{type:'bevel',shape:{type:'disc'},width:.065,height:-.055,profile:'smooth',side:'both'})
  });
  const operations=Object.freeze({
    'shape.define': {description:'Validate and preserve an editable signed planar shape definition.',
      inputs:{definition:{type:'record',default:presets.entries.rectangle.definition}},outputs:{value:'shape2d'},
      run:({definition})=>({value:define(definition)})},
    'shape.library': {description:'Open a versioned library of reusable signed shapes by stable ID.',
      inputs:{source:{type:'record',default:presets}},outputs:{value:'shapeLibrary'},run:({source})=>({value:open(source)})},
    'shape.pick': {description:'Select one editable definition by its stable shape library ID.',
      inputs:{source:'shapeLibrary',id:{type:'string',default:'rectangle'}},outputs:{value:'shape2d'},
      run:({source,id})=>({value:pick(source,id)})},
    'shape.field': {description:'Use an analytic signed shape or profile in procedural sampling.',
      inputs:{source:'shape2d'},outputs:{value:'field',profile:'field',height:'field'},
      run({source}) { const {field,scalar,height}=compile(source); return {value:field,profile:scalar,height}; }}
  });
  P.shapeLibrary=Object.freeze({types,presets,open,pick,define,compile,operations,
    valid:value=>value?.format===format && value.version===version && valid(open,value),
    validShape:value=>valid(compile,value)});
})(KIT.procedural);
