'use strict';

function box(id,min,max,material) {
  const vertices=Array.from({length:8},(_,i)=>({id:id+'-v'+i,position:min.map((v,k)=>i&(1<<k) ? max[k] : v)}));
  const rings=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
  const uv=[[0,0],[1,0],[1,1],[0,1]];
  const faces=rings.map((ring,i)=>({id:id+'-f'+i,material:Array.isArray(material) ? material[i] : material,corners:ring.map((v,j)=>
    ({id:id+'-c'+i+'-'+j,vertex:vertices[v].id,uv:uv[j]}))}));
  return {id,vertices,faces};
}

function gauge() {
  const base=box('plaque',[-1.85,-.98,-.38],[1.75,.90,.29],['celadon-side','celadon-side','celadon-side','celadon-light','celadon-side','celadon']);
  const lip=box('letterplate',[-1.27,.54,.36],[1.25,.80,.47],['brass-side','brass-side','brass-side','brass','brass-side','brass']);
  const thin=box('fin',[.86,-.59,.39],[1.69,.48,.51],['coral-side','coral-side','coral-side','coral','coral-side','coral']);
  const cutter=box('window',[-.71,-.65,-.81],[.52,.45,.80],'metal');
  const turn=.135, cs=Math.cos(turn), sn=Math.sin(turn);
  for (const row of cutter.vertices) {
    const [x,y,z]=row.position;
    row.position=[-.095+(x+.095)*cs-(y+.10)*sn,-.10+(x+.095)*sn+(y+.10)*cs,z];
  }
  return {target:{id:'tide-gauge',vertices:[...base.vertices,...lip.vertices,...thin.vertices],
    faces:[...base.faces,...lip.faces,...thin.faces]},cutter};
}

module.exports={box,gauge};
