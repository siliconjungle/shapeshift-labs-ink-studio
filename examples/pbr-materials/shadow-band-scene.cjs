'use strict';

const width = 136, height = 102;
const palette = [0x111922,0x202631,0x30232a,0x55343a,0x795045,0xa9704d,
  0xd39a60,0xf0c67b,0xffeab2,0x284249,0x365a60,0x558986,0x8ec6b1,0xc7ebd0];
const strokes = [
  {points:[[-.80,.64,.48],[-.61,.65,.54],[-.34,.57,.66],[-.19,.48,.70]],radius:.15,bias:.40,softness:.26},
  {points:[[.80,.64,.48],[.61,.65,.54],[.34,.57,.66],[.19,.48,.70]],radius:.15,bias:.40,softness:.26},
  {points:[[-.77,.02,.52],[-.68,-.18,.55],[-.48,-.31,.58]],radius:.23,bias:-.31,softness:.34},
  {points:[[.77,.02,.52],[.68,-.18,.55],[.48,-.31,.58]],radius:.23,bias:-.31,softness:.34},
  {points:[[-.51,-.55,.51],[0,-.73,.58],[.51,-.55,.51]],radius:.115,bias:.25,softness:.2}
];

function study({KIT,makeBuilder}) {
  const B = makeBuilder(120,palette), positions = [], indices = [], slots = [];
  const materials = [{ id:'brass',color:0xa9704d },{ id:'seam',color:0x30232a },
    { id:'glass',color:0x558986 },{ id:'glint',color:0xc7ebd0 }];
  function polygon(points, material=0) {
    const first = positions.length / 3;
    positions.push(...points.flat());
    for (let i=1;i<points.length-1;i++) {
      indices.push(first,first+i,first+i+1);
      slots.push(material);
    }
  }
  function ring(outer,inner,material=0) {
    for (let i=0;i<outer.length;i++){
      const j=(i+1)%outer.length;
      polygon([outer[i],outer[j],inner[j],inner[i]],material);
    }
  }
  const mirror = (row,transform)=>[...row,...row.slice(1,-1).reverse().map(p=>transform(p))];
  const rim = mirror([[0,1.20,.13],[.59,1.24,.04],[1.02,1.02,-.02],[1.20,.64,-.02],
    [1.21,.03,-.05],[.94,-.58,.01],[.59,-.92,.06],[0,-1.08,.14]],([x,y,z])=>[-x,y,z]);
  const face = mirror([[0,1.08,.45],[.51,1.11,.42],[.89,.87,.30],[1.01,.53,.35],
    [1.02,.06,.36],[.79,-.46,.36],[.49,-.76,.41],[0,-.92,.49]],([x,y,z])=>[-x,y,z]);
  const inner = mirror([[0,.80,.66],[.41,.85,.57],[.72,.71,.50],[.82,.39,.50],
    [.81,.01,.53],[.60,-.30,.55],[.37,-.54,.59],[0,-.67,.65]],([x,y,z])=>[-x,y,z]);
  const bevel = rim.map(([x,y,z],i)=>[(x+face[i][0])*.5,(y+face[i][1])*.5,(z+face[i][2])*.5]);
  ring(rim,bevel,1);
  ring(bevel,face);
  ring(face,inner);
  const ridge = [0,.23,.74];
  for (let i=0;i<inner.length;i++) polygon([inner[i],inner[(i+1)%inner.length],ridge]);

  for (const side of [-1,1]) {
    const reflect = points=>points.map(([x,y,z])=>[side*x,y,z]);
    polygon(reflect([[.16,.39,.77],[.34,.49,.74],[.76,.52,.68],[.85,.39,.66],
      [.62,.24,.70],[.33,.22,.78],[.20,.28,.80]]),1);
    polygon(reflect([[.25,.36,.795],[.38,.42,.775],[.70,.44,.71],[.74,.38,.705],
      [.59,.305,.742],[.36,.285,.795]]),2);
    polygon(reflect([[.38,.39,.81],[.68,.414,.742],[.63,.376,.756],[.39,.356,.81]]),3);
    polygon(reflect([[.27,-.43,.695],[.60,-.31,.655],[.72,-.25,.603],[.62,-.35,.652],[.28,-.47,.696]]),1);
    polygon(reflect([[.92,.69,.47],[1.00,.62,.47],[1.01,.54,.47],[.94,.53,.47],[.89,.60,.47]]),1);
  }
  polygon([[-.27,-.23,.714],[0,-.28,.76],[.27,-.23,.714],[.14,-.36,.732],[0,-.40,.735],[-.14,-.36,.732]],1);
  polygon([[-.24,-.58,.694],[0,-.63,.708],[.24,-.58,.694],[.13,-.64,.702],[0,-.68,.707],[-.13,-.64,.702]],1);

  const uvs = [];
  for (let i=0;i<positions.length;i+=3) uvs.push(.5+positions[i]/3,.5-positions[i+1]/3);
  const mesh = KIT.sceneMeshes.create({id:'brass-warden',positions,indices,uvs,materials,faceMaterials:slots});
  const lightingRamp = {stops:[[0,'#55343a'],[.18,'#795045'],[.37,'#a9704d'],[.59,'#d39a60'],
    [.77,'#f0c67b'],[.94,'#ffeab2']],interpolation:'step'};
  const world = B.finish({meshes:[mesh],radius:4,dither:0,fog:{start:1,max:0,c:0},
    cam:{target:[0,.08,0],yaw:0,pitch:0,dist:4.9,fov:.60,ortho:true},
    look:{pbrMaterials:{materials:{brass:{roughness:.57,metalness:.46,wrap:.12,
      lightingRamp,shadowBand:{strokes},
      highlight:{color:'#ffeab2',threshold:.47,strength:.32}}},
      bindings:[{select:{material:'brass'},material:'brass'}],environment:{intensity:.17}}}
  });
  function pose(degrees) {
    const angle=degrees*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle);
    const turned = [];
    for(let i=0;i<positions.length;i+=3) {
      const [x,y,z]=positions.slice(i,i+3);
      turned.push(x*c+z*s,y,z*c-x*s);
    }
    KIT.sceneMeshes.pose(mesh,turned);
  }
  return {world,pose};
}

function light(angle) {
  const rad=angle*Math.PI/180;
  return [{direction:[Math.sin(rad)*.96,.28,Math.cos(rad)*.96],intensity:1.2,color:'#fff1d9'}];
}

module.exports = {width,height,study,light,strokes};
