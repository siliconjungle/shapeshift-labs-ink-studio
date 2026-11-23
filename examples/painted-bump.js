const { paintMap } = require('../src/frame-composite.js');

const width = 168, height = 104;
const box = (x,y,w,h) => ({type:'rect',rect:[x,y,w,h]});
const outline = points => ({type:'polygon',points});
const glyphs = {
  S:['01111','10000','10000','01110','00001','00001','11110'],
  I:['11111','00100','00100','00100','00100','00100','11111'],
  G:['01110','10001','10000','10111','10001','10001','01110'],
  N:['10001','11001','10101','10011','10001','10001','10001'],
  A:['01110','10001','10001','11111','10001','10001','10001'],
  L:['10000','10000','10000','10000','10000','10000','11111']
};

function source() {
  const art = [], paint = [];
  const ink = (shape,color) => art.push({...shape,color});
  const raise = (shape,level) => paint.push({shape,height:level});
  const block = (x,y,w,h,color,level) => {
    const shape = box(x,y,w,h);
    ink(shape,color);
    raise(shape,level);
  };
  ink(outline([[4,10],[11,10],[11,5],[148,5],[148,8],[160,8],[160,93],[155,93],[155,98],[8,98],[8,94],[4,94]]),'#253339');
  for(let row=0;row<7;row++) for(let col=0;col<9;col++) {
    const x=6+col*18+(row%2)*8, y=8+row*13;
    const w=Math.min(17,158-x);
    if(w<1) continue;
    const colors=['#3e5357','#42585b','#3b5054','#374a50'];
    block(x,y,w,11,colors[(row*3+col*5)%colors.length],.36+.12*((row+col)%3));
    if((row+col)%3===0) ink(box(x+2,y+2,Math.min(w-2,4),1),'#4b6062');
  }
  const plate = outline([[27,24],[141,24],[141,27],[147,27],[147,77],[143,77],[143,82],[25,82],[25,78],[20,78],[20,29],[27,29]]);
  ink(plate,'#855633');
  raise(plate,2.8);
  block(25,30,117,46,'#a7723e',1.85);
  block(36,33,95,40,'#325c57',.43);
  block(39,36,89,34,'#38655d',.73);
  for(const x of [28,138]) for(const y of [36,70]) {
    const rivet=outline([[x-2,y-3],[x+2,y-3],[x+4,y-1],[x+4,y+2],[x+2,y+4],[x-2,y+4],[x-4,y+2],[x-4,y-1]]);
    ink(rivet,'#c08849');
    raise(rivet,4.3);
    block(x-2,y,4,1,'#815837',2.1);
  }
  for(const [index,letter] of [...'SIGNAL'].entries()) {
    for(const [row,pattern] of glyphs[letter].entries()) for(let x=0;x<pattern.length;x++) {
      if(pattern[x]!=='1') continue;
      let end=x+1;
      while(pattern[end]==='1')end++;
      block(49+index*12+x*2,45+row*2,(end-x)*2,2,'#c59a5f',2.6);
      x=end-1;
    }
  }
  block(51,63,64,1,'#5f8c79',-.7);
  for(const x of [68,83,98]) block(x,39,3,2,'#83a88b',1.8);
  block(34,84,100,1,'#253d40',-.6);

  return { metadata:{ width,height,unitsPerPixel:.04,normalSpace:'view',
    scenery:{bands:{wall:0},base:'wall',lightPaint:[{normal:[0,0,1],shape:box(0,0,width,height)}]},
    bump:{strength:1,paint} }, images:{color:paintMap(width,height,art)} };
}

function lightDirection(degrees) {
  const angle=degrees*Math.PI/180, horizontal=Math.sqrt(1-.34**2);
  return [Math.sin(angle)*horizontal,.34,Math.cos(angle)*horizontal];
}

module.exports = ({KIT:K,makeBuilder}) => ({
  id:'painted-bump',name:'Signal Works',seed:1,
  build(seed,{bump=true,light=-48}={}) {
    const art=source();
    if(!bump)art.metadata.bump=false;
    const B=makeBuilder(seed,[0x132126]);
    return B.finish({
      cam:{target:[0,0,0],dist:7.1,yaw:0,pitch:0,ortho:true,sway:0},radius:6,dither:0,
      spriteAtlases:[K.sprite.placeAtlas({atlas:art,at:[0,0,0],objectId:'signal-works'})],
      liveSun:{direction:lightDirection(light),ambient:.47,intensity:.72,shadows:false}
    });
  }
});
module.exports.source = source;
module.exports.lightDirection = lightDirection;
