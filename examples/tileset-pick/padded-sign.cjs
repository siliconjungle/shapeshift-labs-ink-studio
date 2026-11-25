'use strict';

const portal = require('../gatehouse-revision/portal.cjs');

module.exports = function paddedSign() {
  const {width:artWidth,pixels} = portal.atlas();
  const width=58,height=23, atlas = new Uint8Array(width*height*4), expected = new Uint8Array(48*16*4);
  for (let i=0;i<atlas.length;i+=4) atlas.set([133,70,121,255],i);
  for (let y=0;y<16;y++) for (let x=0;x<48;x++) {
    const start = (y*artWidth+48+x)*4;
    const pixel = pixels.subarray(start,start+4);
    const sourceX = 2+x+Math.floor(x/16)*3, sourceY = 3+y+Math.floor(y/8)*2;
    atlas.set(pixel,(sourceY*width+sourceX)*4);
    expected.set(pixel,(y*48+x)*4);
  }
  return {width,height,atlas,expected};
};
