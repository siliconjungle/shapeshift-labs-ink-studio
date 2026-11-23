// A copper astrolabe and a wind-tugged coat, rendered with the interactive WebGL path.
module.exports = function restMarksScene({ KIT:K,makeBuilder }) {
  const pal=[0x141d31,0x1d2940,0x283950,0x354662,0x403147,0x633f50,0x87514c,
    0xbb7655,0xdb9c62,0xf6c47d,0xffdfa1,0x15383f,0x215259,0x367174,0x55928a,
    0x78b6a1,0xaad5af,0x302e49,0x594967,0x886682,0xab87a0];
  const B=makeBuilder(36,pal), meshes=K.sceneMeshes, curves=K.curveSplats;
  const print=(style,ink,paper,scale,density)=>({style,ink,paper,scale,density,
    tone:'luminance',projection:'plane',strength:.72,seed:36,strokeWidth:1.7,lodBias:.45});
  const etchedCopper=print('engraving','#633f50','#f6c47d',.53,.72);
  const dyedCloth=print('hatching','#215259','#78b6a1',.42,.98);
  const cordPrint={...print('woodcut','#633f50','#ffdfa1',.18,1.35),projection:'triplanar'};
  const radius=1.20,cx=-1.78;
  const positions=[],uvs=[],indices=[],faceMaterials=[];
  function ring(from,to,z0,z1,material,segments=96,start=0,arc=2*Math.PI) {
    const first=positions.length/3;
    for(let i=0;i<=segments;i++){
      const angle=start+arc*i/segments,c=Math.cos(angle),s=Math.sin(angle);
      positions.push(cx+from*c,from*s,z0,cx+to*c,to*s,z1);
      uvs.push(.5+from*c/(2*radius),.5+from*s/(2*radius),.5+to*c/(2*radius),.5+to*s/(2*radius));
      if(i<segments){
        const j=first+i*2;
        indices.push(j,j+1,j+2,j+2,j+1,j+3);
        faceMaterials.push(material,material);
      }
    }
  }
  ring(0,1.06,.12,.07,0);
  ring(1.02,1.09,.09,.13,3);
  ring(1.09,1.17,.13,-.033,1);
  ring(1.16,1.19,-.03,-.12,2);
  ring(.49,.51,.135,.135,2);
  ring(.27,.285,.15,.15,3);
  for(let i=0;i<24;i++){
    const a=i*Math.PI/12;
    ring(i%3===0?.73:.88,.985,.115,.115,i%3===0?2:3,1,a,i%3===0?.041:.024);
  }
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    ring(.115,.68,.16,.132,i%2===0?3:2,2,a+.011,.038);
    ring(.115,.42,.163,.145,2,2,a-.035,.038);
  }
  ring(0,.105,.182,.17,2);
  ring(.075,.104,.188,.18,3);
  const plate=meshes.create({id:'copper-astrolabe',positions,uvs,indices,faceMaterials,materials:[
    {id:'etched-copper',color:0xb98262,engraving:etchedCopper},
    {id:'bronze-rim',color:0xd2955e},{id:'inlay-shadow',color:0x734448},{id:'gilt-inlay',color:0xf6c47d}
  ]});
  const standVertices=[],standUV=[],standIndices=[],standFaces=[];
  function rectangle(x0,y0,x1,y1,z,color) {
    const n=standVertices.length/3;
    standVertices.push(x0,y0,z,x1,y0,z,x0,y1,z,x1,y1,z);
    standUV.push(0,0,1,0,0,1,1,1);
    standIndices.push(n,n+1,n+2,n+2,n+1,n+3);
    standFaces.push(color,color);
  }
  for(const middle of [-1.75,1.75]){
    rectangle(middle-1.63,-1.43,middle+1.63,1.43,-.73,2);
    rectangle(middle-1.59,-1.385,middle+1.59,1.385,-.72,1);
    rectangle(middle-1.56,-1.36,middle+1.56,1.36,-.71,0);
    for(const sign of [-1,1])for(const side of [-1,1]){
      const x=middle+side*1.49,y=sign*1.28;
      rectangle(x-.05,y-.013,x+.05,y+.013,-.70,4);
      rectangle(x-.013,y-.05,x+.013,y+.05,-.69,4);
    }
  }
  rectangle(-1.89,-1.31,-1.67,1.31,-.23,2);
  rectangle(.59,1.06,2.93,1.10,.07,4);
  rectangle(.83,1.015,2.69,1.055,.08,3);
  const stand=meshes.create({id:'exhibit-rack',positions:standVertices,uvs:standUV,indices:standIndices,faceMaterials:standFaces,
    materials:[0x1d2940,0x283950,0x354662,0x87514c,0xdb9c62].map((color,i)=>({id:'rack-'+i,color}))});
  let phase=0;
  function warp([x,y,z]) {
    const v=Math.max(0,(.99-y)/2.17), sway=Math.sin(phase);
    const wave=Math.sin(6*x+phase-3*v), flap=wave-Math.sin(6*x-3*v);
    return [x+v*v*(.38*sway+.071*flap),y+v*(.072*flap+.049*sway),
      z+v*(.21*flap+.15*sway)];
  }
  const coat=(u,v,offset=0)=>{
    const spread=.80+.17*v;
    return [1.74+u*spread,.98-2.18*v+.16*Math.abs(u)**3,
      .095*Math.cos(4.3*u)-.10*u*u+offset];
  };
  const first=B.count(), rest=[], pitch=.037;
  for(let j=0;j<=60;j++)for(let i=0;i<=54;i++){
    const u=i/27-1,v=j/60;
    if(v<.12 && Math.abs(u)>.82+v*1.5 || v<.15 && Math.abs(u)<.30*(1-v/.15))continue;
    const p=coat(u,v), stripe=Math.abs(u)>.87 || v>.91 || (v>.85 && v<.875);
    const crease=.80+.20*Math.cos(8.7*u+.6*Math.sin(v*4));
    const rgb=(stripe?[69,130,123]:[76,137,126]).map(c=>Math.round(c*crease));
    B.disc(...p,[0,0,1],pitch,.006,rgb,1);
    rest.push(p);
  }
  B.describeSplats(first,B.count(),{object:'coat',material:'dyed-canvas'});
  B.describeEngraving(first,B.count(),dyedCloth);
  const binding=[];
  function seam(id,points,width,color,engraving) {
    binding.push(curves.bind(B,{kind:'path',points},reference=>reference.points.map(warp),{
      width,edge:'hard',color,engraving,object:'coat-seam',material:id
    }));
  }
  const steps=Array.from({length:25},(_,i)=>i/24);
  for(const side of [-1,1]){
    seam('binding',steps.map(t=>coat(side*.93,.12+t*.86,.048)),.058,'#bb7655',cordPrint);
    seam('thread',steps.map(t=>coat(side*.80,.16+t*.78,.038)),.028,'#db9c62',cordPrint);
    seam('lapel',steps.map(t=>coat(side*(.35-.27*t),.015+t*.46,.042)),.052,'#c99169',cordPrint);
  }
  seam('hem',steps.map(t=>coat(1.84*t-.92,.95,.048)),.062,'#e1a771',cordPrint);
  seam('cross-stitch',steps.map(t=>coat(1.77*t-.885,.875+.013*Math.sin(t*41),.039)),.031,'#d8986e',cordPrint);
  for(let j=0;j<4;j++){
    const at=coat(0,.41+j*.115,.073);
    seam('buttons',[[at[0]-.035,at[1],at[2]],[at[0]+.035,at[1],at[2]]],.049,'#f6c47d',false);
  }
  const world=B.finish({id:'rest-marks-cabinet',meshes:[stand,plate],radius:5,dither:.82,
    cam:{target:[0,0,0],dist:6,yaw:0,pitch:0,fov:2*Math.atan(.275),ortho:true},
    fog:{c:0,start:1,max:0},look:{stable:{dither:'object',spacing:.049,origin:[.007,.012,.017],
      targets:[{object:'exhibit-rack',dither:'world',spacing:.037}]}}});
  const ids=rest.map((_,i)=>first+i), matrices=new Float32Array(rest.length*12);
  K.bones.bind(world,{ids,bid:Float32Array.from(ids,(_,i)=>i),M:matrices,pose(){
    rest.forEach((p,i)=>{
      const at=warp(p),d=at.map((v,j)=>v-p[j]);
      matrices.set([1,0,0,0,1,0,0,0,1,...d],i*12);
    });
  }});
  return {world,width:240,height:112,pose(t) {
    phase=t;
    const a=.68*Math.sin(t),b=.17*Math.sin(t+.4)-.17*Math.sin(.4);
    const c=Math.cos(a),s=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
    const posed=new Float32Array(positions.length);
    for(let j=0;j<positions.length;j+=3){
      const x=positions[j]-cx,y=positions[j+1],z=positions[j+2], xx=c*x+s*z;
      posed.set([cx+cb*xx-sb*y,sb*xx+cb*y,-s*x+c*z],j);
    }
    meshes.pose(plate,posed);
    world.anim.update(1/60,t);
    for(const curve of binding)curve.pose(world);
  }};
};
