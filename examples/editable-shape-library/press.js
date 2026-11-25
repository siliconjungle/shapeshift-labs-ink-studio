const pressSizes = { native:40, inspection:120 };
const pressDefault = 'harbor';
const pressModes = {material:'Material',coverage:'Coverage',distance:'Signed distance',relief:'Bevel height',profile:'Scalar value'};
function pressSource(presets) {
  return { ...presets,entries:{ harbor:{label:'Harbor seal',definition:{
    type:'bevel',width:.027,height:.046,profile:'round',shape:{type:'symbol',parts:[
      {shape:{type:'disc',radius:.411}},
      {op:'subtract',shape:{type:'disc',radius:.341}},
      {shape:{type:'star',center:[.5,.345],tips:4,radius:.143,innerRadius:.049}},
      {shape:{type:'disc',center:[.327,.423],radius:.022}},
      {shape:{type:'disc',center:[.673,.423],radius:.022}},
      {shape:{type:'stroke',width:.047,points:[[.264,.547],[.345,.578],[.423,.545],[.5,.512],[.577,.545],[.655,.578],[.736,.547]]}},
      {shape:{type:'stroke',width:.045,points:[[.319,.658],[.382,.676],[.444,.651],[.5,.627],[.556,.651],[.618,.676],[.681,.658]]}}
    ]}
  }},...presets.entries} };
}

function pressGraph(library,artifacts=false) {
  const link = (node,port='value') => ({node,port}), input = input => ({input});
  const graph={format:'ink-studio/graph-project',version:1,inputs:{
    library:{type:'record',default:library},shapeId:{type:'string',default:pressDefault},
    bakeOptions:{type:'record',default:{samples:1}}
  },nodes:{
    marks:{op:'shape.library',inputs:{source:input('library')}},
    selected:{op:'shape.pick',inputs:{source:link('marks'),id:input('shapeId')}}
  },outputs:{definition:link('selected'),library:link('marks')},exports:{}};
  for (const [name,size] of Object.entries(pressSizes)) {
    graph.nodes[name]={op:'image.shape',inputs:{source:link('selected'),width:size,height:size,options:input('bakeOptions')}};
    const light=name+'Shade';
    graph.nodes[light]={op:'image.emboss',inputs:{source:link(name,'height'),
      options:{spacing:[1/size,1/size],azimuth:-128,elevation:31,strength:.88,bias:.65}}};
    for (const [suffix,port] of Object.entries({Value:'value',Mask:'mask',Distance:'distance',Height:'height'}))
      graph.outputs[name+suffix]=link(name,port);
    graph.outputs[light]=link(light);
    if (artifacts) for (const suffix of ['Mask','Distance','Height']) {
      const id=name+suffix;
      graph.exports[id]={output:id,format:'json'};
    }
  }
  if (artifacts) graph.exports.library={output:'library',format:'json'};
  return graph;
}

const pressClamp = n=>Math.max(0,Math.min(1,n));
const pressMetal = [[76,41,46],[132,71,56],[191,114,63],[234,164,82],[255,215,133],[255,241,181]];
function pressPreview({value,mask,distance,height,shade},mode='material') {
  const {width,height:rows,data:coverage}=mask.raster;
  const signed=distance.raster.data, relief=height.raster.data, valueSamples=value.raster.data;
  const materialProfile=value.descriptor.intent==='data', result=new Uint8Array(width*rows*4);
  for (let y=0,i=0;y<rows;y++) for (let x=0;x<width;x++,i++) {
    const u=(x+.5)/width,v=(y+.5)/rows, d=signed[i], z=relief[i], a=coverage[i];
    const inside=pressClamp(-d*18), glint=1-.58*u-.52*v, dark=pressClamp(1-(d-.013)*45);
    let rgb;
    if (mode==='material') {
      const light=shade ? shade.raster.data[i]-.65 : 0;
      const profile=a ? valueSamples[i]/a : 0;
      const t=pressClamp(materialProfile ? profile*.82+.12 : .42+.21*glint+.09*inside+light*.56);
      const k=t*(pressMetal.length-1), from=Math.floor(k), to=Math.min(pressMetal.length-1,from+1);
      const background=[19+7*glint-6*dark,23+10*glint-6*dark,32+13*glint-7*dark];
      rgb=background.map((base,c)=>{
        const tone=pressMetal[from][c]+(pressMetal[to][c]-pressMetal[from][c])*(k-from);
        return base+(tone-base)*a;
      });
    } else if (mode==='distance') {
      const strength=pressClamp(Math.abs(d)*4.2), line=pressClamp(1-Math.abs(d)*width*.9);
      const base=d<=0 ? [200,112,61] : [64,96,148];
      rgb=base.map((c,j)=> (34+(c-34)*strength)*(1-line)+[249,224,169][j]*line);
    } else if (mode==='relief') {
      const amplitude=pressClamp(Math.abs(z)*17);
      rgb=(z<0 ? [77,146,230] : [255,202,113]).map(c=>22+c*amplitude*.9);
    } else {
      const n=mode==='coverage' ? a : valueSamples[i];
      rgb=[24+224*n,27+218*n,33+205*n];
    }
    const p=i*4;
    for(let c=0;c<3;c++) result[p+c]=Math.round(Math.max(0,Math.min(255,rgb[c])));
    result[p+3]=255;
  }
  return {width,height:rows,data:result};
}
function pressImage(outputs,name,mode) {
  return pressPreview({value:outputs[name+'Value'],mask:outputs[name+'Mask'],distance:outputs[name+'Distance'],
    height:outputs[name+'Height'],shade:outputs[name+'Shade']},mode);
}

if (typeof module!=='undefined') module.exports={pressSource,pressGraph,pressImage};
