'use strict';

const ref = name=>({ $ref:'#/$defs/'+name });
const constant = value=>({ const:value });
const choice = (...values)=>({ enum:values });
const either = (...schemas)=>({ anyOf:schemas });
const num = (minimum,maximum)=>({ type:'number',minimum,maximum });
const int = (minimum,maximum)=>({ type:'integer',minimum,maximum });
const array = (items,minItems,maxItems)=>({ type:'array',items,minItems,maxItems });
const tuple = (...prefixItems)=>({ type:'array',prefixItems,minItems:prefixItems.length,items:false });
const object = (properties = {},required = [],additionalProperties = false)=>
  ({ type:'object',properties,required,additionalProperties });
const tagged = (key,value,properties,required = [])=>object({[key]:constant(value),...properties},[key,...required]);
const variant = (value,properties,required)=>tagged('type',value,properties,required);
const tool = (value,properties,required)=>tagged('tool',value,properties,required);
const nullable = schema=>either(schema,{ type:'null' });

const text = { type:'string',minLength:1,pattern:'\\S' };
const bool = { type:'boolean' }, obj = { type:'object' }, number = num();
const natural = int(0), positive = int(1), unit = num(0,1), byte = int(0,255);
const id = ref('id'), cel = ref('celId'), revision = ref('revision'), pixel = ref('pixel');
const pos = tuple(number,number,number), uv = tuple(unit,unit);
const rgba = tuple(byte,byte,byte,byte), size = tuple(int(1,512),int(1,512));
const box = object({min:uv,max:uv},['min','max']);
const rgb = { type:'string',pattern:'^#[0-9a-fA-F]{6}$' };
const textureCoordinate = tuple(natural,natural);
const address = object({frame:id,layer:id},['frame','layer']);
const rectangle = tuple(int(0,511),int(0,511),int(1,512),int(1,512));
const gridRange = tuple(number,number);
const inkSwatch = either(id,object({swatch:id,color:rgb},['swatch','color']));
const paintColor = either(rgb,int(0,0xffffff),tuple(unit,unit,unit));
const tangentNormal = tuple(num(-1,1),num(-1,1),unit);
const emission = tuple(num(0,64),num(0,64),num(0,64));
const prop = prop=>({ required:[prop] });
const range = (value,description)=>({ ...value,description });

function exactlyOne(a,b) {
  return { oneOf:[prop(a),prop(b)] };
}

function createDefinitions() {
  const query = ref('selectionQuery');
  const withSeed = (type,more = {})=>({
    ...variant(type,{ id:text,at:pixel,...more }),...exactlyOne('id','at')
  });
  const chooseSource = { oneOf:[prop('channel'),prop('destination')] };
  const brush = ref('surfaceBrush'), surfaceStamp = ref('surfaceStamp');
  const transformSettings = object({ at:tuple(int(),int()),offset:tuple(int(),int()),angle:number,
    size,flipX:bool,flipY:bool,rotation:choice('nearest','pixel-aware') });
  const { paintTools,canvasTools,recolorTools } = require('./pixel-commands.js').contract();
  const commonPaint = { layer:id,selection:id };
  const freehand = array(tuple(int(),int()),1,4096);
  const paint = {
    pencil:tool('pencil',{ ...commonPaint,points:freehand,swatch:id,pixelPerfect:bool,drawing:obj },['points','swatch']),
    eraser:tool('eraser',{ ...commonPaint,points:freehand,drawing:obj },['points']),
    fill:tool('fill',{ ...commonPaint,at:tuple(int(),int()),swatch:id,drawing:obj },['at','swatch']),
    shape:tool('shape',{ ...commonPaint,shape:obj,swatch:id,drawing:obj },['shape','swatch']),
    brush:tool('brush',{ ...commonPaint,brush:obj,points:freehand,at:tuple(int(),int()),samples:array(obj,1),
      swatch:id,shading:obj,drawing:obj },['brush']),
    rgba:tool('rgba',{ layer:id,pixels:array(object({at:pixel,rgba:nullable(rgba),swatch:id},['at','rgba']),1,512**2) },['pixels']),
    cleanup:{...tool('cleanup',{ ...commonPaint,pixels:array(pixel,1),kind:text,mode:text,at:pixel,swatch:id,maxChanges:natural },['kind']),
      ...exactlyOne('selection','pixels')}
  };
  const canvas = {
    crop:variant('crop',{ rect:rectangle,bindingPolicy:choice('preserve','reframe') },['rect']),
    trim:variant('trim',{ bindingPolicy:choice('preserve','reframe') }),
    pad:variant('pad',{ margins:tuple(natural,natural,natural,natural),bindingPolicy:choice('preserve','reframe') },['margins']),
    resize:variant('resize',{ size,anchor:text,bindingPolicy:choice('preserve','reframe') },['size']),
    resample:variant('resample',{ size,filter:text,bindingPolicy:choice('preserve','reframe') },['size'])
  };
  const recolor = {
    swatch:variant('swatch',{ swatch:object({id,color:rgb,label:nullable(text),locked:bool},['id']) },['swatch']),
    'remap-indices':variant('remap-indices',{ map:{ type:'object',additionalProperties:int(0,254) } },['map'])
  };
  const move = object({ tool:constant('transform'),layer:id,selection:id,mode:choice('move','copy'),
    transform:transformSettings,resultSelection:id,carryProtection:bool },['selection']);
  const paste = tool('paste',{layer:id,clipboard:obj,transform:transformSettings,resultSelection:id},['clipboard']);
  const indexedAttributes = { pigment:nullable(inkSwatch),coverage:unit,material:nullable(text),roughness:nullable(unit),
    emission:nullable(emission) };
  const geometryAttributes = { opacity:unit,position:pos,scale:either(num(.01,100),tuple(num(.01,100),num(.01,100),num(.01,100))),orientation:tuple(number,number,number,number) };
  const sdfFootprint = { pixels:array(pixel,1),selection:id,camera:obj,minFacing:num(.05,1),
    time:range(num(0,120),'Pose time in seconds.') };
  const sdfBrush = { ...object({mode:choice('add','cut','carve','through-cut','raise','fill','smooth'),
    depth:range(num(.005,20),'Depth in scene units.'),...sdfFootprint,
    direction:either(text,pos),profile:either(text,array(tuple(unit,unit))),falloff:obj,radius:num(0),surface:obj,
    preserveFeatures:bool,minWall:num(0)},['mode','depth']),...exactlyOne('pixels','selection') };
  const brushSize = either(
    object({unit:constant('world'),radius:num(.005,20)},['unit','radius']),
    object({unit:constant('pixels'),radius:num(.5,64)},['unit','radius']));
  const brushMode = (...values)=>({properties:{mode:choice(...values)}});
  const freeformBrush = {
    ...object({mode:choice('grab','flatten','scrape','crease','pinch'),...sdfFootprint,pixels:array(pixel,1,32),
      size:brushSize,strength:num(.01,1),delta:pos,depth:num(.001,20),angle:num(-360,360),
      mirror:nullable(object({axis:choice('x','y','z'),at:num(-1e6,1e6)},['axis']))},['mode','size']),
    ...exactlyOne('pixels','selection'),
    allOf:[
      {if:brushMode('grab'),then:prop('delta'),else:{not:prop('delta')}},
      {if:prop('depth'),then:brushMode('scrape','crease')},
      {if:prop('angle'),then:brushMode('crease','pinch')}
    ]
  };
  const sdfPaint = { ...object({...sdfFootprint,material:nullable(text),
    masks:{type:'object',minProperties:1,additionalProperties:nullable(unit)},thickness:num(.001,2)}),
    allOf:[exactlyOne('pixels','selection'),{anyOf:[prop('material'),prop('masks')]}] };
  const decalImage = object({width:int(1,256),height:int(1,256),pixels:array(byte,4,256**2*4)},['width','height','pixels']);
  const decalMask = nullable(array(byte,1,256**2));
  const quantities = { frame:id,frames:tuple(id,id),layer:id,selection:id };
  return {
    id:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}$'},
    celId:{type:'string',pattern:'^[a-z][a-z0-9-]{0,63}(/[a-z][a-z0-9-]{0,63})?$'},
    revision:{type:'string',pattern:'^[a-f0-9]{64}$',description:'SHA-256 revision from the corresponding Ink inspection.'},
    pixel:range(tuple(int(0,511),int(0,511)),'Top-left zero-based native pixel [x,y]. The document determines the actual bounds.'),
    sceneBinding:{
      ...object({id,scene:text,object:text,part:text,revision:text,frame:id,layer:id,
        canvas:object({size,offset:tuple(number,number),scale:tuple({type:'number',exclusiveMinimum:0},{type:'number',exclusiveMinimum:0})},['size','offset','scale']),
        mapping:obj,stale:array(tuple(natural,natural,positive))},['id','scene','object']),
      dependentRequired:{mapping:['part']}
    },
    selectionQuery:{ anyOf:[
      ...['rectangle','ellipse'].map(name=>variant(name,{rect:rectangle},['rect'])),
      variant('lasso',{points:array(pixel,1,4096)},['points']),
      variant('polygon',{points:array(pixel,3,128)},['points']),
      variant('wand',{at:pixel,tolerance:byte,connected:bool},['at']),
      ...['swatch','object','material'].map(name=>withSeed(name)),
      withSeed('part',{object:text,entity:text}),
      variant('binding',{id,scope:choice('visible','isolated-part','through-layers')},['id']),
      variant('depth',{range:gridRange},['range']),
      { ...variant('channel',{channel:text,destination:text,component:int(0,3),range:gridRange},['range']),...chooseSource },
      { ...variant('shadow-cluster',{swatches:{...array(id,1,255),uniqueItems:true},ramp:id,steps:int(1,255),
        range:tuple(unit,unit),at:pixel,connectivity:choice(4,8)}),
      oneOf:[prop('swatches'),prop('ramp'),prop('range')],dependentRequired:{steps:['ramp']} },
      variant('one-pixel-gap',{axis:choice('horizontal','vertical','either'),at:pixel}),
      variant('protected-detail',{id,kind:choice('pixel','gap','contour','accent'),at:pixel}),
      variant('visible-part',{id:text,object:text,entity:text,at:pixel}),
      variant('occluding-contributor',{binding:id,object:text,part:text,scope:choice('full','partial','either'),at:pixel},['binding']),
      variant('pixels',{pixels:array(pixel)},['pixels']),
      variant('recall',{id},['id']),
      ...['combine','subtract','intersect'].map(name=>variant(name,{base:query,with:query},['base','with'])),
      ...['invert','grow','shrink','outline'].map(name=>variant(name,{
        source:query,...(name!=='invert' && {amount:int(1,512)}),
        ...(name==='outline' && {side:choice('inside','outside','both')})
      },['source'])),
      variant('cluster',{at:pixel,connectivity:choice(4,8),source:query},['at'])
    ] },
    pixelEdit:object({at:pixel,layer:nullable(id),from:nullable(id),to:nullable(id)},['at','layer','from','to'],true),
    rasterPaintOperation:either(...paintTools.map(name=>paint[name])),
    rasterOperation:either(ref('rasterPaintOperation'),ref('swatchReplacement'),ref('rasterTransform')),
    swatchReplacement:object({ tool:constant('replace-swatch'),layer:id,selection:id,from:id,to:id },['selection','from','to']),
    rasterTransform:either(move,paste),
    canvasOperation:either(...canvasTools.map(name=>canvas[name])),
    paletteRecolor:either(...recolorTools.map(name=>recolor[name])),
    paletteOperation:either(ref('paletteRecolor'),variant('ramp',{ramp:obj},['ramp']),
      variant('remove-ramp',{id},['id']),variant('reorder',{order:array(id,1,255)},['order']),
      variant('import',{palette:obj},['palette']),variant('remap',{map:obj,removeSources:bool},['map'])),
    selectionsOperation:object({id,query,layer:id,cel,sources:array(obj),targetRevision:revision},['id','query']),
    guidesOperation:{ ...object({upsert:array(obj),remove:array(id)}),anyOf:[prop('upsert'),prop('remove')] },
    layersOperation:either(variant('add',{layer:obj,before:id},['layer']),
      variant('update',{layer:id,changes:obj},['layer','changes']),variant('reorder',{order:array(id,1,64)},['order']),
      variant('set-cel',{frame:id,layer:id,cel:obj},['frame','layer','cel']),
      ...['remove','merge-down','flatten-group'].map(name=>variant(name,{layer:id},['layer'])),
      variant('flatten',{layer:id})),
    timelineOperation:either(
      variant('add-frame',{frame:id,durationMs:positive,label:text,before:id},['frame','durationMs']),
      variant('duration',{frame:id,durationMs:positive},['frame','durationMs']),
      variant('set-tag',{tag:obj},['tag']),variant('remove-tag',{tag:id},['tag']),
      variant('set-directional',{directional:nullable(obj)},['directional']),
      variant('set-tilemap',{tilemap:nullable(obj)},['tilemap']),
      variant('place-tiles',{points:array(pixel,1),tile:nullable(id)},['points','tile']),
      variant('layer-offset',{layer:id,offset:tuple(int(),int())},['layer','offset']),
      variant('cel-offset',{...address.properties,offset:tuple(int(),int())},['frame','layer','offset']),
      ...['blank','unlink'].map(name=>variant(name,address.properties,address.required)),
      ...['duplicate','hold','move','copy'].map(name=>variant(name,{from:address,to:address,replace:bool},
        name==='duplicate' ? ['from'] : ['from','to'])),
      variant('set-slice-key',{id,label:nullable(text),key:obj},['id','key']),
      variant('remove-slice-key',{id,frame:id},['id','frame']),variant('remove-slice',{id},['id']),
      variant('edit-cels',{scope:obj,edit:obj},['scope','edit']),variant('write-cels',{cels:array(obj,1)},['cels']),
      ...['make-local-variant','reuse-exact-tile'].map(name=>variant(name,{at:pixel,tile:id},['at','tile']))),
    protectionOperation:either(variant('remove',{id},['id']),{
      ...variant('set',{id,kind:choice('pixel','gap','contour','accent'),frame:id,frames:tuple(id,id),pixels:array(pixel,1),
        selection:id},['id','kind']),...exactlyOne('pixels','selection')
    }),
    adjustmentsOperation:object({scope:object(quantities),adjustment:either(
      variant('curves',{curve:array(tuple(unit,unit),2),channels:obj,match:choice('exact','palette')}),
      variant('hue-saturation',{degrees:number,saturation:num(0,4),match:choice('exact','palette')}),
      variant('gradient',{stops:array(tuple(unit,text),1),interpolation:text,axis:choice('x','y'),from:tuple(number,number),
        to:tuple(number,number),match:choice('exact','palette')},['stops']),
      variant('replace',{map:{type:'object',minProperties:1,additionalProperties:id}},['map']),
      variant('dither',{dark:id,light:id,pattern:choice('bayer','checker')},['dark','light']),
      variant('outline',{swatch:id,radius:positive,side:text},['swatch']))},['scope','adjustment']),
    artRulesOperation:object({artRules:nullable(obj)},['artRules']),
    shotCorrectionOperation:object({at:pixel,fps:{ type:'number',exclusiveMinimum:0,maximum:240 },startTime:number,frames:tuple(natural,natural),
      anchor:object({splat:either(text,natural),offset:tuple(int(-8192,8192),int(-8192,8192)),depthOffset:num(-4096,4096)},['splat']),depthTolerance:{type:'number',exclusiveMinimum:0,maximum:4096}},
    ['at','fps','frames','anchor']),
    surfaceBrush:either(tagged('kind','rect',box.properties,box.required),
      tagged('kind','bitmap',{...box.properties,rows:array({type:'string',pattern:'^[.#]{1,256}$'},1,128)},['min','max','rows']),
      tagged('kind','stroke',{points:array(uv,1),width:num(0),softness:unit},['points','width']),
      tagged('kind','retained',{tip:obj,space:choice('uv','rest'),at:either(uv,pos),pixelSize:tuple(num(0),num(0)),direction:pos},
        ['tip','space','at','pixelSize'])),
    surfaceStamp:{...object({brush,value:{},mode:choice('set','add','clear'),strength:unit,window:box,
      projection:object({maxDepth:{type:'number',exclusiveMinimum:0,maximum:10000},frontOnly:bool})},['brush']),
      anyOf:[prop('value'),{required:['mode'],properties:{mode:constant('clear')}},
        {properties:{brush:{properties:{kind:constant('retained')}}}}] },
    surfaceOperation:either(object({stamp:surfaceStamp},['stamp']),object({stamps:array(surfaceStamp,1,256)},['stamps']),
      object({pixel,value:{},mode:choice('set','add','clear'),strength:unit,window:box},['pixel'])),
    decalOperation:either(variant('move',{delta:either(tuple(number,number),pos)},['delta']),
      variant('mask',{mask:decalMask},['mask']),variant('replace',{image:decalImage,mask:decalMask},['image']),
      variant('bake',{image:decalImage}),variant('bake',{source:constant('frame')},['source'])),
    splatOperation:either(object({splats:array(object({splat:either(text,natural),...indexedAttributes,...geometryAttributes,
      footprint:nullable(obj),footprintScale:num(.4,2),visible:bool,weight:unit},['splat']),1),
    paint:object(indexedAttributes),attributes:object(geometryAttributes),
    footprint:nullable(obj),falloff:object({center:pos,radius:num(0),hardness:unit},['center','radius'])},['splats']),
    object({topology:array(either(tagged('op','add',{id:text,position:pos,radius:num(0),pigment:inkSwatch,opacity:unit,part:text},
      ['id','position','radius','pigment']),
    {...tagged('op','clone',{id:text,from:text,position:pos,offset:pos},['id','from']),...exactlyOne('position','offset')},
    tagged('op','retire',{splat:text,reason:text},['splat'])),1)},['topology']),
    object({groups:array(ref('splatGroup'),0,32)},['groups'])),
    splatGroup:object({id:text,pivot:pos,members:array(text,1,32768),mask:array(tuple(text,unit)),
      falloff:object({center:pos,inner:num(0,1e6),outer:num(.001,1e6)},['outer']),
      modifiers:array(either(variant('bend',{axis:pos,side:pos,length:num(.001,1e6),angle:num(-180,180)},
        ['axis','side','length','angle']),variant('taper',{axis:pos,length:num(.001,1e6),amount:num(-.95,.95)},
        ['axis','length','amount']),variant('lattice',{bounds:object({min:pos,max:pos},['min','max']),
          size:tuple(int(2,5),int(2,5),int(2,5)),
          handles:array(object({at:tuple(int(0,4),int(0,4),int(0,4)),offset:pos},['at','offset']),0,125)},
        ['bounds','size','handles'])),1,8)},['id','pivot','members','modifiers']),
    scanMaterialOperation:object({texels:array({...object({at:textureCoordinate,pigment:nullable(inkSwatch),
      roughness:nullable(unit),normal:nullable(tangentNormal)},['at']),anyOf:['pigment','roughness','normal'].map(prop)},1,4096)},['texels']),
    meshComponentTransform:object({
      selection:object({format:constant('ink-studio/mesh-selection'),version:constant(1),mesh:text,revision:text,
        domain:choice('vertices','edges','faces'),ids:array(text,1)},['format','version','mesh','revision','domain','ids']),
      operation:either(tagged('kind','move',{offset:pos},['offset']),
        tagged('kind','rotate',{axis:pos,degrees:number},['axis','degrees']),
        tagged('kind','scale',{factors:either({type:'number',exclusiveMinimum:0},{...pos,
          prefixItems:Array.from({length:3},()=>({type:'number',exclusiveMinimum:0}))})},['factors'])),
      space:choice('local','world','normal'),pivot:pos,normal:pos,tangent:pos,
      pins:object({vertices:array(text),boundary:choice('mesh','selection','both')}),
      falloff:object({radius:{type:'number',exclusiveMinimum:0},curve:choice('linear','smooth','sharp')},['radius']),
      snap:either(...['vertex','edge','face'].map(kind=>tagged('kind',kind,{id:text,object:text,anchor:text,maxDistance:num(0)},['id'])),
        tagged('kind','plane',{origin:pos,normal:pos,anchor:text,maxDistance:num(0)},['origin','normal']),
        tagged('kind','socket',{instance:text,binding:text,anchor:text,maxDistance:num(0)},['instance','binding']),
        tagged('kind','sdf',{object:text,anchor:text,maxDistance:{type:'number',exclusiveMinimum:0},
          tolerance:{type:'number',exclusiveMinimum:0},iterations:int(1,64)},['object','maxDistance']))
    },['selection','operation']),
    meshRepairRequest:object({revision:text,operations:array(either(
      tagged('kind','weld',{keep:text,remove:array(text,1),maxDistance:num(0),
        weights:choice('match','keep','average'),removeCollapsed:bool},['keep','remove','maxDistance']),
      tagged('kind','dissolve',{edge:text,keep:text,tolerance:num(0)},['edge']),
      {...tagged('kind','winding',{anchor:text,faces:array(text,1)}),...exactlyOne('anchor','faces')}
    ),1,128)},['revision','operations']),
    meshCutRequest:{...object({
      id,revision:text,split:bool,tolerance:{type:'number',exclusiveMinimum:0},
      cap:either(tagged('kind','none',{}),...['ngon','triangles'].map(kind=>tagged('kind',kind,{material:text},['material']))),
      plane:object({origin:pos,normal:pos},['origin','normal']),
      knife:object({projection:object({origin:pos,right:pos,up:pos},['origin','right','up']),
        path:array(tuple(number,number),2,65),
        selection:object({format:constant('ink-studio/mesh-selection'),version:constant(1),mesh:text,revision:text,
          domain:choice('vertices','edges','faces'),ids:array(text)},['format','version','mesh','revision','domain','ids'])
      },['projection','path'])
    },['id','revision']),...exactlyOne('plane','knife')},
    meshFaceRegionRequest:object({
      id:{type:'string',pattern:'^[a-zA-Z0-9_.-]{1,96}$'},revision:text,
      selection:object({format:constant('ink-studio/mesh-selection'),version:constant(1),mesh:text,revision:text,
        domain:constant('faces'),ids:array(text,1)},['format','version','mesh','revision','domain','ids']),
      operation:either(tagged('kind','extrude',{distance:number,direction:pos},['distance']),
        ...['inset','thicken'].map(kind=>tagged('kind',kind,{distance:{type:'number',exclusiveMinimum:0}},['distance']))),
      rim:object({material:text,uv:choice('strip','per-edge')}),
      interior:object({material:text,uv:choice('preserve','planar')}),
      minWall:{type:'number',exclusiveMinimum:0},tolerance:{type:'number',exclusiveMinimum:0}
    },['id','revision','selection','operation']),
    meshEdgeSelection:object({format:constant('ink-studio/mesh-selection'),version:constant(1),mesh:text,revision:text,
      domain:constant('edges'),ids:array(text,1)},['format','version','mesh','revision','domain','ids']),
    meshEdgeEditRequest:object({
      id:{type:'string',pattern:'^[a-zA-Z0-9_.-]{1,96}$'},revision:text,
      pins:object({vertices:array(text),edges:array(text),boundary:bool}),
      operation:either(
        tagged('kind','insert-loop',{selection:ref('meshEdgeSelection'),start:text,
          fraction:{type:'number',exclusiveMinimum:0,exclusiveMaximum:1}},['selection','fraction']),
        tagged('kind','slide',{selection:ref('meshEdgeSelection'),start:text,
          amount:{type:'number',exclusiveMinimum:-1,exclusiveMaximum:1}},['selection','amount']),
        tagged('kind','bridge',{first:ref('meshEdgeSelection'),second:ref('meshEdgeSelection'),starts:tuple(text,text),
          offset:{type:'integer'},segments:int(1,32),material:text,uv:choice('strip','inherit')},['first','second']),
        tagged('kind','grid-fill',{selection:ref('meshEdgeSelection'),start:text,columns:int(1,127),material:text},['selection'])
      )
    },['id','revision','operation']),
    meshBevelRequest:object({
      id:{type:'string',pattern:'^[a-zA-Z0-9_.-]{1,96}$'},revision:text,tolerance:{type:'number',exclusiveMinimum:0},
      bevel:object({selection:ref('meshEdgeSelection'),width:{type:'number',exclusiveMinimum:0},segments:int(1,16),
        profile:either(choice('chamfer','round'),object({points:array(tuple(unit,unit),2,17)},['points'])),
        join:choice('miter','patch'),weights:array(object({edge:text,weight:unit},['edge','weight'])),material:text
      },['selection','width']),
      protect:object({faces:array(text),materials:array(text),
        paint:array(object({face:text,min:tuple(unit,unit),max:tuple(unit,unit)},['face','min','max']),0,256),
        gaps:array(object({id:text,origin:pos,direction:pos,distance:{type:'number',exclusiveMinimum:0}},
          ['id','origin','direction','distance']),0,256)
      })
    },['id','revision','bevel']),
    meshShadingSettings:object({smooth:bool,weighting:choice('uniform','area','angle','area-angle')}),
    meshEdgeShading:object({id:text,smooth:nullable(bool),crease:nullable(unit)},['id']),
    meshShadingRequest:object({
      id:{type:'string',pattern:'^[a-zA-Z0-9_.-]{1,96}$'},revision:text,
      edges:array(ref('meshEdgeShading')),corners:array(object({id:text,normal:nullable(pos)},['id','normal'])),
      settings:nullable(ref('meshShadingSettings'))
    },['id','revision']),
    meshModifier: either(
      tagged('kind','mirror',{id:text,enabled:bool,origin:pos,normal:pos,weld:bool,flipU:bool,tolerance:{type:'number',exclusiveMinimum:0}},
        ['id','normal']),
      tagged('kind','array',{id:text,enabled:bool,count:int(1,32),step:pos},['id','count','step']),
      tagged('kind','bevel',{id:text,enabled:bool,edges:array(text,1),width:{type:'number',exclusiveMinimum:0},segments:int(1,16),
        profile:either(choice('chamfer','round'),obj),join:choice('miter','patch'),
        weights:array(object({edge:text,weight:unit},['edge','weight'])),material:text,protect:obj},['id','width']),
      tagged('kind','shell',{id:text,enabled:bool,faces:array(text,1),thickness:{type:'number',exclusiveMinimum:0},
        rim:obj,interior:obj,minWall:{type:'number',exclusiveMinimum:0}},['id','thickness']),
      tagged('kind','subdivision',{id:text,enabled:bool,levels:int(1,3)},['id','levels']),
      tagged('kind','projection',{id:text,enabled:bool,target:text,direction:pos,distance:{type:'number',exclusiveMinimum:0},
        vertices:array(text,1),bidirectional:bool,offset:number,miss:choice('keep','error')},['id','target','direction','distance'])
    ),
    meshModifierEdit:either(tagged('action','set',{stack:array(ref('meshModifier'),0,16)},['stack']),
      tagged('action','update',{id:text,patch:obj},['id','patch']),tagged('action','apply',{through:text})),
    meshBooleanRequest:object({
      id:text,revision:text,operation:choice('union','difference','intersection'),selection:obj,
      operand:object({object:text,part:text,document:obj,revision:text,selection:obj},['revision']),
      cutMaterial:text,tolerance:{type:'number',exclusiveMinimum:0},maxWork:int(1,5000000),
      solver:either(object({kind:constant('mesh')},['kind']),
        object({kind:constant('sdf'),cell:{type:'number',exclusiveMinimum:0},maxCells:int(64,1000000),
          edgeTolerance:{type:'number',exclusiveMinimum:0},thicknessTolerance:{type:'number',exclusiveMinimum:0},
          probes:array(object({id:text,origin:pos,direction:pos,distance:{type:'number',exclusiveMinimum:0}},
            ['id','origin','direction','distance']),0,64)},['kind','cell']))
    },['id','revision','operation','operand']),
    meshRetopologyRail:object({points:array(pos,2,129),sampling:choice('arc','knots')},['points']),
    meshRetopologyRequest:object({
      id:text,revision:text,size:tuple(int(1,64),int(1,64)),material:text,
      surface:object({kind:choice('mesh','sdf','scan-proxy'),object:text,part:text,revision:text,volume:obj,document:obj},['kind']),
      rails:object(Object.fromEntries(['bottom','right','top','left'].map(side=>[side,ref('meshRetopologyRail')]))),
      rims:object(Object.fromEntries(['bottom','right','top','left'].map(side=>[side,array(text,2,65)]))),
      guides:array(object({id:text,axis:choice('row','column'),index:int(0,64),kind:choice('flow','joint','seam','silhouette'),
        points:array(pos,2,129),sampling:choice('arc','knots')},['id','axis','index','kind','points']),0,20),
      pins:array(object({at:tuple(int(0,64),int(0,64)),position:pos,kind:choice('seam','silhouette')},['at','position','kind']),0,512),
      projection:object({maxDistance:num(1e-6,1e4),direction:pos,normal:pos,minFacing:unit,tolerance:num(1e-9),
        pinTolerance:number,guideTolerance:number,maxDeviation:number},['maxDistance']),maxChecks:int(1,2000000)
    },['id','revision','size','material','surface','projection']),
    meshTopologyOperation:{ ...object({
      transform:ref('meshComponentTransform'),
      repair:ref('meshRepairRequest'),
      cut:ref('meshCutRequest'),
      boolean:ref('meshBooleanRequest'),
      retopology:ref('meshRetopologyRequest'),
      faceRegion:ref('meshFaceRegionRequest'),
      edgeEdit:ref('meshEdgeEditRequest'),
      bevel:ref('meshBevelRequest'),
      shading:ref('meshShadingRequest'),
      modifiers:ref('meshModifierEdit'),
      patch:{
        ...object({
          vertices:array(object({id:text,position:pos,weights:nullable(object({},[],unit))},['id','position'])),
          faces:array(object({id:text,material:text,corners:array(object({
            id:text,vertex:text,uv:tuple(unit,unit),normal:pos,attributes:object({},[],either(number,array(number,1,4)))
          },['id','vertex']),3,128)},['id','corners'])),
          removeVertices:array(text),removeFaces:array(text),
          edges:array(ref('meshEdgeShading')),shading:nullable(ref('meshShadingSettings')),
          lineage:object(Object.fromEntries(['faces','edges','corners'].map(kind=>
            [kind,array(object({from:text,to:text},['from','to']))])))
        }),
        minProperties:1
      },
      projection:object({maxDistance:{type:'number',exclusiveMinimum:0},minNormalDot:unit,maxUVDistance:unit,minConfidence:unit,
        ambiguity:unit,maxChecks:int(1,2000000)},['maxDistance'])
    }),oneOf:['patch','transform','repair','cut','boolean','retopology','faceRegion','edgeEdit','bevel','shading','modifiers'].map(prop) },
    stencilSdfBrush:sdfBrush,
    freeformSdfBrush:freeformBrush,
    sdfShapeOperation:either(...[
      ['parameters',obj],['modifier',obj],['updateModifier',object({id:text,patch:obj},['id','patch'])],
      ['protection',array(obj)],['brush',either(ref('stencilSdfBrush'),ref('freeformSdfBrush'))],['updateBrush',{type:'object',required:['id']}]
    ].map(([key,value])=>object({[key]:value},[key]))),
    sdfMaterialOperation:either(object({material:either(text,obj)},['material']),object({paint:sdfPaint},['paint']))
  };
}

module.exports = { createDefinitions,ref,constant,choice,either,object,tagged,nullable,
  types:{text,bool,obj,number,natural,positive,unit,id,cel,revision,pixel,size,paintColor,inkSwatch,tangentNormal,emission},array,num,int,tuple,prop };
