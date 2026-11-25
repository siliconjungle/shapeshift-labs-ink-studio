'use strict';

const ink = require('../..');

function fixture(sheet = ink.createBlankTileset({width:56,height:8,background:'#467c78'})) {
  const scene = {id:'canopy-selection',style:'slate',solids:[],tilesets:{enamel:sheet},
    camera:{target:[1.4,.72,1.1],dist:5.6,yaw:.42,pitch:.24,projection:'orthographic',sway:0}};
  const {cropSource} = ink.load().KIT.authoring.tilesetFaces;
  const vertices = [], faces = [], bindings = [];
  const point = (id,position)=>vertices.push({id,position});
  function panel(id,vertexIds,cell) {
    const x=cell*8, selection=ink.pickTilesetRectangle(scene,'enamel',{x,y:0,width:8,height:8});
    const {source,pigmentUV}=cropSource(sheet,selection);
    faces.push({id,material:'enamel',corners:vertexIds.map((vertex,i)=>({id:id+'/c'+i,vertex,uv:pigmentUV[i]}))});
    bindings.push({id:'tileset/'+id,domain:'faces',element:id,data:source});
  }
  const names = ['flat','rise-15','rise-30','fold-55','return-90'];
  const station = (i,x,z)=>{
    point(`s${i}-low`,[x,0,z]);
    point(`s${i}-high`,[x,1,z]);
  };
  let x=0,z=0;
  station(0,x,z);
  for (const [i,degrees] of [0,15,30,55,90].entries()) {
    const angle=degrees*Math.PI/180, next=i+1;
    x+=.72*Math.cos(angle);
    z+=.72*Math.sin(angle);
    station(next,x,z);
    panel(names[i],[`s${i}-low`,`s${next}-low`,`s${next}-high`,`s${i}-high`],i);
  }
  point('tab-left',[-.41,-.58,0]);
  point('tab-right',[.19,-.58,0]);
  panel('tab',['s0-low','tab-left','tab-right'],5);
  const loose = [[.05,1.33,.1],[.77,1.33,.1],[.77,1.89,.1],[.05,1.89,.1]];
  loose.forEach((position,i)=>point('spare/v'+i,position));
  panel('spare',loose.map((_,i)=>'spare/v'+i),6);

  scene.topologyMeshes={canopy:{document:{id:'canopy',vertices,faces,edges:[{id:'lead',vertices:['s0-low','s1-low']},
    {id:'fold-start',vertices:['s1-low','s1-high']}]},bindings,materials:[{id:'enamel',texture:{tileset:'enamel'}}]}};
  return scene;
}

module.exports = {fixture};
