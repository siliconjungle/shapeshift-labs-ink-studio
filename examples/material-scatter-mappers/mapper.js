const scatterAtlas=(()=>{
  const silt=typeof module==='undefined'?{siltMaps,siltGraph,siltPreview}:require('../material-shape-splatter/silt.js');
  const families=['Cut stone','Fossil ring','Pebble','Slate','Branch'];
  const defaults={mode:'color',scope:'family',shape:2,color:'#7aebd7',opacity:1,style:'bands',replacement:3,angle:0};
  const link=(node,port='value')=>({node,port}), input=input=>({input});
  const modes={color:'Color',gray:'Grayscale',mask:'Selection mask',hide:'Hide stamps',replace:'Replace shape'};
  const styles={bands:'Banded glaze',diamonds:'Diamond inlay',solid:'Solid'};
  const unit=n=>Math.max(0,Math.min(1,n));
  function textures(g,style) {
    if(style==='solid')return {color:[],gray:[]};
    const width=24,height=24,color=new Uint8Array(width*height*3),gray=new Float32Array(width*height);
    for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p++){
      const u=(x+.5)/width-.5,v=(y+.5)/height-.5;
      const drift=.19*Math.cos(v*12);
      const wave=(u-v*.6+drift)*10, bars=wave-Math.floor(wave);
      const diamond=(Math.abs(u)+Math.abs(v))*11, rim=diamond-Math.floor(diamond);
      const edge=style==='bands'?bars:rim;
      const shade=edge<.17?.35:edge<.28?.65:edge>.87?.82:1;
      gray[p]=shade;
      color.set([235*shade,(249-9*edge)*shade,(244-30*edge)*shade],3*p);
    }
    const img=(data,channels,intent)=>g.declare({width,height,channels,data},
      {intent,tiling:{u:'wrap',v:'wrap'},sampling:'nearest'});
    return {color:[img(color,3,'color')],gray:[img(gray,1,'data')]};
  }
  function recordOptions(control) {
    return {value:control.color,opacity:control.opacity,uvAngle:control.angle,uvScale:[1,1],filter:'nearest'};
  }
  function defaultsFor(g) {
    const tile=textures(g,defaults.style);
    return {selector:{shapeIds:[defaults.shape]},focus:{instanceId:1},colorOptions:recordOptions(defaults),
      grayOptions:{...recordOptions(defaults),value:1},colorTextures:tile.color,grayTextures:tile.gray,
      action:{action:'replace',shapeId:defaults.replacement}};
  }
  function graph(g,exportMaps=false) {
    const spec=silt.siltGraph(silt.siltMaps(g),'mixed');
    const portable=img=>({...img,raster:{...img.raster,data:Array.from(img.raster.data)}});
    for(const [key,value] of Object.entries(defaultsFor(g))){
      const isTexture=key.endsWith('Textures');
      spec.inputs[key]={type:isTexture?'array<typedImage>':'record',default:isTexture?value.map(portable):value};
    }
    const op=(op,inputs)=>({op,inputs}), source=link('splatter','surface'), selection=link('subset','selection');
    spec.nodes.subset=op('image.scatterMask',{source,options:input('selector')});
    for(const [name,kind] of [['color','Color'],['gray','Grayscale']])spec.nodes[name]=op('image.scatter'+kind,{
      source,selection,options:input(name+'Options'),textures:input(name+'Textures')});
    spec.nodes.inspect=op('image.scatterInspect',{source,options:input('focus')});
    spec.nodes.edit=op('image.scatterEdit',{selection,options:input('action')});
    spec.nodes.rebake=op('image.shapeSplatter',{...spec.nodes.splatter.inputs,edits:link('edit')});
    spec.nodes.rebakeShadow=op('image.heightShadow',{...spec.nodes.shadow.inputs,source:link('rebake')});
    spec.outputs={...spec.outputs,color:link('color'),gray:link('gray'),mask:link('subset'),inspect:link('inspect'),
      selection,edits:link('edit'),editedHeight:link('rebake'),editedShadow:link('rebakeShadow')};
    for(const port of ['normal','instanceId','shapeId','uv','coverage','layout'])
      spec.outputs['edited'+port[0].toUpperCase()+port.slice(1)]=link('rebake',port);
    if(exportMaps)for(const key of ['color','gray','mask','inspect','selection','edits','editedHeight','editedNormal','editedLayout'])
      spec.exports[key]={output:key,format:'json'};
    return spec;
  }
  function variedControl(control,focus,tile) {
    const selector=control.scope==='family'?{shapeIds:[control.shape]}:{instanceIds:focus.instanceId?[focus.instanceId]:[]};
    const colorOptions=recordOptions(control);
    return {selector,focus:focus.pixel?{pixel:focus.pixel}:{instanceId:focus.instanceId},
      colorOptions,grayOptions:{...colorOptions,value:1},colorTextures:tile.color,grayTextures:tile.gray,
      action:control.mode==='hide'?{action:'hide'}:{action:'replace',shapeId:control.replacement}};
  }
  function preview(out,mode) {
    if(mode==='original')return silt.siltPreview(out);
    if(mode==='hide'||mode==='replace'){
      const edited={};
      for(const key of ['height','shadow','normal','instanceId','shapeId','uv','coverage','layout'])
        edited[key]=out['edited'+key[0].toUpperCase()+key.slice(1)];
      return silt.siltPreview(edited);
    }
    const image=silt.siltPreview(out), {data}=image, mask=out.mask.raster.data;
    const normal=out.normal.raster.data, shaded=out.shadow.raster.data, encoded=out[mode].raster.data;
    for(let p=0,i=0;p<mask.length;p++,i+=4){
      if(mode==='color'){
        const coverage=encoded[i+3]/255;
        if(!coverage)continue;
        const light=.61+.47*unit(-.49*normal[p*3]+.55*normal[p*3+1]+.67*normal[p*3+2])-.23*shaded[p];
        for(let c=0;c<3;c++)data[i+c]=Math.round(data[i+c]*(1-coverage)+Math.min(255,encoded[i+c]*light)*coverage);
      } else {
        const weight=encoded[p], guide=mode==='gray'?20:14;
        for(let c=0;c<3;c++)data[i+c]=Math.round(guide+data[i+c]*.09+weight*([221,235,231][c]-guide));
      }
    }
    return image;
  }
  function defaultFocus(out, family) {
    const {width,height,data}=out.instanceId.raster, shape=out.shapeId.raster.data, coverage=out.coverage.raster.data;
    let hit=0,min=Infinity;
    for(let i=0;i<data.length;i++){
      if(shape[i]!==family||coverage[i]!==1)continue;
      const score=(i%width-width*.53)**2+(Math.floor(i/width)-height*.42)**2;
      if(score<min){min=score;hit=i;}
    }
    return {instanceId:data[hit]||1,pixel:[hit%width,Math.floor(hit/width)]};
  }
  return {defaults,families,modes,styles,graph,preview,defaultFocus,textures,variedControl};
})();
if(typeof module!=='undefined')module.exports=scatterAtlas;
