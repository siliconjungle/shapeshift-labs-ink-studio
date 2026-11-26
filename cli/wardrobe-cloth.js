const { fields, localName, range, vector } = require('./character-rig-assembly.js');
const { layered } = require('./wardrobe-contact.js');
const integer=(n,a,b)=>Number.isSafeInteger(n)&&range(n,a,b);
const pigment=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const edges=['top','bottom','left','right'];

function vertices(spec, panel) {
  const {nu,nv}=panel, {edge,vertices:authored,reverse=false}=spec;
  if (typeof reverse!=='boolean'||(edge===undefined)===(authored===undefined) ||
      edge!==undefined&&!edges.includes(edge) || authored!==undefined&&
      (!Array.isArray(authored)||!authored.length||authored.length>nu*nv||new Set(authored).size!==authored.length||
       !authored.every(i=>integer(i,0,nu*nv-1)))) throw new TypeError('Choose a panel edge or distinct vertex indices');
  const horizontal = ['top','bottom'].includes(edge);
  const list=authored?.slice()??Array.from({length:horizontal?nu:nv},(_,i)=>
    horizontal?i+(edge==='bottom'?(nv-1)*nu:0):i*nu+(edge==='right'?nu-1:0));
  return reverse?list.reverse():list;
}

function cloth(plan, joints, K) {
  const {V}=K;
  const {panels:authored=[],seams:stitches=[],colliders:balls=[],simulation={}}=plan;
  if (!Array.isArray(authored)||authored.length>16||!Array.isArray(stitches)||stitches.length>32||
      !Array.isArray(balls)||balls.length>24||
      !fields(simulation,['fps','frames','substeps','gravity','damp','wind','gust','collision','clearance','reach','cell']))
    throw new TypeError('Invalid wardrobe panels, seams, colliders, or simulation settings');
  const {fps=24,frames=48,substeps=5,gravity=[0,-9.8,0],damp=2.8,wind=[0,0,0],gust=.3,
    collision=true,clearance=.021,reach=.22,cell=.35}=simulation;
  if (!integer(fps,12,120)||!integer(frames,1,240)||!integer(substeps,1,12)||
      !vector(gravity,3,-100,100)||!vector(wind,3,-100,100)||!range(damp,0,60)||!range(gust,0,4)||
      typeof collision!=='boolean'||!range(clearance,.0001,.2)||!range(reach,.015,2)||!range(cell,.02,5))
    throw new RangeError('Wardrobe simulation exceeds its configured clock or dynamics bounds');
  const names=new Map(), seams=[], points=[];
  const hasJoint=joint=>joint===undefined||joints.has(joint);
  const panels=authored.map(row=>{
    if (!fields(row,['id','size','corners','points','layer','side','color','trim','pins','density','stretch','shear','bend','air','thickness'])||
        !localName(row.id)||names.has(row.id)||!Array.isArray(row.size)||row.size.length!==2||!row.size.every(n=>integer(n,2,38))||
        (row.corners===undefined)===(row.points===undefined)) throw new TypeError('A panel needs a unique ID, grid size, and corners or points');
    const {id,layer=0,side=1,color='#576f83',trim=color,pins=[],density=.44,stretch=3e-7,shear=6e-6,bend=.0012,air=1,thickness=.006}=row;
    const [nu,nv]=row.size;
    if (!integer(layer,0,15)||![1,-1].includes(side)||!pigment(color)||!pigment(trim)||!Array.isArray(pins)||pins.length>32||
        !range(density,.02,25)||![stretch,shear,bend].every(n=>range(n,0,1))||!range(air,0,4)||!range(thickness,0,.15)||
        row.points!==undefined&&(!Array.isArray(row.points)||row.points.length!==nu*nv||!row.points.every(p=>vector(p)))||
        row.corners!==undefined&&(!Array.isArray(row.corners)||row.corners.length!==4||!row.corners.every(p=>vector(p))))
      throw new RangeError('Invalid panel geometry or fabric on '+id);
    const layout=K.xpbd.clothGrid({nu,nv,at:[0,0,0],u:[1,0,0],v:[0,1,0],stretch,shear,bend});
    const rest=row.points??layout.points.map(([u,v])=>V.lerp(V.lerp(row.corners[0],row.corners[1],u),
      V.lerp(row.corners[2],row.corners[3],u),v));
    const start=points.length, faces=layout.faces.map(row=>row.nodes);
    const masses=Array(rest.length).fill(0);
    for (const [a,b,c] of faces) {
      const area=V.len(V.cross(V.sub(rest[b],rest[a]),V.sub(rest[c],rest[a])))/2;
      if (area<1e-7) throw new RangeError('Collapsed panel triangle on '+id);
      for (const i of [a,b,c]) masses[i]+=area*density/3;
    }
    const panel={id,start,nu,nv,layer,side,color,trim,air,thickness,points:rest,faces,links:layout.links,
      layout:layout.points,masses,pins:new Map()};
    for (const pin of pins) {
      if (!fields(pin,['edge','vertices','joint'])||!hasJoint(pin.joint)) throw new TypeError('Invalid pin on '+id);
      for (const i of vertices(pin,panel)) {
        if (panel.pins.has(i)) throw new RangeError('Duplicate pinned vertex on '+id);
        panel.pins.set(i,pin.joint);
      }
    }
    names.set(id,panel);
    points.push(...rest);
    return panel;
  });
  if (points.length>6000||frames*points.length*3>1500000||frames*points.length*substeps>3500000)
    throw new RangeError('Wardrobe bake exceeds its vertex or frame work budget');
  const named=new Set();
  for (const seam of stitches) {
    if (!fields(seam,['id','a','b','compliance','gap'])||!localName(seam.id)||named.has(seam.id)||
        !range(seam.compliance??0,0,1)||!range(seam.gap??0,0,2))
      throw new TypeError('A seam needs a distinct ID and bounded stitch settings');
    named.add(seam.id);
    const paths=[seam.a,seam.b].map(ref=>{
      if (!fields(ref,['panel','edge','vertices','reverse'])||!names.has(ref.panel))
        throw new TypeError('A seam side needs a registered panel');
      const panel=names.get(ref.panel);
      return vertices(ref,panel).map(i=>i+panel.start);
    });
    if (paths[0].length!==paths[1].length||paths[0].some((index,i)=>index===paths[1][i]))
      throw new RangeError('Seam '+seam.id+' needs matching vertex counts and distinct stitch endpoints');
    seams.push({id:seam.id,pairs:paths[0].map((i,n)=>[i,paths[1][n]]),compliance:seam.compliance??0,gap:seam.gap??0});
  }
  for (const ball of balls) if (!fields(ball,['joint','center','radius'])||!hasJoint(ball.joint)||
      !vector(ball.center)||!range(ball.radius,.001,100)) throw new TypeError('Invalid wardrobe sphere collider');

  function bake(transform) {
    if(!panels.length) return {frames:Array.from({length:frames},()=>[]),report:{panels:0,vertices:0,seams:[],
      collision:{enabled:collision,pushes:0,maxPush:0,tests:0,frames:[]}}};
    const contact=layered(panels,{clearance,reach,cell},K);
    const spheres=balls.map(({center,radius})=>({c:center,r:radius}));
    const sim=K.xpbd.sim({gravity,damp,substeps,spheres,fixedStep:true,substepPins:true,
      ...(V.len(wind)>0&&{wind:K.xpbd.gust(wind,{gust})}),
      ...(collision&&{projectBatch:contact.solve})});
    const posed=points.map(p=>p);
    for (const panel of panels) for (const [i,point] of panel.points.entries()) {
      const fixed=panel.pins.has(i), joint=panel.pins.get(i);
      const index=sim.point(point,fixed?0:1/Math.max(.0001,panel.masses[i]),panel.thickness);
      if (fixed) {
        posed[index]=transform(joint,point,0);
        sim.pin(index,time=>transform(joint,point,time));
      }
    }
    for (const panel of panels) {
      for (const {a,b,compliance} of panel.links) sim.link(panel.start+a,panel.start+b,compliance);
      for (const [a,b,c] of panel.faces) sim.face(panel.start+a,panel.start+b,panel.start+c,panel.air);
    }
    for (const seam of seams) for (const [a,b] of seam.pairs) sim.link(a,b,seam.compliance,0,undefined,seam.gap);
    sim.resetPose(posed.flat());
    const samples=[], penetration=[], seamFrames=seams.map(()=>[]);
    for (let frame=0;frame<frames;frame++) {
      const time=frame/fps;
      if (frame) {
        for (const [i,ball] of balls.entries()) spheres[i].c=transform(ball.joint,ball.center,time);
        sim.step(1/fps,time);
      }
      const positions=Array.from(sim.X.subarray(0,points.length*3));
      if (!positions.every(n=>range(n,-1e5,1e5))) throw new RangeError('Garment pose exceeded the world bounds');
      samples.push(positions);
      penetration.push(contact.inspect(positions));
      for (const [j,seam] of seams.entries()) seamFrames[j].push(Math.max(...seam.pairs.map(([a,b])=>
        Math.abs(Math.hypot(positions[a*3]-positions[b*3],positions[a*3+1]-positions[b*3+1],
          positions[a*3+2]-positions[b*3+2])-seam.gap))));
    }
    return {frames:samples,report:{panels:panels.length,vertices:points.length,
      seams:seams.map(({id,pairs,gap},i)=>({id,stitches:pairs.length,gap,initial:seamFrames[i][0],
        final:seamFrames[i].at(-1),frames:seamFrames[i]})),
      collision:{enabled:collision,...contact.counts(),frames:penetration}}};
  }
  return {panels,names,points:points.length,fps,frames,bake};
}

module.exports={cloth,integer,pigment};
