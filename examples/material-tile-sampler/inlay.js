const inlayWidth=180, inlayHeight=120, inlayColumns=27, inlayRows=17;
const inlayMapInfo={
  selection:['Selection','Chooses a stamp from the ordered library at each original cell center.'],
  position:['Position','Red and green encode horizontal and vertical movement around neutral gray.'],
  rotation:['Rotation','Orients the shards along the current. Mid-gray holds the original angle.'],
  scale:['Scale','Larger pieces trace the bright current and smaller ones fill the banks.'],
  color:['Color','Tint sampled from the tide, reef and surrounding slate.'],
  density:['Density','Sets the chance that a cell appears. The same seed gives the same draw for each cell.'],
  visibility:['Visibility','Carves quiet pools using a fixed threshold.'],
  priority:['Priority','Keeps the brightest part of the current above neighboring stamps.']
};
const inlayStamps=[
  {type:'disc',radius:.45},
  {type:'polygon',points:[[.01,.53],[.45,.12],[.98,.47],[.58,.88]]},
  {type:'rectangle',size:[1,.63],radius:.25},
  {type:'star',tips:4,radius:.5,innerRadius:.155,angle:70}
];
const inlaySeed=4277;
const inlayOptions={pattern:'brick',size:[1.04,.97],gutter:[.035,.065],aspect:1.5,color:'#ffffff',
  background:'#14262f',samples:2,seed:inlaySeed,jitter:{position:[.12,.11],size:[.13,.15],rotation:22,color:.11}};
const inlayControls={positionAmount:[.33,.38],scaleRange:[.36,1.56],rotationAmount:90,density:1,
  seeds:{density:1148,selection:2710,position:6241,rotation:781,scale:210,color:419}};
const inlayUnit=n=>Math.max(0,Math.min(1,n));
const inlayMix=(a,b,t)=>a+(b-a)*t;
function inlayMaps(images) {
  const width=48,height=32,tau=Math.PI*2;
  const channels={position:2,color:3}, raw={};
  for(const name of Object.keys(inlayMapInfo)) raw[name]=new Uint8Array(width*height*(channels[name]??1));
  const byte=n=>Math.round(255*inlayUnit(n));
  const seam=n=>n-Math.round(n);
  const tide=u=>.435+.166*Math.sin(tau*(u-.075))+.042*Math.sin(tau*(2*u+.15));
  const shallow=[.21,.39,.41], slate=[.095,.18,.24], teal=[.24,.78,.71], foam=[.57,.91,.84];
  const copper=[.88,.47,.28], gold=[1,.86,.58];
  for(let y=0,i=0;y<height;y++) for(let x=0;x<width;x++,i++) {
    const u=(x+.5)/width,v=(y+.5)/height;
    const d=seam(v-tide(u)), outer=Math.exp(-28*d*d), crest=Math.exp(-115*d*d);
    const branch=Math.exp(-160*seam(v-tide(u)-.178+.033*Math.cos(tau*u))**2)*(.45+.55*Math.sin(tau*(u+.08))**2);
    const bend=tau*(.166*Math.cos(tau*(u-.075))+.084*Math.cos(tau*(2*u+.15)))/1.5;
    const rhythm=(Math.cos(tau*(3*u-v))*.5+.5), crestGold=Math.max(0,(crest-.63)/.37)*(.38+.62*rhythm);
    const selected=crest>.94&&Math.cos(tau*(2*u+.14))>.65?.94:crest>.52?.66:outer>.48?.41:.05;
    const poolA=Math.hypot(seam(u-.24)*1.35,seam(v-.775));
    const poolB=Math.hypot(seam(u-.77)*1.35,seam(v-.18));
    raw.selection[i]=byte(selected);
    raw.position[2*i]=byte(.5+.32*Math.sin(tau*(v+u))*outer);
    raw.position[2*i+1]=byte(.5+.32*Math.cos(tau*(u-.09))*outer);
    raw.rotation[i]=byte(.5+Math.atan(bend)/Math.PI*(.7+.3*crest));
    raw.scale[i]=byte(.13+.86*Math.max(crest,.58*branch));
    const rgb=slate.map((c,j)=>{
      const base=inlayMix(c,shallow[j],.37+.40*rhythm);
      const water=inlayMix(base,teal[j],inlayUnit(outer*.65+branch*.54));
      const light=inlayMix(water,foam[j],crest*.35);
      const metallic=inlayMix(copper[j],gold[j],rhythm);
      return inlayMix(light,metallic,crestGold);
    });
    raw.color.set(rgb.map(byte),3*i);
    raw.density[i]=byte(.52+.44*Math.max(outer,branch));
    raw.visibility[i]=poolA<.09||poolB<.085?0:255;
    raw.priority[i]=byte(.22*rhythm+.77*crest);
  }
  return Object.fromEntries(Object.entries(raw).map(([name,data])=>[name,images.declare({width,height,channels:channels[name]??1,data},
    {intent:name==='color'?'color':'data',precision:'unorm8',tiling:{u:'wrap',v:'wrap'},
      sampling:['selection','visibility'].includes(name)?'nearest':'linear'})]));
}

function inlayGraph(maps,artifacts=false) {
  const link=(node,port='value')=>({node,port}), input=input=>({input}), op=(op,inputs)=>({op,inputs});
  const graph={format:'ink-studio/graph-project',version:1,inputs:{
    controls:{type:'record',default:inlayControls}
  },nodes:{},outputs:{},exports:{}};
  for(const [name,map] of Object.entries(maps))
    graph.inputs[name]={type:'any',default:{...map,raster:{...map.raster,data:Array.from(map.raster.data)}}};
  graph.nodes.tiles=op('image.tileSampler',{width:inlayWidth,height:inlayHeight,columns:inlayColumns,rows:inlayRows,
    stamps:inlayStamps,options:inlayOptions,controls:input('controls'),
    ...Object.fromEntries(Object.keys(maps).map(name=>[name,input(name)]))});
  graph.nodes.colorImage=op('image.toDisplay',{source:link('tiles')});
  graph.nodes.height=op('image.bevel',{source:link('tiles','coverage'),options:{width:1.7,height:1.1,profile:'round'}});
  graph.nodes.light=op('image.emboss',{source:link('height'),options:{azimuth:-132,elevation:33,strength:.85,bias:.6}});
  graph.outputs={value:link('colorImage'),light:link('light'),layout:link('tiles','layout'),tileId:link('tiles','tileId'),
    stampId:link('tiles','stampId'),coverage:link('tiles','coverage')};
  if(artifacts) graph.exports={albedo:{output:'value',format:'png'},layout:{output:'layout',format:'json'},
    tileId:{output:'tileId',format:'json'},stampId:{output:'stampId',format:'json'}};
  return graph;
}

const stampColors=[[64,133,158],[252,198,125],[106,200,174],[238,129,109]];
function inlayPreview(outputs,mode='relief') {
  if(mode==='albedo') return outputs.value;
  const {width,height,data:raw}=outputs.value, stamps=outputs.stampId.raster.data, ids=outputs.tileId.raster.data;
  const coverage=outputs.coverage.raster.data, light=outputs.light.raster.data, layout=outputs.layout;
  const priority=new Map(layout.placements.map(tile=>[tile.id,tile.priority]));
  const data=new Uint8Array(raw.length);
  for(let y=0,i=0;y<height;y++) for(let x=0;x<width;x++,i++) {
    const p=i*4, background=[20,38,47], a=coverage[i];
    if(mode==='relief'){
      const shimmer=((Math.imul(x+7,1191733877)^Math.imul(y+7,1187004371))>>>19)%37/36-.5;
      const lambert=a*(light[i]-.6)*.54, gain=1+lambert+.1*shimmer;
      for(let c=0;c<3;c++) data[p+c]=Math.round(Math.max(0,Math.min(255,raw[p+c]*gain+Math.max(0,lambert)*15)));
    } else {
      const value=priority.get(ids[i])??0;
      const ink=!stamps[i]?background:mode==='stamps'?stampColors[stamps[i]-1]:
        [Math.round(45+210*value),Math.round(89+125*value),Math.round(116-37*value)];
      data.set(ink,p);
    }
    data[p+3]=255;
  }
  return {width,height,data};
}

function inlayMapPreview(map) {
  const {width,height,channels,data:source}=map.raster, data=new Uint8Array(width*height*4);
  for(let i=0;i<width*height;i++){
    const p=4*i,j=channels*i,a=source[j];
    if(channels===3) data.set(source.subarray(j,j+3),p);
    else if(channels===2) data.set([a,source[j+1],80],p);
    else data.set([Math.round(20+.92*a),Math.round(38+.75*a),Math.round(47+.49*a)],p);
    data[p+3]=255;
  }
  return {width,height,data};
}

if(typeof module!=='undefined') module.exports={inlayMaps,inlayGraph,inlayPreview,inlayMapPreview};
