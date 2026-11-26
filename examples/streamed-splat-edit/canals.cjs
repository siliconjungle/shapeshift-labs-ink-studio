'use strict';

const { cos, sin, PI } = Math;
const pack = hex => (hex&255)<<16 | hex&0xff00 | hex>>>16&255;
const palette = {
  brick:0x44717d, grout:0x2b4f62, rim:0x84abae, deep:0x223a52,
  bronze:0x98715a, timber:0x624c4b, light:0xffb157, glass:0x74507a, stripe:0xe7c48d,
  glint:0xffdda0, leaf:0x376e67, grass:0x63a788, jewel:0xda78a8
};
const opaque = 1;
const columns = 8, rows = 6;

function build() {
  const data=[], layers=[];
  let cx=0,cz=0;
  function splat(layer,x,y,z,scale,color,opacity=opaque,slant=0) {
    const [sx,sy,sz]=scale,c=cos(slant),s=sin(slant),a=sx*sx,b=sy*sy;
    data.push(cx+x,y,cz+z,opacity,c*c*a+s*s*b,c*s*(a-b),0,pack(color),s*s*a+c*c*b,0,sz*sz,0,0,0,0,0);
    layers.push(layer);
  }
  function ring(layer,rad,y,scale,material,stations=72) {
    for(let step=0;step<stations;step++){
      const a=step*2*PI/stations;
      splat(layer,rad*cos(a),y,rad*sin(a),scale,typeof material==='function'?material(step):material);
    }
  }
  function dock(col,row) {
    cx=2+8*col;
    cz=2+8*row;
    for(let z=-16;z<=16;z++) for(let x=-19;x<=19;x++) {
      const border=Math.abs(x)>=18||Math.abs(z)>=15;
      const joint=(x+19)%8===0 || (z+16)%7===0;
      const variation=((x*x+z*z+3*x*z)%13+13)%13;
      const pigment=border?palette.rim:joint?palette.grout:palette.brick+variation*0x010101;
      splat('quay',x*.081,.13,z*.086,[.062,.014,.065],pigment);
      if(border)splat('quay',x*.081,.076,z*.086,[.060,.064,.061],palette.deep);
    }
    for(const y of [.20,.26,.32,.38,.44]){
      ring('quay',y<.32?.63:.55,y,[.052,.052,.052],y===.38?palette.stripe:palette.timber,76);
    }
    for(let i=0;i<20;i++) {
      const y=.45+i*.045, radius=.36-.045*sin(i*PI/20);
      ring('lantern',radius,y,[.045,.036,.045],j=>{
        const band=j%18, turn=j<35?-0x0a0804:0;
        if(i<4||i>14) return (i===3||i===15?palette.stripe:palette.bronze)+turn;
        if(band<2||band>15)return palette.timber+turn;
        return band===2||band===15 ? palette.glint : palette.light+turn;
      });
    }
    for(let i=0;i<12;i++){
      const y=1.33+i*.045, rad=.48-.034*i;
      ring('lantern',rad,y,[.044,.040,.044],i<2?palette.stripe:palette.glass,60);
    }
    for(let i=0;i<7;i++)ring('lantern',.07+.032*sin(i*PI/6),1.88+i*.025,[.036,.026,.037],palette.jewel,28);
    for(const [u,v] of [[-1.02,-.90],[1.04,.78],[-.92,.72],[.91,-.77]]) {
      for(let j=0;j<11;j++){
        const phase=(j*2.398+col*.07+row*.18),bend=.09*cos(phase), length=.18+.34*((j*7)%11)/10;
        for(let k=0;k<8;k++){
          const t=k/8;
          splat('reeds',u+.15*cos(phase)+bend*t*t,.15+length*t,v+.13*sin(phase)+.09*sin(phase)*t,
            [.031,.041,.027],j%3?palette.grass:palette.leaf, .94,bend*3);
        }
      }
    }
  }
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)dock(col,row);
  return {count:layers.length,data:Float32Array.from(data),bg:[19,30,42],radius:57,
    cam:{target:[2,.94,2],yaw:.61,pitch:.43,dist:6.05,ortho:true},layer:i=>layers[i]};
}
module.exports={build,palette,columns,rows};
