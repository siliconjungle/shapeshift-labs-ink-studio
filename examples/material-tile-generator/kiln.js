const kilnWidth=144, kilnHeight=96;
const kilnPatterns={brick:'Running bond',grid:'Stack bond','column-stagger':'Column stagger',checker:'Checker'};
const kilnStamps={
  brick:{label:'Rounded brick',shape:{type:'rectangle',size:[1,1],radius:.055}},
  disc:{label:'Disc',shape:{type:'disc',radius:.47}},
  hex:{label:'Hexagon',shape:{type:'polygon',sides:6,radius:.48}},
  star:{label:'Compass star',shape:{type:'star',tips:4,radius:.48,innerRadius:.22}},
  spot:{label:'Soft spot',shape:{type:'spot',radius:.48,core:.26}}
};
const kilnPalettes={
  terracotta:{label:'Terracotta',colors:['#a94735','#bb5741','#c76548','#ad503c','#ca7450','#d37a57'],grout:'#33242a'},
  patina:{label:'Verdigris',colors:['#2d6f65','#3c8a77','#497e69','#5c9a7b','#327969'],grout:'#183146'},
  plum:{label:'Plum enamel',colors:['#795274','#916584','#9c6c92','#81577c','#ac7a9a'],grout:'#2a233b'}
};
const kilnCrops={full:{label:'Full period',window:[0,0,1,1]},
  seam:{label:'Seam corner',window:[.75,.75,1.25,1.25]},detail:{label:'Left section',window:[0,.15,.6,.75]}};
const kilnDefaults={pattern:'brick',columns:4,rows:7,stamp:'brick',uSize:1,vSize:1,
  gutterU:.08,gutterV:.12,rowOffset:.5,columnOffset:0,rotation:0,jitter:.42,
  palette:'terracotta',colorMode:'tile',seed:3703,crop:'full'};

function kilnRecipe(settings) {
  const {pattern,uSize,vSize,gutterU,gutterV,rotation,rowOffset,columnOffset,jitter,palette,colorMode,seed,crop}=settings;
  const {colors,grout}=kilnPalettes[palette];
  return {pattern,size:[uSize,vSize],gutter:[gutterU,gutterV],rotation,rowOffset,columnOffset,
    aspect:kilnWidth/kilnHeight,palette:colors,colorMode,background:grout,seed,
    jitter:{position:[.055*jitter,.025*jitter],size:[.09*jitter,.11*jitter],rotation:5*jitter,color:.17*jitter},
    crop:kilnCrops[crop].window};
}

function kilnGraph(artifacts=false) {
  const link=(node,port='value')=>({node,port}), input=input=>({input}), op=(op,inputs)=>({op,inputs});
  const graph={format:'ink-studio/graph-project',version:1,inputs:{
    columns:{type:'number',default:kilnDefaults.columns},rows:{type:'number',default:kilnDefaults.rows},
    definition:{type:'record',default:kilnStamps.brick.shape},
    tileOptions:{type:'record',default:kilnRecipe(kilnDefaults)}
  },nodes:{
    stamp:op('shape.define',{definition:input('definition')}),
    tile:op('image.tileGenerator',{width:kilnWidth,height:kilnHeight,columns:input('columns'),
      rows:input('rows'),stamp:link('stamp'),options:input('tileOptions')}),
    glazedHeight:op('image.bevel',{source:link('tile','coverage'),options:{width:2.35,height:1.65,profile:'round'}}),
    light:op('image.emboss',{source:link('glazedHeight'),options:{azimuth:-130,elevation:38,strength:.95,bias:.64}}),
    shadow:op('image.heightShadow',{source:link('glazedHeight'),options:{azimuth:-130,elevation:28,reach:4,softness:13,step:.8}}),
    albedo:op('image.toDisplay',{source:link('tile')})
  },outputs:{
    value:link('albedo'),coverage:link('tile','coverage'),tileId:link('tile','tileId'),course:link('tile','course'),
    layout:link('tile','layout'),light:link('light'),shadow:link('shadow'),height:link('glazedHeight')
  },exports:{}};
  if (artifacts) graph.exports={
    albedo:{output:'value',format:'png'},layout:{output:'layout',format:'json'},
    coverage:{output:'coverage',format:'json'},tileId:{output:'tileId',format:'json'},course:{output:'course',format:'json'}
  };
  return graph;
}

const courseColors=[[201,133,92],[227,181,103],[148,170,116],[104,153,145],[103,128,170],[145,118,170],[194,126,148]];
function kilnPreview(outputs,crop=kilnCrops.full.window,mode='glaze') {
  const {width,height,data:source}=outputs.value, result=new Uint8Array(source.length);
  if (mode==='albedo') return outputs.value;
  const m=outputs.coverage.raster.data, lit=outputs.light.raster.data, dark=outputs.shadow.raster.data;
  const ids=outputs.tileId.raster.data, rows=outputs.course.raster.data;
  const [x1,y1,x2,y2]=crop;
  const wrap=(n,p)=>((n%p)+p)%p;
  for (let y=0,i=0;y<height;y++) for (let x=0;x<width;x++,i++) {
    const p=i*4;
    if (mode==='courses') {
      const base=rows[i]?courseColors[(rows[i]-1)%courseColors.length]:[33,32,42];
      const split=ids[i]%2 ? 0 : -12;
      for (let c=0;c<3;c++) result[p+c]=Math.max(0,base[c]+split);
    } else {
      const u=wrap(Math.floor((x1+(x+.5)/width*(x2-x1))*width),width);
      const v=wrap(Math.floor((y1+(y+.5)/height*(y2-y1))*height),height);
      const speckle=((Math.imul(u+13,1597334677)^Math.imul(v+71,3812015801))>>>12)%61/60-.5;
      const light=m[i] ? (lit[i]-.64)*.84 : 0;
      const tone=1+light+.13*speckle-m[i]*dark[i]*.12-(1-m[i])*dark[i]*.39;
      const warmth=[22,16,7];
      for (let c=0;c<3;c++) result[p+c]=Math.max(0,Math.min(255,Math.round(source[p+c]*tone+Math.max(0,light)*warmth[c])));
    }
    result[p+3]=255;
  }
  return {width,height,data:result};
}

if (typeof module!=='undefined') module.exports={kilnGraph,kilnPreview};
