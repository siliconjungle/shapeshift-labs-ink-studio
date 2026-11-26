const PNG = require('../../cli/png.js');
const width = 1024, height = 640, scale = 4;
const center = [128, 80];
const palette = ['0e1c2c', '17283d', '203d52', '285360', '327079', '4b8c89', '68a79a', 'a8c2a1',
  '362b40', '66434d', '9a6858', 'c99263', 'f4c387', 'ffdfa2', '8d516a', 'da886e'].map(x => x.match(/../g).map(n => parseInt(n, 16)));
const fish = [[62,82],[75,65],[91,54],[112,49],[131,51],[147,57],[161,67],[171,70],[187,56],[203,53],[198,65],[202,77],
  [192,83],[205,91],[195,99],[204,108],[186,107],[174,101],[164,92],[154,94],[139,105],[125,110],[107,109],
  [89,103],[74,91],[66,89]];
const fin = [[120,52],[135,35],[150,35],[151,42],[141,55],[132,60]];
const belly = [[105,105],[132,102],[160,92],[150,110],[140,123],[124,126],[123,117]];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const distance = (x,y,u,v) => Math.hypot(x-u,y-v);
function inside(x,y,points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a,b] = points[i], [c,d] = points[j];
    if ((b>y) !== (d>y) && x < (c-a)*(y-b)/(d-b)+a) hit = !hit;
  }
  return hit;
}
function capsule(x,y,a,b,c,d) {
  const u=c-a,v=d-b,t=clamp(((x-a)*u+(y-b)*v)/(u*u+v*v),0,1);
  return distance(x,y,a+t*u,b+t*v);
}
function shape(x,y) {
  const dx=Math.abs(x-center[0]),dy=Math.abs(y-center[1]),left=dx>109,top=dy>63;
  const border=Math.max(dx-117,dy-71,(dx+dy-177)*.7);
  if (border>0) return [0,0,0,0];
  const ink=Math.sin(x*.19+y*.13)*Math.cos(y*.17-x*.1);
  const metal=x+1.25*y<215?1:0;
  if (border> -2) return [8+metal,.05,1,0];
  if (border> -9) {
    const index=border> -4 ? 11+metal : border> -5 ? 10+metal : 8+metal+Math.round(clamp(1-ink,0,2));
    return [index,.07+.29*clamp((-.4-border)/6,0,1),1,0];
  }
  if (border> -11) return [8,.22,1,0];
  const r=Math.hypot(dx,dy*1.45);
  let slot=1+Number(r<101)+Number(r<76);
  if (ink>.58 && r<105) slot++;
  if (r>105 && r<108 || dy>55 && dy<57 && dx<97) slot=5;
  let z=.13+(slot-1)*.014;
  for (const [u,v] of [[29,28],[227,28],[29,132],[227,132]]) {
    const r=distance(x,y,u,v);
    if(r<6)return [r>4.7?8:x+y<u+v?12:y===v?9:10,.32+(6-r)*.043,1,0];
  }
  const onFish=inside(x,y,fish), onFin=inside(x,y,fin)||inside(x,y,belly);
  if (onFin) { slot=y<60?4+(ink>.33?1:0):3+(ink>.2?1:0); z=.26; }
  if (onFish) {
    const sheen = .8*Math.sin(.105*x)+.075*(89-y)+ink*.26;
    slot = 4 + Math.round(clamp(sheen,0,3)); z=.30 + slot*.024;
    if (x>172 && (capsule(x,y,170,79,200,59)<1.3 || capsule(x,y,179,87,200,103)<1.1)) { slot=6; z=.39; }
    if (x>102&&x<165&&y>62&&y<100 && Math.sin(x*.47+(y%8>=4?1.5:0))>.42 &&
        Math.abs((y%8)-3.2)<1.1 && ink>-.45) { slot=Math.min(7,slot+1); z+=.023; }
    if (x>88 && capsule(x,y,89,62,96,76)<1.1 || x>95 && capsule(x,y,96,76,90,92)<1.1) { slot=3; z=.305; }
    const eye=distance(x,y,80.6,73);
    if (eye<5.6) { slot=eye>3.2?12:1; z=.53; }
    if (eye<1.8 && x<81 && y<74) slot=13;
  }
  const tide = 113 + Math.sin(x*.048)*5 + Math.sin(x*.091)*2;
  if (!onFish && !onFin && dx<91 && (Math.abs(y-tide)<.85 || Math.abs(y-(tide+10))<.75 && dx<75)) { slot=5; z=.22; }
  if (!onFish && !onFin && !left && !top && dx>67 && dy>18 && (x*11+y*13)%67===0) {slot=5;z=.19;}
  return [slot,z,1,1];
}
function art() {
  const map = new Uint16Array(width*height*4), mask = new Uint16Array(width*height);
  const float = Buffer.alloc(width*height*4);
  const cells=Array.from({length:width*height/(scale*scale)},(_,i)=>shape(i%(width/scale),Math.floor(i/(width/scale))));
  for(let y=0,p=0;y<height;y++)for(let x=0;x<width;x++,p++){
    const [slot,z,a,keep]=cells[Math.floor(y/scale)*width/scale+Math.floor(x/scale)];
    for(let c=0;c<3;c++)map[p*4+c]=palette[slot][c]*257;
    map[p*4+3]=a*65535;mask[p]=keep*65535;
    const hairline=a*.0014*Math.sin(x*.51+y*.083)*Math.cos(y*.349-x*.07);
    float.writeFloatLE(z + hairline,p*4);
  }
  const pfm=Buffer.concat([Buffer.from('Pf\n'+width+' '+height+'\n-1.0\n'),float]);
  return { plate:PNG.encodeMaterial(width,height,map,4), height:pfm, inlay:PNG.encodeGray(width,height,mask) };
}
module.exports = { width,height,scale,art };
