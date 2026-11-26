// Two translated planes share a known shading normal. The second UV island is mirrored in U.
const fs = require('node:fs');
const path = require('node:path');
const { document } = require('../../cli/glb-file.js');

const worldNormal = [-.4,.3,Math.sqrt(.75)];
const tangentNormals = [[.3,-.4,Math.sqrt(.75)],[-.3,-.4,Math.sqrt(.75)]];
const heights = [.125,-.0625];

function writeReference(directory) {
  fs.mkdirSync(directory,{recursive:true});
  for(const kind of ['low','high']) {
    const doc=document(), {gltf}=doc, high=kind==='high';
    const add=(values,type)=>doc.accessor(Float32Array.from(values),type,{bounds:type==='VEC3'});
    function plane({x=0,z=0,normal=[0,0,1],uv}) {
      const attributes={POSITION:add([x,0,z,x+1,0,z,x+1,1,z,x,1,z],'VEC3'),
        NORMAL:add(Array(4).fill(normal).flat(),'VEC3')};
      if(uv)attributes.TEXCOORD_0=add(uv,'VEC2');
      return {attributes,indices:doc.accessor(Uint32Array.of(0,1,2,0,2,3),'SCALAR')};
    }
    const plain=[.09,.91,.91,.91,.91,.09,.09,.09], mirror=[1.91,.91,1.09,.91,1.09,.09,1.91,.09];
    gltf.meshes=[{name:kind,primitives:heights.map((z,i)=>plane({x:i*2,z:high?z:0,
      ...(high?{normal:[.3,.4,Math.sqrt(.75)]}:{uv:i?mirror:plain})}))}];
    if(!high)gltf.meshes.push({name:'Tilted',primitives:[plane({normal:[.3,0,Math.sqrt(.91)],uv:plain})]});
    gltf.nodes=gltf.meshes.map((_,mesh)=>({mesh,rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]}));
    gltf.scenes[0].nodes=gltf.nodes.map((_,i)=>i);
    fs.writeFileSync(path.join(directory,kind+'.glb'),doc.finish());
  }
  const expected={worldNormal,tangentNormals,heights,tiles:[1001,1002]};
  fs.writeFileSync(path.join(directory,'expected.json'),JSON.stringify(expected,null,2)+'\n');
  return expected;
}

module.exports={writeReference};
