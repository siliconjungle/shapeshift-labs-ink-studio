/* Build a mixed GLB that can be inspected independently of its render. */
const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');
const { encode } = require('../../cli/png.js');

const extension = 'KHR_gaussian_splatting';
const tau = 2*Math.PI;
const sh0 = .28209479177387814;
const linear = v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4;
const color = hex => [hex>>16, hex>>8&255, hex&255].map(v=>linear(v/255));

function tidalBeacon() {
  const { gltf, add, accessor, texture, finish } = document();
  gltf.extensionsUsed = [extension];
  const as = (array, type) => accessor(Float32Array.from(array),type,{ target:34962,bounds:type === 'VEC3' });
  const parts = [];
  const pigments = [0x102837,0x3a6370,0x6f9b9c,0xc99463,0xffd5a0];
  const paint = new Uint8Array(128*32*4);
  for (let y=0; y<32; y++) for (let x=0; x<128; x++) {
    const seam = x%16, noise = ((x*53+y*67+x*y*3)%19-9);
    let ink = y<3 ? pigments[3] : y<10 ? pigments[2] : y<29 ? pigments[1] : pigments[0];
    if (seam<1) ink = pigments[0];
    if (seam>2 && seam<6 && (y===13 || y===25)) ink = pigments[4];
    if (seam>=7 && seam<=12 && y>=16 && y<=22 && (seam===7 || seam===12 || y===16 || y===22))
      ink = pigments[2];
    paint.set([ink>>16, ink>>8&255, ink&255].map(v=>Math.max(0,Math.min(255,v+noise))).concat(255), (y*128+x)*4);
  }
  const paintTexture = texture(encode(128,32,paint,4),'Patinated enamel');
  const enamel = add('materials',{name:'Patinated enamel',pbrMetallicRoughness:{baseColorTexture:{index:paintTexture}}});
  const metal = (name, hex) => add('materials',{ name,pbrMetallicRoughness:{baseColorFactor:[...color(hex),1]} });
  const dark = metal('Deep blue enamel',0x244456), rim = metal('Oxidized brass',0xbf865c);
  const shine = metal('Brass trim',0xffc48b), foot = metal('Blue-black steel',0x142532);
  function lathe(profile, material, sections=32) {
    const points=[], uvs=[], indices=[];
    for (const [j,[radius,y]] of profile.entries()) for (let i=0; i<=sections; i++) {
      const angle=i/sections*tau;
      points.push(Math.cos(angle)*radius,y,Math.sin(angle)*radius);
      uvs.push(i/sections,1-j/(profile.length-1));
      if (j && i) {
        const d=j*(sections+1)+i, a=d-sections-2;
        indices.push(a,a+1,d-1,a+1,d,d-1);
      }
    }
    parts.push({ attributes:{POSITION:as(points,'VEC3'),TEXCOORD_0:as(uvs,'VEC2')},
      indices:accessor(Uint16Array.from(indices),'SCALAR',{target:34963}),material });
  }
  lathe([[0,-1.1],[.95,-1.1],[1.08,-1],[1.08,-.95],[0,-.95]],foot);
  lathe([[.94,-.96],[1.02,-.92],[1.02,-.87],[.88,-.82]],rim);
  lathe([[.89,-.86],[.89,-.63],[.8,-.58]],enamel);
  lathe([[.825,-.635],[.9,-.6],[.9,-.55],[.76,-.49],[0,-.49]],shine);
  lathe([[.43,-.5],[.49,-.36],[.44,-.26],[.23,-.2],[.12,.33],[.18,.63],[.3,.78]],dark);
  lathe([[0,.67],[.23,.71],[.41,.81],[.45,.89],[.45,.95],[.32,1.04],[.11,1.13],[0,1.14]],enamel);
  lathe([[.39,.81],[.459,.87],[.459,.895],[.439,.907]],rim);
  lathe([[.29,1.035],[.16,1.114],[.06,1.17],[0,1.17]],shine);
  function waves(phase, tint, colorSpace) {
    const position=[], rotation=[], scale=[], opacity=[], dc=[], sh=[[],[],[]];
    const steps=250;
    for (let i=0; i<steps; i++) {
      const q=i/(steps-1), angle=phase+q*tau*1.3;
      const radius=.55+.44*Math.sin(Math.PI*q)**1.2+.04*Math.sin(angle*3+phase);
      const stretch=.72+.28*Math.abs(Math.sin(angle*1.4+phase));
      const wobble=.085*Math.sin(angle*3-phase);
      const x=Math.cos(angle)*radius, y=-.4+q*1.24+wobble, z=Math.sin(angle)*radius;
      position.push(x,y,z);
      rotation.push(0,Math.sin((-angle-Math.PI/2)/2),0,Math.cos((-angle-Math.PI/2)/2));
      scale.push(.064,.018*stretch,.018);
      opacity.push(Math.round(255*(.24+.68*Math.sin(Math.PI*q)**.6)));
      const boost=.84+.16*Math.sin(angle*2.2+phase), val=tint.map(v=>v*boost);
      dc.push(...val.map(v=>((colorSpace === 'lin_rec709_display' ? linear(v) : v) - .5)/sh0));
      sh[0].push(.07,.09,.12);
      sh[1].push(0,.04,.07);
      sh[2].push(-.05,0,.04);
    }
    const strided = new Uint8Array(steps*4);
    opacity.forEach((value,i)=>strided[i*4]=value);
    const alpha=accessor(strided,'SCALAR',{target:34962});
    const row=gltf.accessors[alpha];
    row.count=steps;
    row.normalized=true;
    gltf.bufferViews[row.bufferView].byteStride=4;
    const attributes={POSITION:as(position,'VEC3'),[extension+':ROTATION']:as(rotation,'VEC4'),
      [extension+':SCALE']:as(scale,'VEC3'),[extension+':OPACITY']:alpha,
      [extension+':SH_DEGREE_0_COEF_0']:as(dc,'VEC3')};
    sh.forEach((row,i)=>attributes[extension+':SH_DEGREE_1_COEF_'+i]=as(row,'VEC3'));
    parts.push({mode:0,attributes,extensions:{[extension]:{kernel:'ellipse',colorSpace}}});
  }
  waves(.2,[.21,.84,.96],'srgb_rec709_display');
  waves(2.3,[.33,.97,.92],'srgb_rec709_display');
  waves(4.4,[1,.7,.36],'lin_rec709_display');
  const beacon = add('meshes',{name:'Tidal beacon · enamel and signal coils',primitives:parts});
  // Instances share both triangle and Gaussian primitives. The rear unit also
  // inherits rotation and uniform scale from its parent boom.
  const hero = add('nodes',{name:'Beacon / primary',mesh:beacon});
  const rear = add('nodes',{name:'Beacon / relay',mesh:beacon,translation:[.16,0,0]});
  const boom = add('nodes',{name:'Relay mounting point',translation:[2.23,-.21,-1.32],
    scale:[.64,.64,.64],rotation:[0,Math.sin(.57),0,Math.cos(.57)],children:[rear]});
  const root = add('nodes',{name:'Tidal station',translation:[-.42,0,0],children:[hero,boom]});
  gltf.scenes[0].nodes.push(root);
  return finish();
}

if (require.main === module) {
  if (!process.argv[2]) throw Error('Choose the output .glb filename');
  fs.writeFileSync(path.resolve(process.argv[2]),tidalBeacon());
}
module.exports = tidalBeacon;
