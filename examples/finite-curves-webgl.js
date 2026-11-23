// The same authored strands are used by the native canvas and headless review.
module.exports = function finiteCurveFixture({ KIT, makeBuilder }, yaw = 0) {
  const colors = [0x121f2d, 0x203244, 0x334e61, 0x608090, 0xffc986, 0xcf8055,
    0x9ee6cb, 0x4bbeb4, 0xdf8fa8, 0x8664a7, 0xebd5b7, 0x294357];
  const B = makeBuilder(7,colors), curves = KIT.curveSplats;
  const sample = (n, fn) => Array.from({ length:n }, (_,i) => fn(i/(n-1)));
  const draw = (id, points, style) => curves.draw(B, { kind:'path',points,id },
    { object:id, edge:'hard', ...style });
  // Alternating depths along each cord force the crossing order to change
  // within a strand. Golden ends retain their taper and pale cords their cap.
  for (let i=0; i<4; i++) {
    const y = .14+i*.36;
    draw('warp-'+i,sample(31,u=>{
      const x = -2.18+4.36*u;
      return [x,y+.08*Math.cos(x*1.25+i*.6),.14*Math.cos(Math.PI*((x+.93)/.62+i))];
    }), { width:.142,color:i%2 ? '#cf8055' : '#ffc986',
      caps:{ start:'blunt',end:{ type:'tapered',length:.13 } } });
  }
  for (let i=0; i<4; i++) {
    const x = -.93+i*.62;
    draw('weft-'+i,sample(26,u=>{
      const y = -.02+1.63*u;
      return [x+.042*Math.sin(y*4+i*.8),y,-.15*Math.cos(Math.PI*((y-.14)/.36+i))];
    }), { width:.137, section:'elliptical', aspect:.65, up:[1,0,0],
      color:i%2 ? '#4bbeb4' : '#9ee6cb', caps:{ start:'rounded',end:'blunt' } });
  }

  const caps = { start:'blunt',end:{ type:'fading',length:.24 } };
  const loop = sample(33,u=>{
    const a = (u*1.05+.02)*Math.PI;
    return [1.26+1.08*Math.cos(a),-.62+.41*Math.sin(a),.25-1.25*u];
  });
  draw('compact-ribbon',loop,{ width:.28, edge:'beta', section:'flattened',
    aspect:.20, twist:[[0,0],[1,1.1]], caps, color:'#df8fa8', opacity:.82,
    taper:[[0,.65],[.30,1],[.85,.9],[1,.42]] });
  draw('return-lead',sample(19,u=>[-2.25+4.5*u,-.90+.33*Math.sin(5*u+.36),1.05-2.0*u]),
    { width:.13, edge:'beta', caps:{ start:'rounded',end:'blunt' }, color:'#9ee6cb', opacity:.78 });
  draw('repair-wire',[[.48,-.21,.71],[1.06,-.55,.23],[1.51,-.83,-.82]],
    { width:.115,caps:'blunt', color:'#ebd5b7' });
  const rect = (x0,y0,x1,y1,z) => [[x0,y0,z],[x1,y0,z],[x0,y1,z],[x1,y1,z]];
  const faces = [
    [rect(-2.58,-1.18,2.58,1.77,-1.27),1],
    [rect(-2.46,-1.08,2.46,1.67,-1.25),0],
    [rect(-2.54,-1.16,2.54,-1.10,-1.24),2],
    [rect(-2.54,1.70,2.54,1.77,-1.24),2],
    [rect(-2.54,-1.18,-2.44,1.77,-1.23),2],
    [rect(2.44,-1.18,2.54,1.77,-1.23),2],
    [rect(-2.4,-.17,2.4,-.13,-1.23),2],
    [rect(1.03,-1.07,1.46,-.20,.08),2],
    [rect(1.08,-1.0,1.40,-.25,.10),11],
    [rect(1.36,-.95,1.39,-.27,.111),3]
  ];
  for (let i=0; i<9; i++) {
    const x = -2.35+i*.185;
    faces.push([rect(x,-1.055,x+.022,-1.005,-1.22),i%4 ? 2 : 3]);
  }
  for (const [x,y] of [[-2.31,1.58],[2.31,1.58],[-2.31,-.99],[2.31,-.99]]) {
    faces.push([rect(x-.035,y-.035,x+.035,y+.035,-1.21),3]);
  }
  const positions = [], uvs = [], indices = [], faceMaterials = [];
  for (const [points, material] of faces) {
    const at = positions.length/3;
    positions.push(...points.flat());
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(at,at+1,at+2,at+2,at+1,at+3);
    faceMaterials.push(material,material);
  }
  const mesh = KIT.sceneMeshes.create({ id:'switchboard', positions,uvs,indices,faceMaterials,
    materials:colors.map((color,i)=>({ id:'panel-'+i,color })) });
  const width = 180, height = 112;
  const world = B.finish({
    meshes:[mesh], cam:{ target:[0,.30,0],dist:6.5,fov:.58,yaw,pitch:.08,ortho:true },
    radius:5, fog:{ start:1,max:0 }, dither:0, look:{ coverageAware:true }
  });
  return { world, width, height };
};
