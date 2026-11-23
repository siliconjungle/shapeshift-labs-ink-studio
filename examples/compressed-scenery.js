// Tern Signal House. The shell, roof, and plinth use BC1. Lettering and decals keep their pixels.
function assets() {
  function texture(size, kind) {
    const pixels = new Uint8Array(size*size*4);
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const n=((x*2477^y*7229^(x*y)*97)&255)/255;
      let color;
      if (kind==='slate') {
        const row=y>>4, joint=(x+(row&1)*16)%32, seam=y%16===0||joint===0;
        const shade=((row*143+(x+(row&1)*16>>5)*79)&15)-7;
        color=seam?[24,44,51]:[66+shade,91+shade,92+shade];
      } else if(kind==='roof') {
        const seam=x%32, ripple=3*Math.sin(y*.17)+2*Math.cos(x*.41);
        color=seam<2?[45,72,69]:seam<4?[121,158,135]:[72+ripple,113+ripple,100+ripple];
      } else {
        const row=y>>5, joint=(x+(row&1)*16)%64, seam=y%32===0||joint===0;
        const shade=4*Math.sin(x*.09+y*.06)+(n-.5)*4;
        color=seam?[46,50,52]:[96+shade,105+shade,99+shade];
      }
      const weather=(n-.5)*6-12*y/size;
      pixels.set([...color.map(v=>Math.round(v+weather)),255],(y*size+x)*4);
    }
    return { width:size,height:size,pixels,delivery:'ktx2' };
  }
  const geometry = Array.from({length:2},()=>({positions:[],uvs:[],indices:[],faceMaterials:[]}));
  const mats=[
    {id:'glazed-masonry',texture:texture(256,'slate')},
    {id:'seamed-copper',texture:texture(128,'roof')},
    {id:'quay-stone',texture:texture(128,'quay')},
    {id:'dark-iron',color:0x233d48},
    {id:'warm-window',color:0xf2bc74}
  ];
  function surface(origin,u,v,slot,steps=1) {
    const {positions,uvs,indices,faceMaterials}=geometry[Number(slot>=3)];
    const at=positions.length/3;
    for(let y=0;y<=steps;y++) for(let x=0;x<=steps;x++) {
      positions.push(...origin.map((axis,i)=>axis+(u[i]*x+v[i]*y)/steps));
      uvs.push(x/steps,y/steps);
      if(x<steps&&y<steps){
        const a=at+y*(steps+1)+x,b=a+steps+1;
        indices.push(a,a+1,b,b,a+1,b+1);
        faceMaterials.push(slot%3,slot%3);
      }
    }
  }
  function box(x,y,z,w,h,d,slot,steps=1) {
    surface([x,y+h,z+d],[w,0,0],[0,-h,0],slot,steps);
    surface([x+w,y+h,z+d],[0,0,-d],[0,-h,0],slot,steps);
    surface([x+w,y+h,z],[0,0,d],[-w,0,0],slot,steps);
    surface([x,y+h,z],[0,0,d],[0,-h,0],slot,steps);
    surface([x+w,y+h,z],[-w,0,0],[0,-h,0],slot,steps);
  }
  box(-2.8,-.62,-1.68,5.6,.42,3.36,2,20);
  box(-1.72,-.2,-1.12,3.2,1.9,2.11,0,28);
  box(-1.86,1.67,-1.23,3.49,.13,2.39,3);
  surface([-1.93,1.8,1.23],[3.63,0,0],[0,.72,-1.23],1,28);
  surface([-1.93,2.52,0],[3.63,0,0],[0,-.72,-1.23],1,28);
  box(-1.34,1.87,-.88,.37,1.04,.42,0);
  box(-1.40,2.86,-.94,.49,.13,.54,3);
  box(-.7,-.21,1.02,1.28,.12,.55,2);
  box(-.62,-.10,1.02,1.12,.12,.39,2);
  box(-.56,.02,.98,1.0,1.17,.045,3);
  box(-.47,.12,1.026,.81,.90,.014,0);
  for (let i=0;i<2;i++) {
    const left=i===0?-1.45:.69;
    box(left,.51,.984,.53,.60,.084,3);
    box(left+.055,.57,1.069,.42,.48,.009,4);
    box(left+.248,.56,1.08,.034,.49,.011,3);
    box(left+.056,.782,1.08,.419,.036,.011,3);
  }
  box(1.44,.43,-.79,.09,.58,.51,3);
  box(1.53,.50,-.72,.012,.44,.37,4);
  box(1.54,.50,-.58,.006,.44,.035,3);
  for (const [x,z] of [[-2.46,1.38],[2.46,1.38],[2.46,-1.32],[-2.46,-1.32]])
    box(x,-.2,z,.14,.58,.14,3);
  box(-2.4,.26,1.43,1.48,.055,.055,3);
  box(.86,.26,1.43,1.64,.055,.055,3);
  box(2.49,.26,-1.28,.055,.055,2.75,3);
  const packed = [
    {id:'signal-house',objectId:'tern-station',partId:'scenery',...geometry[0],materials:mats.slice(0,3)},
    {id:'station-fixtures',objectId:'tern-station',partId:'fixtures',...geometry[1],materials:mats.slice(3)}
  ];
  function plaque(id,x,y,z,width,height,texture) {
    return {id,objectId:'tern-station',partId:id,positions:[x,y+height,z,x+width,y+height,z,x,y,z,x+width,y,z],
      indices:[0,1,2,2,1,3],uvs:[0,0,1,0,0,1,1,1],materials:[{id,texture,mipmaps:false}]};
  }
  const letters=[
    ['111','010','010','010','010'], ['111','100','110','100','111'],
    ['110','101','110','101','101'], ['101','111','111','111','101']
  ], width=25, height=11;
  const paint=new Uint8Array(width*height), coverage=new Uint8Array(width*height).fill(255);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const edge=Math.min(x,y,width-1-x,height-1-y);
    if(edge===0)paint[y*width+x]=1;
    if(edge===1)paint[y*width+x]=2;
    if(edge===0&&(x===0||x===width-1)&&(y===0||y===height-1))coverage[y*width+x]=0;
  }
  letters.forEach((letter,i)=>letter.forEach((row,y)=>Array.from(row).forEach((on,x)=>{
    if(on==='1')paint[(y+3)*width+5+i*4+x]=3;
  })));
  packed.push(plaque('indexed-tern-sign',-.86,1.25,1.073,1.34,.38,
    {width,height,indices:paint,coverage,palette:[0x183640,0x352e30,0x71968b,0xfbe8ae]}));
  const decal=new Uint8Array(16*16*4);
  for(let y=0;y<16;y++) for(let x=0;x<16;x++) {
    const d=Math.abs(x-7.5)+Math.abs(y-7.5);
    if(d<=7)decal.set(d>5?[249,225,170,255]:[164,75,51,255],(y*16+x)*4);
    if(x===7&&y>=5&&y<=9)decal.set([26,41,41,255],(y*16+x)*4);
  }
  packed.push(plaque('lossless-door-decal',-.23,.43,1.061,.34,.34,{width:16,height:16,pixels:decal}));
  return packed;
}

function world(kit, meshes) {
  const B=kit.makeBuilder(26,[0x172933,0x1e414b,0x3d606b,0x769389,0xa6bca7,0xf4c480]);
  return B.finish({meshes,dither:0,cam:{target:[0,1.0,0],dist:10.4,yaw:.40,pitch:.27,ortho:true}});
}

module.exports = kit => ({id:'tern-signal-house',name:'Tern Signal House',seed:26,
  scenery:assets, world:meshes=>world(kit,meshes),
  build:()=>world(kit,assets().map(asset=>kit.KIT.sceneMeshes.create(asset)))});
