module.exports = ({KIT,SpriteSurface,makeBuilder}) => {
  const id='signal-dial', name='Dial at the Relay Passage', seed=19;
  const pivot=[1.24,1.18,.06], facing=[-.8660254,0,.5], across=[.5,0,.8660254];
  const dial=(u,v,n=0)=>pivot.map((at,i)=>at+u*across[i]+v*Number(i===1)+n*facing[i]);
  const pins=[
    {id:'upper mount',point:dial(0,.64)},
    {id:'lower mount',point:dial(0,-.64)},
    {id:'finger contact',point:dial(0,-.113)}
  ];
  const plan={rules:[{id:'readable-dial',select:{object:'relay-dial'},pivot,facing,flatten:.88,strength:.86,pins}]};
  const palette=[0x151c26,0x262e39,0x344453,0x495e6a,0x6b7c80,0x8c9a91,
    0x34303b,0x664446,0x9a674d,0xc19a63,0xf1d291,0x193842,0x345960,0x527d78,0x85b5a2,0xbde1b9];
  const digits={
    0:['111','101','101','101','111'],
    2:['111','001','111','100','111'],
    3:['111','001','111','001','111'],
    4:['101','101','111','001','001'],
    6:['111','100','111','101','111'],
    8:['111','101','111','101','111'],
    9:['111','101','111','001','111']
  };
  const add=(a,b)=>a.map((n,i)=>n+b[i]);
  const mul=(a,t)=>a.map(n=>n*t);

  function meshTools(atlas) {
    const solid=new Map();
    function color(rgb) {
      if (!solid.has(rgb)) solid.set(rgb,atlas.reserve(2,2,()=>rgb));
      return solid.get(rgb);
    }
    function face(origin,right,up,surface,id) {
      atlas.faceRegion(origin,right,up,typeof surface==='number' ? color(surface) : surface,{objectId:id});
    }
    function block(center,[x,y,z],colors,id) {
      const f=Array.isArray(colors) ? colors : [colors,colors,colors];
      const lo=add(center,[-x,-y,-z]);
      face(add(lo,[0,0,2*z]),[2*x,0,0],[0,2*y,0],f[0],id);
      face(add(lo,[2*x,0,0]),[-2*x,0,0],[0,2*y,0],f[1],id);
      face(lo,[0,0,2*z],[0,2*y,0],f[1],id);
      face(add(lo,[2*x,0,2*z]),[0,0,-2*z],[0,2*y,0],f[1],id);
      face(add(lo,[0,2*y,2*z]),[2*x,0,0],[0,0,-2*z],f[2],id);
      face(lo,[2*x,0,0],[0,0,2*z],f[1],id);
    }
    return {face,block};
  }

  function corridor() {
    const A=SpriteSurface.make(512), {face,block}=meshTools(A);
    const wall=A.reserve(136,56,(x,y)=>{
      const row=Math.floor(y/9), tile=(x+(row%2)*9)%19;
      if (y%9===0 || tile===0) return palette[1];
      if (y%9===1 || tile===1) return palette[4];
      return palette[2+(Number((x*13+y*17)%97<9))];
    });
    const ground=A.reserve(128,112,(x,y)=>{
      if (x<6||x>121) return palette[1];
      if ((x===20||x===107)&&y%12>2) return palette[9];
      if (y%13<1 || x%20===0) return palette[1];
      return (x*7+y*11)%173<8 ? palette[3] : palette[2];
    });
    const ceiling=A.reserve(100,32,(x,y)=>x%13===0||y===0 ? palette[2] : palette[1]);
    face([-2.3,0,4],[4.6,0,0],[0,0,-12],ground,'floor');
    face([-2.3,0,-8],[0,0,12],[0,2.62,0],wall,'left wall');
    face([2.3,0,4],[0,0,-12],[0,2.62,0],wall,'right wall');
    face([-2.3,2.60,-8],[4.6,0,0],[0,0,12],ceiling,'ceiling');
    face([-2.3,0,-8],[4.6,0,0],[0,2.62,0],palette[1],'end wall');
    for (const z of [-7,-4.6,-2.25,.36,2.65]) {
      for (const x of [-2.21,2.21]) {
        block([x,1.25,z],[.095,1.25,.065],[palette[3],palette[1],palette[4]],'wall rib');
        block([x,.32,z+.07],[.115,.042,.09],palette[9],'rib marker');
      }
      block([0,2.48,z],[2.2,.06,.073],[palette[3],palette[1],palette[4]],'ceiling rib');
      block([-.69,2.39,z],[.52,.018,.048],palette[10],'ceiling fixture');
      block([.69,2.39,z],[.52,.018,.048],palette[10],'ceiling fixture');
    }
    block([-.14,.94,-7.82],[.64,.93,.106],[palette[2],palette[0],palette[3]],'door');
    block([-.14,.93,-7.69],[.43,.73,.039],[palette[0],palette[1],palette[2]],'door');
    block([-.14,1.76,-7.61],[.30,.055,.043],palette[14],'exit light');
    for (const x of [-.65,.40]) block([x,.93,-7.62],[.018,.82,.030],palette[8],'door trim');
    for (const x of [-2.10,2.15]) {
      block([x,.23,-2.05],[.065,.063,5.36],[palette[3],palette[1],palette[5]],'service pipe');
      block([x,1.87,-2.23],[.034,.026,5.35],[palette[8],palette[7],palette[9]],'copper trunk');
    }
    face(dial(-.55,-.77,-.077),mul(across,1.1),[0,1.54,0],palette[1],'mounting plate');
    for (const v of [-.64,.64]) {
      face(dial(-.12,v-.071,-.018),mul(across,.24),[0,.142,0],palette[7],'mounting plate');
      face(dial(-.033,v-.033,.002),mul(across,.066),[0,.066,0],palette[10],'mount fastener');
    }
    const faceArt=A.reserve(104,104,(x,y)=>{
      const u=(x-51.5)/51.5,v=(y-51.5)/51.5,r=Math.hypot(u,v);
      if (r>.994) return;
      if (r>.956) return palette[0];
      if (r>.89) return v<.04 ? palette[10] : palette[8];
      if (r>.815) return palette[7];
      if (r>.773) return palette[0];
      let rgb=palette[12];
      if (v<-.18 && u<.30) rgb=palette[13];
      if (v>.36 || u>.47) rgb=palette[11];
      const angle=Math.atan2(v,u)*6/Math.PI;
      if (r>.663 && Math.abs(angle-Math.round(angle))<.085) return palette[15];
      for (const [digit,ox,oy] of [[0,49,21],[3,73,47],[6,49,72],[9,25,47],[4,44,57],[8,53,57]]) {
        const sx=Math.floor((x-ox)/2),sy=Math.floor((y-oy)/2);
        if (sx>=0&&sx<3&&sy>=0&&sy<5&&digits[digit][sy][sx]==='1') return palette[15];
      }
      if (v<.05 && v>-.59 && Math.abs(u+v*.46)<.025) return palette[10];
      if (Math.hypot(u,v)<.13) return palette[8];
      if ((x*11+y*17)%181<10) return palette[13];
      return rgb;
    });
    face(dial(-.544,-.544),mul(across,1.088),[0,1.088,0],faceArt,'relay-dial');
    const rim=A.reserve(2,2,()=>palette[8]);
    const rimBack=A.reserve(2,2,()=>palette[6]);
    for (let i=0;i<24;i++) {
      const a=i*Math.PI/12,b=(i+1)*Math.PI/12;
      const p=dial(.54*Math.cos(a),.54*Math.sin(a),-.073);
      const q=dial(.54*Math.cos(b),.54*Math.sin(b),-.073);
      face(p,q.map((n,k)=>n-p[k]),mul(facing,.071),i<12 ? rim : rimBack,'relay-dial');
    }
    return A.finish();
  }

  function hand(time) {
    const A=SpriteSurface.make(64),{block}=meshTools(A);
    const th=Math.min(1,Math.max(0,(time-.16)/.58)), toward=th*th*(3-2*th);
    const tap=pins[2].point;
    const end=add(tap,[.52*(1-toward)-.012,-.29*(1-toward),.45*(1-toward)+.030]);
    const wrist=add(end,[.36,-.29,.32]), sleeve=add(wrist,[.28,-.18,.21]);
    block(sleeve,[.27,.14,.13],[palette[11],palette[0],palette[12]],'operator-sleeve');
    block(wrist,[.174,.131,.108],[palette[7],palette[6],palette[8]],'operator-hand');
    block(add(wrist,[.04,-.062,.09]),[.18,.048,.045],[palette[8],palette[7],palette[9]],'operator-hand');
    for (let i=0;i<5;i++) {
      const t=i/4, joint=end.map((n,k)=>n+(wrist[k]-n)*t*.81);
      block(joint,[.044+i*.007,.049+i*.008,.035+i*.008],[palette[8],palette[7],palette[9]],'operator-finger');
    }
    return A.finish();
  }

  function build() {
    const room=corridor();
    const world=makeBuilder(seed,palette).finish({id,name,
      spriteSurfaces:[room,hand(0)],radius:12,dither:0,
      cam:{target:[.26,1.26,-.90],dist:4.65,yaw:-.075,pitch:.065,fov:.71,ortho:false,sway:0},
      look:{multiprojection:plan}});
    world.anim={update(_dt,time) { world.spriteSurfaces[1]=hand(time); }};
    return world;
  }
  return {id,name,seed,build,plan};
};
