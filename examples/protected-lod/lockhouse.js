module.exports = function lockhouse(kit) {
  const { KIT:K, makeBuilder } = kit;
  const id = 'tide-lock', seed = 61, object = 'tide-lock';
  const palette = [0x18212c,0x223044,0x31465a,0x437074,0x63968a,0xa9bc9c,0xffd99d];
  const pivot = [0,1.36,0], yaw = 0, pitch = .04, fov = .57;
  const cam = { target:pivot, dist:6, yaw, pitch, fov, sway:0 };
  const glaze = ['#294958','#3d696f','#57817e','#78a094','#a9bc9c'];
  const brass = ['#523d4a','#805753','#b47e62','#e7b177','#ffdda0'];
  const parts = {
    portal:'sea-glaze', tablet:'signal-enamel', fin:'iron-fin', cap:'brass-cap', deck:'quayside'
  };
  const color = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));

  function geometry(part, draw) {
    const positions = [], uvs = [], indices = [], cells = [];
    const width = 128, height = 128, slot = 8;
    function face(a,b,c,d,ink,pattern) {
      const i = positions.length/3;
      positions.push(...a,...b,...c,...d);
      const n = cells.length, x = n%16*slot, y = Math.floor(n/16)*slot;
      uvs.push((x+.2)/width,(y+.2)/height,(x+7.8)/width,(y+.2)/height,
        (x+.2)/width,(y+7.8)/height,(x+7.8)/width,(y+7.8)/height);
      indices.push(i,i+1,i+2,i+2,i+1,i+3);
      cells.push({x,y,ink,pattern});
    }
    function box(x0,y0,x1,y1,z,zBack,tones,pattern) {
      face([x0,y1,z],[x1,y1,z],[x0,y0,z],[x1,y0,z],tones[2],pattern);
      face([x1,y1,z],[x1,y1,zBack],[x1,y0,z],[x1,y0,zBack],tones[1]);
      face([x1,y1,zBack],[x0,y1,zBack],[x1,y0,zBack],[x0,y0,zBack],tones[0]);
      face([x0,y1,zBack],[x0,y1,z],[x0,y0,zBack],[x0,y0,z],tones[3]);
      face([x0,y1,zBack],[x1,y1,zBack],[x0,y1,z],[x1,y1,z],tones[4]);
      face([x0,y0,z],[x1,y0,z],[x0,y0,zBack],[x1,y0,zBack],tones[0]);
    }
    draw(box);
    const pixels = new Uint8Array(width*height*4);
    for (const {x,y,ink,pattern} of cells) for (let v=0;v<slot;v++) for (let u=0;u<slot;u++)
      pixels.set([...color(pattern?.(u,v) || ink),255],((y+v)*width+x+u)*4);
    return K.sceneMeshes.create({id:part,objectId:object,partId:part,positions,indices,uvs,
      materials:[{id:parts[part],texture:{width,height,pixels}}]});
  }
  function portal(coarse) {
    return geometry('portal',box=>{
      for (const side of [-1,1]) {
        const foot = [side*.67,side*1.18].sort((a,b)=>a-b);
        box(foot[0]-.1,.19,foot[1]+.1,.42,.53,-.42,brass);
        box(foot[0],.42,foot[1],1.71,.39,-.35,glaze,(u,v)=>
          v===2 || v===5 ? glaze[1] : u===0 ? glaze[3] : u===7 ? glaze[0] : null);
        box(foot[0]-.06,1.64,foot[1]+.06,1.80,.50,-.40,brass);
        const shoulder=[side*.48,side*.90].sort((a,b)=>a-b);
        box(shoulder[0],1.73,shoulder[1],1.98,.39,-.35,glaze);
      }
      box(-.94,1.96,.94,2.26,.41,-.36,glaze);
      box(-.71,2.23,.71,2.43,.55,-.40,brass);
      if (coarse) box(-.68,.39,.68,1.80,.36,-.36,glaze,(x,y)=>y%3===0||x%3===0?glaze[1]:null);
    });
  }
  function tablet(coarse) {
    return geometry('tablet', box=>{
      box(-.29,1.87,.29,2.30,.58,.40,brass);
      box(-.23,1.91,.23,2.25,.61,.58,glaze,(u,v)=>{
        if (u===0||u===7||v===0||v===7) return glaze[0];
        if (!coarse && (u===2||u===5||v===4&&u>2&&u<5)) return brass[4];
        return '#355d66';
      });
    });
  }
  function fin(coarse) {
    return geometry('fin',box=>{
      box(1.00,1.78,1.08,2.65,.36,.20,brass);
      box(1.05,2.13,1.45,2.64,.37,.23,glaze,(u,v)=>v===0||u===7?glaze[3]:null);
      box(1.45,2.13,1.68,2.30,.37,.23,glaze);
      box(1.45,2.48,1.68,2.64,.37,.23,glaze);
      if (coarse) box(1.45,2.30,1.68,2.48,.37,.23,glaze);
    });
  }
  function cap() {
    return geometry('cap',box=>{
      box(-.20,2.40,.20,2.59,.32,-.08,glaze);
      box(-.12,2.54,.12,2.70,.31,-.07,brass);
    });
  }
  function deck() {
    return geometry('deck',box=>{
      box(-1.61,-.08,1.61,.21,.79,-.65,glaze);
      box(-1.55,.15,1.55,.23,.82,-.71,brass);
      for (let i=0;i<12;i++) {
        const x = -1.65+i*.29;
        box(x,-.08,x+.27,.015,.82,.77,glaze);
      }
      for (const side of [-1,1]) {
        const x=side*1.48;
        box(x-.07,.23,x+.07,.64,.65,.49,glaze);
        box(x-.12,.57,x+.12,.67,.69,.45,brass);
      }
    });
  }

  const builders = {portal,tablet,fin,cap};
  function native(meshes) {
    return makeBuilder(seed,palette).finish({id,meshes,cam:{...cam},radius:4,dither:0,
      fog:{c:0,start:1,max:0},look:{pixelSize:1}});
  }
  function build() {
    const detail = Object.values(builders).map(draw=>draw(false));
    const world = native([...detail,deck()]);
    const {spriteAtlas} = require('../../cli/sprite-atlas.js');
    const api = K.sprite.reconstruction;
    api.bindParts(world,detail.map(mesh=>{
      const part = mesh.partId;
      const atlas = spriteAtlas(native([builders[part](true)]),{pivot,width:80,height:80,
        directions:16,yaw,pitches:[pitch],maps:['depth'],view:{dist:5.1,raw:true,edges:false}});
      return {object,part,material:parts[part],representation:'mesh',mesh,
        sprite:{asset:api.asset({atlas,range:[7.7,10.2]}),at:pivot,lighting:false}};
    }));
    return world;
  }
  return {id,name:'Tide Lock',seed,build};
};
