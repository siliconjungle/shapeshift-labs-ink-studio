'use strict';

const Footprints = require('../src/splat-footprints.js');

function texel(mask, x, y, width, height) {
  const atX = Math.floor((x+.5)*mask.width/width);
  const atY = Math.floor((y+.5)*mask.height/height);
  return mask.alpha[atY*mask.width+atX];
}

function editFootprint(current, edit) {
  if (edit===false) return false;
  if (typeof edit==='string') return Footprints.prepare(edit);
  if (!edit || Object.getPrototypeOf(edit)!==Object.prototype)
    throw new TypeError('A splat footprint edit needs a shape, transform, trim or carve');
  const {trim,carve,...settings}=edit;
  if (!Object.keys(edit).length)
    throw new TypeError('A splat footprint edit cannot be empty');
  const replaces=Object.hasOwn(settings,'shape');
  if (!replaces && Object.keys(settings).some(key=>!['rotation','stretch','softness'].includes(key)))
    throw new TypeError('Choose a footprint shape to replace it, or edit rotation, stretch, softness, trim or carve');
  const base=Footprints.prepare(replaces ? settings : {...(current || {shape:'circle'}),...settings});
  if (trim===undefined && carve===undefined) return base;

  // Stencils share the unrotated, top-down coordinates of the source profile.
  const keep=trim===undefined ? undefined : Footprints.prepare({shape:'mask',mask:trim}).mask;
  const cut=carve===undefined ? undefined : Footprints.prepare({shape:'mask',mask:carve}).mask;
  const {mask,rotation,stretch,softness,depth}=base;
  const width=Math.max(mask?.width ?? 64,keep?.width ?? 0,cut?.width ?? 0);
  const height=Math.max(mask?.height ?? 64,keep?.height ?? 0,cut?.height ?? 0);
  const alpha=new Array(width*height);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const source=mask ? texel(mask,x,y,width,height)>=128 :
      Footprints.distance(base,2*(x+.5)/width-1,1-2*(y+.5)/height)<=0;
    const inside=source && (!keep || texel(keep,x,y,width,height)>=128) &&
      (!cut || texel(cut,x,y,width,height)<128);
    alpha[y*width+x]=inside ? 255 : 0;
  }
  return Footprints.prepare({shape:'mask',mask:{width,height,alpha},rotation,stretch,softness,depth});
}

function describe(footprint) {
  if (!footprint) return false;
  const {depth='center',mask,...settings}=footprint;
  return {...settings,depth,...(mask && {mask:{width:mask.width,height:mask.height,
    filledTexels:mask.alpha.reduce((count,alpha)=>count+Number(alpha>=128),0)}})};
}

module.exports={editFootprint,describe};
