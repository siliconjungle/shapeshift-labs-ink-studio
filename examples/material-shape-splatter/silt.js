const siltWidth=180,siltHeight=120,siltColumns=16,siltRows=12;
const siltSpan=[1.5,1], siltTau=Math.PI*2;
const siltPlanes=[
  {type:'polygon',points:[[.08,.44],[.33,.13],[.73,.15],[.93,.42],[.75,.78],[.30,.88]]},
  {type:'symbol',parts:[
    {shape:{type:'disc',radius:.465}},
    {op:'subtract',shape:{type:'disc',center:[.53,.47],radius:.247}}
  ]}
];
const siltDefaults={kind:'mixed',density:1,slope:.9,scale:1,tilt:0,spin:0,roll:0,heightOffset:0,uvMode:'planar',uvScale:1,
  seed:3891,bed:true,channel:true,densityMap:true,placementMask:true};
const siltPorts={relief:'Relief',height:'Height',normals:'Normals',instances:'Instance IDs',shapes:'Shape IDs',uv:'UV checker',coverage:'Coverage'};
const siltUnit=n=>Math.max(0,Math.min(1,n));
const siltFold=n=>n-Math.round(n);
const siltRiver=u=>.48+.13*Math.sin(siltTau*(u-.09))+.039*Math.sin(siltTau*(2*u+.11));
const siltStep=(a,b,x)=>{const t=siltUnit((x-a)/(b-a));return t*t*(3-2*t);};

function siltMaps(images) {
  const width=63,height=42,n=width*height,bed=new Float32Array(n),density=new Uint8Array(n),
    mask=new Uint8Array(n),clip=new Uint8Array(n);
  const exp=(x,s)=>Math.exp(-((x/s)**2));
  for(let y=0,i=0;y<height;y++)for(let x=0;x<width;x++,i++){
    const u=(x+.5)/width,v=(y+.5)/height,d=siltFold(v-siltRiver(u)),a=Math.abs(d);
    const folds=.026*Math.cos(siltTau*(2*u-3*v))+.016*Math.sin(siltTau*(4*u+v));
    const strata=.010*Math.cos(siltTau*(21*v+4*u+.31*Math.sin(siltTau*u)));
    const shore=exp(a-.133,.077), river=exp(d,.071), bank=1-river;
    bed[i]=.048-.079*river+.042*shore+bank*(folds+.46*strata);
    const pod=Math.hypot(siltFold(u-.23),siltFold(v-.21));
    density[i]=Math.round(255*siltUnit(.21+.75*shore+.23*exp(pod,.21)));
    mask[i]=a>.033 && Math.hypot(siltFold(u-.71)*1.08,siltFold(v-.18))>.08 ? 255 : 0;
    clip[i]=Math.round(255*siltStep(.012,.032,a));
  }
  const plane=(data,intent,precision,units)=>images.declare({width,height,channels:1,data},
    {intent,precision,units,tiling:{u:'wrap',v:'wrap'},sampling:'linear'});
  return {background:plane(bed,'height','float32','shape-units'),density:plane(density,'mask','unorm8','unitless'),
    mask:plane(mask,'mask','unorm8','unitless'),clip:plane(clip,'mask','unorm8','unitless')};
}

function siltSettings(control) {
  return {span:siltSpan,seed:control.seed,density:control.density,jitter:.96,scale:[.145,.116,.132].map(n=>n*control.scale),
    scaleJitter:[.33,.28,.29],rotation:[control.tilt,control.spin,control.roll],rotationJitter:[17,180,21],
    slopeAlignment:control.slope,heightOffset:control.heightOffset,heightJitter:.011,extrusion:.44,rounding:.043,
    steps:59,epsilon:.00052,samples:2,uv:{mode:control.uvMode,scale:[control.uvScale,control.uvScale]}};
}

function siltGraph(maps,kind='mixed',artifacts=false) {
  const link=(node,port='value')=>({node,port}), input=input=>({input}), op=(op,inputs)=>({op,inputs});
  const graph={format:'ink-studio/graph-project',version:1,inputs:{options:{type:'record',default:siltSettings(siltDefaults)}},
    nodes:{},outputs:{},exports:{}};
  for(const [name,image] of Object.entries(maps)) graph.inputs[name]={type:'any',
    default:{...image,raster:{...image.raster,data:Array.from(image.raster.data)}}};
  let volumes=[];
  if(kind!=='planar'){
    graph.nodes.pebble=op('sdf.shape',{kind:'sphere',options:{radius:.6}});
    graph.nodes.slate=op('sdf.shape',{kind:'box',options:{half:[.57,.25,.43],round:.16}});
    graph.nodes.branch=op('sdf.shape',{kind:'capsule',options:{radius:.23,length:.82,rotation:[1.36,0,.42]}});
    graph.nodes.library=op('data.record',{pebble:link('pebble'),slate:link('slate'),branch:link('branch')});
    graph.nodes.volumes=op('data.collect',{source:link('library'),keys:['pebble','slate','branch']});
    volumes=link('volumes');
  }
  graph.nodes.splatter=op('image.shapeSplatter',{width:siltWidth,height:siltHeight,columns:siltColumns,rows:siltRows,
    shapes:kind==='volume'?[]:siltPlanes,volumes,options:input('options'),
    ...Object.fromEntries(Object.keys(maps).map(name=>[name,input(name)]))});
  graph.nodes.shadow=op('image.heightShadow',{source:link('splatter'),options:{
    azimuth:-132,elevation:30,softness:19,reach:8,step:1.15,bias:.0015,spacing:[siltSpan[0]/siltWidth,siltSpan[1]/siltHeight]}});
  graph.outputs={height:link('splatter'),shadow:link('shadow')};
  for(const port of ['normal','instanceId','shapeId','uv','coverage','layout']) graph.outputs[port]=link('splatter',port);
  if(artifacts) for(const output of ['height','normal','instanceId','shapeId','uv','coverage','layout']) graph.exports[output]={output,format:'json'};
  return graph;
}

const siltColors=[[240,171,131],[255,215,147],[106,178,165],[158,142,186],[115,186,211]];
function siltPreview(outputs,mode='relief') {
  const {width,height,data:depth}=outputs.height.raster, normals=outputs.normal.raster.data,
    ids=outputs.instanceId.raster.data, shapes=outputs.shapeId.raster.data, uv=outputs.uv.raster.data,
    coverage=outputs.coverage.raster.data, shadows=outputs.shadow.raster.data, pixels=new Uint8Array(width*height*4);
  const lut=new Map(outputs.layout.placements.map(tile=>[tile.id,tile]));
  const encode=v=>Math.round(255*siltUnit(v)), line=t=>t-Math.floor(t);
  const terrain=[188,136,95], water=[49,114,124], dark=[20,37,45];
  for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p++){
    const i=p*4,n=p*3, nx=normals[n],ny=normals[n+1],nz=normals[n+2];
    const u=(x+.5)/width,v=(y+.5)/height, z=depth[p],edge=coverage[p];
    const a=ids[p], b=shapes[p], hit=lut.get(a), localU=uv[p*2],localV=uv[p*2+1];
    const noise=((Math.imul(x+21,1597334677)^Math.imul(y+16,3812015801))>>>15)%101/100-.5;
    let rgb;
    if(mode==='height'){
      const value=siltUnit((z+.044)/.29);rgb=[encode(.12+.87*value),encode(.19+.79*value),encode(.29+.64*value)];
    } else if(mode==='normals') rgb=[encode(nx*.5+.5),encode(ny*.5+.5),encode(nz*.5+.5)];
    else if(mode==='coverage') rgb=dark.map((n,j)=>n+(j===0?228:210)*edge);
    else if(mode==='instances') rgb=a?siltColors[(Math.imul(a,91)>>>0)%siltColors.length].map(n=>n*((a%7)*.052+.68)):dark;
    else if(mode==='shapes') rgb=b?siltColors[(b-1)%siltColors.length]:dark;
    else if(mode==='uv') {
      const check=(Math.floor(localU*7)+Math.floor(localV*7))&1;
      rgb=a?[encode(line(localU)*.72+check*.17),encode(line(localV)*.72+(1-check)*.16),check?184:64]:dark;
    } else {
      const river=1-siltStep(.038,.081,Math.abs(siltFold(v-siltRiver(u))));
      const lambert=siltUnit(-.49*nx+.55*ny+.67*nz), terr=.84+.33*lambert-shadows[p]*.42+noise*.17;
      const depthTint=siltUnit((z+.02)*4)*.13;
      const base=terrain.map((n,j)=>(n*(1-river)+water[j]*river)*(terr+depthTint));
      if(hit){
        const stone=siltColors[(b-1)%siltColors.length], height=siltUnit((z-hit.base[1])/(hit.scale[1]||1));
        const fleck=noise*.14+.063*Math.sin(siltTau*(7*localU+localV*3.1));
        const key=.61+lambert*.54+height*.09-shadows[p]*.23+fleck;
        rgb=base.map((n,j)=>n+(stone[j]*key-n)*edge);
      } else rgb=base;
    }
    for(let j=0;j<3;j++) pixels[i+j]=Math.round(Math.max(0,Math.min(255,rgb[j])));
    pixels[i+3]=255;
  }
  return {width,height,data:pixels};
}

if(typeof module!=='undefined') module.exports={siltMaps,siltGraph,siltPreview,siltPorts};
