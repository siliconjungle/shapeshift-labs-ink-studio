const tideglassPreview=(()=>{
  function uvGrid({width,height,span}){
    return Array.from({length:width*height},(_,index)=>[
      .5+((index%width+.5)/width-.5)*span,
      .5+((Math.floor(index/width)+.5)/height-.5)*span
    ]);
  }
  function chart(colors,{width,height},conversions){
    const data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<colors.length;i++){
      const rgba=conversions.toDisplay(colors[i]);
      for(let c=0;c<4;c++)data[4*i+c]=Math.round(rgba[c]*255);
    }
    return {width,height,data};
  }
  function gray(image){
    const {raster:{width,height,data:source},descriptor}=image;
    const divisor={unorm8:255,unorm16:65535}[descriptor.precision]??1;
    const data=new Uint8ClampedArray(width*height*4);
    for(let p=0;p<source.length;p++){
      const value=Math.round(source[p]*255/divisor);
      data.set([value,value,value,255],p*4);
    }
    return {width,height,data};
  }
  return {uvGrid,chart,gray};
})();
if(typeof module!=='undefined')module.exports=tideglassPreview;
