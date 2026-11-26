const fs=require('node:fs');
const {document}=require('../../cli/glb-file.js');

const coupons=[
  {id:'plate',label:'Calibrated plate',thickness:.375},
  {id:'open',label:'Open sheet',reason:'open'},
  {id:'nested',label:'Nested insert',reason:'part'},
  {id:'nonmanifold',label:'Non-manifold edge',reason:'nonManifold'},
  {id:'winding',label:'Flipped face',reason:'winding'},
  {id:'zero',label:'Zero-volume shell',reason:'degenerate'},
  {id:'inverted',label:'Reversed shell',thickness:.25},
  {id:'tie',label:'Coincident exit',reason:'ambiguous'}
];

function writeCoupons(file) {
  const doc=document(), {gltf}=doc, primitives=[], selected=[], labels={};
  const quad=[[0,1,2],[0,2,3]];
  function primitive(polygon,part,uv,normals,triangles=quad){
    const attributes={POSITION:doc.accessor(Float32Array.from(polygon.flat()),'VEC3',{bounds:true})};
    if(uv)attributes.TEXCOORD_0=doc.accessor(Float32Array.from(uv.flat()),'VEC2');
    if(normals)attributes.NORMAL=doc.accessor(Float32Array.from(normals.flat()),'VEC3');
    const index=primitives.length;
    primitives.push({attributes,indices:doc.accessor(Uint32Array.from(triangles.flat()),'SCALAR')});
    if(uv)selected.push(index);
    labels[index]=part;
    return index;
  }
  function box({x,y=0,base=-.5,top=0,r=.84,part,chart,flip=false,wrongBottom=false,shading}) {
    const corners=z=>[[x-r,y-r,z],[x+r,y-r,z],[x+r,y+r,z],[x-r,y+r,z]];
    const lower=corners(base), upper=corners(top);
    const tri=flip?quad.map(row=>row.slice().reverse()):quad;
    primitive(upper,part,chart,shading&&Array(4).fill(shading),tri);
    for(let k=0;k<4;k++) {
      const j=(k+1)%4;
      primitive([lower[k],lower[j],upper[j],upper[k]],part,undefined,undefined,tri);
    }
    primitive(lower,part,undefined,undefined,wrongBottom?tri:tri.map(row=>row.slice().reverse()));
    return {upper,lower};
  }
  for(const [i,{id,thickness}] of coupons.entries()) {
    const x=i*2.6, u=(i%4)/4, v=Math.floor(i/4)/2;
    const chart=[[u+.023,v+.441],[u+.227,v+.441],[u+.227,v+.059],[u+.023,v+.059]];
    if(id==='open'||id==='zero') {
      const points=[[x-.84,-.84,0],[x+.84,-.84,0],[x+.84,.84,0],[x-.84,.84,0]];
      primitive(points,id,chart);
      if(id==='zero')primitive([points[1],points[0],points[3],points[2]],id);
      continue;
    }
    const base=-(thickness??(id==='nested'?1:id==='tie'?.625:.5));
    const shape=box({x,base,part:id,chart,flip:id==='inverted',wrongBottom:id==='winding',
      shading:id==='plate'?[.6,0,.8]:undefined});
    if(id==='nested')box({x,base:-.7,top:-.3,r:.52,part:'insert'});
    if(id==='nonmanifold')primitive(shape.upper,id);
    if(id==='tie')primitive(shape.lower,'foreign-sheet',undefined,undefined,quad.map(row=>row.slice().reverse()));
  }
  gltf.meshes=[{name:'Test coupons',primitives}];
  gltf.nodes=[{mesh:0,scale:[1,1,2]}];gltf.scenes[0].nodes=[0];
  fs.writeFileSync(file,doc.finish());
  return {labels,selected,coupons};
}

module.exports={writeCoupons,coupons};
