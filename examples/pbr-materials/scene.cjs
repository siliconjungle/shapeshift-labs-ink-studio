'use strict';

const width = 520, height = 300, initial = 36;
const palette = [
  0x0d111b,0x191f30,0x2b3348,0x475268,0x69768c,0x9bacad,0xe4e4d4,
  0x2b171c,0x4f2928,0x7c4738,0xac6a48,0xd6945e,0xedbd81,0xffe5ad,
  0x102b30,0x16434a,0x22656a,0x368b8a,0x58b6a5,0x92debc,0xcfffe6,
  0x292839,0x42445a,0x5a5f77,0x7b8395,0xa7afbd,0xe2e9f2,0xf6f3df
];
const paletteRoles = { copper:[7,8,9,10,11,12,13], teal:[14,15,16,17,18,19,20] };

function paletteMaterials(physical, ramps) {
  const {copper,lens,cable} = physical.materials;
  const diffuse = (role,positions) => ({ role, positions, interpolation:'step' });
  const highlight = (stops,weights,strength) => ({
    lightingRamp:{stops,weights,interpolation:'smooth'},strength
  });
  const scenePalette = {
    ...physical,materials:{
      ...physical.materials,
      copper:{...copper,highlight:{color:'#ffe5ad',threshold:.47,strength:.66}},
      lens:{...lens,highlight:{color:'#cfffe6',threshold:.29,strength:.5}}
    }
  };
  if (!ramps) return scenePalette;
  return {
    ...physical,materials:{
      ...physical.materials,
      copper:{...copper,wrap:.12,rampStrength:.88,
        lightingRamp:diffuse('copper',[0,.24,.43,.66,.84,.965,1]),
        highlight:highlight([[0,'#7c4738'],[.24,'#d6945e'],[.57,'#edbd81'],[1,'#ffe5ad']],[0,.01,.59,.97],.85)},
      cable:{...cable,wrap:.20,
        lightingRamp:diffuse('teal',[0,.20,.36,.55,.71,.96,1]),
        highlight:highlight([[0,'#22656a'],[.34,'#58b6a5'],[.72,'#92debc'],[1,'#cfffe6']],[0,.04,.58,.96],1)},
      lens:{...lens,wrap:.08,rampStrength:.14,
        lightingRamp:diffuse('teal',[0,.24,.40,.62,.83,.96,1]),
        highlight:highlight([[0,'#368b8a'],[.28,'#58b6a5'],[.60,'#92debc'],[1,'#cfffe6']],[0,.19,.66,1],.8)}
    }
  };
}

function keyLight(degrees, shadows = false) {
  const angle = degrees * Math.PI / 180;
  return [
    { direction:[-.72 * Math.cos(angle), .52 + .21 * Math.sin(angle), .62 + .34 * Math.sin(angle)],
      color:'#ffe5c3', intensity:2.6, shadows, mapSize:192, filter:1 },
    { direction:[.72,-.3,.51],color:'#8ee6ee',intensity:.62 },
    { direction:[.22,.92,-.15],color:'#f6a379',intensity:.5 }
  ];
}

function shutterPositions(offset=0) {
  const x=-6.1+offset,y=3.3,z=5.2,w=3.0,h=2.3;
  return [x,y,z,x+w,y,z,x+w,y+h,z,x,y+h,z];
}

function poseShutter({KIT}, world, offset) {
  KIT.sceneMeshes.pose(world.meshes.find(mesh=>mesh.id==='shutter'),shutterPositions(offset));
}

function createScene({ KIT, makeBuilder, SpriteSurface }, { bakeObjectTexels, shadowStudy = false }) {
  const B = makeBuilder(191,palette), meshes = [], surface = SpriteSurface.make(40);
  const { sceneMeshes, curveSplats } = KIT;
  const ring = (name, x, y, profile, material, color, count = 90) => {
    const positions = [], uvs = [], indices = [];
    for (let step = 0; step <= count; step++) {
      const angle = (step / count + .125) * Math.PI * 2;
      for (let i = 0; i < profile.length; i++) {
        const [r,z] = profile[i];
        positions.push(x + r * Math.cos(angle),y + r * Math.sin(angle),z);
        uvs.push(step/count,i/(profile.length-1));
        if (step && i) {
          const a = step * profile.length + i, b = a - profile.length;
          indices.push(b-1,b,a,b-1,a,a-1);
        }
      }
    }
    meshes.push(sceneMeshes.create({id:name,positions,uvs,indices,materials:[{id:material,color}]}));
  };
  function box(name, x, y, w, h, front, depth, radius, material, color) {
    const positions = [], uvs = [], indices = [];
    for (const [inset,z] of [[0,front-depth],[0,front-.055],[.055,front]]) {
      const dx = w/2-inset, dy = h/2-inset, r = Math.max(.02,radius-inset);
      const rim = [[-dx+r,-dy],[dx-r,-dy],[dx,-dy+r],[dx,dy-r],
        [dx-r,dy],[-dx+r,dy],[-dx,dy-r],[-dx,-dy+r]];
      for (const [px,py] of rim) {
        positions.push(x+px,y+py,z);
        uvs.push(.5+px/w,.5-py/h);
      }
    }
    for (let i=0;i<16;i++) {
      const j = (i+1)%8+8*Math.floor(i/8);
      indices.push(i,j,j+8,i,j+8,i+8);
    }
    for (let i=17;i<23;i++) indices.push(16,i,i+1);
    const result={ points:positions,triangles:indices };
    if(material) meshes.push(sceneMeshes.create({ id:name, positions,uvs,indices,materials:[{id:material,color}] }));
    return result;
  }
  const cx=-1.71, cy=.23;
  const bolt = (id, x, y, z, r) => {
    ring(id,x,y,[[r,z-.06],[r,z-.02],[r*.78,z],[.005,z]],'steel',0x848b9c,12);
    surface.face([x-r*.62,y-r*.09,z+.002],[r*1.24,0,0],[0,r*.18,0],2,2,()=>0x1d2230);
  };

  surface.face([-10,-5,-1.63],[20,0,0],[0,10,0],32,32,(x,y) => {
    const falloff = Math.max(0,1-Math.hypot((x-16)/17,(y-13)/15));
    const grain = (x * 31 + y * 19 + x * y * 7) % 5;
    return (16 + Math.floor(13*falloff)+grain) * 65536 + (17+Math.floor(11*falloff)+grain)*256 + 28+Math.floor(17*falloff)+grain;
  });
  box('Lower platform',.10,-1.66,6.84,.44,-.03,.3,.15,'frame',0x363f51);
  box('Chamfered lip',.10,-1.45,6.88,.12,.01,.12,.09,'copper',0x835f50);
  box('Mounting plate',.13,.13,6.65,2.75,-.36,.42,.28,'frame',0x3d4354);
  box('Antenna spine',.38,1.15,.23,1.50,-.05,.2,.10,'steel',0x737981);
  bolt('Antenna cap',.38,1.88,.03,.138);
  ring('Copper collar',cx,cy,[[1.36,-.37],[1.41,-.25],[1.41,.08],[1.33,.32],[1.19,.42],[1.02,.40],[.95,.27]],'copper',0xd39059);
  ring('Dark gasket',cx,cy,[[1.14,.41],[1.07,.49],[.98,.49],[.91,.39]],'gasket',0x2e364b);
  ring('Instrument trim',cx,cy,[[1.32,.33],[1.284,.39],[1.23,.409]],'silver',0x91735a);
  ring('Recessed bed',cx,cy,[[.94,.38],[.89,.27],[.04,.19]],'frame',0x283747);
  for (let i=0;i<8;i++) {
    const a = (i+.5)*Math.PI/4;
    bolt('Collar bolt '+i,cx+1.19*Math.cos(a),cy+1.19*Math.sin(a),.455,.078);
  }

  const first=B.count();
  for (let i=0;i<1500;i++) {
    const z = 1-2*(i+.5)/1500, angle = i * Math.PI*(3-Math.sqrt(5));
    const radius=Math.sqrt(1-z*z), n=[radius*Math.cos(angle),radius*Math.sin(angle),z];
    const ripple=.828+.013*Math.sin(13*n[0]+9*n[1]+26*n[2])*Math.sin(15*n[1]+12*n[2]);
    const trace=Math.sin(n[0]*16+n[2]*11)*Math.cos(n[1]*13-n[2]*12);
    const swatch=trace>.85?20:trace>.37?19:trace>-.20?17:16;
    B.disc(cx+n[0]*ripple,cy+n[1]*ripple,.34+n[2]*ripple*.78,n,.049,.009,B.P[swatch],1);
  }
  B.describeSplats(first,B.count(),{object:'Signal lens',material:'lens'});

  const body = box('Switchboard',2.07,.55,1.93,1.30,.35,.42,.18);
  const bake = bakeObjectTexels(body,{ origin:[2.07,.55,.2],resolution:26,
    material:({point:[x,y]})=>{
      const seam = Math.cos(19*x+9*y)*Math.cos(29*y);
      const trace = y>.83 && y<.93 && x>1.41 && x<2.7;
      const screen=x>1.31&&x<2.82&&y>.26&&y<.71;
      const pixel=Math.floor(x*25)%5===0 && Math.floor(y*19)%3===0;
      return {pigment:trace?0xae775a:screen?(pixel?0x74ccad:0x285453):seam>.35?0x788396:0x68758a,
        roughness:screen?.29:.5+.10*seam,metalness:trace?.86:.12,
        emission:screen?(pixel?0x68c9a5:0x152d35):0};
    },
    fallback:()=>({pigment:0x627184,roughness:.57,metalness:.1})
  });
  meshes.push(sceneMeshes.fromObjectTexels(bake,{id:'Switchboard',materialId:'ceramic'}));
  for (const x of [1.3,2.83]) {
    bolt('Switchboard bolt top '+x,x,1.02,.398,.075);
    bolt('Switchboard bolt bottom '+x,x,.08,.398,.075);
  }

  surface.face([.47,-.82,.225],[.79,0,0],[0,.65,0],18,14,(x,y) => {
    if (x===0||y===0||x===17||y===13) return 0x376467;
    if (y===3&&x>2&&x<15||y===10&&x>2&&x<8||y===8&&x===12) return 0x70ab95;
    return (x+y)%6===0?0x264247:0x1d333b;
  },{id:'Relay status badge',objectId:'Badge',materialId:'decal',projection:{mapping:'affine',vertexSnap:.3}});
  box('Badge bracket',.865,-.50,.93,.77,.20,.22,.12,'gasket',0x39404f);

  const cables = [
    {color:'#a66448',id:'copper',route:[[.38,1.68,.10],[.81,1.79,.13],[1.30,1.66,.22],[1.70,1.35,.31],[1.72,1.17,.36]],width:.18},
    {color:'#71ac9c',id:'cable',route:[[1.63,.10,.40],[1.52,-.38,.60],[1.72,-.85,.73],[2.24,-1.07,.69],[2.95,-.93,.49],[3.29,-.44,.07],[3.03,-.12,-.04]],width:.19},
    {color:'#c67d56',id:'copper',route:[[2.51,.03,.42],[2.39,-.33,.59],[2.15,-.66,.73],[2.18,-1.16,.58],[2.85,-1.28,.41],[3.17,-.97,.29]],width:.15},
    {color:'#497d79',id:'cable',route:[[.13,.81,.14],[.03,.37,.18],[.13,-.05,.27],[.58,-.16,.48],[.98,-.07,.45],[1.17,.19,.35]],width:.13}
  ];
  for (const {color,id,route,width} of cables) {
    const points = B.spline(route,9);
    curveSplats.draw(B,points,{ color,width,edge:'hard',caps:'rounded',object:'Wire assembly',material:id });
  }
  for (const [index,x] of [1.62,2.51].entries())
    bolt('Cable collar '+index,x,.08,.59,.118);
  for (let i=0;i<33;i++) {
    const x=-2.68+i*.167;
    surface.face([x,-1.72,.036],[i%4===0?.03:.016,0,0],[0,i%4===0?.10:.056,0],2,2,
      ()=>i%4===0?0x927c67:0x60565a);
  }
  if(shadowStudy){
    const size=48,pixels=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const slat=(x+Math.floor(y*.27))%13;
      const rim=x<2||x>=size-2||y<2||y>=size-2;
      if(rim||slat<5) pixels.set(rim?[90,77,80,255]:[52,52,65,255],(y*size+x)*4);
    }
    meshes.push(sceneMeshes.create({id:'shutter',objectId:'shutter',positions:shutterPositions(),
      uvs:[0,1,1,1,1,0,0,0],indices:[0,1,2,0,2,3],
      materials:[{id:'shutter',texture:{width:size,height:size,pixels}}]}));
  }

  const materials = {
    copper:{roughness:.37,metalness:.82,anisotropy:.6,coating:{weight:.26,roughness:.27}},
    silver:{roughness:.28,metalness:.91,coating:.22},
    steel:{roughness:.39,metalness:.73,coating:.24},
    frame:{roughness:.65,metalness:.21},
    gasket:{roughness:.89},
    lens:{roughness:.48,metalness:.22,coating:{weight:.72,roughness:.31},emission:'#215658',emissionStrength:.44},
    ceramic:{coating:{weight:.40,roughness:.39}},
    decal:{roughness:.65,emission:'#20474a',emissionStrength:.42},
    cable:{roughness:.43,coating:{weight:.53,roughness:.32},anisotropy:.68}
  };
  const pbrMaterials = {
    materials, bindings:Object.keys(materials).map(id=>({select:{material:id},material:id})),
    lights:keyLight(initial,shadowStudy), environment:{sky:'#a9c9ef',horizon:'#a096b1',ground:'#534869',intensity:.71},exposure:1.15,
    projections:[
      { material:'copper', origin:[-3.25,-.77,.32],u:[2.44,1.88,0],v:[-.10,.13,0],reach:.4,feather:.07,
        channels:{baseColor:'#735759',roughness:.73,metalness:.32,coating:.02} },
      { material:'ceramic', origin:[2.19,.22,.35],u:[.52,.32,0],v:[-.06,.10,0],reach:.13,feather:.055,
        channels:{baseColor:'#31575b',roughness:.77,coating:0,emission:'#224248'} }
    ]
  };
  const shadowArt=shadowStudy?{cast:{include:[{object:'shutter'}]}}:undefined;
  return B.finish({ meshes,spriteSurfaces:surface.finish(),radius:5,paletteRoles,look:{pbrMaterials,shadowArt},
    cam:{target:[0,.06,0],dist:7.92,fov:.62,yaw:.055,pitch:.13,ortho:true},
    fog:{start:1,max:0},dither:0 });
}

if (typeof module !== 'undefined') module.exports = { createScene, keyLight, paletteMaterials, poseShutter, width, height, initial };
