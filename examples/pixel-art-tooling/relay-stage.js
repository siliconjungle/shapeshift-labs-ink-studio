const PixelArt = require('../../cli/pixel-art.js');
const design = require('./relay.json');
const patch = require('./relay-cleanup.json');

module.exports = ({ KIT: K, makeBuilder, makeSculpt }) => ({
  id:'pixel-art-relay',
  name:'Ceramic relay',
  seed:29,
  build(seed) {
    const draft = PixelArt.compile(design);
    const cleaned = PixelArt.compile(PixelArt.edit(design,draft,patch));
    const B = makeBuilder(seed,[0x12212e,0x233747,0x3c5261,0x805d5e,0xd49f6d]);
    const S = K.sculpt(makeSculpt(B));
    S.box([0,-.95,-.05],[1.68,.12,.68],{ r:[1,2,3] },{ res:.075,rd:.08 });
    for (const x of [-.90,.90])
      S.box([x,-.55,-.06],[.058,.36,.12],{ r:[1,2,3] },{ res:.033,rd:.03 });
    S.bake();
    return B.finish({
      cam:{ target:[0,.26,0],dist:6.45,yaw:.12,pitch:.14,ortho:true }, radius:5,dither:0,
      pixelStamps:[{ stamp:PixelArt.stamp(cleaned), at:[0,.43,.18], unitsPerPixel:.043, keepSwatches:true }]
    });
  }
});
