module.exports={graphOperations:{
  'demo.dock':{
    inputs:{stock:'record',pulse:'eventLog'},outputs:{value:'raster'},
    run({stock,pulse}){
      const width=192,height=64, crates=stock.balance??0, flash=pulse.entries.length>0;
      const data=new Uint8Array(width*height*4);
      for(let y=0;y<height;y++) for(let x=0;x<width;x++){
        const crate=Math.floor((x-16)/10), cell=x>=16&&crate<16&&(x-16)%10<8&&y>=22&&y<51;
        const color=y<7?(flash?[82,255,165]:[23,39,55]):cell?
          (crate<crates?[255,161,73]:[41,55,78]):[14,24,41];
        data.set([...color,255],(y*width+x)*4);
      }
      return {value:{width,height,data}};
    }
  }
}};
